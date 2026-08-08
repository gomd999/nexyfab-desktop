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

  it('refuses invalid configs honestly', () => {
    expect(() => buildTowerIR({ floors: 0 })).toThrow();
    expect(() => buildTowerIR({ floors: 10, floorH: 900 })).toThrow();
  });
});
