/**
 * site-layout-check.mjs — 단지 배치 검토 (260730, 계획 P2-④).
 *
 * ## 왜 이것부터 정의했나
 * `landscape/apartment_complex` 는 51종 중 **유일하게 실판정 0** 인 조경 템플릿이었다.
 * 앞 세션은 "검사를 붙이자" 대신 **「무엇을 검토할 것인가부터 정의해야 한다」**로 남겨 뒀다 —
 * 정의 없이 검사를 붙이면 그것이 곧 지어내기이기 때문이다. 이 파일이 그 정의다.
 *
 * ## 무엇을 검토하는가 — **형상이 답을 가진 것만**
 * 단지 배치에서 형상이 실제로 결정하는 것은 셋뿐이다:
 *  ① **인동간격** — 동 높이와 동 사이 거리. 둘 다 형상에 있다. **법정 기준이 있다.**
 *  ② **건폐율·용적률** — 건축면적·연면적·대지면적. 전부 형상에서 나온다.
 *  ③ **녹지(조경)면적률** — 조경 파츠 면적 / 대지면적. 형상에서 나온다.
 *
 * ## 무엇을 검토하지 않는가 — 그리고 **왜**
 *  · **주차대수**(주택건설기준 §27) — 세대당 기준이라 **세대수**가 필요하다. 매싱 모델은
 *    동·층만 있고 층당 세대수가 선언된 적이 없다. 층수로 세대수를 추정하면 그것이 지어내기다.
 *  · **건폐율·용적률의 합·불** — 상한을 **용도지역**이 정한다(국토계획법 시행령 §84).
 *    산출값은 내고, 상한은 **입력받는다**. 「제2종일반주거」를 가정하면 통과·미달이 그
 *    가정 하나로 뒤집힌다.
 *  · **조경면적 최소율** — 건축법 §42 는 「조례로 정한다」이다. 지자체마다 다르므로
 *    비율은 산출하되 판정은 입력받는다.
 *
 * ## ① 인동간격은 **방향을 지어내지 않고도** 판정할 수 있다
 * 건축법 시행령 제86조 제3항: 같은 대지에서 두 동이 마주보면
 *  · 채광창이 있는 벽면 직각방향 — 높이의 **0.5배 이상**
 *  · 서로 **측벽**만 마주보면 — **8m 이상**
 * 어느 면이 채광면인지는 평면(창 위치)이 정하는데 매싱 모델에는 **창이 없다.**
 * 그래서 방향을 가정하는 대신 **두 기준을 모두 걸어** 결론이 방향에 의존하는지를 본다:
 *  · gap ≥ 0.5H  → **어느 배치로도 적합**(PASS)
 *  · 8m ≤ gap < 0.5H → **배치에 달렸다**(CHECK — 측벽이면 적합, 채광면이 마주보면 미달)
 *  · gap < 8m   → **어느 배치로도 미달**(FAIL)
 * 가정 없이 판정할 수 있는 만큼만 판정하고, 갈리는 구간은 갈린다고 적는다.
 */

const r2 = (v, n = 2) => +Number(v).toFixed(n);
const MIN_SIDE_WALL_M = 8;       // 시행령 §86③ 측벽 상호간
const LIGHT_FACTOR = 0.5;        // 시행령 §86③ 채광창 직각방향 (도시형생활주택 0.25 — 별건)

/**
 * 단지 배치 검토. `assembly.siteLayout` 이 없으면 **null**(해당 없음 — 에러가 아니다).
 * @param {object} assembly `siteLayout` 메타를 가진 어셈블리
 * @param {object} params `zoning.coverageLimitPct` · `zoning.farLimitPct` · `zoning.greenRatioMinPct`
 */
