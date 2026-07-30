/**
 * 참고 코퍼스에서 파생한 어휘 (260801).
 *
 * ⚠️ 코퍼스(`Downloads/참고파일들`)는 **로컬 전용·라이선스 제한**이라 저장소에 어떤 파일도
 *    넣지 않는다. 이 테스트는 **코퍼스 없이도 전부 돈다** — 검증 대상이 코퍼스 파일이 아니라
 *    거기서 얻은 **결론**(어휘·판정)이기 때문이다. 분류기 커버리지 측정만 코퍼스가 필요하고,
 *    없으면 `skip` — 「통과」로 세지 않는다.
 *
 * ## 코퍼스가 알려준 것과 알려주지 않은 것
 *  · **알려준 것** — 압출 프로파일 10,508개 중 `arbitrary_closed` **67.6%**(rectangle 23.3%).
 *    부품명 3,296개에 `cmu`/`brick` 40회 · `stud` 43회 · `railing` 계열 27회.
 *  · **알려주지 않은 것** — **부품 단위 치수.** IR 의 `extent.size` 는 어셈블리 전체 bbox 라
 *    조적 블록 한 장의 치수가 없다(실측: 3건 모두 건물 전체 bbox). 그래서 치수 기본값은
 *    코퍼스가 아니라 **KS/법령**에서 온다 — 그 구별을 어휘 힌트에도 적었다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { computeBOQ } from './boq.mjs';
import { partAabb, extrudePoly, polyArea, PARAMS, expandHoles, filletPolygon } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';
import { TYPE_SCHEMAS, TYPE_HINTS } from './schemas.mjs';
import { railingCheck } from './railing-check.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { SNAP_LISTS } from './snap-lists.mjs';
import { domainSafetyReportHtml } from './domain-dossier-verify.mjs';
import { auditTemplate } from './domain-audit.mjs';
import { importStep } from '@/lib/brep-bridge/stepImport';
import { masonryCheck } from './masonry-check.mjs';
import { boltedPlateCheck } from './bolted-plate-check.mjs';

type Asm = { name: string; domain: string; parts: unknown[] };
const build = (type: string, params: Record<string, unknown>): Record<string, unknown> =>
  (buildAssembly as unknown as (a: Asm) => Record<string, unknown>)({
    name: 't', domain: 'mech',
    parts: [{ id: 'p1', type, params, at: { tx: 0, ty: 0, tz: 0 }, material: 'steel', role: 'frame' }],
  });

// L 자 폐곡선: 100×100 외곽에서 80×80 을 뺀 형태 → 면적 100·20 + 80·20 = 3,600
const L_PROFILE = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];

describe('extrude_profile — 임의 폐곡선 압출 (코퍼스 압출의 67.6%)', () => {
  it('어휘가 등록됐다 — PARAMS·스키마·힌트가 모두 있다', () => {
    expect(PARAMS.extrude_profile).toBeDefined();
    expect(TYPE_SCHEMAS.extrude_profile.required).toContain('profile');
    expect(TYPE_HINTS.extrude_profile).toContain('67.6%');   // 근거 수치를 힌트에 남긴다
  });

  it('게이트를 통과하고 어셈블리에 들어간다 — 어휘만 있고 게이트가 없으면 조용히 사라진다', () => {
    const r = build('extrude_profile', { profile: L_PROFILE, depth: 50 });
    expect(r.gateErrors ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('★부피가 **폐형**이다 — AABB 근사가 아니다', () => {
    // 코퍼스 primitive_fit 의 box 잔차가 99%대였다(AABB 로는 실물을 표현할 수 없다).
    const v = (partVolume as unknown as (t: string, p: unknown) => number)(
      'extrude_profile', { profile: L_PROFILE, depth: 50 });
    expect(v).toBeCloseTo(3600 * 50, 6);
    // AABB 는 100×100×50 = 500,000 — 폐형의 2.78배다. 둘을 구별하는 것이 이 어휘의 값이다.
    const bb = (partAabb as unknown as (i: unknown) => { min: number[]; max: number[] })(
      { type: 'extrude_profile', profile: L_PROFILE, depth: 50 });
    const aabbVol = (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]);
    expect(aabbVol / v).toBeCloseTo(500000 / 180000, 3);
  });

  it('원형 홀을 부피·표면적·홀 수에서 모두 반영한다', () => {
    const params = { profile: L_PROFILE, depth: 50, holes: [{ x: 50, y: 10, d: 10 }] };
    const v = (partVolume as unknown as (t: string, p: unknown) => number)('extrude_profile', params);
    expect(v).toBeCloseTo((3600 - (Math.PI / 4) * 100) * 50, 6);
    const boq = (computeBOQ as unknown as (a: Asm) => { items: Array<Record<string, number | string>> })({
      name: 't', domain: 'mech',
      parts: [{ id: 'p1', type: 'extrude_profile', params, at: {}, material: 'steel' }],
    });
    const it0 = boq.items.find((x) => x.id === 'p1')!;
    expect(it0.holes).toBe(1);
    // 표면적 = 2·(3600−78.54) + 둘레400×50 + π·10·50 = 28,613.7mm² = 0.0286m²
    expect(Number(it0.surfaceM2)).toBeCloseTo(0.029, 3);
  });

  it('★잘못된 입력을 **이름으로 거부한다** — 통과시키면 부피 0 부품이 도면집에 들어간다', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ profile: [[0, 0], [1, 0]], depth: 10 }, /3점/],
      [{ profile: L_PROFILE, depth: 0 }, /depth/],
      [{ profile: [[0, 0], [10, 0], [20, 0]], depth: 5 }, /면적이 0/],
      [{ profile: L_PROFILE, depth: 10, holes: [{ x: 1, y: 1 }] }, /holes\[0\]/],
    ];
    for (const [params, re] of cases) {
      const r = build('extrude_profile', params);
      expect((r.gateErrors as string[] | undefined) ?? [], JSON.stringify(params)).not.toEqual([]);
      expect((r.gateErrors as string[]).join(' ')).toMatch(re);
    }
  });

  it('마지막 점이 첫 점과 같으면 중복을 제거한다 — 면적이 달라지지 않는다', () => {
    const closed = [...L_PROFILE, [0, 0]];
    expect(Math.abs((polyArea as unknown as (p: number[][]) => number)(
      (extrudePoly as unknown as (i: unknown) => number[][])({ profile: closed, depth: 1 })))).toBeCloseTo(3600, 6);
  });
});

describe('masonry_block — 조적 블록 (코퍼스 cmu·brick 40회)', () => {
  // KS F 4002 콘크리트 기본블록 390×190×190, 공동 2개
  const KS = { length: 390, thickness: 190, height: 190, coreCount: 2, coreW: 105, coreD: 115 };

  it('공동을 **실제로 공제한다** — 중실로 두면 질량이 실물의 1.5배가 된다', () => {
    const solid = 390 * 190 * 190;
    const cores = 2 * 105 * 115 * 190;
    const v = (partVolume as unknown as (t: string, p: unknown) => number)('masonry_block', KS);
    expect(v).toBeCloseTo(solid - cores, 6);
    expect(solid / v).toBeGreaterThan(1.4);   // 공제를 빼먹으면 이만큼 틀린다
  });

  it('게이트가 형상이 성립하지 않는 공동을 거부한다', () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...KS, coreW: 200 }, /리브가 남지 않는다/],
      [{ ...KS, coreCount: 1, coreD: 190 }, /면판이 남지 않는다/],
      [{ ...KS, coreCount: 5, coreW: 50 }, /coreCount 0~4/],
    ];
    for (const [params, re] of bad) {
      const r = build('masonry_block', params);
      expect((r.gateErrors as string[]).join(' '), JSON.stringify(params)).toMatch(re);
    }
  });

  it('공동 0개(중실 블록)도 정상 형상이다 — 벽돌은 공동이 없다', () => {
    const r = build('masonry_block', { length: 190, thickness: 90, height: 57, coreCount: 0 });
    expect(r.gateErrors ?? []).toEqual([]);
    expect((partVolume as unknown as (t: string, p: unknown) => number)(
      'masonry_block', { length: 190, thickness: 90, height: 57, coreCount: 0 })).toBeCloseTo(190 * 90 * 57, 6);
  });

  it('★치수 기본값의 출처가 KS 라고 적혀 있다 — 코퍼스에서 온 것이 아니다', () => {
    // 코퍼스는 조적의 **존재/빈도**만 줬고 부품 단위 치수를 주지 않았다.
    expect(TYPE_HINTS.masonry_block).toContain('KS F 4002');
    expect(TYPE_HINTS.masonry_block).toMatch(/코퍼스에서 나온 것이 아니다|부품 단위 치수 없음/);
  });
});

describe('난간 검토 — 형상은 있었고 판정이 없었다 (코퍼스 railing 27회)', () => {
  it('난간이 없는 어셈블리에는 **붙지 않는다** — 과고지 금지', () => {
    expect((railingCheck as unknown as (a: unknown, p: unknown) => unknown)(
      buildAssemblyTemplate('building', 'rc_frame', {}), {})).toBeNull();
  });

  it('난간 줄(run)마다 따로 잰다 — 좌·우 난간을 한 줄로 섞지 않는다', () => {
    // 전 부재를 한 줄로 정렬하면 좌·우 스트링거 난간이 한 평면인 것처럼 섞여
    // 「순간격 1,082mm」 같은 **없는 결함**이 생긴다.
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { detail?: string[] }>;
    })(buildAssemblyTemplate('building', 'industrial_stair', {}), {});
    // 살이 없으므로 간격은 판정 불가지만, 기둥 간격은 줄별로 잰다.
    expect(r.checks.postPitch).toBeDefined();
  });

  it('기둥+손스침 형태(계단 난간)를 판정한다', () => {
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { labelKo: string; verdict?: string; pass: boolean | null; detail?: string[] }>;
    })(buildAssemblyTemplate('building', 'industrial_stair', {}), {});
    expect(r.checks.height).toBeDefined();
    expect(r.checks.height.detail!.join(' ')).toContain('기둥 최소 높이');
  });

  it('★일체 난간벽(기둥 없음)도 판정한다 — 처음엔 이 형태가 통째로 빠졌다', () => {
    // `commercial_massing(balcony)` 의 발코니 난간은 1,100mm 일체 벽체다.
    // 기둥 기준만 보던 첫 구현에서는 가장 흔한 형태에 판정이 하나도 없었다.
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { labelKo: string; verdict?: string; detail?: string[] }>;
    })(buildAssemblyTemplate('building', 'commercial_massing', { balcony: 'true' }), {});
    expect(r.checks.height).toBeDefined();
    expect(r.checks.height.detail!.join(' ')).toContain('일체 난간벽');
  });

  it('용도를 선언하면 기준이 확정되고, 안 하면 **두 기준을 함께 보고한다**', () => {
    const asm = buildAssemblyTemplate('building', 'industrial_stair', {});
    const call = (p: unknown) => (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { pass: boolean | null; verdict?: string }>;
    })(asm, p);
    /**
     * ⚠ 260801 에 기본 난간 높이를 1,200mm 로 올렸으므로 **기본값에서는 두 기준을 다 만족**한다
     * (용도를 몰라도 결론이 갈리지 않는다 — 그게 이 수정의 목표였다).
     * 「용도가 결론을 가른다」는 성질은 **낮은 난간**에서 확인해야 한다 — 1,000mm 로 준다.
     */
    expect(call({ railing: { usage: 'industrial' } }).checks.height.pass).toBe(true);
    expect(call({ railing: { usage: 'building' } }).checks.height.pass).toBe(true);
    expect(call({}).checks.height.verdict).toBe('PASS');

    const low = (p: unknown) => (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { pass: boolean | null; verdict?: string }>;
    })(buildAssemblyTemplate('building', 'industrial_stair', { handrailH: 1000 }), p);
    expect(low({ railing: { usage: 'industrial' } }).checks.height.pass).toBe(true);
    expect(low({ railing: { usage: 'building' } }).checks.height.pass).toBe(false);
    expect(low({}).checks.height.verdict).toBe('CHECK');   // 용도가 결론을 가른다
  });

  it('★`params.usage` 를 난간 기준으로 읽지 않는다 — 그 이름은 활하중 용도다', () => {
    const asm = buildAssemblyTemplate('building', 'industrial_stair', {});
    // 낮은 난간(1,000mm)에서 확인한다 — 기본값(1,200)은 두 기준을 다 만족해 구별이 안 된다.
    const low = buildAssemblyTemplate('building', 'industrial_stair', { handrailH: 1000 });
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { verdict?: string }>;
    })(low, { usage: 'industrial' });   // 활하중 용도 키 — 난간 기준을 정해선 안 된다
    expect(r.checks.height.verdict).toBe('CHECK');   // 용도 미선언으로 취급
    void asm;
  });

  it('살이 없으면 간격을 **판정하지 않고 그 사실을 적는다** — 적합이 아니다', () => {
    /**
     * ⚠ 검체를 바꿨다. `industrial_stair` 에는 260801 에 살(picket)을 선언했으므로
     * 이제 간격이 **실판정**된다(아래 케이스). 불변식은 그대로 두고, 살이 없는 실제
     * 형상인 발코니 난간벽(`commercial_massing(balcony)`)으로 검체를 옮긴다 —
     * 일체 난간벽은 살이라는 개념이 없다.
     */
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { pass: boolean | null; labelKo: string; detail?: string[] }>;
    })(buildAssemblyTemplate('building', 'commercial_massing', { balcony: 'true' }), {});
    expect(r.checks.picketGap.pass).toBeNull();
    expect(r.checks.picketGap.detail!.join(' ')).toContain('적합하다는 뜻이 아니다');
  });

  it('★난간 **높이**는 실판정된다 — 기본값을 건축법 1.2m 로 올렸다(계획 ⑥)', () => {
    /**
     * ⚠ 살(picket) 생성은 260801 에 네 번 시도하고 **되돌렸다**(간섭·거짓 미달).
     * 경사·다플라이트·중간참 계단의 법정 살 배치는 별도 설계 작업이고, 억지로 붙이면
     * 간섭이 남고 간격 판정이 거짓 미달을 낸다 — 판정을 만들려고 형상을 지어내는 것이다.
     * 그래서 간격은 「판정하지 않았다」로 남고, **높이는 실판정**한다.
     */
    const r = (railingCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { pass: boolean | null; verdict?: string; labelKo: string }>;
    })(buildAssemblyTemplate('building', 'industrial_stair', {}), {});
    expect(r.checks.height.verdict).toBe('PASS');     // 1,231.5mm ≥ 1,200mm
    expect(r.checks.picketGap.pass).toBeNull();       // 살 없음 → 판정 불가(적합 아님)
  });

  it('빌더 폴백과 템플릿 기본값이 **같다** — 경로에 따라 갈리지 않는다', () => {
    // 파라미터를 안 주는 경로(API·직접 호출)에서 폴백이 낮으면 난간이 법정 미달로 나간다.
    const viaTemplate = buildAssemblyTemplate('building', 'industrial_stair', {}) as { parts?: Array<{ role?: string; params?: { height?: number } }> };
    const posts = (viaTemplate.parts ?? []).filter((x) => x.role === 'post');
    expect(posts.length).toBeGreaterThan(0);
    expect(Math.max(...posts.map((x) => Number(x.params?.height ?? 0)))).toBeGreaterThan(1100);
  });

  it('★난간 판정이 **안전검토 문서까지 닿는다** — 계산만 되고 안 닿으면 없는 것과 같다', () => {
    // 이 세션에서 반복해 잡은 형태 ②(판정했는데 소비자 문서에 없음)를 난간에서도 막는다.
    const html = (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
      buildAssemblyTemplate('building', 'industrial_stair', {}), { title: 't', params: {} }) ?? '';
    expect(html).toContain('난간');
    expect(html).toContain('건축법 시행령 제40조');
    // 소제목이 영문 키(`railing`·`picketGap`)로 새지 않는다.
    const heads = [...html.matchAll(/<div class="ghead">([^<]*)<\/div>/g)].map((m) => m[1]);
    expect(heads.filter((h) => /^[A-Za-z][A-Za-z0-9_]*$/.test(h))).toEqual([]);
  });

  it('난간 판정이 **감사에도 이름으로** 잡힌다', () => {
    const a = auditTemplate('building', 'industrial_stair', {}) as { names: { real: string[]; unjudged: string[] } };
    const all = [...a.names.real, ...a.names.unjudged].join(' | ');
    expect(all).toContain('난간 높이');
    expect(all).toContain('살 사이 간격');   // 살 미선언 → 「판정하지 않았다」 라벨
  });
});

