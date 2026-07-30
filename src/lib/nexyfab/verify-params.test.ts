/**
 * 검토 입력 폼 → `verifyParams` 변환 (260731b, 계획 P2-⑦).
 *
 * ## 왜 이 파일이 있는가
 * `verifyParams`(지진 R·풍 V0·배근 As·용도지역 상한)는 웹 라우트와 MCP 양쪽에 배선돼
 * 있었고 라이브 도달도 실측했다. 그런데 **웹 UI 는 `{assembly}` 만 보내고 있었다** —
 * 넣을 자리가 없으니 웹 사용자는 영원히 「입력 대기」만 받았다.
 * **API 로만 닿는 입력은 사실상 없는 입력이다.**
 *
 * 변환에서 가장 위험한 것은 **빈칸을 값으로 바꾸는 것**이다. `0` 이나 기본값을 넣어 보내면
 * 사용자가 확인하지 않은 값으로 판정이 나가고, 그건 이 세션 내내 막아 온 「지어내기」다.
 */
import { describe, it, expect } from 'vitest';
import { VERIFY_FIELDS, buildVerifyParams } from './verify-params';

describe('빈칸은 **키를 만들지 않는다** — 기본값으로 갈아치우지 않는다', () => {
  it('전부 비어 있으면 빈 객체다', () => {
    expect(buildVerifyParams({})).toEqual({});
  });

  it.each(VERIFY_FIELDS.map((f) => f.key))('%s — 빈 문자열은 무시된다', (key) => {
    expect(buildVerifyParams({ [key]: '' })).toEqual({});
    expect(buildVerifyParams({ [key]: '   ' })).toEqual({});
  });

  it('숫자가 아닌 값은 무시된다 — NaN 을 판정에 넣지 않는다', () => {
    expect(buildVerifyParams({ seismicR: 'abc', windV0: '--' })).toEqual({});
  });

  it('`0` 은 **명시적으로 준 값**이라 살린다(상한 0% 는 뜻이 있다)', () => {
    expect(buildVerifyParams({ coverageLimitPct: '0' })).toEqual({ zoning: { coverageLimitPct: 0 } });
  });

  it('As=0 은 배근 없음이라 넘기지 않는다 — 검사가 「입력 대기」로 고지해야 한다', () => {
    // 0mm² 를 넘기면 계산기가 「배근 0」으로 판정해 FAIL 이 되고, 그건 「미입력」과 다르다.
    expect(buildVerifyParams({ As_mm2: '0' })).toEqual({});
  });
});

describe('중첩 구조를 계산기 규약대로 만든다', () => {
  it('R → `seismic.R` · V0 → `wind.V0`', () => {
    expect(buildVerifyParams({ seismicR: '5', windV0: '30' }))
      .toEqual({ seismic: { R: 5 }, wind: { V0: 30 } });
  });

  it('용도지역 3항목은 `zoning` 하나로 묶인다 — 일부만 줘도 된다', () => {
    expect(buildVerifyParams({ farLimitPct: '250' })).toEqual({ zoning: { farLimitPct: 250 } });
    expect(buildVerifyParams({ coverageLimitPct: '60', greenRatioMinPct: '30' }))
      .toEqual({ zoning: { coverageLimitPct: 60, greenRatioMinPct: 30 } });
  });

  it('전부 주면 4계통이 다 실린다', () => {
    expect(buildVerifyParams({
      seismicR: '5', windV0: '30', As_mm2: '8000',
      coverageLimitPct: '60', farLimitPct: '250', greenRatioMinPct: '30',
    })).toEqual({
      seismic: { R: 5 }, wind: { V0: 30 }, As_mm2: 8000,
      zoning: { coverageLimitPct: 60, farLimitPct: 250, greenRatioMinPct: 30 },
    });
  });
});

describe('폼 필드 정의', () => {
  it('키가 중복되지 않는다', () => {
    const keys = VERIFY_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('모든 필드가 변환에서 실제로 쓰인다 — 폼에만 있고 안 보내는 칸을 만들지 않는다', () => {
    for (const f of VERIFY_FIELDS) {
      const out = buildVerifyParams({ [f.key]: '5' });
      expect(Object.keys(out).length, f.key).toBeGreaterThan(0);
    }
  });
});
