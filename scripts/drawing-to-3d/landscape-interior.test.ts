/**
 * 조경 5종 · 인테리어 4종 도메인 템플릿 회귀(260719).
 * 5개 분야(기계·건축·토목·조경·인테리어) 커버리지 확충분 — 전 템플릿이
 * ①게이트 ok ②지지 체인 완결(designOk: 부유 0) ③확정 간섭 0 을 만족해야 한다.
 * 배치 규약: 부재는 맞댐(0겹침) — 지지는 얹힘/측면 면접촉 체결/선언 부착(role='mount') 로만.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';

type Part = { id: string; role?: string; material?: string };
type Asm = { parts: Part[]; note?: string; name?: string } & Record<string, unknown>;
type Built = { ok: boolean; designOk: boolean; interferences: { a: string; b: string }[]; gateErrors: string[]; support: { floating: string[] } };

const build = (domain: string, id: string, params: Record<string, unknown> = {}) => {
  const asm = (buildAssemblyTemplate as unknown as (d: string, i: string, p: Record<string, unknown>) => Asm)(domain, id, params);
  const b = (buildAssembly as unknown as (a: Asm) => Built)(asm);
  return { asm, b };
};
/** 3대 게이트 공통 단언 — 모든 템플릿이 통과해야 하는 하한선. */
const expectSound = (asm: Asm, b: Built) => {
  expect(b.gateErrors).toEqual([]);
  expect(b.ok).toBe(true);
  expect(b.support.floating, `부유 부품: ${b.support.floating.join(',')}`).toEqual([]);
  expect(b.designOk).toBe(true);
  expect(b.interferences.map((i) => `${i.a}×${i.b}`)).toEqual([]);
  expect(String(asm.note ?? '').length).toBeGreaterThan(30); // 정직 원칙: 미포함 범위 명시
};
const ids = (asm: Asm) => asm.parts.map((p) => p.id);

