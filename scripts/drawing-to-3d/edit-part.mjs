/**
 * edit-part.mjs — 선택 부품 단위 수정 루프(260719, 사용자 방향: 픽킹→대상만 수정).
 *
 * 계약(edit-intent 와 동일 사상): AI 는 「지시문 → 부품 패치 JSON」 이해만 담당.
 * 적용·게이트(어휘 검증·간섭·지지·구조)는 buildAssembly 결정론이 처리 — AI 가
 * 어셈블리 전체를 다시 만들지 않는다(대상 외 부품 불변 보장 = 코드가 강제).
 *
 * 면 선택: 프리미티브는 파라메트릭이라 위상 명명 없이 월드 노멀 → 명명 면
 * (box=6면, 회전체=축단±/원통면)으로 사상 — 픽킹 UI 가 노멀만 넘기면 된다.
 */
import { buildAssembly, placedAabb } from './assembly.mjs';
import { PARAMS } from './reconstruct.mjs';
import { callGeminiJson } from './from-text.mjs';

/** 허용 패치 필드 — id 는 불변, 그 외는 화이트리스트만. */
const PATCHABLE = new Set(['type', 'params', 'at', 'material', 'system', 'detail', 'role']);

/**
 * 결정론 적용: 부품 하나에 패치 병합 → 전체 재빌드·게이트.
 * @returns { ok, assembly?, built?, error?, gateErrors?, interferences? }
 */
export function applyPartPatch(asm, partId, patch) {
  const idx = (asm.parts ?? []).findIndex((p) => p.id === partId);
  if (idx < 0) return { ok: false, error: `부품 '${partId}' 없음` };
  const bad = Object.keys(patch ?? {}).filter((k) => !PATCHABLE.has(k));
  if (bad.length) return { ok: false, error: `허용 외 패치 필드: ${bad.join(',')}` };
  if (patch.type && !(patch.type in PARAMS)) return { ok: false, error: `미지원 type '${patch.type}' (어휘 외 — 정직 거부)` };
  const cur = asm.parts[idx];
  const next = {
    ...cur,
    ...(patch.type ? { type: patch.type } : {}),
    ...(patch.material ? { material: patch.material } : {}),
    ...(patch.system ? { system: patch.system } : {}),
    ...(patch.role ? { role: patch.role } : {}),
    ...(patch.detail != null ? { detail: patch.detail } : {}),
    // type 이 바뀌면 params 는 전면 교체(이종 파라미터 잔존 방지), 아니면 병합
    params: patch.type ? { ...(patch.params ?? {}) } : { ...cur.params, ...(patch.params ?? {}) },
    at: { ...cur.at, ...(patch.at ?? {}) },
  };
  const parts = asm.parts.slice();
  parts[idx] = next;
  const nextAsm = { ...asm, parts };
  const built = buildAssembly(nextAsm);
  if (!built.ok) return { ok: false, error: 'gate', gateErrors: built.gateErrors, assembly: nextAsm };
  return {
    ok: true, assembly: nextAsm, part: next,
    gateErrors: [], interferences: built.interferences ?? [],
    floating: built.support?.floating ?? [],
    massKg: built.structural?.totalMassKg ?? null,
  };
}

/** 월드 노멀 → 명명 면(픽킹 컨텍스트). box 회전은 v1 미지원=null(정직). */
export function faceOfPart(part, normal) {
  const n = normal.map(Number);
  const L = Math.hypot(...n) || 1;
  const u = n.map((v) => v / L);
  // 확장 회전체 축 판정(roundAxisOf 는 cylinder 계열만 — reducer/revolve/nut 포함)
  const roundAxis = (p) => {
    if (!['cylinder', 'tube', 'flange', 'hex_bolt', 'hex_nut', 'washer', 'pipe_reducer', 'revolve'].includes(p.type)) return null;
    const { rx = 0, ry = 0, rz = 0 } = p.at ?? {};
    if (!rx && !ry && !rz) return 'z';
    if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx && !rz) return 'x';
    if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry && !rz) return 'y';
    return null;
  };
  const round = roundAxis(part);
  if (round) {
    const ax = round === 'x' ? [1, 0, 0] : round === 'y' ? [0, 1, 0] : [0, 0, 1];
    const d = u[0] * ax[0] + u[1] * ax[1] + u[2] * ax[2];
    if (d > 0.7) return { face: 'axis+', label: '축단(+) — 진행 끝면' };
    if (d < -0.7) return { face: 'axis-', label: '축단(−) — 시작 끝면' };
    return { face: 'radial', label: '원통면(반경)' };
  }
  if (part.type === 'box' && !(part.at?.rx || part.at?.ry || part.at?.rz)) {
    const names = [['x-', '좌면(x−)'], ['x+', '우면(x+)'], ['y-', '전면(y−)'], ['y+', '후면(y+)'], ['z-', '하면(z−)'], ['z+', '상면(z+)']];
    let bi = 0, bv = -Infinity;
    [[-u[0]], [u[0]], [-u[1]], [u[1]], [-u[2]], [u[2]]].forEach((q, i) => { if (q[0] > bv) { bv = q[0]; bi = i; } });
    return { face: names[bi][0], label: names[bi][1] };
  }
  return null; // 회전 box 등 — v1 미지원(정직)
}

