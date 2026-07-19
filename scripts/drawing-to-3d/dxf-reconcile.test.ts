/**
 * T3 DXF DIMENSION 결정론 판독 회귀(260719) — 분류(선형H/V·지름·반지름)+intent 정합.
 * 실측값 직사용: ≤2% 근접 파라미터=교체(이력 보고), 매칭 없음=unverified(강등 대상).
 */
import { describe, it, expect } from 'vitest';
import { extractDxfSeed, reconcileIntentWithDxf } from './dxf-seed.mjs';

const L = (code: number | string, val: number | string) => `${code}\n${val}`;
const DXF = [
  L(0, 'SECTION'), L(2, 'ENTITIES'),
  L(0, 'DIMENSION'), L(70, 0), L(50, '0.0'), L(42, '200.0'), L(1, '<>'),
  L(0, 'DIMENSION'), L(70, 0), L(50, '90.0'), L(42, '120.0'),
  L(0, 'DIMENSION'), L(70, 3), L(42, '16.0'), L(1, '⌀16'),
  L(0, 'DIMENSION'), L(70, 4), L(42, '5.0'),
  L(0, 'CIRCLE'), L(10, '40.0'), L(20, '40.0'), L(40, '8.0'),
  L(0, 'ENDSEC'), L(0, 'EOF'),
].join('\n');

type Rec = { intent: Record<string, unknown>; measured: { param: string; from: number; to: number }[]; unverified: string[]; coverage: number };

describe('T3 DXF 치수 결정론 판독', () => {
  it('DIMENSION 분류: 선형H/V(50 각)·지름(70&7=3)·반지름 — 실측값 42 수집', () => {
    const seed = extractDxfSeed(DXF);
    const kinds = seed.dims.map((d: { kind: string; value: number }) => `${d.kind}:${d.value}`);
    expect(kinds).toContain('linearH:200');
    expect(kinds).toContain('linearV:120');
    expect(kinds).toContain('diameter:16');
    expect(kinds).toContain('radius:5');
  });
  it('정합: 근접 파라미터=실측값 교체(이력)·무매칭=unverified — 지름 파라미터는 지름 풀 우선', () => {
    const seed = extractDxfSeed(DXF);
    const r = reconcileIntentWithDxf(
      { type: 'plate_with_holes', confidence: 0.9, width: 201.5, depth: 119, thickness: 9.8, holes: [{ x: 40, y: 40, d: 15.8 }] },
      seed,
    ) as Rec;
    expect(r.intent.width).toBe(200);   // 0.75% → 교체
    expect(r.intent.depth).toBe(120);
    expect(r.unverified).toContain('thickness'); // 실측 없음 = 추론값 잔존(정직)
    expect((r.intent.holes as { d: number }[])[0].d).toBe(16); // ⌀16 직사용
    expect(r.measured.find((m) => m.param === 'width')?.from).toBe(201.5);
    expect(r.coverage).toBeGreaterThan(0.5);
  });
  it('radius×2·원 2r 도 지름 풀: boreDia 10 ↔ radius 5', () => {
    const seed = extractDxfSeed(DXF);
    const r = reconcileIntentWithDxf({ boreDia: 10.1 }, seed) as Rec;
    expect(r.intent.boreDia).toBe(10);
  });
});
