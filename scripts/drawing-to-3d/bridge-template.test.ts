/**
 * N3 — 교량 템플릿(C-L1→C-L2): 닫힌형 전개 수, 지점/교좌 격자, 거더 열 연속성
 * (변이 검출), 표고 연속, 면접촉 스택 간섭 0.
 */
import { describe, expect, it } from 'vitest';
import { buildBridge, buildBridgeIR, gateBridge } from './bridge-template.mjs';
import { buildAssembly } from './assembly.mjs';

describe('bridge template (N3)', () => {
  it('3-span 4-girder: closed-form counts and gates pass', () => {
    const r = buildBridge({ spans: 3, girders: 4 });
    expect(r.gateErrors).toEqual([]);
    expect(r.ok).toBe(true);
    // 경간당 16×3 + 지점 28 + 신축이음(내부지점 2) = 78
    expect(r.expanded!.parts!).toHaveLength(78);
  });

  it('mutation: a shifted girder line breaks continuity; a lifted deck breaks elevation', () => {
    const r = buildBridge({ spans: 3, girders: 4 });
    const g = r.expanded!.parts!.find((p: { _occ: { leaf: string } }) => p._occ.leaf === 'g')!;
    (g as { at: { ty: number } }).at.ty += 77;
    expect(gateBridge(r.ir, r.expanded!).some((e: string) => e.includes('girder'))).toBe(true);
    (g as { at: { ty: number } }).at.ty -= 77;
    const d = r.expanded!.parts!.find((p: { _occ: { leaf: string } }) => p._occ.leaf === 'deck')!;
    (d as { at: { tz: number } }).at.tz += 30;
    expect(gateBridge(r.ir, r.expanded!).some((e: string) => e.includes('deck_elevation'))).toBe(true);
  });

  it('face-contact stack yields zero interference (5 spans, 5 girders)', () => {
    const r = buildBridge({ spans: 5, girders: 5 });
    expect(r.ok).toBe(true);
    const built = buildAssembly({ name: r.expanded!.name, domain: 'civil', parts: r.expanded!.parts });
    expect(built.ok).toBe(true);
    expect((built.interferences ?? []).length).toBe(0);
  });

  it('C-L3: expansion joints — count = interior supports, deck gap identity, mutation caught', () => {
    const r = buildBridge({ spans: 4, girders: 3 });
    expect(r.ok).toBe(true);
    const joints = r.expanded!.parts!.filter((p: { role?: string }) => p.role === 'expansion_joint');
    expect(joints).toHaveLength(3);
    // 변이: 한 경간을 밀어 이격을 깨면 deck_gap 게이트가 잡는다
    const decks = r.expanded!.parts!.filter((p: { _occ: { leaf: string } }) => p._occ.leaf === 'deck');
    (decks[1] as { at: { tx: number } }).at.tx += 30;
    expect(gateBridge(r.ir, r.expanded!).some((e: string) => e.includes('deck_gap'))).toBe(true);
  });

  it('C-L3: constant grade — deck follows the grade line, zero interference across ±3%', () => {
    for (const gradePct of [1.5, 3, -2, -3]) {
      const r = buildBridge({ spans: 4, girders: 4, gradePct });
      expect(r.gateErrors, `grade ${gradePct}`).toEqual([]);
      const built = buildAssembly({ name: 'g', domain: 'bridge', parts: r.expanded!.parts });
      expect((built.interferences ?? []).length, `grade ${gradePct} interference`).toBe(0);
      // 경간별 deck 표고가 구배선을 따른다 (게이트 자체 검증 + 직접 확인)
      const decks = r.expanded!.parts!.filter((p: { _occ: { leaf: string } }) => p._occ.leaf === 'deck');
      const z0 = (decks[0] as { at: { tz: number } }).at.tz;
      const z1 = (decks[1] as { at: { tz: number } }).at.tz;
      expect(z1 - z0).toBeCloseTo(30000 * gradePct / 100, 3);
    }
  });

  it('refuses invalid configs honestly (incl. unverified grades)', () => {
    expect(() => buildBridgeIR({ spans: 0 })).toThrow();
    expect(() => buildBridgeIR({ girders: 1 })).toThrow();
    // B-3(260808e): 3<|g|≤6 은 스트립 근사로 검증 범위에 편입 — 5%는 이제 정상.
    expect(() => buildBridgeIR({ gradePct: 7 })).toThrow(/6/);
  });
});

describe('B-3 — ±6% 스트립 계단 근사(C-L3 완결)', () => {
  it('grades up to ±6% build clean: gates 0 + interference 0 (strip mode >3%)', () => {
    for (const gradePct of [3.5, 4.5, 6, -6]) {
      const r = (buildBridge as any)({ spans: 3, gradePct });
      expect(r.ok, `grade ${gradePct}`).toBe(true);
      const v = (buildAssembly as any)({ name: 'br', domain: 'civil', parts: r.expanded.parts });
      expect((v.interferences ?? []).length, `grade ${gradePct} interf`).toBe(0);
      // 스트립 모드 실증: 데크가 다수 스트립으로 전개
      const strips = r.expanded.parts.filter((pp: any) => pp.role === 'deck');
      expect(strips.length).toBeGreaterThan(3);
    }
  });

  it('≤3% keeps the legacy pitched-deck path verbatim (no corpus drift)', () => {
    const r = (buildBridge as any)({ spans: 3, gradePct: 2 });
    expect(r.ok).toBe(true);
    const decks = r.expanded.parts.filter((pp: any) => pp.role === 'deck');
    expect(decks.length).toBe(3); // 경간당 단일 피치 데크(종전)
    expect(r.expanded.parts.length).toBe(78);
  });

  it('honest cap: |grade| > 6% is refused, not approximated silently', () => {
    expect(() => (buildBridge as any)({ spans: 2, gradePct: 7 })).toThrow(/6/);
  });
});
