/**
 * N2 — 타워 템플릿(B-L1→B-L2): 결정론 전개 규모, 기둥 수직 연속성 게이트,
 * BOQ 교차, 간섭 0(면접촉 스택 기하 계약), 시스템 레이어 태그.
 */
import { describe, expect, it } from 'vitest';
import { buildTower, buildTowerIR, gateTower } from './tower-template.mjs';
import { buildAssembly } from './assembly.mjs';

describe('tower template (N2)', () => {
  it('10F 3x2: expands to the closed-form part count and passes gates', () => {
    const r = buildTower({ floors: 10, nx: 3, ny: 2 });
    expect(r.gateErrors).toEqual([]);
    expect(r.ok).toBe(true);
    // 층당 54(기둥12+보17+코어8+슬래브1+가구16) ×10 + 옥상 파라펫 4
    expect(r.expanded!.parts).toHaveLength(54 * 10 + 4);
    // 시스템 레이어: 구조/인테리어 분리 태그
    const systems = new Set(r.expanded!.parts!.map((p: { system?: string }) => p.system));
    expect(systems.has('structure')).toBe(true);
    expect(systems.has('interior')).toBe(true);
  });

  it('column continuity gate catches a broken stack', () => {
    const r = buildTower({ floors: 5, nx: 2, ny: 2 });
    expect(r.ok).toBe(true);
    // 임의로 기둥 하나를 옆으로 밀면 연속성 게이트가 잡아야 한다
    const sab = r.expanded!.parts!.find((p: { _occ: { leaf: string } }) => p._occ.leaf === 'col')!;
    (sab as { at: { tx: number } }).at.tx += 123;
    const errs = gateTower(r.ir, r.expanded!);
    expect(errs.some((e: string) => e.includes('column'))).toBe(true);
  });

  it('face-contact stacking yields zero interference at 6 floors', () => {
    const r = buildTower({ floors: 6, nx: 3, ny: 2 });
    expect(r.ok).toBe(true);
    const built = buildAssembly({ name: r.expanded!.name, domain: 'building', parts: r.expanded!.parts });
    expect(built.ok).toBe(true);
    expect((built.interferences ?? []).length).toBe(0);
  });

  it('B-L3: lobby variant keeps core continuity and stacks elevations closed-form', () => {
    const r = buildTower({ floors: 10, nx: 3, ny: 2, withLobby: true });
    expect(r.gateErrors).toEqual([]);
    expect(r.ok).toBe(true);
    // 레벨 = 로비 1 + 기준층 9; 코어벽 8위치 × 10레벨
    const cores = r.expanded!.parts!.filter((p: { role?: string }) => p.role === 'core_wall');
    expect(cores).toHaveLength(8 * 10);
    // 파라펫은 로비층고(2H) + 9H 위에 얹힌다
    const parapet = r.expanded!.parts!.find((p: { role?: string }) => p.role === 'parapet')!;
    expect((parapet as { at: { tz: number } }).at.tz).toBe(3400 * 2 + 9 * 3400);
    // 변이: 로비 코어벽 하나를 밀면 수직 동선 단절이 잡힌다
    const lc = r.expanded!.parts!.find((p: { id: string }) => p.id.startsWith('lobby/core/'))!;
    (lc as { at: { tx: number } }).at.tx += 50;
    expect(gateTower(r.ir, r.expanded!).some((e: string) => e.includes('core_continuity'))).toBe(true);
  });

  it('B-L3: lobby variant zero interference', () => {
    const r = buildTower({ floors: 6, nx: 3, ny: 2, withLobby: true });
    const built = buildAssembly({ name: r.expanded!.name, domain: 'building', parts: r.expanded!.parts });
    expect(built.ok).toBe(true);
    expect((built.interferences ?? []).length).toBe(0);
  });

  it('B-L4: MEP shafts align vertically, trunks stay in the plenum band, zero interference', () => {
    const r = buildTower({ floors: 8, nx: 3, ny: 2, withMep: true });
    expect(r.gateErrors).toEqual([]);
    const shafts = r.expanded!.parts!.filter((p: { role?: string }) => p.role === 'mep_shaft');
    expect(shafts).toHaveLength(8);
    expect(new Set(shafts.map((p: { at: { tx: number; ty: number } }) => `${p.at.tx},${p.at.ty}`)).size).toBe(1);
    const built = buildAssembly({ name: 'mep', domain: 'building', parts: r.expanded!.parts });
    expect((built.interferences ?? []).length).toBe(0);
    // 변이: 한 층 샤프트를 밀면 수직 정렬 게이트가 잡는다
    (shafts[3] as { at: { tx: number } }).at.tx += 200;
    expect(gateTower(r.ir, r.expanded!).some((e: string) => e.includes('shaft_alignment'))).toBe(true);
  });

  it('refuses invalid configs honestly', () => {
    expect(() => buildTowerIR({ floors: 0 })).toThrow();
    expect(() => buildTowerIR({ floors: 10, floorH: 900 })).toThrow();
  });
});

describe('B-2 — curtain wall (B-L4 잔여)', () => {
  it('module arithmetic: mullion/panel counts match the fit-to-length formula, gates clean', () => {
    const r = (buildTower as any)({ floors: 5, withCurtainWall: true });
    expect(r.ok).toBe(true);
    const parts = r.parts ?? r.expanded.parts;
    const mullions = parts.filter((pp: any) => pp.role === 'cw_mullion');
    const panels = parts.filter((pp: any) => pp.role === 'cw_panel');
    // L_x=24500→nModX 16, L_y(코너 인셋 후)=16000→nModY 11
    expect(mullions.length).toBe(5 * (2 * 17 + 2 * 12));
    expect(panels.length).toBe(5 * (2 * 16 + 2 * 11));
  });

  it('default stays curtain-wall-free (no corpus drift)', () => {
    const r = (buildTower as any)({ floors: 3 });
    const parts = r.parts ?? r.expanded.parts;
    expect(parts.some((pp: any) => /^cw_/.test(pp.role ?? ''))).toBe(false);
  });

  it('mutation: a shifted floor of mullions breaks vertical-grid continuity (gate fires)', () => {
    const r = (buildTower as any)({ floors: 4, withCurtainWall: true });
    const parts = (r.parts ?? r.expanded.parts).map((pp: any) => {
      if (pp.role !== 'cw_mullion') return pp;
      // 두 번째 층 밴드(z∈[floorH,2floorH))의 멀리언만 15mm 옆으로
      if (pp.at.tz >= 3400 && pp.at.tz < 6800) return { ...pp, at: { ...pp.at, tx: pp.at.tx + 15 } };
      return pp;
    });
    const errs = (gateTower as any)(r.ir, { parts });
    expect(errs.some((e: string) => e.includes('cw_mullion_continuity'))).toBe(true);
  });

  it('mutation: dropping one panel breaks the coverage identity (gate fires)', () => {
    const r = (buildTower as any)({ floors: 4, withCurtainWall: true });
    const parts = (r.parts ?? r.expanded.parts);
    const idx = parts.findIndex((pp: any) => pp.role === 'cw_panel');
    const mutated = [...parts.slice(0, idx), ...parts.slice(idx + 1)];
    const errs = (gateTower as any)(r.ir, { parts: mutated });
    expect(errs.some((e: string) => e.includes('cw_coverage'))).toBe(true);
  });
});
