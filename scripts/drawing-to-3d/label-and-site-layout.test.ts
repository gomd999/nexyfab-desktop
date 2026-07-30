/**
 * 판정을 **읽을 수 있는가** + 단지 배치 검토 (260731, 계획 260730 P0-①②·P1-③·P2-④⑤).
 *
 * 지금까지 이 세션은 「판정이 소비자에 **닿는가**」를 고쳐 왔다. 이름으로 세어 보니
 * 그 다음 층이 드러났다: **닿았는데 무엇을 판정했는지 읽을 수 없다.**
 * 실측(소제목 567개) — 271개가 영문 코드 키였다. 값은 정확한데 항목명이
 * `flexure`·`detail`·`needInputs` 였다. 제작 업체·건축주가 받는 문서다.
 */
import { describe, it, expect } from 'vitest';
import { ASSEMBLY_TEMPLATES, buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyReportHtml, domainSafetyVerdict } from './domain-dossier-verify.mjs';
import { siteLayoutCheck } from './site-layout-check.mjs';
import { auditTemplate } from './domain-audit.mjs';
import { easySummary } from './easy-summary.mjs';
import { shearWallCheck } from './shear-wall-check.mjs';

const P = { wind: { V0: 30, Cn: -1.1 }, seismicG: 0.22 };
/**
 * ⚠ 260731b — **params 를 1조합만 돌리면 「입력을 준 사용자가 보는 문서」를 못 본다.**
 *
 * 앞 네 번의 평가가 전부 1조합이었고, 그래서 벽식 횡력 검토의 풍 경로가 **한 번도 작동한
 * 적이 없다**는 사실이 안 보였다(`x.p.at` — 스택에 `.p` 가 없어 항상 throw). 실측:
 * `seismic.R` 을 주면 소제목이 590 → 626 으로 늘고 영문 키가 2종 → 11종이 됐다.
 * 회귀는 **입력을 준 경로까지** 봐야 한다 — 그게 돈 내는 사용자가 받는 문서다.
 */
const PARAM_MATRIX: Array<[string, Record<string, unknown>]> = [
  ['기본', P],
  ['+seismic.R', { ...P, seismic: { R: 5 } }],
  ['+zoning+As', {
    ...P, seismic: { R: 5 }, As_mm2: 8000,
    zoning: { coverageLimitPct: 60, farLimitPct: 250, greenRatioMinPct: 30 },
  }],
];
const report = (d: string, id: string, params: unknown = P) =>
  (domainSafetyReportHtml as unknown as (a: unknown, o: unknown) => string | null)(
    buildAssemblyTemplate(d, id, {}), { title: id, params }) ?? '';
