/**
 * railing-check.mjs — 난간 검토 (260801, 참고 코퍼스 근거).
 *
 * ## 왜 필요한가
 * 참고 코퍼스 부품명 3,296개를 집계했더니 `railing`/`handrail`/`balustrade` 계열이
 * 27회 이상 나왔다 — 산업용 계단·발코니·교량에 실재하는 부재다.
 * 우리 형상에도 **이미 있다**: `industrial_stair` 는 `post` 10개 + `handrail` 2개를,
 * `commercial_massing` 은 `role:'railing'` 파라펫 난간을 만든다.
 *
 * **그런데 난간에 붙은 판정이 하나도 없었다.** 난간은 추락 방지 부재이고 법정 기준이
 * 명시된 몇 안 되는 항목이다 — 형상이 답을 갖고 있는데 아무도 보지 않았다.
 *
 * ## 무엇을 판정하는가 — 형상이 답을 가진 것만
 *  · **난간 높이** — 바닥(디딤/슬래브 상면)에서 상부 손스침까지. 형상에서 나온다.
 *  · **살(발라스터) 사이 간격** — 살이 형상에 있을 때만. 없으면 **판정하지 않고 그 사실을 적는다.**
 *  · **기둥(포스트) 간격** — 형상에서 나온다.
 *
 * ## 지어내지 않는 것
 *  · **살이 없는 난간을 "간격 적합"으로 두지 않는다.** 살이 형상에 없으면 간격을 계산할
 *    대상이 없는 것이고, 그건 "적합"이 아니라 "판정 불가"다. 이 세션 내내 지킨 구별이다.
 *  · **수평력(난간 손스침 하중)** — KDS 41 12 00 은 난간에 수평 등분포/집중하중을 요구하지만
 *    부재 접합 상세(앵커·용접)가 선언돼 있지 않아 판정할 수 없다. 안 한다고 적는다.
 *  · 용도별 완화·강화(공동주택·어린이 이용 시설 등)는 반영하지 않는다.
 *
 * ## 기준
 * 건축법 시행령 제40조(옥상광장 등의 설치) — 난간 높이 **1.2m 이상**,
 * 난간의 **살 사이 간격 10cm 이하**(영유아 추락 방지).
 * ⚠ 산업용 강재 계단은 산업안전보건기준에 관한 규칙이 별도 기준(90cm 이상)을 두므로,
 *   높이 판정은 **두 기준을 함께 보고** 어느 쪽에 걸리는지를 밝힌다 — 용도를 우리가 정하지 않는다.
 */

const r1 = (v) => +Number(v).toFixed(1);

/** 부품의 로컬 치수(box 전제) — 회전은 높이 판정에 쓰지 않는다(아래 주석 참조). */
function dims(p) {
  const q = p?.params ?? {};
  const w = Number(q.width), d = Number(q.depth), h = Number(q.height);
  return [w, d, h].every((x) => Number.isFinite(x) && x > 0) ? { w, d, h } : null;
}

const IS_RAIL = (p) => p.role === 'handrail' || p.role === 'railing';
const IS_POST = (p) => p.role === 'post';
const IS_PICKET = (p) => p.role === 'picket' || p.role === 'baluster';

/**
 * 난간 검토. 난간·기둥이 없으면 **null**(해당 없음 — 에러가 아니다).
 * @param {object} assembly
 * @param {object} params `railing.usage:'industrial'|'building'` (선택 — 없으면 두 기준 모두 보고)
 */
