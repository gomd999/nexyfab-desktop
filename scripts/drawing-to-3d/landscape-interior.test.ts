/**
 * 조경 5종 · 인테리어 4종 도메인 템플릿 회귀(260719).
 * 5개 분야(기계·건축·토목·조경·인테리어) 커버리지 확충분 — 전 템플릿이
 * ①게이트 ok ②지지 체인 완결(designOk: 부유 0) ③확정 간섭 0 을 만족해야 한다.
 * 배치 규약: 부재는 맞댐(0겹침) — 지지는 얹힘/측면 면접촉 체결/선언 부착(role='mount') 로만.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore runtime .mjs
import { pavementGradingCheck } from './landscape-check.mjs';
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
  it('parking_pavement W2-2: 배수 구배 실기하 — 스트립 상면 재도출=선언 항등 + 휠스토퍼 국소 안착', () => {
    const { asm, b } = build('landscape', 'parking_pavement', { stalls: 6, slopePct: 2 });
    expectSound(asm, b);
    const strips = asm.parts.filter((p: { id: string }) => p.id.startsWith('surface_strip_'));
    expect(strips.length).toBeGreaterThanOrEqual(2);
    // 기하 재도출 구배 = 선언 2% (항등) — 선언-기하 표류 검출 계약
    const g = pavementGradingCheck(asm)! as {
      checks: Record<string, { pass: boolean; detail: string }>;
      basis: { derivedPct?: number };
    };
    expect(g.checks.slopeIdentity!.pass).toBe(true);
    expect(g.checks.drainageSlope!.pass).toBe(true);
    expect(g.basis.derivedPct).toBeCloseTo(2, 2);
    // 무구배는 조용한 통과 금지 — 배수 미성립 명시
    const flat = build('landscape', 'parking_pavement', { stalls: 6 }).asm;
    expect(pavementGradingCheck(flat)!.checks.drainageSlope.pass).toBe(false);
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
  // 개수는 **이름으로 뒷받침**한다 — 종전엔 subset(5종)만 확인하고 length 만 7 로 박아둬,
  // 443b02db 가 apartment_complex 를 넣었을 때 "8 아닌 7"이라는 숫자 불일치로만 깨졌다.
  // 그러면 "새 템플릿이 추가됨"과 "엉뚱한 템플릿이 샜음"이 같은 실패로 보인다.
  it('조경 8종·인테리어 10종이 스튜디오 카탈로그에 params 와 함께 노출된다', () => {
    const ls = (listAssemblyTemplates as unknown as (d: string) => { id: string; params: { name: string; labelKo: string }[] }[])('landscape');
    const it2 = (listAssemblyTemplates as unknown as (d: string) => { id: string; params: { name: string; labelKo: string }[] }[])('interior');
    expect([...ls.map((t) => t.id)].sort()).toEqual(
      ['apartment_complex', 'fence_run', 'parking_pavement', 'pavilion', 'pergola', 'planter_wall', 'timber_deck', 'tree_planting']);
    expect([...it2.map((t) => t.id)].sort()).toEqual(
      ['apartment_unit', 'built_in_closet', 'cafe_room', 'ceiling_grid', 'counter_bar', 'interior_floor', 'partition_wall', 'studio_unit', 'three_room_unit', 'two_room']);
    // params 는 UI 가 그대로 렌더 — 전 파라미터에 한국어 라벨과 기본값이 있어야 한다
    for (const t of [...ls, ...it2]) {
      for (const q of t.params) {
        expect(q.labelKo, `${t.id}.${q.name}`).toBeTruthy();
        expect(q, `${t.id}.${q.name}`).toHaveProperty('default');
      }
    }
  });
});

/**
 * 입력 정규화 — 조용한 기본값 대체 금지(F3/F10/F4, 260719).
 * 도그푸딩에서 `{width:"3657mm", height:"2438"}` 가 경고 0건으로 전량 기본값 도면이 되어
 * 사용자가 남의 치수를 자기 치수로 알고 받아가던 경로를 고정한다.
 */
