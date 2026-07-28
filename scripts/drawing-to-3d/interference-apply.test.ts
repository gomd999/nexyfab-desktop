/**
 * 메시 부울 2차 간섭 정제가 소비자에 도달하는가 (260728).
 *
 * 결함: `generate_package`(MCP)·`/drawing/package`(웹) 둘 다 정제를 돌려놓고
 * `interferences`·`designOk` 는 **원본 AABB 과탐**을 반환했다. 쉬운요약도 자기가
 * buildAssembly 를 다시 불러 해제된 과탐을 되살렸다.
 *
 * 실측(mech/transmission_tower, 99부품): AABB 186쌍 → 확정 75 · 해제 111(과탐 59.7%).
 * 한 쌍은 AABB 추정 9,144,088mm³ vs 실측 328.1mm³ — 27,000배 과대였다.
 */
import { describe, it, expect } from 'vitest';
import { applyInterferenceRefinement } from './interference-refine.mjs';

type Built = {
  ok: boolean; interferences: unknown[]; designOk: boolean;
  support?: { floating: string[] }; pipes?: null;
  interferencesRaw?: number; interferencesDemoted?: number; interferenceBasis?: string;
  interferencesUnrefined?: number;
};
const apply = applyInterferenceRefinement as unknown as (b: unknown, r: unknown) => Built;

const builtWith = (n: number): Built => ({
  ok: true,
  interferences: Array.from({ length: n }, (_, i) => ({ a: `p${i}`, b: `q${i}` })),
  designOk: n === 0,
  support: { floating: [] },
  pipes: null,
});

