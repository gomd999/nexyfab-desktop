/**
 * run.test.ts — **하네스가 실패를 실제로 잡는가** (260803).
 *
 * ⚠ 항상 통과하는 하네스는 무용지물이다. 실제 케이스 4건이 4/4 로 나온 것만으로는
 *   「검사가 동작한다」를 증명하지 못한다 — 그건 §0.9 에서 저자가 반복한 실수
 *   (「돌아간다」를 「맞다」로 읽기)와 같은 형태다. 그래서 **일부러 깨뜨려서** 잡히는지 본다.
 *
 * 특히 **G3(의도)** 를 집중해서 검사한다. 저자가 이번 세션에 빠뜨린 축이고,
 * G1·G2 만 통과하는 「형상은 나왔는데 요청과 다른」 결과를 잡는 유일한 장치다.
 */

import { describe, expect, it } from 'vitest';
import { BUCKETS, classify, scoreCase } from './run.mjs';
import * as autoFix from '../drawing-to-3d/auto-fix.mjs';
import * as assembly from '../drawing-to-3d/assembly.mjs';

const mods = { autoFix, assembly, fromText: null } as never;
type Case = Record<string, unknown>;
type Score = {
  pass: boolean; gateTrue?: boolean; bucket: string | null;
  axes: Record<string, boolean>; detail: string; dropped?: number;
};
const score = (c: Case): Promise<Score> => (scoreCase as unknown as (c: Case, m: unknown) => Promise<Score>)(c, mods);
const bucketOf = classify as unknown as (i: {
  gateErrors?: string[]; designOk?: boolean; intentMiss?: string[]; dropped?: Array<{ errors?: string[] }>;
}) => string | null;

const GOOD = {
  name: 't',
  parts: [
    { id: 'base', type: 'box', params: { width: 200, depth: 200, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', params: { width: 40, depth: 40, height: 100 }, at: { tx: 80, ty: 80, tz: 10 } },
  ],
};

describe('★G3 의도 — 형상이 나와도 요청과 다르면 잡는다', () => {
  it('부품 수가 모자라면 실패로 잡는다', async () => {
    const r = await score({ id: 'x', kind: 'assembly', input: GOOD, expect: { minParts: 5, designOk: false } });
    expect(r.pass).toBe(false);
    expect(r.axes.g1).toBe(true);          // 형상은 성립한다
    expect(r.axes.g3).toBe(false);         // 그런데 요청과 다르다 ← 이 축이 잡는다
    expect(r.bucket).toBe('INTENT_MISS');
    expect(r.detail).toContain('G3');
  });

  it('요구한 어휘가 없으면 실패로 잡는다', async () => {
    const r = await score({ id: 'x', kind: 'assembly', input: GOOD, expect: { partTypes: { washer: 2 }, designOk: false } });
    expect(r.pass).toBe(false);
    expect(r.axes.g3).toBe(false);
    expect(r.detail).toContain('washer');
  });

  it('살아 있어야 할 부품이 사라지면 잡는다', async () => {
    const r = await score({ id: 'x', kind: 'assembly', input: GOOD, expect: { mustKeep: ['missing_part'], designOk: false } });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('사라짐');
  });

  it('드롭이 허용치를 넘으면 잡는다', async () => {
    const withBroken = {
      name: 't',
      parts: [...GOOD.parts, { id: 'B', type: 'flange', params: { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100 } }],
    };
    const r = await score({ id: 'x', kind: 'assembly', input: withBroken, expect: { maxDropped: 0, designOk: false } });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('드롭');
  });

  it('expect 를 만족하면 통과한다 — 무조건 실패하는 것도 아니다', async () => {
    const r = await score({ id: 'x', kind: 'assembly', input: GOOD, expect: { minParts: 2, mustKeep: ['base'], designOk: false } });
    expect(r.pass).toBe(true);
    expect(r.bucket).toBeNull();
  });
});

describe('★정직성 장치 ① — GATE_TRUE 는 분모에서 빠지고, 느슨해지면 경고한다', () => {
  const incomplete = {
    name: 't',
    parts: [
      { id: 'base', type: 'box', params: { width: 200, depth: 200, height: 10 } },
      { id: 'inc', type: 'flange', params: { outerDia: 150, boreDia: 50, thickness: 12, bcd: 100 } },
    ],
  };

  it('막혀야 할 것이 막히면 gateTrue 통과', async () => {
    const r = await score({ id: 'g', kind: 'assembly', expectFail: true, input: incomplete });
    expect(r.gateTrue).toBe(true);
    expect(r.pass).toBe(true);
    expect(r.bucket).toBe('GATE_TRUE');
  });

  it('★막았어야 하는데 통과하면 **그것이 실패**다', async () => {
    // 멀쩡한 어셈블리에 expectFail 을 달면 = 게이트가 느슨해진 상황의 모사
    const r = await score({ id: 'g', kind: 'assembly', expectFail: true, input: GOOD });
    expect(r.gateTrue).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('느슨');
  });
});

describe('분류기 — 모르면 null 을 낸다(지어내지 않는다)', () => {
  it('의도 불일치가 최우선', () => {
    expect(bucketOf({ intentMiss: ['x'], gateErrors: ['y invalid'] })).toBe('INTENT_MISS');
  });

  it('어휘 부재를 구분한다', () => {
    expect(bucketOf({ gateErrors: ['composite: subs[0].type 미등록'] })).toBe('VOCAB_MISSING');
  });

  it('배치 실패를 구분한다', () => {
    expect(bucketOf({ designOk: false })).toBe('PLACEMENT');
  });

  it('분류할 수 없으면 null — 억지로 버킷에 넣지 않는다', () => {
    expect(bucketOf({ gateErrors: ['알 수 없는 무엇'], designOk: true })).toBeNull();
  });

  it('버킷 설명이 전부 있다 — 이름만 있는 버킷은 쓸모없다', () => {
    for (const [k, v] of Object.entries(BUCKETS as Record<string, string>)) {
      expect(v, k).toBeTruthy();
    }
  });
});