describe('조경 템플릿 5종', () => {
  it('fence_run: 기둥 피치·가로대·피켓 수가 연장에서 폐형 산출 + 지지 완결', () => {
    const { asm, b } = build('landscape', 'fence_run', {});
    expectSound(asm, b);
    const m = asm.fenceMeta as { posts: number; rails: number; pickets: number; picketPitch: number; length: number };
    expect(m.posts).toBe(7);              // 12000/2000 + 1
    expect(m.rails).toBe(2);
    expect(m.picketPitch).toBe(120);      // 90 + 30
    expect(m.pickets).toBe(100);
    expect(asm.parts).toHaveLength(m.posts + m.rails + m.pickets);
    expect(ids(asm)).toEqual(expect.arrayContaining(['post_1', 'rail_1', 'picket_1']));
  });
  it('fence_run: 연장·피치 변경이 부재 수에 반영(파라메트릭)', () => {
    const { asm, b } = build('landscape', 'fence_run', { length: 6000, postPitch: 1500, railCount: 3 });
    expectSound(asm, b);
    expect((asm.fenceMeta as { posts: number }).posts).toBe(5);
    expect((asm.fenceMeta as { rails: number }).rails).toBe(3);
  });
  it('planter_wall: 버림+저판+분절 벽체/캡+유공관 구성 + 신축이음 분절', () => {
    const { asm, b } = build('landscape', 'planter_wall', {});
    expectSound(asm, b);
    const m = asm.planterWallMeta as { segments: number; jointGap: number; drainDia: number };
    expect(m.segments).toBe(2);           // 6000 / 3000
    expect(m.jointGap).toBe(20);
    expect(m.drainDia).toBe(100);
    expect(ids(asm)).toEqual(expect.arrayContaining(['lean_concrete', 'footing', 'stem_1', 'stem_2', 'cap_1', 'drain_pipe']));
    expect(asm.parts).toHaveLength(7);
    // 정직: 뒷채움/방수는 부재로 지어내지 않고 note 로 미포함 명시
    expect(asm.note).toMatch(/뒷채움|방수/);
  });
  it('parking_pavement: 포장 3층 + 경계석 + 주차대수만큼 휠스토퍼', () => {
    const { asm, b } = build('landscape', 'parking_pavement', { stalls: 6 });
    expectSound(asm, b);
    const m = asm.parkingMeta as { stalls: number; width: number; depth: number; pavementThk: number; pavedAreaM2: number };
    expect(m.stalls).toBe(6);
    expect(m.width).toBe(15000);
    expect(m.depth).toBe(11000);
    expect(m.pavementThk).toBe(300);
    expect(m.pavedAreaM2).toBeCloseTo(165, 0);
    expect(asm.parts.filter((p) => p.id.startsWith('wheelstop_'))).toHaveLength(6);
    expect(ids(asm)).toEqual(expect.arrayContaining(['subbase', 'base_course', 'surface_course']));
    expect(asm.note).toMatch(/구획선/);   // 구획선 도색은 부재 아님 — 정직 명시
  });
  it('pavilion: 기단+기둥4+처마도리2+지붕판2+용마루 + 경사에 따른 용마루고 폐형', () => {
    const { asm, b } = build('landscape', 'pavilion', {});
    expectSound(asm, b);
    const m = asm.pavilionMeta as { eaveTopMm: number; ridgeTopMm: number; pitchDeg: number };
    expect(m.eaveTopMm).toBe(2750);       // 150(기단)+2400(기둥)+200(도리)
    expect(m.ridgeTopMm).toBe(Math.round(2750 + 1500 * Math.tan((30 * Math.PI) / 180)));
    expect(asm.parts.filter((p) => p.id.startsWith('post_'))).toHaveLength(4);
    expect(ids(asm)).toEqual(expect.arrayContaining(['pad', 'girder_1', 'girder_2', 'roof_front', 'roof_back', 'ridge']));
  });
  it('pavilion: 경사 10~45° 전 구간에서 지붕판·용마루 간섭 0', () => {
    for (const pitchDeg of [10, 20, 30, 45]) {
      const { asm, b } = build('landscape', 'pavilion', { pitchDeg });
      expectSound(asm, b);
    }
  });
  it('tree_planting: 수목 N주 = 줄기+수관 2부품 · 수관은 프록시임을 note 에 명시', () => {
    const { asm, b } = build('landscape', 'tree_planting', {});
    expectSound(asm, b);
    const m = asm.treePlantingMeta as { trees: number; canopyDia: number; spacingX: number };
    expect(m.trees).toBe(8);              // 2행 × 4주
    expect(asm.parts).toHaveLength(16);
    expect(asm.parts.filter((p) => p.role === 'canopy')).toHaveLength(8);
    expect(asm.note).toMatch(/프록시/);
    expect(asm.note).toMatch(/물량 산출에 쓰지 말/);
  });
  it('tree_planting: 수관 폭이 주간거리를 넘으면 클램프(수관 간섭 회피)', () => {
    const { asm, b } = build('landscape', 'tree_planting', { spacingX: 2000, spacingY: 2000, canopyDia: 9000 });
    expectSound(asm, b);
    expect((asm.treePlantingMeta as { canopyDia: number }).canopyDia).toBe(1800); // min(2000,2000) - 200
  });
});

