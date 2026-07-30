/**
 * 어휘가 **소비자를 갖는가** (260801, 계획 ①·⑧).
 *
 * ## 왜 이 파일이 있는가
 * 260801 에 어휘를 2종 추가하고(`extrude_profile`·`masonry_block`) 게이트·부피·BOQ·SCAD·
 * STEP 을 다 붙였는데, **어느 검사도 그 둘을 밟지 않았다.** 전 어휘를 실측하는 유일한
 * 전수 소비자(`proxy-inventory.mjs` 의 `CANONICAL`)에 넣는 것을 빠뜨렸기 때문이다.
 * 이 세션 내내 잡아 온 형태 ①(있는 것이 안 닿음)의 **어휘판**이고, **아무 검사도 잡지
 * 못했다.** 그래서 검사를 만든다.
 *
 * ## ⚠ 「템플릿이 안 쓴다 = 죽은 어휘」가 아니다 — 실측으로 정정한 것
 * 처음엔 「어휘 35종 중 19종을 아무도 안 쓴다」로 읽었다. 그런데 소비자를 세어 보니
 * **템플릿은 여러 소비자 중 하나**였다:
 *   · 도면 인식·텍스트→3D(`extract`·`from-text`·`gen-drawing`) — `stepped_plate`·
 *     `l_bracket`·`bent_sheet`·`rect_tube` 등
 *   · 체결 자동생성·부품 편집(`mech-presets`·`edit-part`) — `hex_bolt`·`hex_nut`·`washer`
 *   · 전수 프록시 인벤토리(`proxy-inventory`) — **35종 전부**
 * 「템플릿 사용 0」을 결함으로 단정하면 API 전용 어휘에 억지 템플릿이 생긴다.
 * 그래서 이 파일이 지키는 불변식은 **「템플릿이 쓴다」가 아니라 「전수 소비자가 밟는다」**다.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL } from './proxy-inventory.mjs';
import { PARAMS, gate, partAabb } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';
import { TYPE_HINTS } from './schemas.mjs';
import { ASSEMBLY_TEMPLATES, buildAssemblyTemplate } from './domain-assemblies.mjs';
import { auditAll } from './domain-audit.mjs';

const params = Object.keys(PARAMS as Record<string, unknown>);
const canon = CANONICAL as Record<string, Record<string, unknown>>;

describe('★ 전 어휘가 전수 소비자에 등록돼 있다', () => {
  it('PARAMS ⊆ CANONICAL — 새 어휘를 추가하면 여기도 늘어난다', () => {
    const missing = params.filter((t) => !(t in canon));
    expect(missing, `CANONICAL 누락: ${missing.join(', ')}`).toEqual([]);
  });

  it('CANONICAL ⊆ PARAMS — 없는 어휘를 인벤토리가 들고 있지 않다', () => {
    const extra = Object.keys(canon).filter((t) => !params.includes(t));
    expect(extra, `PARAMS 에 없는 어휘: ${extra.join(', ')}`).toEqual([]);
  });

  it.each(params)('%s — 대표 파라미터가 게이트를 통과한다', (t) => {
    // 인벤토리에 넣어 놓고 게이트를 못 통과하면 「전수 실측」이 그 어휘를 건너뛴다.
    const errs = (gate as unknown as (i: unknown) => string[])({ type: t, ...canon[t] });
    expect(errs, `${t}: ${errs.join(' / ')}`).toEqual([]);
  });

  it.each(params)('%s — 대표 파라미터로 부피와 AABB 가 **양수로** 나온다', (t) => {
    const v = (partVolume as unknown as (ty: string, p: unknown) => number)(t, canon[t]);
    expect(v, `${t} 부피`).toBeGreaterThan(0);
    const bb = (partAabb as unknown as (i: unknown) => { min: number[]; max: number[] })({ type: t, ...canon[t] });
    for (const k of [0, 1, 2]) expect(bb.max[k] - bb.min[k], `${t} 축 ${k}`).toBeGreaterThan(0);
  });
});

describe('어휘 힌트 — 사람이 읽을 설명이 있다', () => {
  /**
   * ⚠ 힌트가 없는 어휘는 AI 분류 프롬프트에서 **필드 이름만 보고 채워야** 한다.
   * 전수를 요구하지는 않는다(기존 미보유가 다수라 그걸 지금 결함으로 세면 과고지다) —
   * **이번에 추가한 어휘**만 힌트를 갖는지 확인하고, 전체 보유율은 수치로 남긴다.
   */
  it('260801 추가 어휘는 힌트를 갖는다', () => {
    for (const t of ['extrude_profile', 'masonry_block']) {
      expect((TYPE_HINTS as Record<string, string>)[t], t).toBeTruthy();
    }
  });

  it('힌트 보유율을 기록한다 — 줄지 않게만 막는다', () => {
    const have = params.filter((t) => (TYPE_HINTS as Record<string, string>)[t]).length;
    // 260801 실측: 35종 중 17종. 늘리는 것은 별건이고, **줄어드는 것**을 막는다.
    expect(have).toBeGreaterThanOrEqual(17);
  });
});