describe('stud — 새 어휘를 만들지 않고 **규격**만 추가했다', () => {
  it('스터드 형상은 기존 `c_channel` 이다 — 같은 형상에 타입을 두 벌 만들지 않는다', () => {
    // 같은 형상에 새 타입을 만들면 부피·BOQ·STEP 경로가 두 벌이 되고 언젠가 갈린다.
    expect(PARAMS.c_channel).toBeDefined();
    expect((PARAMS as Record<string, unknown>).stud).toBeUndefined();
  });

  it('규격 절점이 등록되고 **출처가 관례임을 밝힌다**', () => {
    expect(SNAP_LISTS.studWeb.values).toContain(100);
    expect(SNAP_LISTS.studWeb.source).toContain('표 절점 아님');
    expect(SNAP_LISTS.studSpacing.values).toEqual([300, 450, 600]);
    expect(SNAP_LISTS.studSpacing.source).toContain('표 절점 아님');
  });
});

describe('원호 엣지 근사 — 임포트의 실제 병목이었다 (260801, 계획 ④)', () => {
  /**
   * 코퍼스 STEP 전수 측정에서 미지원 사유 1위가 `non-linear edge (CIRCLE)` **61건**이었다.
   * 필렛·모서리 라운드가 하나라도 있으면 면 전체를 버렸다. 현 분할로 근사해 받는다.
   *
   * ⚠ 근사는 **근사라고 말해야** 한다 — `stepFileBounds` 를 「OCCT 정확 경계」로 적어 놓고
   *   실제로 최대 +73% 부풀던 전례가 있다.
   */
  const ARC_STEP = [
    'ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;',
    // 사각 캡 한 장의 한 변을 원호로 대체한 최소 면 — 좌표는 아래 주석의 계산값이다.
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=CARTESIAN_POINT('',(10.,0.,0.));",
    "#3=DIRECTION('',(0.,0.,1.));",
    "#4=DIRECTION('',(1.,0.,0.));",
    '#5=AXIS2_PLACEMENT_3D(\'\',#1,#3,#4);',
    "#6=CIRCLE('',#5,10.);",
    'ENDSEC;', 'END-ISO-10303-21;',
  ].join('\n');

  it('CIRCLE 엣지를 만나면 **면을 버리지 않는다** — 사유 문구가 사라졌다', () => {
    // 합성 최소 파일로는 솔리드가 성립하지 않으므로, 여기서 지키는 것은
    // 「CIRCLE 때문에 거부한다」는 **옛 사유가 더는 나오지 않는다**는 것이다.
    const r = (importStep as unknown as (s: string) => { unsupported?: string[] })(ARC_STEP);
    expect((r.unsupported ?? []).join(' ')).not.toContain('non-linear edge (CIRCLE)');
  });

  it('B_SPLINE 은 여전히 거부한다 — 제어점 없이 현 분할은 지어내기다', () => {
    const bs = ARC_STEP.replace("#6=CIRCLE('',#5,10.);", "#6=B_SPLINE_CURVE_WITH_KNOTS('',3,(#1,#2),.UNSPECIFIED.,.F.,.F.);");
    const r = (importStep as unknown as (s: string) => { unsupported?: string[]; warnings?: string[] })(bs);
    // 스플라인을 원호처럼 근사하지 않는다(사유가 남거나 애초에 솔리드가 없다).
    expect((r.warnings ?? []).join(' ')).not.toContain('근사');
  });
});