describe('입력 정규화 — 조용한 대체 금지', () => {
  type Err = { ok?: boolean; error?: string; paramErrors?: string[]; parts?: Part[]; paramNotes?: string[] };
  const raw = buildAssemblyTemplate as unknown as (d: string, i: string, p: Record<string, unknown>) => Asm & Err;

  it('F3: 숫자 문자열·단위 접미 치수가 기본값으로 버려지지 않고 실제로 반영된다', () => {
    const { asm, b } = build('landscape', 'pergola', { width: '3657mm', depth: '2743mm', height: '2438' });
    expect(b.gateErrors).toEqual([]);
    const post = asm.parts.find((p) => p.id === 'post2') as unknown as { at: { tx: number }; params: { height: number } };
    expect(post.params.height).toBe(2438);          // "2438" → 2438 (기본 2400 아님)
    expect(post.at.tx).toBeCloseTo(3657 - 120 / 2); // "3657mm" → 3657 (기본 3600 아님)
    // 환산은 조용히 일어나지 않는다 — 무엇을 어떻게 바꿨는지 호출자가 읽을 수 있어야 한다
    expect((asm as Err).paramNotes?.join(' ')).toContain('3657mm');
  });

  it('F3: 해석 불가 입력은 기본값으로 대체되지 않고 사유와 함께 거부된다', () => {
    for (const bad of [NaN, '삼천육백', '3657kg', true]) {
      const r = raw('landscape', 'pergola', { width: bad });
      expect(r.ok, `${String(bad)} 가 통과했다`).toBe(false);
      expect(r.error).toBe('invalid_params');
      expect(r.paramErrors?.join(' ')).toContain('폭');
    }
  });

  it('F3: 미입력(undefined/null/빈문자)만 조용히 기본값을 쓴다 — 그건 대체가 아니다', () => {
    for (const empty of [undefined, null, '']) {
      const r = raw('landscape', 'pergola', { width: empty });
      expect(r.ok).not.toBe(false);
      expect((r.parts ?? []).length).toBeGreaterThan(0);
    }
  });

  it('F10: params 의 min/max 를 강제한다 — 자동 클램프가 아니라 거부+범위 안내', () => {
    const r = raw('landscape', 'pergola', { rafterCount: 400, height: 99999 });
    expect(r.ok).toBe(false);
    expect(r.parts).toEqual([]);
    expect(r.paramErrors).toHaveLength(2);
    expect(r.paramErrors?.join(' ')).toContain('3~15');       // 범위를 알려줘야 고칠 수 있다
    expect(r.paramErrors?.join(' ')).toContain('1800~3600');
    // 거부 사유는 하류(게이트·쉬운요약)까지 그대로 흘러야 한다 — "parts[] 비어있음" 금지
    const b = (buildAssembly as unknown as (a: unknown) => Built)(r);
    expect(b.ok).toBe(false);
    expect(b.gateErrors.join(' ')).not.toContain('parts[] 비어있음');
    expect(b.gateErrors.join(' ')).toContain('허용 범위');
  });

  it('F10: 선언되지 않은 구조적 입력(ips 등)은 통과시킨다 — params 는 UI 카탈로그이지 스키마가 아니다', () => {
    const r = raw('civil', 'retaining_wall_alignment', { ips: [[0, 0], [200000, 0]] });
    expect(r.ok).not.toBe(false);
    expect((r.parts ?? []).length).toBeGreaterThan(0);
  });

  it('F10: enum 파라미터는 목록 밖 값을 거부하고 선택지를 안내한다', () => {
    const ok = raw('mech', 'conveyor', { kind: 'roller' });
    expect((ok.parts ?? []).length).toBeGreaterThan(0);
    const bad = raw('mech', 'conveyor', { kind: 'chain' });
    expect(bad.ok).toBe(false);
    expect(bad.paramErrors?.join(' ')).toContain('"belt" / "roller"');
  });

  it('F4: 파고라 관수 배관은 기본으로 삽입되지 않고, UI 파라미터로 노출된다', () => {
    const def = raw('landscape', 'pergola', {}) as unknown as { pipes?: unknown[] };
    expect(def.pipes).toBeUndefined();                       // 유령 부품 없음
    const on = raw('landscape', 'pergola', { irrigation: 1 }) as unknown as { pipes?: unknown[] };
    expect(on.pipes).toHaveLength(1);                        // 원하면 켤 수 있다
    const spec = (listAssemblyTemplates as unknown as (d: string) => { id: string; params: { name: string }[] }[])('landscape')
      .find((t) => t.id === 'pergola');
    expect(spec?.params.map((q) => q.name)).toContain('irrigation'); // UI 미노출 금지
  });

  it('F8: 회전체 BOM 이 호퍼·동체·지붕을 규격으로 구별한다', () => {
    const { asm } = build('mech', 'tank_silo', {});
    const dims = (id: string) => (asm.parts.find((p) => p.id === id) as unknown as { params: Record<string, number> }).params;
    for (const id of ['hopper', 'shell', 'roof']) {
      expect(dims(id).outerDia, id).toBeGreaterThan(0);
      expect(dims(id).height, id).toBeGreaterThan(0);
      expect(dims(id).thickness, id).toBeGreaterThan(0);
    }
    expect(dims('shell').height).not.toBe(dims('roof').height); // 3행이 같은 문구로 뭉개지지 않는다
  });
});
