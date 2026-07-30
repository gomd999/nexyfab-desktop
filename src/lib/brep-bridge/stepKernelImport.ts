/**
 * stepKernelImport.ts — 분류기가 못 받은 STEP 을 **커널(OCCT)로 실측 수신** (260801i).
 *
 * ## 왜 만들었나 — 측정이 결론을 뒤집었다
 * 실물 CAD 코퍼스에서 우리 분류기(`stepImport`)는 **35파일 중 1파일**만 바디를 냈다.
 * 원인은 확정돼 있었다: `CONICAL`·`TOROIDAL` 면을 가진 셸 383개 중 **381개가 모따기·라운드**
 * 라서, 프리미티브 분류기로는 구조적으로 못 잡는다.
 *
 * 그래서 「일반 BREP 경로가 필요하다」로 적었는데, **그 경로가 이미 리포 안에 있었다** —
 * STEP **내보내기**에 쓰던 replicad(OCCT WASM)에 `importSTEP` 이 있다. 실측:
 *
 *     코퍼스 35파일 → OCCT 34 성공 / 1 실패 · 전부 메시 생성 · 평균 2.1초
 *
 * 즉 임포트는 **능력의 문제가 아니라 배선의 문제**였다.
 *
 * ## ⚠ 이것은 분류기의 상위 호환이 아니다 — 그렇게 적으면 과고지다
 * · 분류기 결과는 **파라메트릭**이다(외곽 루프 + 두께 → 치수를 고쳐 다시 만들 수 있다).
 * · 커널 결과는 **실측 형상**이다(삼각 메시). 부피·경계·무게중심은 실측이지만
 *   **치수를 고쳐 재생성할 수 없다.** 그 차이를 `fidelity` 와 경고로 고지한다.
 * 그래서 커널은 **분류기가 실패했을 때만** 쓴다. 성공한 것을 메시로 덮으면 편집성을 잃는다.
 *
 * ## ⚠ **자식 프로세스로 돈다** — 인라인으로 두면 서버가 죽는다
 * OCCT 는 WASM 힙을 쓰고 JS GC 대상이 아니다. 형상마다 `delete()` 를 불러도 코퍼스 35파일을
 * 한 프로세스에서 연속 처리하면 **힙 3.7GB 에서 죽었다(2회 재현)**. Next.js 서버는 장수
 * 프로세스라 요청이 쌓일수록 죽는다. 프로세스를 나누면 **종료와 함께 전부 회수된다.**
 * 대가는 기동 비용(WASM 초기화 ~1초)인데, 임포트 자체가 초 단위라 비율로 작다.
 *
 * ## 지어내지 않는 것
 * · 커널이 실패하면 **실패로 남긴다.** 메시가 없는데 AABB 로 상자를 만들어 넣지 않는다
 *   (그건 형상이 아니라 경계이고, 부피가 최대 58배까지 과대해진 전례가 있다).
 * · 재질·질량은 정하지 않는다 — 부피만 실측이고 밀도는 호출측 선언이다.
 */

import { join } from 'node:path';

/** 메시 부품 1개 — SAT·IFC·STL 임포터와 **같은 규약**이다(재발명 금지). */
export interface KernelMeshPart {
  id: string;
  type: 'mesh';
  params: {
    volumeMm3: number;
    triCount: number;
    aabb: { min: [number, number, number]; max: [number, number, number] };
    verts: Array<[number, number, number]>;
    faces: Array<[number, number, number]>;
  };
  at: { tx: number; ty: number; tz: number };
  role: 'imported';
  fidelity: 'kernel-mesh';
}

export interface KernelImportResult {
  ok: boolean;
  parts: KernelMeshPart[];
  warnings: string[];
  /** 실패 사유 — 성공했으면 null. 「사유 없음 = 성공」으로 읽히지 않게 명시한다. */
  reason: string | null;
  elapsedMs: number;
}

/**
 * 메시 허용오차(mm)·각(도) — 값을 바꾸면 부피 실측이 바뀌므로 **고지 문구와 함께** 움직인다.
 *
 * ⚠ 처음 「replicad 가 이 옵션을 무시한다」고 판단했다가 **정정했다** — 같은 shape 객체를
 *   재사용해 캐시된 메시를 다시 읽고 있었다. 새로 임포트하면 실제로 적용된다
 *   (실측 1.15MB 파일: tol 0.01 → 삼각형 293,626 / tol 2.0 → 6,698).
 */