describe('상세 어휘 — 홀 가공·패턴·필렛·복합 (260801b)', () => {
  /**
   * 코퍼스 실측이 지목한 상세 갭 4개:
   *   홀 683파일 · 필렛 157파일(반경 표본 2,095 · 중앙값 1.43mm) ·
   *   패턴 248파일(원형 455 · 선형 175 · 패턴 소속 홀 1,796) · aspect complex 42%
   */
  const RECT = [[0, 0], [200, 0], [200, 120], [0, 120]];
  const vol = (t: string, p: unknown) => (partVolume as unknown as (ty: string, q: unknown) => number)(t, p);

  it('★홀 가공 상세가 **어휘 간에 같은 값**을 낸다 — 종전엔 갈렸다', () => {
    // 실측: 같은 카운터보어를 줘도 plate 475,024 vs extrude 477,738(=관통과 동일)로 갈렸다.
    const plate = { width: 200, depth: 120, thickness: 20 };
    for (const h of [
      { x: 50, y: 60, d: 12 },
      { x: 50, y: 60, d: 12, kind: 'cbore', cbDia: 24, cbDepth: 8 },
      { x: 50, y: 60, d: 12, kind: 'csink', csDia: 24 },
      { x: 50, y: 60, d: 10, kind: 'tap', thread: 'M12' },
    ]) {
      const a = vol('plate_with_holes', { ...plate, holes: [h] });
      const b = vol('extrude_profile', { profile: RECT, depth: 20, holes: [h] });
      expect(b, JSON.stringify(h)).toBeCloseTo(a, 6);
    }
  });

  it('카운터보어가 관통보다 **더 많이** 빠진다 — 상세가 실제로 반영된다', () => {
    const thru = vol('extrude_profile', { profile: RECT, depth: 20, holes: [{ x: 50, y: 60, d: 12 }] });
    const cb = vol('extrude_profile', { profile: RECT, depth: 20, holes: [{ x: 50, y: 60, d: 12, kind: 'cbore', cbDia: 24, cbDepth: 8 }] });
    expect(cb).toBeLessThan(thru);
  });

  it('★패턴이 전개된다 — 선언 1건이 실제 홀 N개다', () => {
    const one = vol('extrude_profile', { profile: RECT, depth: 20, holes: [{ x: 40, y: 60, d: 12 }] });
    const four = vol('extrude_profile', { profile: RECT, depth: 20, holes: [{ x: 40, y: 60, d: 12, pattern: { kind: 'linear', count: 4, pitch: 30 } }] });
    const full = 200 * 120 * 20;
    expect(full - four).toBeCloseTo(4 * (full - one), 6);   // 홀 4개분이 빠진다
    const circ = (expandHoles as unknown as (h: unknown) => unknown[])([{ x: 100, y: 60, d: 8, pattern: { kind: 'circular', count: 6, bcd: 80 } }]);
    expect(circ).toHaveLength(6);
  });

  it('패턴 정보를 **잃지 않는다** — 도면 표기·BOQ 회차가 이걸 쓴다', () => {
    const ex = (expandHoles as unknown as (h: unknown) => Array<{ _pat?: { kind: string; count: number; seq: number } }>)(
      [{ x: 40, y: 60, d: 12, pattern: { kind: 'linear', count: 3, pitch: 30 } }]);
    expect(ex[0]._pat).toMatchObject({ kind: 'linear', count: 3, seq: 1 });
    expect(ex[2]._pat).toMatchObject({ seq: 3 });
  });

  it('모르는 패턴 kind 는 **펼치지 않고 거부한다** — 선형으로 가정하지 않는다', () => {
    const r = (buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })({
      name: 't', domain: 'mech',
      parts: [{ id: 'p', type: 'extrude_profile', params: { profile: RECT, depth: 20, holes: [{ x: 40, y: 60, d: 12, pattern: { kind: 'spiral', count: 3 } }] }, at: {}, material: 'steel' }],
    });
    expect((r.gateErrors ?? []).join(' ')).toContain('pattern.kind 미지원');
  });

  it('★필렛이 **형상에 반영된다** — 부피·표면적·SCAD 가 같은 형상을 본다', () => {
    // 100×100 정사각 r10 → 면적 10,000 − 4·r²(1−π/4) = 9,914.2 (현 분할이라 약간 작다)
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const f = (filletPolygon as unknown as (p: number[][], r: (i: number) => number) => { pts: number[][]; applied: number; maxSagittaMm: number })(sq, () => 10);
    expect(f.applied).toBe(4);
    // 정확값 9,914.16 · 현 분할이라 2.02mm²(0.02%) 작다 — 그 차이가 새그의 대가다.
    const area = Math.abs((polyArea as unknown as (p: number[][]) => number)(f.pts));
    expect(area).toBeGreaterThan(9910);
    expect(area).toBeLessThan(9914.17);          // 내접이므로 정확값을 넘지 않는다
    expect(9914.16 - area).toBeLessThan(3);      // 근사 오차가 3mm² 미만
    expect(f.maxSagittaMm).toBeLessThan(0.06);   // 근사 오차를 수치로 갖는다
    // 부피가 필렛만큼 줄어든다(형상과 일치)
    const plain = vol('extrude_profile', { profile: sq, depth: 10 });
    const round = vol('extrude_profile', { profile: sq, depth: 10, filletR: 10 });
    expect(round).toBeLessThan(plain);
  });

  it('필렛은 **볼록 꼭짓점만** 라운드한다 — 오목은 재료가 늘어나는 쪽이라 별건이다', () => {
    // L 자: 꼭짓점 3번이 오목(내각 270°)
    const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
    const f = (filletPolygon as unknown as (p: number[][], r: (i: number) => number) => { applied: number })(L, () => 5);
    expect(f.applied).toBe(5);   // 6점 중 오목 1개 제외
  });

  it('반경이 인접 변 절반을 넘으면 **줄이지 않고 거부한다**', () => {
    const r = (buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })({
      name: 't', domain: 'mech',
      parts: [{ id: 'p', type: 'extrude_profile', params: { profile: RECT, depth: 20, filletR: 200 }, at: {}, material: 'steel' }],
    });
    expect((r.gateErrors ?? []).join(' ')).toContain('절반을 넘는다');
  });

  it('★복합 부품 — 합·차가 폐형으로 정확하다', () => {
    const params = {
      subs: [
        { type: 'box', params: { width: 200, depth: 100, height: 50 }, op: 'add' },
        { type: 'box', params: { width: 200, depth: 12, height: 80 }, at: { ty: 44, tz: 50 }, op: 'add' },
        { type: 'cylinder', params: { diameter: 30, length: 60 }, at: { tx: 100, ty: 50, tz: -5 }, op: 'subtract' },
      ],
    };
    /**
     * ⚠ 260801k — **이 기대값이 틀려 있었다.** 커터(⌀30×60)를 통째로 뺐는데,
     *   그 커터는 z −5~55 라 아래로 5mm 는 **허공**을 지나고 위 5mm 는 리브(폭 12mm)만 스친다.
     *   전량 절삭은 진값 대비 **−0.536%**(질량이 그만큼 작게 나갔다).
     *
     * 진값은 두 조각의 합이다:
     *   · 밑판 안: 원 단면 × 50mm
     *   · 리브 안: y 44~56 띠 ∩ 원(활꼴 면적) × 5mm
     * 리브 쪽은 원의 **활꼴**이라 AABB 비(12×30 직사각)로는 정확히 못 맞춘다 —
     * 남는 오차 **−0.047%** 를 수치로 적어 둔다(0 이라고 하면 과고지다).
     */
    const band = 2 * ((6 / 2) * Math.sqrt(15 * 15 - 36) + ((15 * 15) / 2) * Math.asin(6 / 15));
    const truth = 200 * 100 * 50 + 200 * 12 * 80
      - Math.PI * 15 * 15 * 50      // 밑판을 지나는 50mm
      - band * 5;                    // 리브를 지나는 5mm(활꼴 단면)
    const got = vol('composite', params);
    expect(Math.abs(got / truth - 1)).toBeLessThan(0.001);   // 0.1% 이내
    // 종전(전량 절삭)으로 되돌아가면 잡힌다 — 그때는 0.5% 넘게 벌어졌다.
    expect(Math.abs(got / truth - 1)).toBeLessThan(0.005);
    // 외곽은 add 하위의 합집합 — subtract 는 경계를 넓히지 않는다
    const bb = (partAabb as unknown as (i: unknown) => { min: number[]; max: number[] })({ type: 'composite', ...params });
    expect(bb.max).toEqual([200, 100, 130]);
  });

  it('복합 표면적은 **미산출**이고 BOQ 가 이름으로 고지한다 — 0 이 아니라 모름', () => {
    const asm = { name: 't', domain: 'mech', parts: [{ id: 'c1', type: 'composite', params: { subs: [{ type: 'box', params: { width: 100, depth: 100, height: 10 }, op: 'add' }] }, at: {}, material: 'steel' }] };
    const boq = (computeBOQ as unknown as (a: unknown) => { surfaceMissing?: string[]; items: Array<{ surfaceM2: number | null }> })(asm);
    expect(boq.surfaceMissing).toContain('composite');
    expect(boq.items[0].surfaceM2).toBeNull();
  });

  it('복합의 하위는 **자기 게이트**로 검사된다 · 중첩의 중첩은 거부', () => {
    const mk = (params: unknown) => (buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })({
      name: 't', domain: 'mech', parts: [{ id: 'p', type: 'composite', params, at: {}, material: 'steel' }],
    });
    expect((mk({ subs: [{ type: 'box', params: { width: 0, depth: 10, height: 10 }, op: 'add' }] }).gateErrors ?? []).join(' ')).toContain('subs[0](box)');
    expect((mk({ subs: [{ type: 'composite', params: { subs: [] }, op: 'add' }] }).gateErrors ?? []).join(' ')).toContain('중첩의 중첩');
    expect((mk({ subs: [{ type: 'box', params: { width: 10, depth: 10, height: 10 }, op: 'subtract' }] }).gateErrors ?? []).join(' ')).toContain('add 하위가 하나도 없다');
  });
});

