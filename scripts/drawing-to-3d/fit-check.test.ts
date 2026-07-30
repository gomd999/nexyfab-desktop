import { describe, it, expect } from 'vitest';
import { fitCheck } from './fit-check.mjs';
import { evaluateFit } from '@/app/[lang]/shape-generator/assembly/fitClassLookup';

const call = (pairs: unknown) => (fitCheck as unknown as (p: unknown, f: unknown) => {
  checks: Record<string, { labelKo: string; verdict?: string; pass?: boolean | null; detail?: string[] }>;
} | null)(pairs, evaluateFit);

describe('끼워맞춤 판정 — 양쪽이 선언됐을 때만', () => {
  it('짝이 없으면 null(해당 없음)', () => { expect(call([])).toBeNull(); });

  it('양쪽 선언 → 틈새/조임을 낸다', () => {
    const r = call([{ holeId: 'plate', pinId: 'pin', holeFit: 'H7', pinFit: 'g6', nominalMm: 25 }])!;
    const c = r.checks.pair0;
    expect(c.labelKo).toContain('H7/g6');
    expect(c.detail!.join(' ')).toContain('항상 헐겁다');
  });

  it('조임 끼워맞춤은 조임으로 분류', () => {
    const c = call([{ holeId: 'h', pinId: 'p', holeFit: 'H7', pinFit: 'u6', nominalMm: 25 }])!.checks.pair0;
    expect(c.detail!.join(' ')).toContain('항상 조인다');
  });

  it('중간 끼워맞춤', () => {
    const c = call([{ holeId: 'h', pinId: 'p', holeFit: 'H7', pinFit: 'k6', nominalMm: 25 }])!.checks.pair0;
    expect(c.detail!.join(' ')).toContain('중간끼워맞춤');
  });

  it('★한쪽만 선언되면 판정하지 않는다', () => {
    const c = call([{ holeId: 'h', pinId: 'p', holeFit: 'H7', nominalMm: 25 }])!.checks.pair0;
    expect(c.pass).toBeNull();
    expect(c.detail!.join(' ')).toContain('가정 하나로 결론이 뒤집힌다');
  });

  it('★산식 없는 조합을 구간 밖에서 요구하면 계산하지 않는다', () => {
    const c = call([{ holeId: 'h', pinId: 'p', holeFit: 'H7', pinFit: 'u6', nominalMm: 100 }])!.checks.pair0;
    expect(c.detail!.join(' ')).toContain('계산하지 않는다');
  });

  it('전 구간 산식 조합은 ⌀400 에서도 낸다', () => {
    const c = call([{ holeId: 'h', pinId: 'p', holeFit: 'H7', pinFit: 'g6', nominalMm: 400 }])!.checks.pair0;
    expect(c.detail!.join(' ')).toContain('항상 헐겁다');
  });
});
