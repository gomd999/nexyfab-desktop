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
    // 경간당: 거더4+가로보9+판3 = 16 → 48; 지점 4×(부재3+교좌4)=28; 총 76
    expect(r.expanded!.parts!).toHaveLength(76);
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

  it('refuses invalid configs honestly', () => {
    expect(() => buildBridgeIR({ spans: 0 })).toThrow();
    expect(() => buildBridgeIR({ girders: 1 })).toThrow();
  });
});