const heads = (h: string) => [...h.matchAll(/<div class="ghead">([^<]*)<\/div>/g)].map((m) => m[1]);
/** 영문 코드 키로 보이는 소제목(한글이 한 글자도 없다). */
const isCodeKey = (s: string) => /^[A-Za-z][A-Za-z0-9_ [\]#]*$/.test(s);

describe('P0-① 판정 항목명을 읽을 수 있다', () => {
  it('전 51종 소제목 중 영문 코드 키가 남아도 5건 미만이다', () => {
    let total = 0; const left: string[] = [];
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        const hs = heads(report(d, t.id));
        total += hs.length;
        for (const x of hs) if (isCodeKey(x)) left.push(`${d}/${t.id}:${x}`);
      }
    }
    expect(total).toBeGreaterThan(400);      // 측정 자체가 비면 통과처럼 보인다 — 막는다
    expect(left.length).toBeLessThan(5);     // 260731 실측 271 → 2 (하중조합 이름 U1·U2)
  });

  it.each(PARAM_MATRIX)('[%s] 영문 소제목이 5건 미만이다 — params 를 바꿔도', (_nm, params) => {
    let total = 0; const left: string[] = [];
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        const hs = heads(report(d, t.id, params));
        total += hs.length;
        for (const x of hs) if (isCodeKey(x)) left.push(`${d}/${t.id}:${x}`);
      }
    }
    expect(total).toBeGreaterThan(400);
    expect(left.length, left.join(' · ')).toBeLessThan(5);
  });

  it.each(PARAM_MATRIX)('[%s] 남은 영문 키는 전부 고지된다', (_nm, params) => {
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        const h = report(d, t.id, params);
        for (const k of heads(h).filter(isCodeKey)) expect(h, `${d}/${t.id}:${k}`).toContain(`<code>${k}</code>`);
      }
    }
  });

  it.each(PARAM_MATRIX)('[%s] ★계산기 labelKo — **근본**에서 영문 라벨이 0건이다', (_nm, params) => {
    /**
     * ⚠ 렌더러 사전은 **표시 계층 보완**이고, 이것이 근본이다. 감사는 표시 계층을 거치지
     * 않으므로 여기서 0 이 나오는 것은 「계산기가 스스로 이름을 밝힌다」는 뜻이다.
     * 260731b 실측: 52건 → 0건(rc_beam·rc_column·timber_beam·drainage_vent +
     * interior/landscape/bridge/load-path 자체 검사).
     */
    const left: string[] = [];
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        const a = auditTemplate(d, t.id, params) as { englishLabels?: string[] };
        for (const k of a.englishLabels ?? []) left.push(`${d}/${t.id}:${k}`);
      }
    }
    expect(left, left.join(' · ')).toEqual([]);
  });

  it('★남은 영문 키는 **전부 고지된다** — 사전만으로는 새 키를 못 막는다', () => {
    // ⚠ 배포 직후 이 기구가 스스로를 잡았다: 같은 세션에 만든 단지 배치 검토의
    //   `notChecked` 가 라이브 문서에 영문 그대로 나갔고 고지가 그것을 이름으로 짚었다.
    //   그러므로 「사전에 다 넣었다」가 아니라 「남은 것이 전부 고지된다」가 불변식이다.
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        const h = report(d, t.id);
        for (const k of heads(h).filter(isCodeKey)) {
          expect(h, `${d}/${t.id}:${k}`).toContain(`<code>${k}</code>`);
        }
      }
    }
  });

  it('노드가 이미 가진 이름(labelKo)을 소제목으로 쓴다 — 값처럼 찍지 않는다', () => {
    // 기계는 전 검사에 labelKo 가 있는데도 소제목이 전부 영문이었다.
    // labelKo 를 스칼라로 취급해 `labelKo=…` 로 찍고 소제목엔 키를 쓴 탓이다.
    const h = report('mech', 'conveyor');
    expect(h).not.toContain('labelKo=');
    expect(heads(h).some((x) => /전도/.test(x))).toBe(true);
  });

  it('사전에 없는 키는 원문 그대로 나가되 **고지한다**', () => {
    // 조용히 넘어가면 계산기에 새 키가 생겨도 아무도 모른다.
    const h = report('building', 'rc_frame');
    expect(h).toContain('한국어 라벨 미등록');
    // ⚠ 고지에는 **문서에 실제로 찍힌 키**가 들어가야 한다. 접미 숫자를 떼고 넣었더니
    //   `U1`·`U2` 가 `U` 로 나가 문서에서 찾을 수 없는 키를 고지했다(첫 구현 실측).
    for (const k of heads(h).filter(isCodeKey)) expect(h).toContain(`<code>${k}</code>`);
  });

  it('미등록 키가 없는 문서는 고지를 붙이지 않는다 — 과고지 금지', () => {
    const h = report('mech', 'conveyor');
    expect(h).not.toContain('한국어 라벨 미등록');
  });
});

describe('P0-② 이름 없는 판정 — 루트 종합 판정에 이름을 준다', () => {
  it.each([['building', 'industrial_stair'], ['bridge', 'truss_bridge'], ['bridge', 'arch_bridge']])(
    '%s/%s — "판정: 적합 ✓" 만 덩그러니 나오지 않는다', (d, id) => {
      const h = report(d, id);
      expect(h).toContain('종합 판정');
      expect(h).toContain('아래 개별 검토의 합');
    });

  it('감사가 종합 판정을 실판정과 **이중으로 세지 않는다**', () => {
    const a = auditTemplate('bridge', 'truss_bridge', P) as { real: number; overall: number };
    expect(a.overall).toBe(1);
    // 종합은 자식들의 합이므로 실판정에 섞이면 총량이 부푼다(260731 실측: 교량 19→15).
    expect(a.real).toBeGreaterThan(0);
  });
});