describe('새 템플릿의 판정 — 형상이 답을 가진 것만 (260801b, 계획 ⑤)', () => {
  const audit = (d: string, id: string) => auditTemplate(d, id, {}) as {
    real: number; failed: string[]; names: { real: string[] }; reached: boolean;
  };

  it('★`gusset_bracket` — 볼트 연단거리·간격이 실판정된다', () => {
    const a = audit('mech', 'gusset_bracket');
    expect(a.real).toBeGreaterThan(0);
    expect(a.reached).toBe(true);
    expect(a.names.real.join(' ')).toContain('연단거리');
    expect(a.failed).toEqual([]);   // 기본값이 기준을 만족한다
  });

  it('★`motor_mount` — 복합 부품 **안쪽 판재**의 볼트까지 본다', () => {
    // 최상위만 보게 짜면 composite 안의 판재가 통째로 빠진다.
    const a = audit('mech', 'motor_mount');
    expect(a.names.real.join(' ')).toContain('subs[0]');
    expect(a.failed).toEqual([]);
  });

  it('★`masonry_wall` — 세장비·줄눈이 실판정된다 (조적은 전단벽이 아니다)', () => {
    const a = audit('building', 'masonry_wall');
    expect(a.real).toBeGreaterThan(0);
    expect(a.names.real.join(' ')).toContain('세장비');
  });

  it('세장비 한계는 **보강 여부가 정한다** — 우리가 정하지 않는다', () => {
    const call = (p: unknown, ov: Record<string, number> = {}) =>
      (masonryCheck as unknown as (a: unknown, q: unknown) => { checks: Record<string, { pass: boolean | null; verdict?: string }> })(
        buildAssemblyTemplate('building', 'masonry_wall', ov), p);
    // h/t = 4000/150 = 26.7 → 무보강(20) 미달 · 보강(30) 적합 → 용도가 결론을 가른다
    const slim = { height: 4000, thickness: 150 };
    expect(call({ masonry: { reinforced: true } }, slim).checks.slenderness.pass).toBe(true);
    expect(call({ masonry: { reinforced: false } }, slim).checks.slenderness.pass).toBe(false);
    expect(call({}, slim).checks.slenderness.verdict).toBe('CHECK');
  });

  it('개구를 선언했는데 인방이 없으면 **판정하지 않고 그 사실을 적는다**', () => {
    const asm = buildAssemblyTemplate('building', 'masonry_wall', { openingW: 1200 }) as { parts?: Array<{ id?: string }> };
    const stripped = { ...asm, parts: (asm.parts ?? []).filter((p) => p.id !== 'lintel') };
    const r = (masonryCheck as unknown as (a: unknown, p: unknown) => { checks: Record<string, { pass: boolean | null; detail?: string[] }> })(stripped, {});
    expect(r.checks.lintelBearing.pass).toBeNull();
    expect(r.checks.lintelBearing.detail!.join(' ')).toContain('자립하지 못한다');
  });

  it('볼트 검사가 **연단거리 미달을 실제로 잡는다** — 살아 있는 검사다', () => {
    // 연단거리를 극단적으로 줄이면 FAIL 이 나와야 한다(안 나오면 검사가 죽은 것이다).
    const r = (boltedPlateCheck as unknown as (a: unknown, p: unknown) => { checks: Record<string, { pass: boolean | null; verdict?: string }> })(
      buildAssemblyTemplate('mech', 'gusset_bracket', { edgeDist: 15 }), {});
    expect(r.checks.edgeDistance.verdict).toBe('FAIL');
  });
});