export function siteLayoutCheck(assembly, params = {}) {
  const sl = assembly?.siteLayout;
  if (!sl) return null;
  const towerH = Number(sl.towerHmm), siteA = Number(sl.siteAreaM2);
  if (!(towerH > 0) || !(siteA > 0)) {
    return { labelKo: '단지 배치 검토', pass: null, detail: ['단지 제원(동 높이·대지면적)이 선언되지 않아 판정하지 않았다.'] };
  }
  const H_m = towerH / 1000;
  const need_m = r2(LIGHT_FACTOR * H_m, 1);
  const checks = {};

  // ── ① 인동간격 ────────────────────────────────────────────────────────────
  for (const [axis, koAxis, gapMm, count] of [
    ['gapX', '가로(동 좌우)', Number(sl.gapXmm), Number(sl.nX)],
    ['gapY', '세로(동 전후)', Number(sl.gapYmm), Number(sl.nY)],
  ]) {
    if (!(count > 1)) continue;   // 한 줄뿐이면 마주보는 동이 없다 — 해당 없음
    const gap_m = r2(gapMm / 1000, 1);
    const meetsLight = gap_m >= need_m;
    const meetsSide = gap_m >= MIN_SIDE_WALL_M;
    checks[axis] = {
      labelKo: `인동간격 ${koAxis} — ${gap_m}m (동 높이 ${r2(H_m, 1)}m)`,
      // ⚠ `pass:null` 이 아니라 **verdict** 로 세 갈래를 낸다. 「방향에 달렸다」는
      //   「판정 불가」와 다르다 — 무엇이 결론을 가르는지가 이미 밝혀져 있다.
      verdict: meetsLight ? 'PASS' : meetsSide ? 'CHECK' : 'FAIL',
      pass: meetsLight ? true : meetsSide ? null : false,
      detail: [
        `채광 기준 0.5H = ${need_m}m · 측벽 기준 ${MIN_SIDE_WALL_M}m (건축법 시행령 제86조 제3항)`,
        meetsLight
          ? `${gap_m}m 는 0.5H 를 만족한다 — **채광면이 마주보든 측벽이든 적합**하다(창 위치를 몰라도 결론이 갈리지 않는다).`
          : meetsSide
            ? `${gap_m}m 는 측벽 기준(${MIN_SIDE_WALL_M}m)은 만족하나 채광 기준(${need_m}m)에는 **${r2(need_m - gap_m, 1)}m 모자란다**. `
              + '**결론이 배치에 달렸다** — 마주보는 면에 채광창이 있으면 미달이다. 평면(창 위치)을 선언해야 확정된다.'
            : `${gap_m}m 는 측벽 기준 ${MIN_SIDE_WALL_M}m 에도 미달이다 — **어느 배치로도 적합할 수 없다.**`,
      ],
      note: '도시형 생활주택 0.25배·남측 동 높이 0.4배 등 완화 조항과 조례 강화는 반영하지 않았다 — 별도 확인 필요.',
    };
  }

  // ── ② 건폐율·용적률 ───────────────────────────────────────────────────────
  const bcr = Number(sl.buildingAreaM2) > 0 ? r2((sl.buildingAreaM2 / siteA) * 100, 1) : null;
  const far = Number(sl.grossFloorAreaM2) > 0 ? r2((sl.grossFloorAreaM2 / siteA) * 100, 1) : null;
  const bcrLimit = Number(params.zoning?.coverageLimitPct);
  const farLimit = Number(params.zoning?.farLimitPct);
  if (bcr != null) {
    checks.coverage = bcrLimit > 0
      ? {
        labelKo: `건폐율 ${bcr}% (상한 ${bcrLimit}%)`, pass: bcr <= bcrLimit,
        detail: [`건축면적 ${r2(sl.buildingAreaM2, 0)}㎡ ÷ 대지면적 ${r2(siteA, 0)}㎡ = ${bcr}%`],
      }
      : {
        labelKo: `건폐율 ${bcr}% — 상한 미선언`, pass: null,
        needInputs: [{ name: 'zoning.coverageLimitPct', labelKo: '건폐율 상한(%) — 용도지역이 정한다(국토계획법 시행령 §84, 조례로 강화 가능)' }],
        detail: [
          `건축면적 ${r2(sl.buildingAreaM2, 0)}㎡ ÷ 대지면적 ${r2(siteA, 0)}㎡ = **${bcr}%** 를 산출했다.`,
          '**합·불은 판정하지 않았다** — 상한을 용도지역이 정하는데 선언되지 않았다. 용도지역을 가정하면 그 가정 하나로 결론이 뒤집힌다.',
        ],
      };
  }
  if (far != null) {
    checks.far = farLimit > 0
      ? {
        labelKo: `용적률 ${far}% (상한 ${farLimit}%)`, pass: far <= farLimit,
        detail: [`연면적 ${r2(sl.grossFloorAreaM2, 0)}㎡ ÷ 대지면적 ${r2(siteA, 0)}㎡ = ${far}%`],
      }
      : {
        labelKo: `용적률 ${far}% — 상한 미선언`, pass: null,
        needInputs: [{ name: 'zoning.farLimitPct', labelKo: '용적률 상한(%) — 용도지역이 정한다(국토계획법 시행령 §85)' }],
        detail: [
          `연면적 ${r2(sl.grossFloorAreaM2, 0)}㎡(지상 ${sl.floors}층 × ${sl.towers}개동) ÷ 대지면적 ${r2(siteA, 0)}㎡ = **${far}%**.`,
          '**합·불은 판정하지 않았다.** 지하·주차·필로티 등 용적률 산입 제외분도 매싱에는 없다 — 실제 값은 이보다 낮을 수 있다.',
        ],
      };
  }

  // ── ③ 조경면적률 ──────────────────────────────────────────────────────────
  if (Number(sl.greenAreaM2) >= 0 && Number.isFinite(Number(sl.greenAreaM2))) {
    const g = r2((sl.greenAreaM2 / siteA) * 100, 1);
    const gMin = Number(params.zoning?.greenRatioMinPct);
    checks.green = gMin > 0
      ? { labelKo: `조경면적률 ${g}% (최소 ${gMin}%)`, pass: g >= gMin, detail: [`조경면적 ${r2(sl.greenAreaM2, 0)}㎡ ÷ 대지면적 ${r2(siteA, 0)}㎡ = ${g}%`] }
      : {
        labelKo: `조경면적률 ${g}% — 최소율 미선언`, pass: null,
        needInputs: [{ name: 'zoning.greenRatioMinPct', labelKo: '조경면적 최소율(%) — 건축법 §42 는 「조례로 정한다」라 지자체가 정한다' }],
        detail: [`조경면적 ${r2(sl.greenAreaM2, 0)}㎡ ÷ 대지면적 ${r2(siteA, 0)}㎡ = **${g}%** 를 산출했다. 최소율은 조례 소관이라 판정하지 않았다.`],
      };
  }

  return {
    ok: true,
    // ⚠ 루트는 `labelKo` 가 아니라 `label` 이다. `labelKo` + `ok:true` 는 렌더러가
    //   **"판정: 적합 ✓" 배지**로 그린다 — 「검사가 돌았다」가 「단지가 적합하다」로
    //   둔갑한다(개별 항목이 미달이어도). 형태 ④(없는 판정을 있는 것처럼).
    label: '단지 배치 검토 (인동간격·건폐율·용적률·조경률)',
    checks,
    /**
     * ⚠ **검토하지 않은 것을 이름으로 밝힌다.** 「검사가 없다」와 「해당이 없다」와
     * 「할 수 없다」는 다른 말이고, 이 셋을 뭉개지 않는 것이 이 문서 전체의 규약이다.
     */
    notChecked: [
      { labelKo: '주차대수 (주택건설기준 §27)', messageKo: '세대당 기준이라 **세대수**가 필요한데 매싱 모델에는 동·층만 있다. 층수로 세대수를 추정하면 지어내기가 된다 — 검토하지 않았다.' },
      { labelKo: '일조권 사선제한 (건축법 §61)', messageKo: '정북방향 인접 대지경계선까지의 거리가 필요한데 **대지경계선이 선언되지 않았다**(모델의 대지는 동 배치에서 파생한 것이라 실제 경계가 아니다).' },
      { labelKo: '소방차 진입로·동 출입구', messageKo: '도로·출입구가 매싱에 없다 — 형상에 없는 것은 검토할 수 없다.' },
    ],
    basis: {
      towers: sl.towers, floors: sl.floors, towerHm: r2(H_m, 1),
      siteAreaM2: r2(siteA, 0), buildingAreaM2: r2(sl.buildingAreaM2 ?? 0, 0),
      grossFloorAreaM2: r2(sl.grossFloorAreaM2 ?? 0, 0), greenAreaM2: r2(sl.greenAreaM2 ?? 0, 0),
    },
    refs: ['건축법 시행령 제86조 제3항 (인동간격)', '국토계획법 시행령 제84·85조 (건폐율·용적률 상한)', '건축법 제42조 (조경 — 조례 위임)'],
    disclaimer: '개념 검토(비법정) — 매싱 기준. 대지경계선·창 위치·세대 구성이 없어 일조 사선·주차·세대수 관련 법정 검토는 수행하지 않았다. 인허가는 건축사 검토 영역.',
  };
}