describe('P1-③ 배수 구배 — 사유를 세 갈래로 구별한다', () => {
  /**
   * ⚠ 260801 에 `cafe_room` 의 낙차를 선언해(입상관 진입 z 를 80mm 낮춤) **세 배관이 모두
   * PASS 로 바뀌었다** — 검체가 사라졌다. 불변식은 그대로 두고 검체를 옮긴다:
   *   · 낙차를 선언한 템플릿 → **실판정**(PASS)
   *   · 하강 경로가 성립하지 않는 템플릿 → 「중력 배수로 판정할 수 없다」(판정 불가)
   * 「기준 미달」로 뭉개지 않는 것이 원래 불변식이고, 그건 양쪽에서 지켜진다.
   */
  it('낙차를 선언한 배관은 **실판정**된다', () => {
    const h = report('interior', 'cafe_room', {});
    expect(h).toContain('배수 구배');
    expect(h).toMatch(/판정: <span[^>]*>적합/);
  });

  it('하강 경로가 없으면 「중력 배수로 판정할 수 없다」 — 기준 미달이 아니다', () => {
    // `apartment_unit` 은 벽 배치상 하강 단조 경로가 없어 라우터가 상승 경로를 택한다.
    // 그 사실을 라우터가 note 로, 검사가 사유로 각각 밝힌다.
    const h = report('interior', 'apartment_unit', {});
    expect(h).toMatch(/중력 배수로 판정할 수 없다|판정 불가\(기준 미달이 아니다\)/);
    expect(h).not.toMatch(/구배 미달|기준 미달로 판정/);
  });
});

describe('P2-④ 단지 배치 — 방향을 지어내지 않고 판정한다', () => {
  const base = {
    nX: 3, nY: 2, towers: 6, floors: 15, storyHmm: 2900, towerHmm: 43500,
    siteAreaM2: 21600, buildingAreaM2: 1800, grossFloorAreaM2: 27000, greenAreaM2: 900,
  };
  const run = (gapXmm: number, gapYmm: number, params: unknown = {}) =>
    (siteLayoutCheck as unknown as (a: unknown, p: unknown) => {
      checks: Record<string, { verdict?: string; pass: boolean | null; needInputs?: unknown[] }>;
    })({ siteLayout: { ...base, gapXmm, gapYmm } }, params);

  it.each([
    [25000, 'PASS'],   // 0.5H(21.8m) 이상 — 어느 배치로도 적합
    [15000, 'CHECK'],  // 측벽 8m 는 넘고 0.5H 미달 — **배치에 달렸다**
    [6000, 'FAIL'],    // 측벽 8m 미달 — 어느 배치로도 미달
  ])('인동간격 %dmm → %s', (gap, want) => {
    expect(run(gap as number, gap as number).checks.gapX.verdict).toBe(want);
  });

  it('상한이 선언되지 않은 건폐율·용적률·조경률은 **판정하지 않는다**', () => {
    const c = run(25000, 35000).checks;
    for (const k of ['coverage', 'far', 'green']) {
      expect(c[k].pass).toBeNull();
      expect((c[k].needInputs ?? []).length).toBeGreaterThan(0);
    }
  });

  it('상한을 주면 판정한다 — 입력이 있으면 회피하지 않는다', () => {
    const c = run(25000, 35000, { zoning: { coverageLimitPct: 60, farLimitPct: 250, greenRatioMinPct: 30 } }).checks;
    expect(c.coverage.pass).toBe(true);    // 8.3% ≤ 60%
    expect(c.far.pass).toBe(true);         // 125% ≤ 250%
    expect(c.green.pass).toBe(false);      // 4.2% < 30%
  });

  it('마주보는 동이 없으면 인동간격은 **해당 없음**이다 — 억지로 판정하지 않는다', () => {
    const c = (siteLayoutCheck as unknown as (a: unknown, p: unknown) => { checks: Record<string, unknown> })(
      { siteLayout: { ...base, nX: 1, nY: 1, gapXmm: 25000, gapYmm: 35000 } }, {}).checks;
    expect(c.gapX).toBeUndefined();
    expect(c.gapY).toBeUndefined();
  });

  it('메타가 없으면 null — 「해당 없음」이지 에러가 아니다', () => {
    expect((siteLayoutCheck as unknown as (a: unknown, p: unknown) => unknown)({ parts: [] }, {})).toBeNull();
  });

  it('루트에 배지를 만들지 않는다 — 「검사가 돌았다」≠「단지가 적합하다」', () => {
    // labelKo + ok:true 는 렌더러가 "판정: 적합 ✓" 로 그린다. 개별 항목이 미달이어도.
    const r = (siteLayoutCheck as unknown as (a: unknown, p: unknown) => Record<string, unknown>)(
      { siteLayout: { ...base, gapXmm: 6000, gapYmm: 7000 } }, {});
    expect(r.labelKo).toBeUndefined();
    expect(typeof r.label).toBe('string');
  });

  it('검토하지 않은 것을 이름으로 밝힌다', () => {
    const r = (siteLayoutCheck as unknown as (a: unknown, p: unknown) => { notChecked: { labelKo: string }[] })(
      { siteLayout: { ...base, gapXmm: 25000, gapYmm: 35000 } }, {});
    const names = r.notChecked.map((x) => x.labelKo).join(' ');
    expect(names).toContain('주차대수');
    expect(names).toContain('일조권');
  });
});