/**
 * AI 이해 계층: 지시문 → 패치 제안 → 결정론 적용(+게이트 실패 시 1회 교정 재시도).
 * 대상 부품 JSON + 선택 면 + 이웃 AABB 만 프롬프트에 — 어셈블리 전체를 AI 에 안 넘긴다.
 */
export async function aiEditPart(asm, partId, instruction, { face = null, models } = {}) {
  const part = (asm.parts ?? []).find((p) => p.id === partId);
  if (!part) return { ok: false, error: `부품 '${partId}' 없음` };
  const pb = placedAabb(part);
  const center = pb.min.map((v, i) => (v + pb.max[i]) / 2);
  const neighbors = (asm.parts ?? [])
    .filter((p) => p.id !== partId && p.type !== 'mesh')
    .map((p) => { const b = placedAabb(p); const c = b.min.map((v, i) => (v + b.max[i]) / 2); return { p, d: Math.hypot(...c.map((v, i) => v - center[i])), b }; })
    .sort((a, b) => a.d - b.d).slice(0, 10)
    .map((q) => `- ${q.p.id}(${q.p.type}) AABB [${q.b.min.map(Math.round)}]..[${q.b.max.map(Math.round)}]`);
  const prompt = `기계 어셈블리에서 부품 하나만 수정한다. 아래 부품 JSON 을 지시에 맞게 고친 "패치"만 출력하라.
배치 관례(반드시 준수): box=at(tx,ty,tz)이 최소 코너. cylinder/tube/pipe_reducer/revolve=단면 중심이 (tx,ty)[무회전, tz=축 시작] · ry:90이면 축=x(tx=시작, ty/tz=단면 중심) · rx:90이면 축=y.
대상 부품: ${JSON.stringify({ id: part.id, type: part.type, params: part.params, at: part.at, material: part.material })}
${face ? `선택 면: ${face.label ?? face.face ?? face} — 지시는 이 면 기준으로 해석(예: 축단(+)=그 방향 치수/위치).` : ''}
이웃 부품(참고 — 충돌 회피):\n${neighbors.join('\n')}
지시: ${String(instruction).slice(0, 400)}
출력(JSON 만): {"patch":{"params":{...바뀐 값만},"at":{...바뀐 값만}},"note":"한줄 설명"} — type 변경이 꼭 필요하면 "type" 포함(그때 params 는 새 타입 전체 파라미터).`;
  let out = await callGeminiJson(prompt, null, { models, thinkingBudget: 0, maxOutputTokens: 2048 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = out?.data ?? out; // callGeminiJson 은 {data, model, repaired} 래퍼
    const patch = body?.patch;
    if (!patch || typeof patch !== 'object') return { ok: false, error: 'AI 패치 형식 오류(정직 거부)', raw: out };
    const r = applyPartPatch(asm, partId, patch);
    if (r.ok) return { ...r, patch, note: body.note ?? null, attempts: attempt + 1 };
    if (attempt === 0) {
      out = await callGeminiJson(
        `${prompt}\n\n이전 패치 ${JSON.stringify(patch)} 가 게이트에서 실패했다: ${JSON.stringify(r.gateErrors ?? r.error).slice(0, 300)}\n오류를 고친 패치를 같은 형식으로 다시 출력하라.`,
        null, { models, thinkingBudget: 0, maxOutputTokens: 2048 },
      );
    } else {
      return { ok: false, error: '패치 게이트 실패(교정 1회 포함 — 정직 거부)', gateErrors: r.gateErrors ?? [r.error], patch };
    }
  }
  return { ok: false, error: 'unreachable' };
}
