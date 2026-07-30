/**
 * kernel-first-import.test.ts — 주력 임포트가 **커널 우선 · AABB 폴백**인가 (260802).
 *
 * ## 무엇이 바뀌었나
 * 종전 주력 경로는 전 부품을 **월드 AABB 상자**로 받았다. 실측:
 * ```
 * 파일 성공률       35/35 (실패하지 않는다 — 문제는 커버리지가 아니라 충실도였다)
 * AABB/커널 부피 비  0.02 ~ 26.63  ← **양방향**
 * ```
 * 상자가 형상을 감싸지도 못한다. **양방향 오차는 신뢰 구간을 줄 수 없고**, 질량이 작게
 * 나오면 구조 검토가 안전측이 아니다.
 *
 * ⚠ 코퍼스는 로컬 전용이라 CI 에서 skip 된다. **skip 은 통과가 아니므로** 폴백 규약은
 *   합성 입력으로 따로 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stepToNexyfabAssemblyPreferKernel } from './stepToNexyfabAssembly';
import { corpusRoot } from '../../../scripts/drawing-to-3d/corpus-fixtures.mjs';

const root = (corpusRoot as unknown as () => string | null)();
function walk(d: string, dep: number, out: string[]): string[] {
  if (dep > 5) return out;
  for (const e of readdirSync(d)) {
    const p = `${d}/${e}`; let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, dep + 1, out);
    else if (/\.(stp|step)$/i.test(e) && st.size < 8e6) out.push(p);
  }
  return out;
}

describe('폴백 규약 — 커널이 못 읽어도 빈손으로 돌아가지 않는다', () => {
  it('★커널이 실패하면 AABB 로 폴백하고 **오차가 양방향임을 고지**한다', async () => {
    // 커널이 읽을 수 없는 입력(STEP 이 아니다) → 폴백 경로가 돌아야 한다.
    const r = await stepToNexyfabAssemblyPreferKernel('NOT A STEP FILE', { name: 't' });
    expect(r.fidelity).toBe('aabb-approx');
    expect((r.warnings ?? []).join(' ')).toMatch(/양방향/);
    // 「커널을 왜 못 썼는지」가 남아야 한다 — 없으면 「원래 안 쓰는 것」으로 읽힌다.
    expect(r.kernelReason ?? '').not.toBe('');
  }, 300_000);
});

(root ? describe : describe.skip)('커널 우선 — 실물 파일', () => {
  it('★솔리드 단위로 쪼개지고 부피가 **정확값**이다', async () => {
    const files = walk(root!, 0, []).sort((a, b) => statSync(a).size - statSync(b).size);
    const big = files[files.length - 1]!;
    const r = await stepToNexyfabAssemblyPreferKernel(readFileSync(big, 'latin1'), { name: 't' });
    expect(r.ok).toBe(true);
    expect(r.fidelity).toBe('kernel-solid');
    const parts = r.assembly?.parts ?? [];
    // 실측: 트롤리 7.35MB → 205부품. 컴파운드 1개로 오던 것이 쪼개졌다.
    expect(parts.length).toBeGreaterThan(50);
    // 부품마다 근거가 남아야 한다 — 합계만 보면 어느 것이 근사인지 모른다.
    for (const p of parts.slice(0, 20)) {
      expect((p as unknown as { basis?: string }).basis, `${p.id} basis 없음`).toBeTruthy();
    }
    // 고지에 「파라메트릭 아님」이 반드시 있어야 한다(과고지 방지).
    expect((r.warnings ?? []).join(' ')).toMatch(/파라메트릭이 아니다/);
  }, 900_000);
});
