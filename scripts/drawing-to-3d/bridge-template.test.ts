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

  it('refuses invalid configs honestly', () => {
    expect(() => buildBridgeIR({ spans: 0 })).toThrow();
    expect(() => buildBridgeIR({ girders: 1 })).toThrow();
  });
});
