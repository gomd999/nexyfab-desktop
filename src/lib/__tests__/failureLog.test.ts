/**
 * failureLog.test.ts — **지문이 같은 원인을 하나로 모으는가** (260803).
 *
 * 이 회귀의 대상은 저장이 아니라 **정규화**다. 지문이 흩어지면 집계가 무의미해지고,
 * 그러면 「무엇을 다음에 고칠지」를 못 정한다 — 이 파일이 존재하는 이유가 사라진다.
 *
 * 실제로 그랬다: 라이브에서 `hole[0] d invalid` … `hole[3] d invalid` 가 **4건**으로,
 * `friction_washer_1..6` 이 **6건**으로 흩어져 있었다. 원인은 각각 하나다.
 */

import { describe, expect, it } from 'vitest';
import { failureSignature } from '../failureLog';

describe('★같은 원인은 같은 지문이 된다', () => {
  it('구멍 인덱스가 달라도 하나로 모인다', () => {
    const a = failureSignature('gate', ['hole[0] d 없음 — 원형 구멍은 지름 d 가 필수다']);
    const b = failureSignature('gate', ['hole[3] d 없음 — 원형 구멍은 지름 d 가 필수다']);
    expect(a).toBe(b);
  });

  it('★부품 이름이 달라도 하나로 모인다 — 이름은 사용자가 지은 것(PII)이다', () => {
    const a = failureSignature('gate', ['friction_washer_1: bcd invalid'], ['flange']);
    const b = failureSignature('gate', ['hinge_friction_washer4: bcd invalid'], ['flange']);
    expect(a).toBe(b);
  });

  it('치수 숫자가 달라도 하나로 모인다', () => {
    const a = failureSignature('gate', ['hole[0] d 300 ≥ 판 최소변 240 — 구멍이 판보다 크다']);
    const b = failureSignature('gate', ['hole[1] d 999 ≥ 판 최소변 120 — 구멍이 판보다 크다']);
    expect(a).toBe(b);
  });

  it('오류 순서가 흔들려도 같은 지문이다', () => {
    const a = failureSignature('gate', ['boltHoleD invalid', 'bcd invalid']);
    const b = failureSignature('gate', ['bcd invalid', 'boltHoleD invalid']);
    expect(a).toBe(b);
  });
});

describe('★다른 원인은 갈라진다 — 뭉뚱그리면 그것도 쓸모없다', () => {
  it('stage 가 다르면 다른 지문', () => {
    expect(failureSignature('gate', ['x invalid'])).not.toBe(failureSignature('drop', ['x invalid']));
  });

  it('부품 타입이 다르면 다른 지문', () => {
    expect(failureSignature('gate', ['thickness invalid'], ['flange']))
      .not.toBe(failureSignature('gate', ['thickness invalid'], ['washer']));
  });

  it('오류 문구가 다르면 다른 지문', () => {
    expect(failureSignature('gate', ['bcd invalid'])).not.toBe(failureSignature('gate', ['bore ≥ OD']));
  });
});

describe('지문에 PII 가 남지 않는다', () => {
  it('부품 id·치수가 지문에 들어가지 않는다', () => {
    const sig = failureSignature('gate', ['secret_project_x_bracket_7: width 1234 invalid'], ['box']);
    expect(sig).not.toContain('secret_project_x');
    expect(sig).not.toContain('1234');
  });

  it('입력이 비어도 죽지 않는다', () => {
    expect(() => failureSignature('empty')).not.toThrow();
    expect(failureSignature('empty')).toContain('empty');
  });

  it('오류가 많아도 상위 3건만 쓴다 — 지문이 무한히 갈라지지 않게', () => {
    const many = Array.from({ length: 20 }, (_, i) => `err${i} invalid`);
    const sig = failureSignature('gate', many);
    expect(sig.split('|').length).toBeLessThanOrEqual(3);
  });
});