export const KERNEL_MESH_TOL_MM = 0.2;
export const KERNEL_MESH_ANGULAR_DEG = 20;
/**
 * 기본 허용오차에서 **곡면 부피가 얼마나 과소로 나오는가** — 정확부피를 아는 형상 실측:
 *   원기둥 −0.26% · 구 −0.57% · 원환 −0.62%  (tol 0.2 / 각 20°)
 * 삼각형이 볼록면을 **현으로 자르므로 편향이 한쪽(과소)이다.** 무작위 오차가 아니다.
 * 「근사다」로 뭉개지 않고 이 수치를 고지에 싣는다. `kernel-mesh-accuracy.test.ts` 가 고정한다.
 */
export const KERNEL_CURVED_VOLUME_BIAS_PCT = 0.7;
/** 정점 상한 — 넘으면 받지 않는다(표시·전송 예산). 잘라서 받으면 형상이 거짓이 된다. */
export const KERNEL_MAX_VERTS = 400_000;
/** 커널 프로세스 시간 상한 — 실측 최대(7.3MB, 임포트 6초 + 메시 17초)에 여유를 둔 값. */
export const KERNEL_TIMEOUT_MS = 90_000;

/**
 * STEP 원문 → 커널 실측 메시 부품.
 *
 * @param source STEP 파일 텍스트(또는 바이트)
 * @param opts.idPrefix 부품 id 접두사
 */
export async function importStepWithKernel(
  source: string | Uint8Array,
  opts: { idPrefix?: string; timeoutMs?: number } = {},
): Promise<KernelImportResult> {
  const t0 = Date.now();
  const done = (r: Omit<KernelImportResult, 'elapsedMs'>): KernelImportResult =>
    ({ ...r, elapsedMs: Date.now() - t0 });

  const { execFile } = await import('node:child_process');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'nf-kernel-'));
    const inPath = join(dir, 'in.step');
    const outPath = join(dir, 'out.json');
    await writeFile(inPath, typeof source === 'string' ? source : Buffer.from(source), 'latin1');
    const runner = join(process.cwd(), 'scripts', 'drawing-to-3d', 'kernel-step-import.mjs');
    try {
      await run(process.execPath, [runner, inPath, outPath, String(KERNEL_MAX_VERTS)], {
        timeout: opts.timeoutMs ?? KERNEL_TIMEOUT_MS,
        // stdout 으로 결과를 받지 않는다(러너가 파일로 쓴다) — 버퍼는 로그용으로만 작게.
        maxBuffer: 1 << 20,
        windowsHide: true,
      });
    } catch (e) {
      /**
       * ⚠ 여기 오는 것은 **프로세스가 죽은 것**이다(시간초과·OOM·기동 실패).
       *   러너는 형상을 못 읽어도 종료코드 0 으로 끝내며 사유를 파일에 적는다 —
       *   「프로세스 죽음」과 「형상을 못 읽음」을 뭉개면 원인을 영영 모른다.
       */
      const err = e as { killed?: boolean; signal?: string; message?: string };
      return done({
        ok: false, parts: [], warnings: [],
        reason: err.killed || err.signal
          ? `커널 프로세스가 시간(${Math.round((opts.timeoutMs ?? KERNEL_TIMEOUT_MS) / 1000)}초) 안에 끝나지 않아 중단했다`
          : `커널 프로세스가 비정상 종료했다: ${String(err.message ?? e).slice(0, 160)}`,
      });
    }
    let raw: string;
    try { raw = await readFile(outPath, 'utf8'); }
    catch { return done({ ok: false, parts: [], warnings: [], reason: '커널 프로세스가 결과를 남기지 않았다' }); }
    let parsed: KernelImportResult;
    try { parsed = JSON.parse(raw) as KernelImportResult; }
    catch { return done({ ok: false, parts: [], warnings: [], reason: '커널 결과를 해석하지 못했다(파일이 잘렸을 수 있다)' }); }
    const prefix = opts.idPrefix ?? 'kernel';
    return done({
      ok: !!parsed.ok,
      parts: (parsed.parts ?? []).map((q, n) => ({ ...q, id: `${prefix}_${n}` })),
      warnings: parsed.warnings ?? [],
      reason: parsed.reason ?? null,
    });
  } catch (e) {
    return done({ ok: false, parts: [], warnings: [], reason: `커널 실행 준비에 실패했다: ${String((e as Error)?.message ?? e).slice(0, 160)}` });
  } finally {
    if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* 임시파일 정리 실패는 결과에 영향이 없다 */ } }
  }
}
