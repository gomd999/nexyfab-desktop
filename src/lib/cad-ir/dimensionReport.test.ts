/**
 * dimensionReport — **치수 대조가 사용자에게 정직하게 닿는가** (260801, 격차 W4).
 *
 * 잡는 것은 문장이 예쁜지가 아니라, 이 저장소가 반복해 온 착각이 문장으로 새는 것이다:
 *   · 안 잰 것을 ✓ 로 보이게 하는 것
 *   · 단위를 모르는데 mm 를 붙이는 것
 *   · 통과 개수에 미검사를 얹어 세는 것
 *   · 통과 문장을 앞에 쌓아 실패를 안 읽히게 하는 것
 */
import { describe, expect, it } from 'vitest';
import { dimensionSentences, dimensionSummary } from './dimensionReport';
import type { GateCheck } from './gate';

const mk = (o: Partial<GateCheck> & { name: string }): GateCheck => ({
  expected: null, actual: null, tol_pct: null, delta_pct: null, passed: true, ...o,
});

describe('사용자 문장', () => {
  it('요청 → 실제 → 차이 순서로 읽힌다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_x', expected: 80, actual: 79.8, delta_pct: 0.25, passed: true })], { unit: 'mm' });
    expect(s!.text).toBe('X축 길이: 요청 80mm → 실제 79.8mm (0.25% 차이) ✓');
  });

  it('불일치는 허용 오차까지 밝힌다 — 얼마나 벗어났는지 판단하게', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_z', expected: 80, actual: 92, delta_pct: 15, tol_pct: 2, passed: false })], { unit: 'mm' });
    expect(s!.text).toContain('요청 80mm → 실제 92mm');
    expect(s!.text).toContain('허용 2%');
    expect(s!.text).toContain('✗');
  });

  it('영문도 같은 정보를 담는다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_x', expected: 80, actual: 79.8, delta_pct: 0.25 })], { lang: 'en', unit: 'mm' });
    expect(s!.text).toContain('requested 80mm → actual 79.8mm');
  });

  it('★축을 「가로/세로」로 옮기지 않는다 — 놓는 방향에 따라 달라지는 것을 아는 척하지 않는다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_x', expected: 1, actual: 1, delta_pct: 0 })]);
    expect(s!.text).toContain('X축');
    expect(s!.text).not.toContain('가로');
  });
});

describe('★단위를 지어내지 않는다', () => {
  it('★단위를 모르면 숫자만 — mm 를 붙이지 않는다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_x', expected: 80, actual: 79.8, delta_pct: 0.25 })]);
    expect(s!.text).toContain('요청 80 → 실제 79.8');
    expect(s!.text).not.toContain('mm');
  });

  it('★기본값이 mm 가 아니다 — 옵션을 아예 안 주는 경우가 「모른다」이다', () => {
    const s = dimensionSentences([mk({ name: 'bbox_y', expected: 5, actual: 5, delta_pct: 0 })], {});
    expect(s[0]!.text).not.toMatch(/mm|cm|in\b/);
  });
});

describe('★안 잰 것을 통과로 보이지 않게 한다', () => {
  it('★passed=null 은 ✓ 도 ✗ 도 아니다', () => {
    const [s] = dimensionSentences([mk({ name: 'volume', passed: null, status: 'skipped', reason: '메시 측정 실패' })]);
    expect(s!.verdict).toBe('unchecked');
    expect(s!.text).toContain('검사 안 함');
    expect(s!.text).toContain('메시 측정 실패');
    expect(s!.text).not.toContain('✓');
    expect(s!.text).not.toContain('✗');
  });

  it('★이유가 없으면 없다고 적는다 — 빈칸으로 두면 「그냥 통과」로 읽힌다', () => {
    const [s] = dimensionSentences([mk({ name: 'genus', passed: null })]);
    expect(s!.text).toContain('사유 기록 없음');
  });

  it('★요청은 있는데 못 쟀으면 그렇게 적는다 — 0 이나 공란으로 채우지 않는다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_x', expected: 80, actual: null, passed: false })], { unit: 'mm' });
    expect(s!.text).toContain('요청 80mm → 측정 못 함');
    expect(s!.verdict).toBe('failed');
  });
});