describe('템플릿 어휘 사용 — 결함이 아니라 **기록**이다', () => {
  it('템플릿이 쓰는 어휘를 센다 — 0 을 실패로 단정하지 않는다', () => {
    const used = new Set<string>();
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, { id: string }[]>)) {
      for (const t of list) {
        type Built = { parts?: Array<{ type?: string }> };
        let a: Built | null = null;
        try { a = buildAssemblyTemplate(d, t.id, {}) as Built; } catch { continue; }
        for (const p of a?.parts ?? []) if (p.type) used.add(p.type);
      }
    }
    // 템플릿은 소비자 중 하나다(도면 인식·체결 자동·프록시 인벤토리가 나머지).
    // 여기서 지키는 것은 **템플릿이 실제로 어휘를 쓴다**는 하한뿐이다.
    expect(used.size).toBeGreaterThanOrEqual(16);
    for (const t of used) expect(params, `템플릿이 미등록 타입 사용: ${t}`).toContain(t);
  });
});

describe('★ 빌더 폴백 = 템플릿 파라미터 default (260801b)', () => {
  /**
   * ## 왜 이 검사가 필요한가
   * `buildAssemblyTemplate(domain, id, {})` 는 파라미터 목록의 `default` 를 **채우지 않고**
   * 빌더 안의 폴백(`num(p.x, 기본값)`)을 쓴다. 두 값이 갈리면 **경로에 따라 형상이 달라진다**:
   * UI 는 default 를 보여주고, API·직접 호출은 폴백을 쓴다.
   *
   * 이 세션에 같은 부류를 **두 번** 겪었다:
   *  · 난간 `handrailH` — 템플릿 1,200 vs 폴백 1,000 → 파라미터를 안 주면 법정 미달로 나갔다
   *  · 거셋 `edgeDist` — 템플릿 55 vs 폴백 40 → 볼트 연단거리가 계속 미달로 잡혔다
   * 두 번 겪고서야 전수로 막는다.
   *
   * ⚠ **파생·조건부 기본값은 정당하다.** 허용목록으로 이유와 함께 남긴다 —
   *   목록에 없는 불일치만 실패로 본다(과고지도 결함이다).
   */
  const DERIVED_DEFAULT_OK: Record<string, string> = {
    'mech/flanged_fitting': 'bendR 은 관경에서 파생한다(od×1.5) — default 170 은 기본 관경에 대한 표시값',
    'mech/conveyor': 'rollerPitch 는 형식에 따라 다르다(belt 900 / roller 300) — default 는 roller 값',
  };

  it('전 템플릿에서 빈 호출과 default 명시 호출이 **같은 형상**을 낸다', () => {
    const mismatched: string[] = [];
    for (const [d, list] of Object.entries(ASSEMBLY_TEMPLATES as Record<string, Array<{ id: string; params: Array<{ name: string; default: unknown }> }>>)) {
      for (const t of list) {
        const defs = Object.fromEntries(t.params.map((q) => [q.name, q.default]));
        let a: unknown, b: unknown;
        try {
          a = (buildAssemblyTemplate(d, t.id, {}) as { parts?: unknown })?.parts ?? [];
          b = (buildAssemblyTemplate(d, t.id, defs) as { parts?: unknown })?.parts ?? [];
        } catch { continue; }
        if (JSON.stringify(a) !== JSON.stringify(b)) mismatched.push(`${d}/${t.id}`);
      }
    }
    const unexpected = mismatched.filter((k) => !(k in DERIVED_DEFAULT_OK));
    expect(unexpected, `폴백≠default: ${unexpected.join(', ')}`).toEqual([]);
  });

  it('허용목록은 **실제로 불일치인 것만** 담는다 — 죽은 예외를 남기지 않는다', () => {
    for (const key of Object.keys(DERIVED_DEFAULT_OK)) {
      const [d, id] = key.split('/');
      const t = (ASSEMBLY_TEMPLATES as Record<string, Array<{ id: string; params: Array<{ name: string; default: unknown }> }>>)[d]
        ?.find((x) => x.id === id);
      expect(t, key).toBeTruthy();
      const defs = Object.fromEntries(t!.params.map((q) => [q.name, q.default]));
      const a = JSON.stringify((buildAssemblyTemplate(d, id, {}) as { parts?: unknown })?.parts ?? []);
      const b = JSON.stringify((buildAssemblyTemplate(d, id, defs) as { parts?: unknown })?.parts ?? []);
      expect(a, `${key} 는 이제 일치한다 — 허용목록에서 빼야 한다`).not.toBe(b);
    }
  });
});

