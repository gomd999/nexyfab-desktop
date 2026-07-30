/**
 * domain-coverage.test.ts — 5도메인 판정 커버리지 회귀 (260802).
 *
 * ## 무엇을 지키는가
 * `domain-audit.mjs` 로 템플릿 54종을 **표시 계층을 거치지 않고** 순회해,
 * **판정 0개**와 **미도달**이 늘지 않는지 본다.
 *
 * ## ⚠ 숫자만 보면 틀린다 — 실측으로 확인한 것
 * · `civil` 판정 0개는 「검토가 없다」가 아니라 **「안전검토 계층이 없다」**였다
 *   (계산기 검증은 `decisive: true` 로 도달하고 있었다). 디스패치에 분기가 없었을 뿐이다.
 * · `building` 3건·`bridge` 2건의 판정 0개는 **의도된 것**이다 —
 *   「연직 하중경로 = 적용범위 밖」(벽식은 벽이 연직도 받는다)과 「입력 대기」.
 *   **손대면 과고지가 된다.** 그래서 0 을 요구하지 않고 **늘지 않는 것**만 막는다.
 */
import { describe, expect, it } from 'vitest';
import { auditAll } from './domain-audit.mjs';

interface Row { domain: string; id: string; real: number; reached: boolean }
const rows = (auditAll as unknown as () => Row[])();

describe('5도메인 판정 커버리지', () => {
  it('★미도달이 0 이다 — 계산은 됐는데 소비자에 안 닿는 것(형태 ①)', () => {
    const bad = rows.filter((r) => !r.reached).map((r) => `${r.domain}/${r.id}`);
    expect(bad, `미도달: ${bad.join(', ')}`).toEqual([]);
  });

  it('★판정 0개 템플릿이 늘지 않는다 — 260802 실측 5건(전부 의도된 거절)', () => {
    const zero = rows.filter((r) => r.real === 0).map((r) => `${r.domain}/${r.id}`);
    // building 3(적용범위 밖) + bridge 2(입력 대기) = 5. 늘면 새로 생긴 공백이다.
    expect(zero.length, `판정 0개: ${zero.join(', ')}`).toBeLessThanOrEqual(5);
    // ⚠ civil·mech·interior·landscape 에는 **하나도 없어야** 한다(260802 에 해소했다).
    const regressed = zero.filter((k) => !/^(building|bridge)\//.test(k));
    expect(regressed, `해소했던 도메인에서 재발: ${regressed.join(', ')}`).toEqual([]);
  });

  it('도메인별 판정 수가 줄지 않는다 — 260802 기준선', () => {
    const by: Record<string, number> = {};
    for (const r of rows) by[r.domain] = (by[r.domain] ?? 0) + r.real;
    // 실측 기준선(260802). 늘리는 것은 별건이고 **줄어드는 것**을 막는다.
    for (const [d, min] of Object.entries({ interior: 50, mech: 36, landscape: 25, building: 18, bridge: 15, civil: 8 })) {
      expect(by[d] ?? 0, `${d} 판정 ${by[d]} < 기준 ${min}`).toBeGreaterThanOrEqual(min);
    }
  });
});
