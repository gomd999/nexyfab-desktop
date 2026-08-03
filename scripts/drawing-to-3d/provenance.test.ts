/**
 * provenance.test.ts — **축 2 가 흐려지지 않는가** (260803).
 *
 * 「어떤 입력이든 결과를 낸다」를 정직하게 만드는 것은 근거 표시뿐이다.
 * 이 회귀가 지키는 것은 기능이 아니라 **규율**이다:
 *   ① 모르는 값이 조용히 `observed` 로 승격되지 않는다
 *   ② 등급은 내려가기만 한다
 *   ③ 가정이 하나라도 있으면 「검증됨」이라고 말하지 않는다
 */

import { describe, expect, it } from 'vitest';
import {
  LEVELS, annotateAssembly, assemblyProvenance, groundParamsInText, isVerifiableLevel,
  markParam, markParams, partLevel, provenanceSummary, weaker,
} from './provenance.mjs';

type Part = { id: string; type: string; params: Record<string, number>; _prov?: unknown };
const mark = markParam as unknown as (p: Part, k: string, l: string, n?: string) => Part;
const marks = markParams as unknown as (p: Part, m: Record<string, unknown>) => Part;
const level = partLevel as unknown as (p: Part, o?: { unknownAs?: string }) => string;
const asmProv = assemblyProvenance as unknown as (
  a: { parts: Part[] }, o?: { unknownAs?: string; dropped?: unknown[] }
) => {
  counts: Record<string, number>; weakest: string; verifiable: boolean;
  assumed: Array<{ partId: string; params: string[] }>; unresolved: Array<{ partId: string }>;
};

const plate = (): Part => ({ id: 'plate', type: 'plate_with_holes', params: { width: 280, depth: 240, thickness: 4 } });

describe('어휘 — PBAS Evidence Graph 와 같은 문자열', () => {
  it('5단계가 약한 순으로 정렬돼 있다', () => {
    expect(LEVELS).toEqual(['observed', 'geometry-derived', 'rule-derived', 'assumed', 'unresolved']);
  });

  it('assumed 부터는 검증에 그대로 쓸 수 없다', () => {
    expect(isVerifiableLevel('observed')).toBe(true);
    expect(isVerifiableLevel('rule-derived')).toBe(true);
    expect(isVerifiableLevel('assumed')).toBe(false);
    expect(isVerifiableLevel('unresolved')).toBe(false);
  });
});

describe('★등급은 내려가기만 한다', () => {
  it('weaker() 가 약한 쪽을 남긴다', () => {
    expect(weaker('observed', 'assumed')).toBe('assumed');
    expect(weaker('assumed', 'observed')).toBe('assumed');
    expect(weaker('rule-derived', 'unresolved')).toBe('unresolved');
  });

  it('가정으로 채운 값을 규칙으로 덮어도 가정이 사라지지 않는다', () => {
    let p = mark(plate(), 'thickness', 'assumed', '통상값 4mm');
    p = mark(p, 'thickness', 'rule-derived');
    expect(level(p, { unknownAs: 'observed' })).toBe('assumed');
  });

  it('사유는 등급이 실제로 바뀐 회차의 것만 남는다', () => {
    let p = mark(plate(), 'thickness', 'assumed', '통상값 4mm');
    p = mark(p, 'thickness', 'rule-derived', '표준표에서');
    const notes = (p._prov as { notes: Record<string, string> }).notes;
    expect(notes.thickness).toBe('통상값 4mm'); // 덮어쓰지 않는다
  });
});

describe('★모르는 값이 조용히 observed 가 되지 않는다', () => {
  it('표시가 없으면 기본이 assumed 다 — observed 가 아니다', () => {
    expect(level(plate())).toBe('assumed');
  });

  it('사용자가 준 값이라고 **선언**해야 observed 가 된다', () => {
    const p = marks(plate(), { width: 'observed', depth: 'observed', thickness: 'observed' });
    expect(level(p)).toBe('observed');
  });

  it('부품 등급 = 파라미터 중 최저', () => {
    const p = marks(plate(), { width: 'observed', depth: 'observed', thickness: 'assumed' });
    expect(level(p)).toBe('assumed');
  });

  it('알 수 없는 등급은 거부한다 — 오타가 조용히 통과하면 안 된다', () => {
    expect(() => mark(plate(), 'width', 'probably-fine')).toThrow(/알 수 없는 등급/);
  });

  it('원본을 변형하지 않는다', () => {
    const p = plate();
    mark(p, 'width', 'assumed');
    expect(p._prov).toBeUndefined();
  });
});

