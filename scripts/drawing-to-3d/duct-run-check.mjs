/**
 * duct-run-check.mjs — 덕트 계통 자기정합 + 사이징 정직 거부 (260729).
 *
 * ## 왜 필요했나
 * `duct_run` 은 building 도메인이라 라멘 전용 `loadPathCheck` 로 가서 "role 태깅 필요 —
 * 기둥4·보0·슬래브1"로 거부됐다. **태깅 갭이 아니다** — 이 어셈블리는 기둥이 슬래브를
 * 직접 받는 무량판이고 보가 없는 게 맞다. 더 중요한 건, 이 어셈블리의 본체는 구조가
 * 아니라 **덕트 계통**이라는 것이다. 그리고 `duct_sizing` 계산기(속도법 + Darcy·
 * Swamee-Jain, ASHRAE 등가경)는 **어디서도 호출되지 않고 있었다** — stairCheck·
 * shear_wall 과 같은 자리.
 *
 * ## 파생하는 것과 거부하는 것
 *  파생한다: 주덕트 단면·직관 길이·분기 수·행어 개수 — 전부 형상에 있다
 *  거부한다: 풍량(flowCMH)·허용유속(velocityLimit)
 *    둘 다 **설계 요구량**이지 형상이 아니다. 단면에서 풍량을 역산하려면 유속을
 *    가정해야 하고, 유속을 가정하면 그게 곧 날조다.
 *
 * ⚠ 관례값(주덕트 6~8m/s 등)으로 합·불을 내지 않는다 — 용도마다 다르다. 산출값만 적는다.
 */

/** 롤별 부품 수집. */
const byRole = (a, role) => (a?.parts ?? []).filter((p) => p.role === role && p.unverified !== true);

/**
 * 덕트 계통 검토. ductMeta 가 없으면 **null**(대상 아님).
 * @param {object} assembly
 */
export function ductRunCheck(assembly) {
  const m = assembly?.ductMeta;
  if (!m || typeof m !== 'object') return null;
  const ducts = byRole(assembly, 'duct');
  const hangers = byRole(assembly, 'hanger');
  if (!ducts.length) {
    return { ok: false, label: '덕트 계통 검토', needInputs: [{ name: "parts[role='duct']", labelKo: '덕트 부재' }] };
  }
  // 주덕트 = 가장 긴 덕트(직관). 분기는 나머지.
  const spanOf = (p) => Math.max(Number(p.params?.width) || 0, Number(p.params?.depth) || 0, Number(p.params?.height) || 0);
  const trunk = ducts.reduce((a, b) => (spanOf(b) > spanOf(a) ? b : a));
  const checks = {};

  // ── 선언 메타 ↔ 실제 형상 자기정합 (하드 — 어긋나면 둘 중 하나가 틀렸다) ─────
  const trunkLen = spanOf(trunk);
  if (Number(m.length) > 0) {
    checks.trunkLength = {
      labelKo: '주덕트 직관 길이 = 선언 length',
      pass: Math.abs(trunkLen - Number(m.length)) <= 1e-6,
      detail: [`형상 ${trunkLen} vs 선언 ${m.length}`],
      note: '어긋나면 계통도와 수량표 중 하나가 틀렸다',
    };
  }
  if (Number(m.trunkW) > 0 && Number(m.trunkH) > 0) {
    // 주덕트의 단면 = 길이축을 뺀 나머지 두 변.
    const dims = [Number(trunk.params?.width), Number(trunk.params?.depth), Number(trunk.params?.height)];
    const section = dims.filter((v) => Math.abs(v - trunkLen) > 1e-6).sort((a, b) => b - a);
    const want = [Number(m.trunkW), Number(m.trunkH)].sort((a, b) => b - a);
    checks.trunkSection = {
      labelKo: '주덕트 단면 = 선언 trunkW × trunkH',
      pass: section.length === 2 && section[0] === want[0] && section[1] === want[1],
      detail: [`형상 ${section.join('×')} vs 선언 ${want.join('×')}`],
    };
  }
  if (Number(m.ceilingH) > 0) {
    const slab = byRole(assembly, 'slab')[0];
    if (slab) {
      checks.ceilingHeight = {
        labelKo: '천장(슬래브 하면) 높이 = 선언 ceilingH',
        pass: Math.abs(Number(slab.at?.tz ?? 0) - Number(m.ceilingH)) <= 1e-6,
        detail: [`슬래브 tz ${slab.at?.tz ?? 0} vs 선언 ${m.ceilingH}`],
      };
    }
  }

  // ── 산출값(판정하지 않음) ─────────────────────────────────────────────────
  const dims = [Number(trunk.params?.width), Number(trunk.params?.depth), Number(trunk.params?.height)];
  const sec = dims.filter((v) => Math.abs(v - trunkLen) > 1e-6);
  const areaM2 = sec.length === 2 ? (sec[0] * sec[1]) / 1e6 : null;
  if (areaM2) {
    checks.sectionInfo = {
      labelKo: '주덕트 단면적(참고)', pass: null,
      detail: [`${sec.join('×')}mm = ${areaM2.toFixed(3)}㎡. 흘릴 수 있는 풍량은 유속에 비례하는데 `
        + '허용 유속은 용도(거실 3~5·주덕트 6~8 m/s 관례)에 따라 다르므로 여기서 정하지 않는다.'],
    };
  }
  if (hangers.length >= 2 && trunkLen > 0) {
    checks.hangerInfo = {
      labelKo: '행어 배치(참고)', pass: null,
      detail: [`행어 ${hangers.length}개 · 직관 ${trunkLen}mm. 지지 간격 기준은 덕트 재질·규격·`
        + '내진 등급에 따라 달라 판정하지 않는다(산출값만).'],
    };
  }

  return {
    ok: true,
    label: '덕트 계통 검토 (형상 자기정합)',
    checks,
    // 사이징은 형상만으로 성립하지 않는다 — 무엇을 주면 되는지 이름으로 지목한다.
    sizingUnavailable: {
      ran: false,
      needInputs: [
        { name: 'duct.flowCMH', labelKo: '풍량 m³/h — 환기 계산에서 나오는 설계 요구량이라 형상에서 알 수 없다' },
        { name: 'duct.velocityLimit', labelKo: '허용 유속 m/s — 용도가 정한다(거실 3~5·주덕트 6~8 관례)' },
      ],
      messageKo: `덕트 사이징·마찰손실 미검토 — 주덕트 단면 ${areaM2 ? areaM2.toFixed(3) + '㎡' : '미산출'}·`
        + `직관 ${trunkLen}mm·분기 ${m.branches ?? '?'}개는 형상에서 산출했습니다. `
        + '풍량과 허용 유속을 주면 표준경 선정·Δp 를 검토합니다(duct_sizing). '
        + '**"덕트 용량이 충분하다"는 뜻이 아닙니다.**',
    },
  };
}
