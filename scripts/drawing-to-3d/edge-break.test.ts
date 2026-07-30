/**
 * edge-break.test.ts — 모서리 가공(필렛·모따기)이 **질량에도 반영되는가** (260801l).
 *
 * ## 무엇이 갈려 있었나
 * `part.filletMm` 은 **STEP B-rep 에만** 반영되고 부피·질량은 무필렛 그대로였다.
 * 같은 부품이 도면에서는 둥글고 물량서에서는 각졌다 — 질량이 깎인 만큼 **과대**로 나간다.
 * 모따기(`chamferMm`)는 아예 없었다.
 */
import { describe, expect, it } from 'vitest';
import { partVolumeEffective } from './structural.mjs';

const E = (part: unknown): { volumeMm3: number; basis: string; note: string } =>
  (partVolumeEffective as unknown as (p: unknown) => { volumeMm3: number; basis: string; note: string })(part);

const BOX = { id: 'b', type: 'box', params: { width: 100, depth: 60, height: 20 } };

describe('필렛·모따기가 질량에 반영된다', () => {
  it('★필렛 R5 가 부피를 줄인다 — 볼록 모서리 폐형 (1−π/4)r²L', () => {
    const plain = E(BOX).volumeMm3;
    const r = 5;
    const L = 4 * (100 + 60 + 20);
    const cut = (1 - Math.PI / 4) * r * r * L;
    expect(E({ ...BOX, filletMm: r }).volumeMm3).toBeCloseTo(plain - cut, 6);
  });

  it('★모따기 C3 이 부피를 줄인다 — (c²/2)L', () => {
    const plain = E(BOX).volumeMm3;
    const c = 3;
    const L = 4 * (100 + 60 + 20);
    expect(E({ ...BOX, chamferMm: c }).volumeMm3).toBeCloseTo(plain - (c * c / 2) * L, 6);
  });

  it('모따기가 필렛보다 더 많이 깎는다 — 같은 크기라면 (c²/2 > (1−π/4)r²)', () => {
    expect(E({ ...BOX, chamferMm: 5 }).volumeMm3).toBeLessThan(E({ ...BOX, filletMm: 5 }).volumeMm3);
  });

  it('★근사라는 사실이 note 에 남는다 — 꼭짓점 교차분 미반영', () => {
    expect(E({ ...BOX, filletMm: 5 }).note).toMatch(/꼭짓점 교차분/);
    expect(E({ ...BOX, filletMm: 5 }).basis).toMatch(/edge-break/);
  });

  it('선언이 없으면 아무것도 바뀌지 않는다 — 과고지 금지', () => {
    expect(E(BOX).basis).not.toMatch(/edge-break/);
    expect(E(BOX).note).not.toMatch(/필렛|모따기/);
  });
});

describe('⚠ 모서리 길이를 모르는 어휘 — 지어내지 않는다', () => {
  it('★모서리를 셀 수 없으면 **부피를 건드리지 않고** 과대라고 적는다', () => {
    const part = { id: 'g', type: 'spur_gear', params: { module: 2, teeth: 20, thickness: 10, boreDia: 8 }, filletMm: 1 };
    const plain = E({ ...part, filletMm: 0 }).volumeMm3;
    const withF = E(part);
    // 부피는 그대로 — 임의 계수를 곱하면 어디서 온 수치인지 아무도 모른다.
    expect(withF.volumeMm3).toBeCloseTo(plain, 6);
    expect(withF.basis).toMatch(/unquantified/);
    expect(withF.note).toMatch(/질량이 그만큼 과대/);
  });
});