describe('★실패가 먼저 온다', () => {
  it('★통과 문장 아래 실패를 묻지 않는다', () => {
    const s = dimensionSentences([
      mk({ name: 'bbox_x', expected: 1, actual: 1, delta_pct: 0, passed: true }),
      mk({ name: 'volume', passed: null, reason: 'x' }),
      mk({ name: 'bbox_z', expected: 1, actual: 2, delta_pct: 100, passed: false }),
    ]);
    expect(s.map((x) => x.verdict)).toEqual(['failed', 'unchecked', 'ok']);
  });

  it('참고 검사는 같은 등급 안에서 뒤로 — 그것만으로 불합격이 아니다', () => {
    const s = dimensionSentences([
      mk({ name: 'volume_fill_plausible_weak', expected: 1, actual: 2, delta_pct: 100, passed: false, advisory: true }),
      mk({ name: 'bbox_x', expected: 1, actual: 2, delta_pct: 100, passed: false }),
    ]);
    expect(s[0]!.name).toBe('bbox_x');
    expect(s[1]!.text).toContain('참고');
  });
});

describe('★요약이 미검사를 통과로 세지 않는다', () => {
  it('★세 수를 따로 적는다', () => {
    const s = dimensionSentences([
      mk({ name: 'bbox_x', expected: 1, actual: 1, delta_pct: 0, passed: true }),
      mk({ name: 'volume', passed: null, reason: 'x' }),
      mk({ name: 'bbox_z', expected: 1, actual: 2, delta_pct: 100, passed: false }),
    ]);
    const t = dimensionSummary(s);
    expect(t).toContain('일치 1');
    expect(t).toContain('불일치 1');
    expect(t).toContain('미검사 1');
    expect(t.indexOf('다릅니다')).toBeLessThan(t.indexOf('일치 1'));
  });

  it('★전부 미검사면 「모두 일치」라고 하지 않는다', () => {
    const s = dimensionSentences([mk({ name: 'volume', passed: null, reason: 'x' })]);
    expect(dimensionSummary(s)).toContain('확인된 치수가 없습니다');
  });

  it('★검사가 하나도 없으면 「수행하지 않았다」 — 통과가 아니다', () => {
    expect(dimensionSummary([])).toContain('수행하지 않았습니다');
    expect(dimensionSentences(null)).toEqual([]);
  });

  it('전부 통과하면 그렇게 말한다 — 과탐 없음', () => {
    const s = dimensionSentences([mk({ name: 'bbox_x', expected: 1, actual: 1, delta_pct: 0, passed: true })]);
    expect(dimensionSummary(s)).toContain('모두 요청과 일치');
  });

  it('★「검사한 치수는」이라고 한정한다 — 전수 검사였다고 읽히면 안 된다', () => {
    const s = dimensionSentences([mk({ name: 'bbox_x', expected: 1, actual: 1, delta_pct: 0, passed: true })]);
    expect(dimensionSummary(s)).toContain('검사한 치수는');
  });
});

describe('숫자 표기', () => {
  it('지어낸 정밀도를 붙이지 않는다', () => {
    const [s] = dimensionSentences([mk({ name: 'volume', expected: 1234.5678, actual: 1234.4, delta_pct: 0.01 })]);
    expect(s!.text).toContain('요청 1235');   // 100 이상은 정수로
  });

  it('3축 배열을 나열로 읽는다', () => {
    const [s] = dimensionSentences([mk({ name: 'bbox_sorted', expected: [10, 20, 30], actual: [10, 20, 30], delta_pct: 0 })], { unit: 'mm' });
    expect(s!.text).toContain('10 × 20 × 30');
  });

  it('불리언 검사를 값 대조로 읽는다', () => {
    const [s] = dimensionSentences([mk({ name: 'watertight', expected: true, actual: false, passed: false })]);
    expect(s!.text).toContain('수밀');
    expect(s!.text).toContain('✗');
  });
});