describe('★어셈블리 요약 — 가정이 있으면 검증됐다고 말하지 않는다', () => {
  const good = (): Part => marks(
    { id: 'base', type: 'box', params: { width: 260, depth: 220, height: 6 } },
    { width: 'observed', depth: 'observed', height: 'observed' },
  );

  it('전부 근거가 있으면 verifiable', () => {
    const r = asmProv({ parts: [good()] });
    expect(r.verifiable).toBe(true);
    expect(provenanceSummary(r as never)).toContain('그대로');
  });

  it('가정이 하나라도 있으면 verifiable 이 아니다', () => {
    const p = marks(plate(), { width: 'observed', depth: 'observed', thickness: 'assumed' });
    const r = asmProv({ parts: [good(), p] });
    expect(r.verifiable).toBe(false);
    expect(r.assumed).toHaveLength(1);
    expect(r.assumed[0].params).toEqual(['thickness']);
    expect(provenanceSummary(r as never)).toContain('조건부');
  });

  it('드롭된 부품은 unresolved 로 집계되고 요약에 나온다', () => {
    const r = asmProv({ parts: [good()] }, { dropped: [{ partId: 'BROKEN', errors: ['boltHoleD invalid'] }] });
    expect(r.counts.unresolved).toBe(1);
    expect(r.weakest).toBe('unresolved');
    expect(r.verifiable).toBe(false);
    expect(provenanceSummary(r as never)).toContain('제외');
  });

  it('표준·형상 파생은 검증 가능으로 센다 — 가정과 섞지 않는다', () => {
    const p = marks(plate(), { width: 'observed', depth: 'geometry-derived', thickness: 'rule-derived' });
    const r = asmProv({ parts: [p] });
    expect(r.verifiable).toBe(true);
    expect(r.weakest).toBe('rule-derived');
  });
});

// ─── B1: 결정론 판정기 ──────────────────────────────────────────────────────

describe('★원문 숫자 대조 — LLM 을 믿지 않고 기계로 가른다', () => {
  const TEXT = '하부 베이스: 260×220mm, 두께 6mm. 노트북 받침판: 280×240mm. '
    + '힌지 마찰 와셔: 외경 18mm, 내경 8mm, 두께 1mm. 베이스 체결 볼트 M5×12 4개.';
  const ground = groundParamsInText as unknown as (p: Part, t: string) => Part;
  const annotate = annotateAssembly as unknown as (
    a: { parts: Part[] }, t: string, o?: { repairedIds?: string[] }
  ) => { parts: Part[] };

  it('원문에 있는 값은 observed', () => {
    const p = ground({ id: 'base', type: 'plate_with_holes', params: { width: 260, depth: 220, thickness: 6 } }, TEXT);
    expect(level(p)).toBe('observed');
  });

  it('★원문에 없는 값은 assumed — 이쪽이 이 판정의 신뢰 구간이다', () => {
    const p = ground({ id: 'x', type: 'box', params: { width: 137, depth: 99, height: 41 } }, TEXT);
    expect(level(p)).toBe('assumed');
    expect((p._prov as { notes: Record<string, string> }).notes.width).toContain('원문에 없음');
  });

  it('한 자리 수는 단위·기호가 붙을 때만 인정한다 — 우연 일치 억제', () => {
    // "4개" 의 4 는 인정하지 않는다
    const bad = ground({ id: 'a', type: 'box', params: { width: 4 } as Record<string, number> }, '패드 4개 사용');
    expect(level(bad)).toBe('assumed');
    // "두께 1mm" 의 1 은 인정한다
    const good = ground({ id: 'b', type: 'box', params: { thickness: 1 } as Record<string, number> }, TEXT);
    expect(level(good)).toBe('observed');
  });

  it('배열·객체 파라미터는 건너뛴다 — 숫자 대조 대상이 아니다', () => {
    const p = ground({
      id: 'c', type: 'plate_with_holes',
      params: { width: 260, holes: [{ x: 1, y: 1, d: 5 }] } as unknown as Record<string, number>,
    }, TEXT);
    expect((p._prov as { params: Record<string, string> }).params.holes).toBeUndefined();
  });
});

describe('★수리 이력 — 게이트 수리된 부품은 전량 assumed 로 내려간다', () => {
  const TEXT = '받침판 280×240mm, 두께 4mm.';
  const annotate = annotateAssembly as unknown as (
    a: { parts: Part[] }, t: string, o?: { repairedIds?: string[] }
  ) => { parts: Part[] };
  const plateP = (): Part => ({ id: 'plate', type: 'plate_with_holes', params: { width: 280, depth: 240, thickness: 4 } });

  it('수리 안 된 부품은 원문 대조 결과를 유지한다', () => {
    const a = annotate({ parts: [plateP()] }, TEXT);
    expect(level(a.parts[0])).toBe('observed');
  });

  it('★수리된 부품은 원문에 숫자가 있어도 assumed 다', () => {
    const a = annotate({ parts: [plateP()] }, TEXT, { repairedIds: ['plate'] });
    expect(level(a.parts[0])).toBe('assumed');
    const notes = (a.parts[0]._prov as { notes: Record<string, string> }).notes;
    expect(notes.width).toContain('게이트 수리');
  });

  it('hex_bolt 는 표준표 파생을 부품 수준에 남긴다', () => {
    const a = annotate({ parts: [{ id: 'b', type: 'hex_bolt', params: { threadDia: 5, length: 12 } }] }, 'M5×12');
    expect((a.parts[0]._prov as { standard?: string }).standard).toContain('ISO 4017');
  });

  it('원본을 변형하지 않는다', () => {
    const asm = { parts: [plateP()] };
    annotate(asm, TEXT, { repairedIds: ['plate'] });
    expect(asm.parts[0]._prov).toBeUndefined();
  });
});