export function railingCheck(assembly, params = {}) {
  /**
   * ⚠ `params.usage` 를 쓰지 않는다 — 그 이름은 이미 **활하중 용도**(`residence_living` 등)로
   * 쓰이고 있어서 같은 키를 다른 뜻으로 읽으면 언젠가 엉뚱한 값이 난간 기준을 정하게 된다.
   * `railing.usage` 로 분리한다(같은 이름 두 뜻은 이 세션에서 `importance` 로 이미 겪었다).
   */
  const railUsage = params.railing?.usage;
  const parts = (assembly?.parts ?? []).filter((p) => p.unverified !== true);
  const rails = parts.filter(IS_RAIL);
  const posts = parts.filter(IS_POST);
  const pickets = parts.filter(IS_PICKET);
  if (!rails.length && !posts.length) return null;

  const checks = {};

  // ── ① 난간 높이 ───────────────────────────────────────────────────────────
  /**
   * ⚠ 높이는 **기둥 높이**로 잰다(손스침 부재의 z 좌표가 아니다).
   *   계단 난간은 경사로 올라가므로 손스침의 절대 z 는 위치마다 다르다 — 그 값을 쓰면
   *   "난간이 4m 높다" 같은 무의미한 수가 나온다. 기둥은 디딤면에서 수직으로 서므로
   *   기둥 높이 + 손스침 두께가 실제 손스침 높이다. 형상이 답을 가진 쪽을 쓴다.
   */
  /**
   * ⚠ 260801 실측으로 잡은 결함 — **기둥이 없는 난간이 높이 판정에서 통째로 빠졌다.**
   *
   * 처음엔 「기둥 높이 + 손스침 두께」만 봤다. 그런데 `commercial_massing(balcony:'true')` 의
   * 발코니 난간은 **1,100mm 짜리 일체 벽체**(기둥 없음)라 높이 판정이 하나도 안 나왔다 —
   * 가장 흔한 형태(콘크리트 난간벽)에서 가장 중요한 판정이 사라진 것이다.
   * 형상에 답이 있는데 한 가지 형태만 가정한 탓이다.
   *
   * 두 형태를 구별해 받는다:
   *  · **일체 난간벽** — 난간 부재 자체가 높다(h ≥ 600mm). 그 높이가 곧 난간 높이다.
   *  · **기둥+손스침** — 손스침은 얇은 봉(h < 600mm)이고 높이는 기둥이 정한다.
   * 600mm 는 판정 기준이 아니라 **형태 판별 임계**이며, 어느 쪽으로 봤는지 문서에 적는다.
   */
  const SOLID_MIN = 600;
  const solidRails = rails.map((p) => dims(p)?.h).filter((x) => x >= SOLID_MIN);
  const postH = posts.map((p) => dims(p)?.h).filter((x) => x > 0);
  const railT = rails.map((p) => { const d = dims(p); return d && d.h < SOLID_MIN ? Math.min(d.d, d.h) : null; }).filter((x) => x > 0);
  const basis = postH.length ? 'post' : (solidRails.length ? 'solid' : null);
  if (basis) {
    const hMin = postH.length ? Math.min(...postH) : Math.min(...solidRails);
    const top = basis === 'post' ? hMin + (railT.length ? Math.min(...railT) : 0) : hMin;
    const basisNote = basis === 'post'
      ? `기둥 최소 높이 ${r1(hMin)}mm + 손스침 두께 ${railT.length ? r1(Math.min(...railT)) : 0}mm`
      : `일체 난간벽 최소 높이 ${r1(hMin)}mm (기둥 없음 — 부재 자체가 난간)`;
    const OK_BUILDING = 1200, OK_INDUSTRIAL = 900;
    const usage = railUsage;
    const limit = usage === 'industrial' ? OK_INDUSTRIAL : usage === 'building' ? OK_BUILDING : null;
    checks.height = limit !== null
      ? {
        labelKo: `난간 높이 ${r1(top)}mm (기준 ${limit}mm — ${usage === 'industrial' ? '산업안전보건기준' : '건축법 시행령 제40조'})`,
        pass: top >= limit,
        detail: [`${basisNote} = ${r1(top)}mm`],
      }
      : {
        // ⚠ 용도를 우리가 정하지 않는다. 두 기준을 함께 보고 **어느 쪽에 걸리는지**를 밝힌다.
        labelKo: `난간 높이 ${r1(top)}mm — 용도 미선언(두 기준 대조)`,
        verdict: top >= OK_BUILDING ? 'PASS' : top >= OK_INDUSTRIAL ? 'CHECK' : 'FAIL',
        pass: top >= OK_BUILDING ? true : top >= OK_INDUSTRIAL ? null : false,
        detail: [
          `${basisNote} = **${r1(top)}mm**`,
          `건축법 시행령 제40조 ${OK_BUILDING}mm 이상 · 산업안전보건기준(산업용 계단) ${OK_INDUSTRIAL}mm 이상`,
          top >= OK_BUILDING
            ? '**두 기준 모두 만족한다** — 용도를 몰라도 결론이 갈리지 않는다.'
            : top >= OK_INDUSTRIAL
              ? `**결론이 용도에 달렸다** — 산업용이면 적합, 옥상광장·발코니 등 건축법 대상이면 `
                + `${r1(OK_BUILDING - top)}mm 미달이다. \`usage\` 를 선언해야 확정된다.`
              : '**어느 기준으로도 미달이다.**',
        ],
        note: '공동주택·어린이 이용 시설 등의 강화 조항은 반영하지 않았다 — 별도 확인 필요.',
      };
  }

  // ── ② 살 사이 간격 ────────────────────────────────────────────────────────
  const GAP_MAX = 100; // 건축법 시행령 제40조 — 살 사이 간격 10cm 이하
  if (pickets.length >= 2) {
    /**
     * ⚠ 260801 실측으로 잡은 것 — **기둥도 난간의 일부다.**
     *
     * 처음엔 살만 정렬해 간격을 쟀다. 그러면 기둥을 사이에 둔 두 살 사이가 「살 간격
     * 240.9mm」로 나온다 — **그 자리는 기둥이 막고 있어서 실제로 비어 있지 않다.**
     * 기준의 취지는 「영유아가 통과할 수 있는 빈틈」이고, 빈틈을 막는 것이 살이든
     * 기둥이든 상관없다. 난간 살 100개를 정확히 배치한 형상이 **기준 미달로 오판**됐다.
     * 살 ∪ 기둥을 **막는 부재**로 함께 세운다.
     */
    const barrier = [...pickets, ...posts];
    const cs = barrier.map((p) => ({ x: Number(p.at?.tx ?? 0), y: Number(p.at?.ty ?? 0), w: dims(p)?.w ?? 0, d: dims(p)?.d ?? 0 }));
    const spanX = Math.max(...cs.map((c) => c.x)) - Math.min(...cs.map((c) => c.x));
    const spanY = Math.max(...cs.map((c) => c.y)) - Math.min(...cs.map((c) => c.y));
    const alongX = spanX >= spanY;
    /**
     * ⚠ **난간 줄(run)마다 따로 잰다.**
     *
     * 처음엔 전 부재를 한 줄로 정렬했다. 그러면 좌·우 스트링거의 난간, U턴 계단의 두
     * 플라이트가 **한 평면인 것처럼** 섞여 「순간격 1,082.5mm」 같은 값이 나온다 —
     * 그 자리는 애초에 같은 난간이 아니라 빈틈이 아니다. 서로 다른 줄을 한 줄로 재면
     * 없는 결함을 만든다(이 세션에서 반복해 막은 「측정이 틀려 결함이 생기는」 형태).
     * 직교 좌표(줄을 가르는 축)로 묶어 **각 줄의 최댓값**을 본다.
     */
    const keyOf = (c) => Math.round((alongX ? c.y : c.x) / 50) * 50;   // 50mm 허용오차로 줄 구분
    const runs = new Map();
    for (const c of cs) {
      const k = keyOf(c);
      if (!runs.has(k)) runs.set(k, []);
      runs.get(k).push({ p: alongX ? c.x : c.y, t: alongX ? c.w : c.d });
    }
    let worst = -Infinity;
    for (const arr of runs.values()) {
      if (arr.length < 2) continue;
      const sorted = arr.sort((a, b) => a.p - b.p);
      for (let i = 1; i < sorted.length; i++) worst = Math.max(worst, sorted[i].p - (sorted[i - 1].p + sorted[i - 1].t));
    }
    if (!Number.isFinite(worst)) worst = 0;
    checks.picketGap = {
      labelKo: `살 사이 최대 간격 ${r1(worst)}mm (기준 ${GAP_MAX}mm 이하 — 건축법 시행령 제40조)`,
      pass: worst <= GAP_MAX,
      detail: [
        `막는 부재 ${barrier.length}개(살 ${pickets.length} + 기둥 ${posts.length}) · `
        + `${alongX ? 'X' : 'Y'}방향 정렬 · 난간 줄 ${runs.size}개를 **각각** 재서 최댓값 ${r1(worst)}mm`,
        '기둥도 빈틈을 막으므로 함께 센다 — 살만 세면 기둥을 사이에 둔 자리가 빈틈으로 오판된다.',
      ],
      note: '부재 두께를 공제한 **순간격**이다(중심간격이 아니다) — 영유아 통과 가능성이 기준의 취지다.',
    };
  } else if (rails.length || posts.length) {
    /**
     * ⚠ **살이 없는 난간을 "간격 적합"으로 두지 않는다.**
     * 살이 형상에 없으면 간격을 계산할 대상이 없는 것이고, 그건 「적합」이 아니라
     * 「판정 불가」다. 「해당 없음 ≠ 판정 불가 ≠ 이상 없음」의 난간판이다.
     */
    checks.picketGap = {
      labelKo: '살 사이 간격 — 판정하지 않았다(살이 형상에 없다)', pass: null,
      needInputs: [{ name: "parts[role='picket'|'baluster']", labelKo: '난간 살(발라스터) 부재 — 형상에 선언되어야 간격을 잴 수 있다' }],
      detail: [
        `난간 손스침 ${rails.length}개·기둥 ${posts.length}개는 있으나 **살이 ${pickets.length}개**다.`,
        '건축법 시행령 제40조의 「살 사이 간격 10cm 이하」를 **검토하지 않았다** — '
          + '살이 없는 것이 적합하다는 뜻이 아니다(개방형 난간은 그 자체가 추락 위험이다).',
      ],
    };
  }

  // ── ③ 기둥 간격 (형상 자기정합) ───────────────────────────────────────────
  if (posts.length >= 2) {
    const xs = posts.map((p) => Number(p.at?.tx ?? 0));
    const ys = posts.map((p) => Number(p.at?.ty ?? 0));
    const alongX = (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...ys) - Math.min(...ys));
    const line = (alongX ? xs : ys).slice().sort((a, b) => a - b);
    let maxPitch = 0;
    for (let i = 1; i < line.length; i++) maxPitch = Math.max(maxPitch, line[i] - line[i - 1]);
    checks.postPitch = {
      labelKo: `기둥 간격 최대 ${r1(maxPitch)}mm (형상 자기정합 — 안전 판정 아님)`,
      kind: 'self-consistency',
      ok: maxPitch > 0,
      detail: [
        `기둥 ${posts.length}본 · ${alongX ? 'X' : 'Y'}방향 최대 간격 ${r1(maxPitch)}mm`,
        '기둥 간격의 **법정 상한은 없다** — 손스침 수평력·부재 강도가 정한다(아래 미검토 항목).',
      ],
    };
  }

  return {
    ok: true,
    label: '난간 검토 (높이·살 간격)',
    checks,
    notChecked: [
      {
        labelKo: '난간 수평력 (KDS 41 12 00 손스침 하중)',
        messageKo: '난간은 수평 등분포·집중하중을 받지만 **앵커·용접 등 접합 상세가 선언돼 있지 않아** '
          + '부재·접합부 강도를 판정할 수 없다. 높이·간격이 적합해도 **하중을 못 버티면 무의미하다.**',
      },
      {
        labelKo: '용도별 강화 조항',
        messageKo: '공동주택·어린이 이용 시설 등의 강화 규정은 반영하지 않았다 — 용도가 선언되지 않았다.',
      },
    ],
    refs: ['건축법 시행령 제40조 (난간 높이 1.2m·살 간격 10cm)', '산업안전보건기준에 관한 규칙 (산업용 계단 난간 90cm)'],
    disclaimer: '개념 검토(비법정) — 형상 파생 치수 기준. 하중·접합부는 미검토. 인허가는 건축사·구조기술사 검토 영역.',
  };
}