describe('정제 결과가 built 에 되돌아간다', () => {
  it('전량 해제되면 designOk 가 true 로 뒤집힌다 — 깨끗한데 불합격으로 나가던 자리', () => {
    // 이것이 이 수정의 핵심 케이스다. 종전에는 실기하로 전부 떨어져 있음을 확인하고도
    // 원본 AABB 건수로 designOk:false 를 내보냈다.
    const out = apply(builtWith(4), {
      interferences: [], demoted: [{ a: 'p0', b: 'q0' }, { a: 'p1', b: 'q1' }, { a: 'p2', b: 'q2' }, { a: 'p3', b: 'q3' }], laps: [], checked: 4,
    });
    expect(out.interferences).toHaveLength(0);
    expect(out.designOk).toBe(true);
    expect(out.interferencesRaw).toBe(4);
    expect(out.interferencesDemoted).toBe(4);
  });

  it('일부만 해제되면 확정분이 남고 designOk 는 false 를 유지한다', () => {
    const out = apply(builtWith(186), {
      interferences: Array.from({ length: 75 }, (_, i) => ({ a: `p${i}`, b: `q${i}` })),
      demoted: Array.from({ length: 111 }, (_, i) => ({ a: `x${i}`, b: `y${i}` })), laps: [], checked: 186,
    });
    expect(out.interferences).toHaveLength(75);
    expect(out.designOk).toBe(false);
    expect(out.interferenceBasis).toContain('AABB 의심 186쌍');
    expect(out.interferenceBasis).toContain('확정 75');
    expect(out.interferenceBasis).toContain('해제 111');
  });

  it('원본 건수를 감추지 않는다 — 좁힌 근거가 응답에 남는다', () => {
    const out = apply(builtWith(10), {
      interferences: [{ a: 'p0', b: 'q0' }], demoted: Array.from({ length: 9 }, () => ({})), laps: [], checked: 10,
    });
    expect(out.interferencesRaw).toBe(10);
    expect(String(out.interferenceBasis)).toMatch(/186|10/);
  });

  it('정제가 실패하면 원본을 그대로 둔다 — 실패를 통과로 바꾸지 않는다', () => {
    const before = builtWith(5);
    expect(apply(before, { error: 'openscad 실패' })).toBe(before);
    expect(apply(before, null)).toBe(before);
  });

  it('해제가 하나도 없으면 원본 객체를 그대로 — 불필요한 재작성 없음', () => {
    const before = builtWith(3);
    const out = apply(before, { interferences: before.interferences, demoted: [], laps: [], checked: 3 });
    expect(out).toBe(before);
  });

  it('간섭 외 조건(부유 부재)이 걸려 있으면 간섭이 0 이어도 designOk 는 false', () => {
    // 여기서 다른 게이트를 재해석하지 않는다 — 간섭 항목만 교체한다.
    const b = { ...builtWith(2), support: { floating: ['p9'] } };
    const out = apply(b, { interferences: [], demoted: [{}, {}], laps: [], checked: 2 });
    expect(out.interferences).toHaveLength(0);
    expect(out.designOk).toBe(false);
  });

  it('예산 초과 미검증분은 보수 유지되고 건수가 반드시 고지된다', () => {
    // 실측: 200부품 밀집 어셈블리 = 의심 1468쌍 × 27ms = 39초(정제만). 예산이 필요하다.
    // 못 본 쌍을 해제하면 "확인 못 함"이 "이상 없음"이 된다 — 보수 유지가 유일한 정답이다.
    const out = apply(builtWith(1468), {
      interferences: Array.from({ length: 1468 }, (_, i) => ({ a: `p${i}`, b: `q${i}` })),
      demoted: [], laps: [], checked: 400, unrefined: 1068,
    });
    expect(out.interferences).toHaveLength(1468); // 미검증분이 빠지지 않았다
    expect(out.designOk).toBe(false);
    expect(out.interferencesUnrefined).toBe(1068);
    expect(String(out.interferenceBasis)).toContain('1068쌍 예산초과 미검증');
  });

  it('전량 미검증이어도 고지가 사라지지 않는다 — 조기 반환 구멍', () => {
    // confirmed.length === raw.length 라 "바꿀 것 없음"으로 빠져나가면 고지도 함께 사라진다.
    const out = apply(builtWith(500), {
      interferences: Array.from({ length: 500 }, (_, i) => ({ a: `p${i}`, b: `q${i}` })),
      demoted: [], laps: [], checked: 0, unrefined: 500,
    });
    expect(out.interferencesUnrefined).toBe(500);
    expect(String(out.interferenceBasis)).toContain('미검증');
  });

  it('격자 절점 랩 접합은 근거 문구에 별도로 남는다', () => {
    const out = apply(builtWith(20), {
      interferences: [{ a: 'p0', b: 'q0' }], demoted: Array.from({ length: 12 }, () => ({})),
      laps: Array.from({ length: 7 }, () => ({})), checked: 20,
    });
    expect(String(out.interferenceBasis)).toContain('격자 절점 랩 7');
  });
});

describe('정제 예산은 결정론이어야 한다 (260729 정정)', () => {
  // 처음엔 budgetMs=20000 을 기본으로 뒀는데 그게 잘못이었다. 이 결과는 designOk 를
  // 좌우하는데 벽시계 예산을 걸면 **같은 입력이 머신 부하에 따라 다른 판정**을 낸다.
  // 실제로 송전탑 회귀(92쌍)가 단독 실행에선 통과하고 전체 스위트 동시 실행에선
  // 21쌍 미검증으로 실패했다 — 형상이 아니라 그때의 CPU 여유가 판정을 바꿨다.
  it('기본값에 시간 상한이 없다 — 입력만으로 결과가 정해진다', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./interference-refine.mjs', import.meta.url), 'utf8'));
    // 기본 인자에서 budgetMs 는 0(무제한)이어야 한다.
    expect(src).toMatch(/maxPairs = 400,\s*budgetMs = 0/);
    // 시간 비교는 budgetMs 가 명시됐을 때만 활성화된다.
    expect(src).toContain('budgetMs > 0 && Date.now() - started > budgetMs');
  });
});
