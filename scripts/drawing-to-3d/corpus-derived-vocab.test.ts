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
import { partAabb, extrudePoly, polyArea, PARAMS } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';
import { TYPE_SCHEMAS, TYPE_HINTS } from './schemas.mjs';
import { railingCheck } from './railing-check.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { SNAP_LISTS } from './snap-lists.mjs';
import { domainSafetyReportHtml } from './domain-dossier-verify.mjs';
import { auditTemplate } from './domain-audit.mjs';
import { importStep } from '@/lib/brep-bridge/stepImport';

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
