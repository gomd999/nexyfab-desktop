#!/usr/bin/env node
/**
 * kernel-step-import.mjs — STEP 을 **커널(OCCT)로 읽어 메시 부품으로** 내보내는 러너
 * (260801i). 부모(API 라우트)가 **자식 프로세스로** 실행한다.
 *
 * ## 왜 프로세스를 나누나 — 실측 근거
 * OCCT 는 WASM 힙을 쓰고 **JS GC 대상이 아니다.** 형상마다 `delete()` 를 불러도
 * 코퍼스 35파일을 한 프로세스에서 연속 처리하면 **힙 3.7GB 에서 죽는다**(2회 재현).
 * Next.js 서버는 장수 프로세스라 이걸 인라인으로 두면 요청이 쌓일수록 서버가 죽는다.
 *
 * 프로세스를 나누면 **종료와 함께 전부 회수된다.** 대가는 기동 비용(WASM 초기화 ~1초)인데,
 * 임포트 자체가 초 단위라 비율로는 작다. 「빠르지만 가끔 서버가 죽는다」보다 낫다.
 *
 * ## 입출력
 *   node kernel-step-import.mjs <입력STEP경로> <출력JSON경로> [정점상한]
 * 성공: 출력 경로에 `{ ok:true, parts:[...], warnings:[...] }` · 종료코드 0
 * 실패: 출력 경로에 `{ ok:false, reason:"..." }` · 종료코드 0
 *   ⚠ 실패도 **0 으로 끝낸다** — 부모가 「프로세스 죽음」과 「형상을 못 읽음」을 구별해야 한다.
 *
 * ## 결과를 stdout 으로 내보내지 않는 이유
 * 삼각형 20만 개면 JSON 이 수십 MB 다. 파이프 버퍼 한도에 걸리면 **부분만 읽히고도
 * 성공처럼 보인다** — 잘린 형상을 실측이라 내보내는 것이 가장 나쁜 실패다. 파일로 쓴다.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, maxVertsArg] = process.argv;
const MAX_VERTS = Number(maxVertsArg) > 0 ? Number(maxVertsArg) : 400_000;
/** 메시 허용오차 — `stepKernelImport.ts` 의 상수와 **같은 값**이어야 한다(회귀가 묶는다). */
const TOL_MM = 0.2;
const ANG_DEG = 20;

const fail = (reason) => {
  try { writeFileSync(outPath, JSON.stringify({ ok: false, parts: [], warnings: [], reason })); } catch { /* 기록 실패는 종료코드로 드러난다 */ }
  process.exit(0);
};

if (!inPath || !outPath) {
  console.error('usage: kernel-step-import.mjs <in.step> <out.json> [maxVerts]');
  process.exit(2);
}

/** 삼각 메시 폐부피 — 부호付き 사면체 합. 닫힌 메시에서 정확하다. */
function meshVolume(V, T) {
  let v6 = 0;
  for (let i = 0; i + 2 < T.length; i += 3) {
    const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
    v6 += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1])
      - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c])
      + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return Math.abs(v6) / 6;
}

let rc;
try {
  ({ ensureReplicad: rc } = await import('./to-step.mjs'));
  rc = await rc();
} catch (e) {
  fail(`커널을 불러오지 못했다: ${String(e?.message ?? e).slice(0, 160)}`);
}

let shapes;
try {
  shapes = await rc.importSTEP(new Blob([readFileSync(inPath)]));
} catch (e) {
  // 못 읽으면 **못 읽었다고 적는다.** 경계로 상자를 만들어 넣지 않는다.
  fail(`커널이 STEP 을 읽지 못했다: ${String(e?.message ?? e).slice(0, 160)}`);
}

const arr = Array.isArray(shapes) ? shapes : [shapes];
const parts = [];
let skippedNoMesh = 0, skippedTooBig = 0, skippedOpen = 0;

for (const [n, shape] of arr.entries()) {
  let m = null;
  try { m = shape.mesh({ tolerance: TOL_MM, angularTolerance: ANG_DEG }); } catch { m = null; }
  const V = m?.vertices, T = m?.triangles;
  const release = () => { try { shape.delete?.(); } catch { /* 해제 실패가 진행을 막지 않는다 */ } };
  if (!V || !T || V.length < 9 || T.length < 3) { skippedNoMesh++; release(); continue; }
  if (V.length / 3 > MAX_VERTS) { skippedTooBig++; release(); continue; }

  const verts = [];
  for (let i = 0; i + 2 < V.length; i += 3) verts.push([V[i], V[i + 1], V[i + 2]]);
  const faces = [];
  for (let i = 0; i + 2 < T.length; i += 3) faces.push([T[i], T[i + 1], T[i + 2]]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (const k of [0, 1, 2]) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
  const vol = meshVolume(V, T);
  const boxVol = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
  /**
   * ⚠ 닫힌 메시가 아니면 부호합은 부피가 아니다 — 열린 셸에서는 상쇄로 아무 값이나 나온다.
   *   경계 부피를 **상한**으로 교차 확인한다. 넘으면 부피를 내지 않는다(질량이 통째로 거짓이 된다).
   */
  if (!(vol > 0) || !(boxVol > 0) || vol > boxVol * 1.001) { skippedOpen++; release(); continue; }

  parts.push({
    id: `kernel_${n}`, type: 'mesh',
    params: { volumeMm3: +vol.toFixed(4), triCount: faces.length, aabb: { min, max }, verts, faces },
    at: { tx: 0, ty: 0, tz: 0 }, role: 'imported', fidelity: 'kernel-mesh',
  });
  release();
}

if (!parts.length) {
  fail(skippedTooBig
    ? `커널은 읽었으나 정점이 상한(${MAX_VERTS})을 넘어 받지 않았다 — 잘라서 받으면 형상이 거짓이 된다`
    : skippedOpen
      ? '커널은 읽었으나 닫힌 형상이 없었다 — 열린 셸은 부피가 성립하지 않는다'
      : '커널은 읽었으나 부피를 가진 메시가 나오지 않았다(면·곡선만 있는 파일일 수 있다)');
}

const warnings = [
  '형상은 **커널 실측 메시**다(파라메트릭 아님) — 부피·경계·무게중심은 실측이지만 '
  + `**치수를 고쳐 다시 만들 수 없다.** 면을 허용오차 ${TOL_MM}mm·각 ${ANG_DEG}° 로 삼각형 근사했으므로 `
  + '**곡면이 있으면 부피가 최대 0.7% 과소**로 나온다(기준 형상 실측: 원기둥 −0.26% · 구 −0.57% · 원환 −0.62%). '
  + '평면만으로 된 형상은 정확하다.',
];
if (skippedNoMesh) warnings.push(`부피가 없는 형상 ${skippedNoMesh}개는 받지 않았다(면·곡선만 있는 요소).`);
if (skippedTooBig) warnings.push(`정점 상한 초과 형상 ${skippedTooBig}개는 받지 않았다 — 잘라서 받으면 형상이 거짓이 된다.`);
if (skippedOpen) warnings.push(`닫히지 않은 형상 ${skippedOpen}개는 받지 않았다 — 열린 셸은 부피가 성립하지 않는다.`);

writeFileSync(outPath, JSON.stringify({ ok: true, parts, warnings, reason: null }));
process.exit(0);
