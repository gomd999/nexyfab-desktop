/**
 * fit-check.mjs — 핀·보어 **끼워맞춤 판정** (260801f).
 *
 * ## 왜 여기서 되는가
 * 홀에 `fit`(H7 등)을 받을 자리는 만들었지만(260801e) **판정할 상대가 없었다** —
 * 판재에는 축이 없기 때문이다. 그런데 어셈블리에는 **핀-보어 짝 검출이 이미 있었다**
 * (`assembly.mjs`: 수직 cylinder × 홀 선언 부재의 축심 정합 <0.5mm). 그 짝이 곧 상대다.
 *
 * ## 무엇을 판정하는가 — **양쪽이 공차를 선언했을 때만**
 *  · 홀 `fit`(대문자 기호 + 등급, 예 `H7`) · 핀 `fit`(소문자, 예 `g6`)
 *  · 둘을 합쳐 `H7/g6` 형태의 명명 끼워맞춤이 되면 `evaluateFit` 으로 틈새/조임을 낸다
 *
 * ## 지어내지 않는 것
 *  · **한쪽만 선언되면 판정하지 않는다.** 나머지를 관례값으로 채우면 그 가정 하나로
 *    틈새/조임이 뒤집힌다 — 「선언되지 않았다」고 적는다.
 *  · **명명 조합에 없는 짝**(예 `H8/g6`)은 판정하지 않는다. 산식이 있는 것은 IT 등급과
 *    기본편차뿐이고, 임의 조합을 계산하려면 구멍 기호별 편차 규칙이 필요한데 그건
 *    확인된 산식이 없다(`fitClassLookup` 의 `p·s·u·c` 와 같은 이유).
 *  · **표면거칠기·재질·온도**는 보지 않는다 — 실제 조립 가부는 그것들이 함께 정한다.
 */

import { itTolerance, shaftFundamentalDeviation, ISO286_MAX_MM } from './iso286.mjs';

/**
 * 형상에서 **핀-보어 짝**을 찾는다 — `assembly.mjs` 의 관통 검출과 **같은 규약**이다
 * (수직 cylinder + 홀 선언 부재, 축심 정합 0.5mm, 홀경 ≥ 핀경).
 *
 * ⚠ 규약을 여기서 다시 정하면 **형상은 관통이라 하고 판정은 짝이 없다고** 할 수 있다.
 *   숫자(0.5mm)를 그대로 쓰고 주석으로 짝을 묶어 둔다.
 * ⚠ `extrude_profile` 도 홀을 갖는다 — `plate_with_holes` 만 보면 새 어휘가 통째로 빠진다.
 */