describe('★ 템플릿이 판정을 갖는가 (260801b)', () => {
  /**
   * 어휘 층은 위에서 막았는데 **템플릿 층이 비어 있었다.** 이 세션에 템플릿을 4종 추가하고
   * `gusset_bracket`·`motor_mount`·`masonry_wall` 이 **실판정 0** 이었으며,
   * `gusset_bracket` 은 안전검토.html 조차 나오지 않았다 — 어느 검사도 잡지 못했다.
   *
   * ⚠ 실판정 0 이 **결함이 아닌 경우**가 있다. 그건 허용목록에 **이유와 함께** 선언해야
   *   통과한다 — 선언 없이 0 이면 실패다(「없다」와 「해당 없다」의 구별을 강제한다).
   */
  const NO_JUDGMENT_OK: Record<string, string> = {
    'civil/retaining_wall_run': '검증.html(codeVerificationVerdict) 경로로 소비자에 닿는다',
    'civil/box_culvert': '같음 — 검증.html 경로',
    'civil/retaining_wall_alignment': '같음 — 검증.html 경로',
    'mech/flanged_fitting': '배관 부속류 — 형상 검토 대상이 아니다(하중·계통이 없다)',
  };

  it('실판정 0 인 템플릿은 **허용목록에 선언**돼 있어야 한다', () => {
    const rows = auditAll({ wind: { V0: 30, Cn: -1.1 }, seismicG: 0.22, seismic: { R: 5 }, As_mm2: 8000 }) as Array<{ domain: string; id: string; real: number; error?: string }>;
    const zero = rows.filter((r) => !r.error && r.real === 0).map((r) => `${r.domain}/${r.id}`);
    const undeclared = zero.filter((k) => !(k in NO_JUDGMENT_OK));
    expect(undeclared, `판정 0인데 이유 미선언: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('허용목록에 **판정이 생긴 것**을 남겨 두지 않는다', () => {
    const rows = auditAll({ wind: { V0: 30, Cn: -1.1 }, seismicG: 0.22, seismic: { R: 5 }, As_mm2: 8000 }) as Array<{ domain: string; id: string; real: number }>;
    for (const key of Object.keys(NO_JUDGMENT_OK)) {
      const r = rows.find((x) => `${x.domain}/${x.id}` === key);
      expect(r, key).toBeTruthy();
      expect(r!.real, `${key} 에 판정이 생겼다 — 허용목록에서 빼야 한다`).toBe(0);
    }
  });
});