describe('★ 문구가 사실인가 — 「V0 를 주면 돕니다」를 실제로 V0 만 줘서 검사한다', () => {
  const shaft = () => buildAssemblyTemplate('building', 'elevator_shaft', {});
  const run = (params: unknown) => (shearWallCheck as unknown as (a: unknown, p: unknown) => {
    ok: boolean; checks?: Record<string, unknown>; needInputs?: { name: string }[]; messageKo?: string;
    attempted?: string[]; basis?: Record<string, unknown>;
  } | null)(shaft(), params);

  it('★`wind.V0` 만 줘도 검토가 돈다 — 종전엔 **한 번도 돈 적이 없었다**', () => {
    // 종전: `lateral.map(x => x.p.at?.tx)` — `lateral` 원소는 연직 병합된 스택이라 `.p` 가
    // 없어 **항상 throw**. 그런데 거부 문구는 「R 또는 V0 중 하나만 주면 돕니다」라고 했다.
    const r = run({ wind: { V0: 30 } });
    expect(r?.ok).toBe(true);
    expect(Object.keys(r!.checks ?? {}).length).toBeGreaterThan(0);
  });

  it.each([
    ['seismic.R 만', { seismic: { R: 5 } }],
    ['wind.V0 만', { wind: { V0: 30 } }],
    ['둘 다', { seismic: { R: 5 }, wind: { V0: 30 } }],
  ])('%s — 문구가 약속한 대로 검토가 돈다', (_nm, params) => {
    expect(run(params)?.ok).toBe(true);
  });

  it('풍 B·D 는 **건물 외곽**이다 — 벽 중심 범위가 아니다(과소평가 방지)', () => {
    const r = run({ wind: { V0: 30 } });
    const note = JSON.stringify(r);
    expect(note).toContain('평면 외곽');
    expect(note).toContain('풍압은 투영면에 걸린다');
  });

  it('★`seismic.importance` 를 풍 어휘(`1`)로 줘도 받는다 — 어휘가 다른 것은 우리 사정이다', () => {
    // 지진 계산기는 special|grade1|grade2, 풍은 1|2|3. MCP 스키마는 같은 이름을 노출한다.
    expect(run({ seismic: { R: 5, importance: '1' }, wind: { V0: 30 } })?.ok).toBe(true);
    expect(run({ seismic: { R: 5, importance: 'grade2' } })?.ok).toBe(true);
    expect(run({ seismic: { R: 5, importance: 'I' } })?.ok).toBe(true);
  });

  it('★모르는 값은 **지어내지 않고** 게이트가 이름으로 거부한다', () => {
    const r = run({ seismic: { R: 5, importance: 'ZZZ' } });
    expect(r?.ok).toBe(false);
    // 「입력 없음」이 아니라 「값이 허용범위 밖」이라고 말해야 한다.
    expect(r?.messageKo).toContain('값이 허용범위를 벗어났거나');
    expect(r?.messageKo).toContain('must be one of');
  });

  it('★이미 준 값을 다시 요구하지 않는다', () => {
    const r = run({ seismic: { R: 5, importance: 'ZZZ' } });
    // R 은 줬으므로 needInputs 에 없어야 한다. V0 는 안 줬으므로 있어야 한다.
    const names = (r?.needInputs ?? []).map((x) => x.name);
    expect(names).not.toContain('seismic.R');
    expect(names).toContain('wind.V0');
  });

  it('아무것도 안 주면 종전대로 둘 다 요구한다 — 과소 고지도 막는다', () => {
    const names = (run({})?.needInputs ?? []).map((x) => x.name);
    expect(names).toEqual(['seismic.R', 'wind.V0']);
  });

  it('★풍 경로 복구로 실판정 0 이던 건축 3종이 **V0 만으로도** 판정한다', () => {
    // ⚠ 이 단정은 「R 을 주면 늘어난다」가 아니다. `P` 에는 이미 `wind.V0` 가 있으므로,
    //   풍 경로가 살아난 것만으로 세 템플릿이 판정한다 — 그게 이 수정의 크기다.
    //   (수정 전에는 세 종 모두 어떤 params 로도 실판정 0 이었다.)
    for (const id of ['water_tank', 'elevator_shaft', 'gable_house']) {
      expect((auditTemplate('building', id, P) as { real: number }).real, id).toBeGreaterThan(0);
      // V0 를 빼면 다시 0 이 된다 — 판정이 풍에서 나온 것임을 대조로 확정한다.
      const noWind = auditTemplate('building', id, { seismicG: 0.22 }) as { real: number };
      expect(noWind.real, `${id} (V0 없음)`).toBe(0);
    }
  });
});