describe('★ 「고지만 하고 검사가 없는」 다섯 구멍 (260801d)', () => {
  /**
   * 「공차·에러·중첩이 잘 판단되는가」를 물어 재 보니 **부피가 조용히 틀리는 경로 5개**가
   * 나왔다. 전부 같은 부류다 — 어휘 힌트에 「겹침 미공제」처럼 **적어 두기만 하고**
   * 검사가 없었다. 적어 두는 것과 검사하는 것은 다르다: 사용자는 질량이 2배로 나가는 것을
   * 알 방법이 없었다. 이 세션 내내 막아 온 형태를 내가 만든 것이었다.
   *
   * 접촉 vs 관통 분류는 **부품 간 간섭과 같은 값**(`TOL_CONTACT`)을 쓴다 — 공차 단일 소스.
   */
  const prof = [[0, 0], [200, 0], [200, 120], [0, 120]];
  const mk = (type: string, params: unknown) => (buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })({
    name: 't', domain: 'mech', parts: [{ id: 'p', type, params, at: {}, material: 'steel' }],
  });
  const errs = (type: string, params: unknown) => (mk(type, params).gateErrors ?? []).join(' ');

  it('① 홀 중심이 판 밖이면 거부한다 — 없는 홀이 부피를 빼면 질량이 과소해진다', () => {
    expect(errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 500, y: 60, d: 12 }] }))
      .toContain('판 외곽 밖이다');
  });

  it('② 홀이 외곽을 넘으면 거부한다 — 카운터보어는 **머리 외경**으로 잰다', () => {
    expect(errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 5, y: 60, d: 20 }] }))
      .toContain('판 외곽을 넘는다');
    // 중심은 안쪽이지만 ⌀30 머리가 넘는 경우 — 관통홀 기준으로는 통과할 수 있다
    expect(errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 12, y: 60, d: 12, kind: 'cbore', cbDia: 30, cbDepth: 8 }] }))
      .toContain('반경 15.0mm');
  });

  it('③ 홀끼리 겹치면 거부한다 — 부피가 이중으로 빠진다', () => {
    expect(errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 50, y: 60, d: 20 }, { x: 52, y: 60, d: 20 }] }))
      .toContain('이중으로 빠진다');
  });

  it('④ **패턴 전개분 전부**를 검사한다 — 선언 1건이 판 밖으로 뻗는다', () => {
    const e = errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 20, y: 60, d: 12, pattern: { kind: 'linear', count: 6, pitch: 60 } }] });
    expect(e).toContain('holes[3]');
    expect(e).toContain('holes[5]');   // 전개된 것 전부를 짚는다(첫 건만 잡으면 나머지를 모른다)
  });

  it('⑤ 복합 add 하위가 관통하면 거부한다 — 부피가 그만큼 과대하다', () => {
    const e = errs('composite', {
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 100 }, op: 'add' },
        { type: 'box', params: { width: 100, depth: 100, height: 100 }, op: 'add' },
      ],
    });
    expect(e).toContain('관통한다');
    expect(e).toContain('1000000mm³');   // 겹침 부피를 수치로 말한다
  });

  it('⑥ 빼기 하위가 어느 add 와도 안 겹치면 거부한다 — 뺄 것이 없는데 부피가 빠진다', () => {
    expect(errs('composite', {
      subs: [
        { type: 'box', params: { width: 100, depth: 100, height: 100 }, op: 'add' },
        { type: 'cylinder', params: { diameter: 20, length: 50 }, at: { tx: 900, ty: 900 }, op: 'subtract' },
      ],
    })).toContain('뺄 것이 없는데');
  });

  it('★정상 형상은 통과한다 — 과고지도 결함이다', () => {
    // 접촉(리브가 판에 얹힘)은 관통이 아니다. 실제 템플릿 3종이 통과해야 한다.
    expect(errs('extrude_profile', { profile: prof, depth: 20, holes: [{ x: 50, y: 60, d: 12 }, { x: 150, y: 60, d: 12 }] })).toBe('');
    expect(errs('composite', {
      subs: [
        { type: 'box', params: { width: 200, depth: 100, height: 50 }, op: 'add' },
        { type: 'cylinder', params: { diameter: 30, length: 60 }, at: { tx: 100, ty: 50, tz: -5 }, op: 'subtract' },
      ],
    })).toBe('');
    for (const [d, id] of [['mech', 'motor_mount'], ['mech', 'gusset_bracket'], ['building', 'masonry_wall']]) {
      const r = (buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })(buildAssemblyTemplate(d, id, {}));
      expect(r.gateErrors ?? [], `${d}/${id}`).toEqual([]);
    }
  });
});

