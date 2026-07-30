/**
 * kernel-fallback-corpus.test.ts — 커널 폴백이 **실물 파일을 실제로 살리는가** (260801i).
 *
 * ⚠ 코퍼스는 **로컬 전용·재배포 불가**라 CI 에서는 skip 된다. **skip 은 통과가 아니다** —
 *   그래서 정확도 회귀(`kernel-mesh-accuracy.test.ts`)는 코퍼스 없이 돌게 따로 두었다.
 *   이 파일은 「분류기 1 / 커널 34」라는 실측 대비를 고정하는 용도다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { importStep } from './stepImport';
import { importStepWithKernel } from './stepKernelImport';
import { corpusRoot } from '../../../scripts/drawing-to-3d/corpus-fixtures.mjs';

const root = (corpusRoot as unknown as () => string | null)();
function walk(d: string, depth: number, out: string[]): string[] {
  if (depth > 5) return out;
  for (const e of readdirSync(d)) {
    const p = `${d}/${e}`;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1, out);
    else if (/\.(stp|step)$/i.test(e) && st.size < 8e6) out.push(p);
  }
  return out;
}

(root ? describe : describe.skip)('커널 폴백 — 분류기가 놓친 실물 파일', () => {
  it('★분류기가 못 받은 파일을 커널이 받는다 (표본)', async () => {
    const files = walk(root!, 0, []).sort((a, b) => statSync(a).size - statSync(b).size);
    // 전수는 수 분이 걸리고 메모리를 쓴다 — **작은 쪽 표본 6개**로 대비를 고정한다.
    // ⚠ 표본이라는 사실을 적는다. 「전수 통과」로 읽히면 과고지다.
    const sample = files.slice(0, 6);
    expect(sample.length).toBeGreaterThan(0);
    let classifier = 0, kernel = 0;
    for (const f of sample) {
      const src = readFileSync(f, 'latin1');
      if ((importStep(src) as unknown as { tree: { nodes: unknown[] } }).tree.nodes.length > 0) classifier += 1;
      const k = await importStepWithKernel(src, { idPrefix: 'k' });
      if (k.ok && k.parts.length > 0) kernel += 1;
    }
    // 커널이 분류기보다 **엄격히 많이** 받아야 폴백을 둔 의미가 있다.
    expect(kernel, `커널 ${kernel} / 분류기 ${classifier} (표본 ${sample.length})`).toBeGreaterThan(classifier);
  }, 900_000);

  it('★받은 형상은 부피가 경계 안에 있다 — 열린 셸을 부피로 내보내지 않는다', async () => {
    const files = walk(root!, 0, []).sort((a, b) => statSync(a).size - statSync(b).size);
    const k = await importStepWithKernel(readFileSync(files[0]!, 'latin1'), { idPrefix: 'k' });
    expect(k.ok).toBe(true);
    for (const p of k.parts) {
      const { min, max } = p.params.aabb;
      const box = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
      expect(p.params.volumeMm3).toBeGreaterThan(0);
      expect(p.params.volumeMm3).toBeLessThanOrEqual(box * 1.001);
    }
    /**
     * 파라메트릭이 아니라는 사실이 **반드시** 경고에 있어야 한다(과고지 방지).
     * ⚠ 260802 — 문구 표현(`파라메트릭 아님`)에 묶어 뒀다가, 고지를 정확값 경로용으로
     *   고치면서 표현이 바뀌자 깨졌다. **표현이 아니라 의미**로 검사한다.
     */
    expect(k.warnings.join(' ')).toMatch(/파라메트릭/);
    expect(k.warnings.join(' ')).toMatch(/재생성할 수 없다|다시 만들 수 없다/);
  }, 600_000);
});