describe('인테리어 템플릿 4종', () => {
  it('built_in_closet: 걸레받이+측판+상판+선반(mount)+행거+문짝 · 베이별 구성', () => {
    const { asm, b } = build('interior', 'built_in_closet', {});
    expectSound(asm, b);
    const m = asm.closetMeta as { bays: number; doors: number; shelvesPerBay: number; hangerBays: number };
    expect(m.bays).toBe(2);
    expect(m.doors).toBe(2);
    expect(m.hangerBays).toBe(1);
    expect(ids(asm)).toEqual(expect.arrayContaining(['plinth', 'side_1', 'side_2', 'divider_1', 'top_panel', 'hanger_rod', 'shelf_hang_top', 'door_1']));
    // 베이1=옷걸이(선반1+행거), 베이2=선반 4단
    expect(asm.parts.filter((p) => p.id.startsWith('shelf_b2_'))).toHaveLength(4);
    // 자중 지지가 아닌 부재는 role='mount' 로 선언(원칙 우회 아님)
    expect(asm.parts.filter((p) => p.role === 'mount').length).toBeGreaterThanOrEqual(7);
  });
  it('built_in_closet: 베이 4·선반 6 확장에서도 지지 완결', () => {
    const { asm, b } = build('interior', 'built_in_closet', { bays: 4, shelfCount: 6, width: 4000 });
    expectSound(asm, b);
    expect(asm.parts.filter((p) => p.id.startsWith('door_'))).toHaveLength(4);
    expect(asm.parts.filter((p) => p.id.startsWith('divider_'))).toHaveLength(3);
  });
  it('counter_bar: 상판+하부장+문짝(서비스측)+풋레일(브래킷+환봉)', () => {
    const { asm, b } = build('interior', 'counter_bar', {});
    expectSound(asm, b);
    const m = asm.counterMeta as { doors: number; brackets: number; footRailHeight: number; seatsApprox: number };
    expect(m.doors).toBe(4);              // 2400 / 600
    expect(m.brackets).toBe(4);
    expect(m.footRailHeight).toBe(265);   // 200 + 40(브래킷) + 25(환봉 반경)
    expect(m.seatsApprox).toBe(4);
    expect(ids(asm)).toEqual(expect.arrayContaining(['plinth', 'carcass', 'countertop', 'foot_rail', 'rail_bracket_1']));
  });
  it('partition_wall: 러너+스터드+양면 보드 + 개구 시 러너 분절·헤더·보드 3분할', () => {
    const { asm, b } = build('interior', 'partition_wall', {});
    expectSound(asm, b);
    const m = asm.partitionMeta as { opening: { width: number; height: number } | null; wallThk: number; studs: number };
    expect(m.opening).toMatchObject({ width: 900, height: 2100 });
    expect(m.wallThk).toBe(90);           // 65 + 2×12.5
    expect(ids(asm)).toEqual(expect.arrayContaining(['track_bot_1', 'track_bot_2', 'track_top', 'opening_header', 'board_a_l', 'board_a_r', 'board_a_h']));
    expect(asm.parts.filter((p) => p.id.startsWith('stud_')).length).toBe(m.studs);
  });
  it('partition_wall: 개구 폭 0 이면 러너 1본·보드 통판(헤더 없음)', () => {
    const { asm, b } = build('interior', 'partition_wall', { openingWidth: 0 });
    expectSound(asm, b);
    expect((asm.partitionMeta as { opening: unknown }).opening).toBeNull();
    expect(asm.parts.filter((p) => p.id.startsWith('track_bot_'))).toHaveLength(1);
    expect(ids(asm)).toEqual(expect.arrayContaining(['board_a', 'board_b']));
    expect(ids(asm)).not.toContain('opening_header');
  });
  it('ceiling_grid: 메인/크로스 티바·텍스·조명 개구·달대 수가 격자에서 폐형 산출', () => {
    const { asm, b } = build('interior', 'ceiling_grid', {});
    expectSound(asm, b);
    const m = asm.ceilingMeta as { cellsX: number; cellsY: number; cells: number; tiles: number; lights: number; mainTees: number; crossTees: number; hangers: number };
    expect([m.cellsX, m.cellsY]).toEqual([6, 5]);
    expect(m.cells).toBe(30);
    expect(m.lights).toBe(4);
    expect(m.tiles).toBe(26);
    expect(m.mainTees).toBe(6);
    expect(m.crossTees).toBe(35);         // 5행 × 7열
    expect(asm.parts).toHaveLength(m.mainTees + m.crossTees + m.cells + m.hangers);
    expect(asm.note).toMatch(/슬래브|앵커/); // 상부 앵커 미포함 명시
  });
  it('ceiling_grid: 조명 0 이면 전 셀이 텍스', () => {
    const { asm, b } = build('interior', 'ceiling_grid', { lightCount: 0 });
    expectSound(asm, b);
    expect(asm.parts.filter((p) => p.id.startsWith('light_'))).toHaveLength(0);
    expect((asm.ceilingMeta as { tiles: number }).tiles).toBe(30);
  });
});

describe('템플릿 카탈로그 등록', () => {
  it('조경 7종·인테리어 9종이 스튜디오 카탈로그에 params 와 함께 노출된다', () => {
    const ls = (listAssemblyTemplates as unknown as (d: string) => { id: string; params: { name: string; labelKo: string }[] }[])('landscape');
    const it2 = (listAssemblyTemplates as unknown as (d: string) => { id: string; params: { name: string; labelKo: string }[] }[])('interior');
    expect(ls.map((t) => t.id)).toEqual(expect.arrayContaining(['fence_run', 'planter_wall', 'parking_pavement', 'pavilion', 'tree_planting']));
    expect(it2.map((t) => t.id)).toEqual(expect.arrayContaining(['built_in_closet', 'counter_bar', 'partition_wall', 'ceiling_grid']));
    expect(ls).toHaveLength(7);
    expect(it2).toHaveLength(9);
    // params 는 UI 가 그대로 렌더 — 전 파라미터에 한국어 라벨과 기본값이 있어야 한다
    for (const t of [...ls, ...it2]) {
      for (const q of t.params) {
        expect(q.labelKo, `${t.id}.${q.name}`).toBeTruthy();
        expect(q, `${t.id}.${q.name}`).toHaveProperty('default');
      }
    }
  });
});