describe('홀 공차 등급 — **받을 자리**를 먼저 만든다 (260801e)', () => {
  /**
   * ⚠ 종전에는 사용자가 공차를 **줄 자리조차 없었다.** 판정 이전에 받을 자리가 먼저다 —
   *   없으면 사용자는 의도를 표현할 방법이 없다.
   * ⚠ 여기서 하는 것은 **표기 형식 검증뿐**이다. 틈새/조임은 짝이 되는 축이 선언돼야
   *   판정할 수 있고(`fitClassLookup.evaluateFit`), 판재에는 축이 없다.
   *   형식만 보고 판정한 척하지 않는다.
   */
  const prof = [[0, 0], [200, 0], [200, 120], [0, 120]];
  const errs = (holes: unknown) => ((buildAssembly as unknown as (a: unknown) => { gateErrors?: string[] })({
    name: 't', domain: 'mech',
    parts: [{ id: 'p', type: 'extrude_profile', params: { profile: prof, depth: 20, holes }, at: {}, material: 'steel' }],
  }).gateErrors ?? []).join(' ');

  it.each(['H7', 'h6', 'JS9', 'G7', 'js13'])('%s — 정상 표기는 통과한다', (fit) => {
    expect(errs([{ x: 50, y: 60, d: 12, fit }])).toBe('');
  });

  it.each([['Q99'], [7], [{ grade: 7 }], ['H'], ['H99']])('%s — 표기가 아니면 이름으로 거부한다', (fit) => {
    expect(errs([{ x: 50, y: 60, d: 12, fit }])).toContain('fit 표기가 아니다');
  });

  it('미선언은 통과한다 — 공차는 선택이다(강제하면 과고지)', () => {
    expect(errs([{ x: 50, y: 60, d: 12 }])).toBe('');
  });

  it('어휘 힌트가 **판정하지 않는다는 것**을 밝힌다', () => {
    expect(TYPE_HINTS.extrude_profile).toContain('fit');
    expect(TYPE_HINTS.extrude_profile).toContain('판정하지 않는다');
  });
});
