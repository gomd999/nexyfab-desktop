/**
 * synthesize.test.ts — **원문 없이도 재현 케이스를 만든다** (260803, B4 완결).
 *
 * `failureLog` 는 원문을 저장하지 않는다(고객 설계 IP). 그래서 「무엇이 깨지는지」는 알아도
 * **「고쳤는지 확인」이 안 됐다.** 루프가 거기서 끊겼다.
 *
 * 해법은 사용자 입력 복원이 아니라 **우리 어휘로 만든 최소 재현**이다.
 * ⚠ 이 회귀의 핵심은 **「재현되지 않으면 버린다」** — 재현 못 하는 케이스를 회귀에 넣으면
 *   무엇을 지키는지 알 수 없고 「고쳤다」가 거짓이 된다.
 */

import { describe, expect, it } from 'vitest';
import { healthyPart, paramsFromErrors, synthesizeAll, synthesizeCase } from './synthesize.mjs';
import { failureSignature } from '../../src/lib/failureLog';
import { gate } from '../drawing-to-3d/reconstruct.mjs';

type Row = { signature: string; stage: string; sampleErrors: string[] };
type Out = { case?: Record<string, unknown>; skipped?: string; signature?: string };
const sigOf = failureSignature as unknown as (s: string, e?: string[], t?: string[]) => string;
const syn = (r: Row): Out => (synthesizeCase as unknown as (r: Row, o: unknown) => Out)(r, { signatureOf: sigOf });
const g = (t: string, p: Record<string, unknown>): string[] =>
  (gate as unknown as (i: Record<string, unknown>) => string[])({ type: t, ...p });

// 라이브에서 실제로 났던 실패 — 마찰 와셔가 flange 로 분류돼 부품당 6건씩 났다.
const LIVE_ERRORS = ['friction_washer_1: boltHoleD invalid', 'friction_washer_1: boltCount invalid — 2~36 사이 정수'];
const LIVE: Row = {
  stage: 'gate',
  signature: sigOf('gate', LIVE_ERRORS, ['flange']),
  sampleErrors: LIVE_ERRORS,
};

describe('★라이브 지문에서 재현 케이스가 나온다', () => {
  it('지문이 케이스로 합성된다', () => {
    const out = syn(LIVE);
    expect(out.skipped, out.skipped).toBeUndefined();
    expect(out.case).toBeTruthy();
  });

  it('★합성된 케이스가 **같은 지문을 실제로 재현**한다 — 이게 없으면 무의미하다', () => {
    const out = syn(LIVE);
    const parts = (out.case!.input as { parts: Array<{ type: string; params: Record<string, unknown> }> }).parts;
    const broken = parts.find((p) => p.type === 'flange')!;
    const errs = g('flange', broken.params);
    expect(errs.length).toBeGreaterThan(0);
    expect(sigOf('gate', errs, ['flange'])).toBe(LIVE.signature);
  });

  it('expectFail 케이스로 만든다 — 막히는 것이 정답인 재현이다', () => {
    expect(syn(LIVE).case!.expectFail).toBe(true);
  });

  it('★사용자 설계가 아님을 케이스 자체에 적는다', () => {
    const c = syn(LIVE).case!;
    expect(String(c.note)).toMatch(/사용자의 원래 설계가 아니다/);
    expect(String(c.source)).toMatch(/원문은 저장하지 않으므로/);
  });
});

describe('★못 만드는 것은 못 만든다고 한다', () => {
  it('배치·의도 실패는 부품 파라미터로 재현 불가 — 건너뛰고 사유를 남긴다', () => {
    const out = syn({ stage: 'assembly', signature: 'assembly::box::designOk false', sampleErrors: [] });
    expect(out.case).toBeUndefined();
    expect(out.skipped).toMatch(/원문 필요/);
  });

  it('template-miss 도 건너뛴다', () => {
    const out = syn({ stage: 'template-miss', signature: 'template-miss::::none', sampleErrors: [] });
    expect(out.skipped).toBeTruthy();
  });

  it('오류에서 파라미터 이름을 못 뽑으면 건너뛴다 — 억지로 만들지 않는다', () => {
    const out = syn({ stage: 'gate', signature: sigOf('gate', ['알 수 없는 무엇'], ['box']), sampleErrors: ['알 수 없는 무엇'] });
    expect(out.case).toBeUndefined();
    expect(out.skipped).toMatch(/파라미터 이름/);
  });

  it('지문에 재현 가능한 어휘가 없으면 건너뛴다', () => {
    const out = syn({ stage: 'gate', signature: 'gate::없는어휘::x invalid', sampleErrors: ['x invalid'] });
    expect(out.skipped).toMatch(/어휘가 없다/);
  });

  it('건너뛴 것을 숨기지 않는다 — synthesizeAll 이 사유를 함께 낸다', () => {
    const r = (synthesizeAll as unknown as (rows: Row[], o: unknown) => { cases: unknown[]; skipped: Array<{ reason: string }> })(
      [LIVE, { stage: 'assembly', signature: 'a::b::c', sampleErrors: [] }], { signatureOf: sigOf },
    );
    expect(r.cases).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBeTruthy();
  });
});

describe('★단일 소스 — 지문 규칙을 두 벌로 만들지 않는다', () => {
  it('signatureOf 를 안 주면 즉시 실패한다 — 조용히 자체 구현으로 떨어지지 않는다', () => {
    expect(() => (synthesizeCase as unknown as (r: Row) => Out)(LIVE)).toThrow(/signatureOf 주입 필수/);
  });
});

describe('합성 기본값이 실제로 게이트를 통과한다', () => {
  // ⚠ 기본값이 게이트를 못 넘으면 "파라미터를 지워서 깨졌다"를 증명할 수 없다.
  for (const t of ['flange', 'plate_with_holes', 'washer', 'box', 'rect_tube', 'l_bracket', 'slab_with_openings']) {
    it(`${t} 정상 부품이 게이트 0건`, () => {
      const p = (healthyPart as unknown as (t: string) => { params: Record<string, unknown> })(t);
      expect(g(t, p.params), t).toEqual([]);
    });
  }
});

describe('paramsFromErrors — 문구에서 파라미터 이름만 뽑는다', () => {
  it('식별자 접두와 한국어 설명이 섞여도 뽑는다', () => {
    expect(paramsFromErrors(['friction_washer_1: bcd invalid', 'boltCount invalid — 2~36 사이 정수']).sort())
      .toEqual(['bcd', 'boltCount']);
  });

  it('invalid 가 아닌 문구에서는 뽑지 않는다', () => {
    expect(paramsFromErrors(['bore ≥ OD', 'bolt holes break bore rim'])).toEqual([]);
  });
});