export function findPinBorePairs(assembly) {
  const parts = (assembly?.parts ?? []).filter((q) => q.unverified !== true);
  const pins = parts.filter((q) => q.type === 'cylinder' && !(q.at?.rx || q.at?.ry || q.at?.rz));
  const hosts = parts.filter((q) => q.type === 'plate_with_holes' || q.type === 'extrude_profile');
  const out = [];
  for (const pin of pins) {
    const cx = Number(pin.at?.tx) || 0, cy = Number(pin.at?.ty) || 0;
    const dPin = Number(pin.params?.diameter);
    if (!(dPin > 0)) continue;
    for (const host of hosts) {
      const rz = ((Number(host.at?.rz) || 0) * Math.PI) / 180;
      const cR = Math.cos(rz), sR = Math.sin(rz);
      for (const h of host.params?.holes ?? []) {
        if (!(Number(h.d) >= dPin - 0.01)) continue;
        const wx = (Number(host.at?.tx) || 0) + h.x * cR - h.y * sR;
        const wy = (Number(host.at?.ty) || 0) + h.x * sR + h.y * cR;
        if (Math.hypot(wx - cx, wy - cy) >= 0.5) continue;
        out.push({
          holeId: host.id ?? host.type, pinId: pin.id ?? pin.type,
          holeFit: h.fit ?? null, pinFit: pin.params?.fit ?? pin.fit ?? null,
          nominalMm: dPin,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * 기본 `evaluateFit` — `iso286.mjs` 산식으로 직접 낸다(주입 불필요).
 * ⚠ **검증된 산식이 있는 조합만** 답한다. 그 밖은 던져서 호출측이
 *   「판정하지 않았다」로 남기게 한다(표준 이름을 달고 틀린 값이 나가는 것을 막는다).
 */
const FORMULA_FITS = {
  'H7/g6': [7, 'g', 6], 'H7/f7': [7, 'f', 7], 'H7/e8': [7, 'e', 8],
  'H7/h6': [7, 'h', 6], 'H7/k6': [7, 'k', 6], 'H7/n6': [7, 'n', 6],
};
function defaultEvaluateFit(nominalMm, name) {
  const spec = FORMULA_FITS[name];
  if (!spec) throw new Error(`${name} 은 검증된 산식이 없다 — 계산하지 않는다(표 구간 전용)`);
  if (!(nominalMm > 0) || nominalMm > ISO286_MAX_MM) {
    throw new Error(`⌀${nominalMm}mm 는 산식 적용 범위(0<d≤${ISO286_MAX_MM}) 밖이다`);
  }
  const [hg, sym, sg] = spec;
  const holeIT = itTolerance(nominalMm, hg);
  const shaftIT = itTolerance(nominalMm, sg);
  const dev = shaftFundamentalDeviation(nominalMm, sym);
  if (holeIT === null || shaftIT === null || dev === null) throw new Error('산식이 값을 내지 못했다');
  const shaftHi = dev.kind === 'es' ? dev.value : dev.value + shaftIT;
  const shaftLo = dev.kind === 'es' ? dev.value - shaftIT : dev.value;
  const hMin = nominalMm, hMax = nominalMm + holeIT / 1000;
  const sMin = nominalMm + shaftLo / 1000, sMax = nominalMm + shaftHi / 1000;
  return {
    holeDiameter: { min: hMin, max: hMax }, shaftDiameter: { min: sMin, max: sMax },
    minClearance: hMin - sMax, maxClearance: hMax - sMin,
    application: 'ISO 286 산식 기반',
  };
}

/** 홀 쪽 표기(대문자 시작) + 핀 쪽 표기(소문자 시작) → `H7/g6` 형태. */
function joinFit(holeFit, pinFit) {
  const H = String(holeFit ?? '').trim();
  const s = String(pinFit ?? '').trim();
  if (!H || !s) return null;
  if (!/^[A-Z]+\d+$/.test(H)) return null;   // 홀은 대문자 기호
  if (!/^[a-z]+\d+$/.test(s)) return null;   // 축은 소문자 기호
  return `${H}/${s}`;
}

/**
 * 끼워맞춤 판정. 짝이 없거나 공차 선언이 없으면 **null**(해당 없음 — 에러가 아니다).
 *
 * @param pairs `[{ holeId, pinId, holeFit, pinFit, nominalMm }]` — 호출측이 형상에서 찾은 짝
 * @param evaluateFit (선택) 주입 — 없으면 `iso286.mjs` 산식으로 직접 낸다.
 *   ⚠ 주입을 **필수**로 두면 배선을 잊는 순간 판정이 조용히 사라진다
 *   (이 세션에서 반복해 본 형태 ① — 있는 것이 안 닿음).
 */
export function fitCheck(pairs, evaluateFit = defaultEvaluateFit) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (!list.length) return null;
  const checks = {};
  let declared = 0;

  for (const [n, p] of list.entries()) {
    const tag = `${p.pinId} ↔ ${p.holeId}`;
    const name = joinFit(p.holeFit, p.pinFit);
    if (!name) {
      /**
       * ⚠ 한쪽만 선언된 것을 「판정 불가」로 남긴다. 나머지를 관례값(H7 등)으로 채우면
       *   그 가정 하나로 틈새·조임이 뒤집힌다 — 이 세션 내내 지킨 규약이다.
       */
      checks[`pair${n}`] = {
        labelKo: `끼워맞춤 ${tag} — 판정하지 않았다(공차 미선언)`,
        pass: null,
        needInputs: [
          ...(p.holeFit ? [] : [{ name: `holes[].fit`, labelKo: `구멍 공차 등급(예 H7) — ${p.holeId}` }]),
          ...(p.pinFit ? [] : [{ name: `parts[].fit`, labelKo: `축 공차 등급(예 g6) — ${p.pinId}` }]),
        ],
        detail: [
          `핀 ⌀${p.nominalMm}mm 가 구멍을 관통하는 것은 형상에서 확인했다.`,
          '**양쪽 공차가 모두 선언돼야** 틈새/조임을 낼 수 있다 — 한쪽을 관례값으로 채우면 '
          + '그 가정 하나로 결론이 뒤집힌다.',
        ],
      };
      continue;
    }
    declared += 1;
    let r = null, err = null;
    try { r = evaluateFit(p.nominalMm, name); } catch (e) { err = String(e?.message ?? e); }
    if (!r) {
      checks[`pair${n}`] = {
        labelKo: `끼워맞춤 ${name} ${tag} — 판정하지 않았다`,
        pass: null,
        detail: [
          err ?? '해당 조합을 계산하지 못했다.',
          '⚠ 명명 조합에 없거나 검증된 산식이 없는 등급은 **계산하지 않는다** — '
          + '표준 이름을 달고 틀린 값이 나가는 것을 막는다.',
        ],
      };
      continue;
    }
    const minC = r.minClearance * 1000, maxC = r.maxClearance * 1000;   // µm
    checks[`pair${n}`] = {
      labelKo: `끼워맞춤 ${name} — ${tag} (⌀${p.nominalMm}mm)`,
      // 합·불이 아니라 **분류**다. 어느 쪽이 옳은지는 용도가 정한다.
      verdict: 'INFO',
      detail: [
        `구멍 ⌀${r.holeDiameter.min.toFixed(4)}~${r.holeDiameter.max.toFixed(4)}mm · `
        + `축 ⌀${r.shaftDiameter.min.toFixed(4)}~${r.shaftDiameter.max.toFixed(4)}mm`,
        minC >= 0
          ? `**항상 헐겁다**(틈새 ${minC.toFixed(1)}~${maxC.toFixed(1)}µm) — ${r.application}`
          : maxC <= 0
            ? `**항상 조인다**(조임 ${(-maxC).toFixed(1)}~${(-minC).toFixed(1)}µm) — ${r.application}`
            : `**중간끼워맞춤**(조임 ${(-minC).toFixed(1)}µm ~ 틈새 ${maxC.toFixed(1)}µm) — `
              + '개체마다 헐겁거나 조일 수 있다.',
      ],
      note: 'ISO 286 산식 기반(표 반올림과 ±1µm 차 가능) · 표면거칠기·재질·온도 미반영 — 실제 조립 가부는 그것들이 함께 정한다.',
    };
  }

  return {
    ok: true,
    label: '끼워맞춤 검토 (핀·보어)',
    checks,
    basis: { pairs: list.length, declared },
    notChecked: [
      {
        labelKo: '표면거칠기·재질·온도',
        messageKo: '끼워맞춤 등급이 맞아도 **거칠기가 크면 실제 틈새가 다르고**, 열팽창이 다른 재질 조합은 '
          + '온도에서 조임이 바뀐다. 여기서는 치수 공차만 봤다.',
      },
      {
        labelKo: '압입력·유지 토크',
        messageKo: '조임 끼워맞춤의 **압입 하중·전달 가능 토크**는 재질·마찰계수가 필요하다 — 선언되지 않았다.',
      },
    ],
    refs: ['ISO 286 (표준공차등급·기본편차 — 산식 구현)'],
    disclaimer: '개념 검토(비법정) — 치수 공차만. 조립 가부는 거칠기·재질·온도가 함께 정한다.',
  };
}