describe('★ 같은 것을 두 곳에서 다르게 세지 않는다 — 쉬운요약 커버리지', () => {
  it.each([['landscape', 'apartment_complex'], ['building', 'rc_frame'], ['bridge', 'truss_bridge']])(
    '%s/%s — 쉬운요약의 「판정한 항목」 수가 판정 소스의 judged 와 일치한다', (d, id) => {
      const asm = buildAssemblyTemplate(d, id, {});
      const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { judged: number } | null)(asm, {});
      const t = (easySummary as unknown as (a: unknown, o: unknown) => string)(
        asm, { title: 't', domain: d, domainSafety: v }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      // 종전엔 판정 소스를 **1개**로 세서, 인동간격 2건을 판정한 문서가 "1개" 라고 했다.
      expect(t).toContain(`실제로 판정한 항목은 ${v!.judged}개`);
    });

  it('거부 경로도 같은 수를 말한다 — judgedDespiteRefusal 을 빠뜨리지 않는다', () => {
    // `tower_crane` 은 지배 입력(카운터웨이트)이 없어 본 검토는 거부되지만
    // 정적 전도는 실제로 판정한다. 거부 경로는 개수를 **다른 이름**으로 낸다.
    const asm = buildAssemblyTemplate('mech', 'tower_crane', {});
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { judgedDespiteRefusal?: number } | null)(asm, {});
    expect(v?.judgedDespiteRefusal).toBeGreaterThan(0);
    const t = (easySummary as unknown as (a: unknown, o: unknown) => string)(
      asm, { title: 't', domain: 'mech', domainSafety: v }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toContain(`실제로 판정한 항목은 ${v!.judgedDespiteRefusal}개`);
  });
});

describe('P2-⑤ 감사가 civil 의 검증 경로도 센다', () => {
  it.each(['retaining_wall_run', 'box_culvert'])('civil/%s — 미도달로 보이지 않는다', (id) => {
    const found = (ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>).civil?.some((t) => t.id === id);
    if (!found) return;   // 템플릿 이름이 바뀌면 조용히 통과시키지 말고 아래 전수로 잡는다
    const a = auditTemplate('civil', id, P) as { reached: boolean; reachedVerification: unknown };
    expect(a.reachedVerification).not.toBeNull();
    expect(a.reached).toBe(true);
  });

  it('civil 전 종이 어느 한 경로로든 소비자에 닿는다', () => {
    for (const t of (ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>).civil ?? []) {
      const a = auditTemplate('civil', t.id, P) as { reached: boolean };
      expect(a.reached, `civil/${t.id}`).toBe(true);
    }
  });
});
