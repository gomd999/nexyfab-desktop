/**
 * mech-check.mjs — 기계 분야 안전·정합 검토 (260728).
 *
 * ## 왜 이제야
 * 5개 분야 실측 평가에서 드러났다: **mech 만 도메인 판정이 하나도 없었다.**
 * `runDomainSafetyCheck` 는 interior/landscape/bridge/building 을 맡고 civil 은
 * `verificationReportHtml`(옹벽·암거 KDS)이 맡는데, mech 은 **어느 쪽에도 걸리지 않았다** —
 * 260723 A-7 이 civil 에서 잡았던 "어느 쪽으로도 도달 못 함"과 구조가 같다. 템플릿이 16종으로
 * 가장 많은 분야인데 안전 소스가 `structural`(자중 강체 전도)과 FEA(웹 전용)뿐이었다.
 *
 * ## 무엇을 검사하는가 — 그리고 무엇을 **검사하지 않는가**
 * 이 레포의 원칙은 하나다: **입력을 지어내지 않는다.** 그래서 메타가 실제로 들고 있는
 * 값만으로 판정 가능한 것만 판정하고, 지배 입력이 없으면 **정직 거부**한다.
 *
 *  판정한다 (선언값만으로 결정론적):
 *   · 기어열 중심거리 — a = m(z₁+z₂)/2. 어긋나면 **기어가 물리지 않는다.** 순수 기하라
 *     가정이 하나도 없다. 이 레포의 expectedVolume 과 같은 종류의 자기정합 검사다.
 *   · 열교환기 튜브 피치 — TEMA 관례상 pitch ≥ 1.25 × 튜브 외경(튜브시트 리가먼트 확보).
 *   · 로봇 도달거리 — 선언 reach 는 링크 길이 합을 **넘을 수 없다**(기구학 상한).
 *     각도 규약을 모르고도 성립하는 불가능성 검사라 추측이 들어가지 않는다.
 *
 *  거부한다 (지배 입력 부재 — 값을 지어내면 그게 곧 날조):
 *   · 압력용기 최소 두께 — 설계압력 P·재질 허용응력 S 가 있어야 한다.
 *   · 탱크/사일로 — 내용물 밀도·설계 수두가 있어야 한다.
 *   · 타워크레인 전도 — 카운터웨이트 질량·정격하중이 있어야 한다.
 *
 * ⚠ **비법정.** 여기 판정은 제작 전 자기점검이고, 인허가·기술사 날인 영역을 대신하지 않는다.
 * 적용 가능한 검사가 하나도 없으면 `null` 을 돌려준다 — "검증 없음"과 "검증했는데 통과"는
 * 다른 말이고, 그 구별을 호출자에게 넘긴다(domainSafetyVerdict 가 null 을 그대로 존중한다).
 */


/** 선언값의 **자릿수 그대로** 대조한다 — 반올림 표기를 불일치로 잡지 않기 위해. */
function eqAtDeclaredPrecision(declared, computed) {
  const d = String(declared);
  const dec = d.includes('.') ? d.split('.')[1].length : 0;
  return Number(computed.toFixed(dec)) === Number(declared);
}

/**
 * 선언 수량 ↔ 실제 부품 수 (형상과 수량표 중 하나가 틀렸다면 여기서 걸린다).
 *
 * ⚠ **선언 수량의 단위가 부품과 같을 때만** 쓸 수 있다. 실측으로 걸렀다:
 * conveyor `legs:5` 는 다리 **벤트 조 수**이고 부품은 leg_N_1·leg_N_2·legtie_N 15개다 —
 * 부품을 세어 비교했더니 5 vs 15 오탐이 났다. 단위가 다른 선언에는 붙이지 않는다.
 */
function declaredCount(assembly, labelKo, declared, matcher) {
  const n = Number(declared);
  if (!Number.isFinite(n) || n <= 0 || !assembly?.parts) return null;
  const actual = assembly.parts.filter(matcher).length;
  return {
    labelKo, pass: actual === n,
    detail: [`선언 ${n} vs 실제 부품 ${actual}`],
    note: '어긋나면 수량표와 형상 중 하나가 틀렸다 — 순수 계수',
  };
}

/** 정직 거부: 지배 입력이 없어 판정 자체가 불가능한 경우. */
function needInputs(label, inputs) {
  return { ok: false, label, needInputs: inputs };
}

/** 기어열 — 중심거리 정합(결정론) + 언더컷(가정 명시 INFO). */
function checkGear(m) {
  const teeth = Array.isArray(m.teeth) ? m.teeth : null;
  const mod = Number(m.module);
  const declared = Array.isArray(m.centerDistances) ? m.centerDistances : null;
  if (!teeth || teeth.length < 2 || !Number.isFinite(mod) || mod <= 0) {
    return needInputs('기어열 검토', [{ name: 'module/teeth', labelKo: '모듈·잇수 배열' }]);
  }
  const checks = {};
  if (declared) {
    // 인접 쌍마다 a = m(z1+z2)/2. 선언과 어긋나면 그 쌍은 물리지 않는다.
    const bad = [];
    for (let i = 0; i + 1 < teeth.length && i < declared.length; i++) {
      const theo = (mod * (teeth[i] + teeth[i + 1])) / 2;
      const got = Number(declared[i]);
      if (!Number.isFinite(got) || Math.abs(got - theo) > 1e-6) {
        bad.push(`쌍#${i + 1} z=${teeth[i]}·${teeth[i + 1]} → 이론 ${theo} vs 선언 ${got}`);
      }
    }
    checks.centerDistance = {
      labelKo: '기어 중심거리 정합(a = m(z₁+z₂)/2)',
      pass: bad.length === 0,
      detail: bad,
      note: '어긋나면 기어가 맞물리지 않는다 — 순수 기하, 가정 없음',
    };
  }
  // 피치원 지름 자기정합: d = m·z (정의식). 선언 pitchDias 가 있으면 대조한다.
  if (Array.isArray(m.pitchDias) && m.pitchDias.length === teeth.length) {
    const bad = [];
    for (let i = 0; i < teeth.length; i++) {
      const want = mod * teeth[i];
      if (Math.abs(Number(m.pitchDias[i]) - want) > 1e-9) bad.push(`#${i + 1}: 선언 ${m.pitchDias[i]} vs m·z ${want}`);
    }
    checks.pitchDia = {
      labelKo: '피치원 지름 = 모듈 × 잇수 (d = m·z)',
      pass: bad.length === 0, detail: bad,
      note: '정의식이라 가정이 없다 — 어긋나면 도면과 제원표 중 하나가 틀렸다',
    };
  }
  // 총 감속비 자기정합: 인접 쌍 비의 연쇄곱.
  if (Number.isFinite(Number(m.totalRatio)) && teeth.length >= 2) {
    const computed = teeth.slice(1).reduce((r, z, i) => r * (z / teeth[i]), 1);
    checks.totalRatio = {
      labelKo: '총 감속비 = 잇수비 연쇄곱',
      pass: eqAtDeclaredPrecision(m.totalRatio, computed),
      detail: [`선언 ${m.totalRatio} vs 계산 ${+computed.toFixed(6)}`],
    };
    if (Number.isFinite(Number(m.outputPer1000rpm))) {
      checks.outputRpm = {
        labelKo: '출력 회전수(입력 1000rpm) = 1000 ÷ 감속비',
        pass: eqAtDeclaredPrecision(m.outputPer1000rpm, 1000 / computed),
        detail: [`선언 ${m.outputPer1000rpm} vs 계산 ${+(1000 / computed).toFixed(3)}`],
      };
    }
  }
  // 언더컷: 표준 인벌류트에서 압력각에 따라 최소 잇수가 정해진다. **압력각이 선언돼 있지
  // 않으므로 판정하지 않고 산출값만 적는다** — 20° 를 가정해 합·불을 내면 그게 날조다.
  const minZ = Math.min(...teeth);
  /**
   * ⚠ 260802: 여기가 「참고」로만 남아 있었는데 **needInputs 를 안 달아** 사용자가
   *   무엇을 주면 되는지 알 방법이 없었다(요구 수집기에도 안 잡힌다).
   *
   * 그리고 이것은 **표가 아니라 수식**이다 — 표준 전위 없는 인벌류트 랙 절삭에서
   * 언더컷 한계는 `z_min = 2·ha* / sin²α` 이고, 표준 이높이 계수 `ha* = 1` 이면
   * `z_min = 2 / sin²α` 다. α=20° → 17.10 → **17**, α=14.5° → 32.02 → **32**
   * (흔히 인용되는 두 값이 여기서 나온다). 표 인용이 아니라 유도라 출처 확보 없이 계산한다.
   * 전위(profile shift)가 있으면 한계가 낮아지므로 **선언되면 판정을 보류**한다.
   */
  const alphaDeg = Number(m.pressureAngleDeg ?? m.pressureAngle);
  const hasShift = m.profileShift != null || m.profileShifts != null;
  if (alphaDeg > 0 && alphaDeg < 90 && !hasShift) {
    const sinA = Math.sin((alphaDeg * Math.PI) / 180);
    const zMin = Math.ceil(2 / (sinA * sinA));
    checks.undercutInfo = {
      labelKo: `최소 잇수(언더컷) — 압력각 ${alphaDeg}°`,
      pass: minZ >= zMin,
      detail: [
        `가장 작은 기어 ${minZ}잇 · 언더컷 한계 ${zMin}잇 (z_min = 2/sin²α = 2/sin²${alphaDeg}° = ${(2 / (sinA * sinA)).toFixed(2)})`,
        '표준 이높이(ha*=1)·전위 없음 기준의 **유도식**이다 — 표를 인용한 값이 아니다.',
        /**
         * ⚠ 통상 인용되는 값은 **반올림**한 것이다 — 20° 는 17.10 → 17, 14.5° 는 31.90 → 32.
         *   여기서는 **올림**을 쓴다: 한계가 17.10잇이면 17잇은 미달이라 미세 언더컷이 난다
         *   (실무는 허용하기도 한다). 그래서 20° 에서만 교과서보다 한 잇 보수적이다(18).
         *   14.5° 는 올림·반올림이 같아 32로 일치한다.
         */
        `⚠ 통상 인용값은 반올림이다(20°→17 · 14.5°→32). 여기서는 ${(2 / (sinA * sinA)).toFixed(2)} 를 **올림**해 ${zMin}잇을 쓴다 — 20°에서만 한 잇 보수적이다.`,
        ...(minZ >= zMin ? [] : ['**언더컷이 발생한다** — 잇수를 늘리거나 전위를 주어야 한다.']),
      ],
      note: '전위(profile shift)를 주면 한계가 낮아진다 — 선언되면 이 판정은 적용되지 않는다.',
    };
  } else {
    checks.undercutInfo = {
      labelKo: '최소 잇수(언더컷) — 판정하지 않았다',
      pass: null,
      // ⚠ 경로를 정확히 적는다. `pressureAngleDeg` 라고만 쓰면 부품 params 에 넣어도 안 먹는다 —
      //   읽는 곳은 `assembly.gearMeta` 다(오늘 fit 에서 겪은 것과 같은 형태).
      needInputs: [{ name: 'gearMeta.pressureAngleDeg', labelKo: '압력각(도) — 예 20 또는 14.5. 이것만 주면 언더컷 한계를 **유도식으로** 계산한다' }],
      detail: [
        `가장 작은 기어 ${minZ}잇.`,
        hasShift
          ? '전위(profile shift)가 선언돼 있어 표준 언더컷 한계가 그대로 적용되지 않는다 — 판정하지 않는다.'
          : '압력각이 선언돼 있지 않다. 20° 를 가정해 합·불을 내면 그게 날조다.',
      ],
    };
  }
  return { ok: true, label: '기어열 검토 (중심거리·잇수)', checks };
}

/** 열교환기 — TEMA 튜브 피치 하한. */
function checkHeatExchanger(m) {
  const pitch = Number(m.tubePitch);
  const od = Number(m.tubeOD);
  if (!Number.isFinite(pitch) || !Number.isFinite(od) || pitch <= 0 || od <= 0) {
    return needInputs('열교환기 검토', [{ name: 'tubePitch/tubeOD', labelKo: '튜브 피치·외경' }]);
  }
  const ratio = pitch / od;
  const extra = {};
  if (Number(m.shellOD) > 0 && Number(m.shellID) > 0) {
    extra.shell = {
      labelKo: '동체 외경 > 내경 (판 두께가 양수)',
      pass: Number(m.shellOD) > Number(m.shellID),
      detail: [`외경 ${m.shellOD} vs 내경 ${m.shellID} → 두께 ${(Number(m.shellOD) - Number(m.shellID)) / 2}`],
      note: '어기면 형상이 성립하지 않는다',
    };
  }
  if (Number(m.baffles) > 0 && Number(m.tubeLen) > 0) {
    const spacing = Math.round(Number(m.tubeLen) / (Number(m.baffles) + 1));
    const lo = Number(m.baffleSpacingMinMm), hi = Number(m.baffleSpacingMaxMm);
    const hasCrit = lo > 0 || hi > 0;
    extra.baffleInfo = hasCrit
      ? {
        labelKo: '배플 간격',
        pass: (!(lo > 0) || spacing >= lo) && (!(hi > 0) || spacing <= hi),
        detail: [
          `튜브길이 ${m.tubeLen} ÷ (배플 ${m.baffles}+1) = ${spacing}mm`,
          `선언 기준: ${lo > 0 ? `최소 ${lo}mm` : '최소 미선언'} · ${hi > 0 ? `최대 ${hi}mm` : '최대 미선언'}`,
        ],
        note: '기준은 **선언받은 값**이다 — TEMA 표를 인용한 것이 아니다.',
      }
      : {
        labelKo: '배플 간격 — 판정하지 않았다(기준 미선언)', pass: null,
        // ⚠ 260802: 여기가 「참고」로만 있었고 요구를 안 했다. 기준을 지어내지 않되,
        //   **무엇을 주면 판정되는지는 말해야 한다.**
        needInputs: [
          { name: 'hxMeta.baffleSpacingMinMm', labelKo: '배플 간격 하한(mm) — TEMA 권장은 동체경·유량이 정한다' },
          { name: 'hxMeta.baffleSpacingMaxMm', labelKo: '배플 간격 상한(mm)' },
        ],
        detail: [`튜브길이 ${m.tubeLen} ÷ (배플 ${m.baffles}+1) = ${spacing}mm (산출값).`,
          '허용 범위를 선언하면 그 기준으로 판정한다 — 우리가 정하면 근거가 우리 추측이 된다.'],
      };
  }
  return {
    ok: true,
    label: '열교환기 검토 (튜브 배열·동체)',
    checks: {
      ...extra,
      tubePitch: {
        labelKo: '튜브 피치 ≥ 1.25 × 외경 (TEMA 리가먼트)',
        pass: ratio >= 1.25 - 1e-9,
        detail: [`피치 ${pitch} / 외경 ${od} = ${ratio.toFixed(3)} (하한 1.25)`],
        note: '튜브시트 리가먼트 확보 — 미달 시 시트 강도·확관 작업성 문제',
      },
    },
  };
}

/** 로봇 암 — 선언 도달거리의 기구학 상한(불가능성 검사). */
function checkRobot(m) {
  const links = [m.upperArmLen, m.forearmLen].map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const reach = Number(m.reach);
  if (links.length < 2 || !Number.isFinite(reach)) {
    return needInputs('로봇 암 검토', [{ name: 'upperArmLen/forearmLen/reach', labelKo: '링크 길이·도달거리' }]);
  }
  const max = links.reduce((a, v) => a + v, 0);
  return {
    ok: true,
    label: '로봇 암 검토 (도달거리)',
    checks: {
      reachBound: {
        labelKo: '도달거리 ≤ 링크 길이 합 (기구학 상한)',
        pass: reach <= max + 1e-6,
        detail: [`선언 ${reach} vs 링크 합 ${max}`],
        note: '각도 규약과 무관하게 성립하는 상한 — 넘으면 물리적으로 불가능한 사양이다',
      },
    },
  };
}

/**
 * 4절 링크 — 조립 가능성(하드) + 선언 Grashof 자기정합(하드) + 전달각(INFO).
 *
 * 260729 확장. 전수 실측에서 mech 16종 중 10종이 `mechCheck` 미적용이었다. 그중
 * **선언값만으로 결정되는** 것들을 채운다 — 값을 지어내야 하는 것은 여전히 거부한다.
 */
function checkFourBar(m) {
  const L = [m.ground, m.crank, m.coupler, m.rocker].map(Number);
  if (L.some((v) => !Number.isFinite(v) || v <= 0)) {
    return needInputs('4절 링크 검토', [{ name: 'ground/crank/coupler/rocker', labelKo: '4개 링크 길이' }]);
  }
  const checks = {};
  const sorted = [...L].sort((a, b) => a - b);
  const [s, p, q, l] = sorted;
  // ① 조립 가능성: 가장 긴 링크가 나머지 셋의 합을 넘으면 루프가 닫히지 않는다.
  //    삼각부등식의 4변 확장 — 순수 기하라 가정이 하나도 없다.
  const others = sorted.slice(0, 3).reduce((a, v) => a + v, 0);
  checks.closable = {
    labelKo: '루프 폐합 가능(최장 링크 ≤ 나머지 3개 합)',
    pass: l <= others + 1e-9,
    detail: [`최장 ${l} vs 나머지 합 ${others}`],
    note: '넘으면 4절이 조립되지 않는다 — 물리적으로 불가능한 치수',
  };
  // ② 선언 Grashof 자기정합: s + l ≤ p + q 가 Grashof 조건이다. 템플릿이 grashof 를
  //    **선언**하므로 재계산해 대조한다 — 기어 중심거리 검사와 같은 종류의 자기정합.
  if (typeof m.grashof === 'boolean') {
    const computed = s + l <= p + q + 1e-9;
    checks.grashofConsistency = {
      labelKo: 'Grashof 조건 자기정합 (s+l ≤ p+q)',
      pass: computed === m.grashof,
      detail: [`s+l = ${+(s + l).toFixed(3)} · p+q = ${+(p + q).toFixed(3)} → 계산 ${computed} vs 선언 ${m.grashof}`],
      note: '어긋나면 선언과 치수 중 하나가 틀렸다 — 회전 가능 여부가 뒤바뀐다',
    };
  }
  // ③ 전달각: 작을수록 구동이 나빠지지만 **허용 하한은 용도마다 다르다**(관례 40~50°).
  //    합·불을 정하면 그게 근거 없는 임계가 되므로 산출값만 적는다.
  if (Number.isFinite(Number(m.transmissionDeg))) {
    const minDeg = Number(m.transmissionAngleMinDeg);
    checks.transmissionInfo = minDeg > 0
      ? {
        labelKo: `전달각 — 선언 하한 ${minDeg}°`,
        pass: Number(m.transmissionDeg) >= minDeg,
        detail: [`전달각 ${m.transmissionDeg}° · 선언 하한 ${minDeg}°`],
        note: '하한은 **선언받은 값**이다 — 관례값(40~50°)을 우리가 고른 것이 아니다.',
      }
      : {
        labelKo: '전달각 — 판정하지 않았다(하한 미선언)',
        pass: null,
        needInputs: [{ name: 'fourBarMeta.transmissionAngleMinDeg', labelKo: '전달각 하한(도) — 용도·하중이 정한다(관례 40~50°)' }],
        detail: [`전달각 ${m.transmissionDeg}° (산출값).`,
          '하한을 선언하면 그 기준으로 판정한다. 관례값을 우리가 고르면 근거 없는 임계가 된다.'],
      };
  }
  return { ok: true, label: '4절 링크 검토 (조립성·Grashof)', checks };
}

/** 선언 치수 사이의 하드 기하 관계 — 어기면 형상 자체가 성립하지 않는다. */
function dimensionOrderCheck(label, rows) {
  const bad = rows.filter((r) => !(Number(r.big) > Number(r.small)));
  return {
    ok: true, label,
    checks: {
      dimensionOrder: {
        labelKo: rows.map((r) => r.labelKo).join(' · '),
        pass: bad.length === 0,
        detail: rows.map((r) => `${r.labelKo}: ${r.big} vs ${r.small}`),
        note: '어기면 형상이 성립하지 않는다 — 순수 기하, 가정 없음',
      },
    },
  };
}

/** 등간격 배치 자기정합 — n개를 pitch 간격으로 놓으면 (n-1)×pitch 가 전장 안에 들어가야 한다. */
function spanCheck(label, { count, pitch, span, countKo, pitchKo, spanKo }) {
  const n = Number(count), p = Number(pitch), s = Number(span);
  if (![n, p, s].every((v) => Number.isFinite(v) && v > 0) || n < 2) return null;
  const need = (n - 1) * p;
  return {
    ok: true, label,
    checks: {
      span: {
        labelKo: `배치 자기정합 ((${countKo}−1) × ${pitchKo} ≤ ${spanKo})`,
        pass: need <= s + 1e-9,
        detail: [`(${n}−1) × ${p} = ${need} vs 전장 ${s}`],
        note: '넘으면 선언한 개수가 선언한 전장 안에 들어가지 않는다 — 치수 자기모순',
      },
    },
  };
}

/**
 * 기계 어셈블리 검토. 적용 가능한 검사가 없으면 **null**(에러가 아니다).
 * @param {object} assembly
 * @returns {{ok:boolean,label:string,checks?:object,needInputs?:object[]}|null}
 */

import { structuralCheck } from './structural.mjs';
import { fitCheck, findPinBorePairs } from './fit-check.mjs';
import { toleranceStackCheck } from './tolerance-stack.mjs';
import { boltedPlateCheck } from './bolted-plate-check.mjs';

/**
 * 정적 전도 검토 (260729b, P1-5) — **중력만** 쓴다.
 *
 * `structuralCheck` 는 `tipover`(무게중심 ↔ 지지 다각형)를 이미 계산하는데 **기계 판정에
 * 한 번도 들어가지 않았다.** 실측: conveyor 지진 FS 0.81 · tower_crane 0.05 인데
 * 안전 판정에는 아무것도 안 나왔다 — 있는 계산이 소비자 판정에 안 닿는 자리(§6-G ⑤).
 *
 * ⚠ **지진 전도는 판정하지 않는다.** `structuralCheck` 의 `seismicG` 기본값 0.5 는
 * 지역·지반이 정하는 값을 코드가 채운 **가정**이다. 그 위에 합·불을 얹으면 지어낸 값에
 * 선 판정이 된다(이 세션에서 반복해 잡아낸 형태 ③). 선언되면 판정하고, 아니면 요구한다.
 *
 * 정적 전도는 다르다 — 중력과 형상만으로 결정되므로 가정이 없다.
 */
function tipoverCheck(assembly, params = {}) {
  let st = null;
  // ⚠ 이 catch 가 **import 누락(ReferenceError)을 조용히 삼켜** 전도 검토가 통째로
  //   사라진 채 「해당 없음」으로 보였다(260729b 실측 — 이 세션 주제 그대로다).
  //   실패는 삼키지 말고 이유를 남긴다.
  try { st = structuralCheck(assembly, params.seismicG > 0 ? { seismicG: Number(params.seismicG) } : {}); }
  catch (e) {
    return {
      staticTipover: {
        labelKo: '정적 전도', pass: null,
        detail: [`질량·지지 산출 실패로 전도를 판정하지 못했다: ${String(e?.message ?? e).slice(0, 90)}`],
      },
    };
  }
  const t = st?.tipover;
  if (!t || typeof t !== 'object') return null;
  const out = {};
  const ang = Number(t.staticAngleDeg), edge = Number(t.edgeDistMm);
  // `edgeDistMm` 은 밖으로 나가도 0 으로 잘린다 — 「정확히 경계」와 「크게 벗어남」이
  // 같은 값이 된다. 지지점과 CG 로 **얼마나** 벗어났는지 직접 낸다(형상·질량만 쓴다).
  let outside = null;
  const sup = Array.isArray(st?.supports) ? st.supports.map((x) => x.pos).filter(Array.isArray) : [];
  const cg = Array.isArray(st?.cgWorldMm) ? st.cgWorldMm : null;
  if (sup.length >= 2 && cg) {
    const xs = sup.map((q) => q[0]), ys = sup.map((q) => q[1]);
    const dx = Math.max(Math.min(...xs) - cg[0], cg[0] - Math.max(...xs), 0);
    const dy = Math.max(Math.min(...ys) - cg[1], cg[1] - Math.max(...ys), 0);
    if (dx > 0 || dy > 0) outside = { dx: +dx.toFixed(1), dy: +dy.toFixed(1) };
  }
  if (Number.isFinite(ang) && Number.isFinite(edge)) {
    // 무게중심이 지지 다각형 안에 있어야 스스로 서 있다. edgeDist>0 = 안쪽.
    out.staticTipover = {
      labelKo: '정적 전도 — 무게중심이 지지 범위 안에 있는가',
      pass: edge > 0,
      detail: [
        `무게중심에서 지지 가장자리까지 ${edge.toFixed(1)}mm · 전도 개시 경사 ${ang.toFixed(1)}°`,
        `지지 기준: ${String(t.supportBasis ?? '접지 부품 footprint')}`,
        ...(edge > 0 ? [] : [
          outside
            ? `**무게중심이 지지 범위를 ${[outside.dx ? `X ${outside.dx}mm` : '', outside.dy ? `Y ${outside.dy}mm` : ''].filter(Boolean).join(' · ')} 벗어났다 — 고정하지 않으면 넘어진다.**`
            : '**무게중심이 지지 범위 경계에 있거나 벗어났다 — 고정하지 않으면 넘어진다.**',
          '⚠ 로봇 암·링크 기구처럼 **바닥에 앵커로 고정하는 장비**라면 이 검토는 해당하지 않는다 '
          + '— 고정 여부는 형상에 없으므로 여기서는 자립을 기준으로 본다.',
        ]),
      ],
      note: '중력·형상만으로 결정 — 가정 없음. 앵커·볼트 고정은 반영하지 않았다(고정하면 이 검토는 무의미).',
    };
  } else {
    out.staticTipover = {
      labelKo: '정적 전도', pass: null,
      detail: ['지지점을 잡지 못해 전도를 판정하지 못했다 — 접지 부품이 없거나 지지 다각형이 퇴화했다.'],
    };
  }
  // 지진 전도: 선언이 있을 때만 판정한다.
  if (Number(params.seismicG) > 0) {
    const fs = Number(t.seismicFS);
    out.seismicTipover = {
      labelKo: `지진 전도 (선언 ${params.seismicG}g)`,
      pass: Number.isFinite(fs) ? fs >= 1.0 : null,
      detail: [Number.isFinite(fs) ? `전도 안전율 FS = ${fs.toFixed(2)} (1.0 이상 필요)` : '산출 불가'],
    };
  } else {
    out.seismicTipover = {
      labelKo: '지진 전도', pass: null,
      needInputs: [{ name: 'seismicG', labelKo: '설계 지반가속도(g) — 지역·지반이 정하는 값이라 형상에서 알 수 없다' }],
      detail: ['지진 전도는 **판정하지 않았다.** 지반가속도를 지어내면 그 위에 선 판정이 전부 근거를 잃는다.'],
    };
  }
  return out;
}

/** 기존 결과에 전도 검토를 덧붙인다(결과가 없으면 전도만으로 결과를 만든다). */
function withTipover(result, assembly, params) {
  const tip = tipoverCheck(assembly, params);
  if (!tip) return result;
  // ⚠ 적용 가능한 검사가 하나도 없으면(=null) **전도만으로 결과를 만들지 않는다.**
  //   배관 부속(flanged_fitting)처럼 배관에 매달리는 것에 「자립 전도」는 무의미하고,
  //   「검증 없음」과 「검증했는데 통과」의 구별도 무너진다 — 기존 계약이 이걸 잡았다.
  if (!result) return null;
  return { ...result, checks: { ...(result.checks ?? {}), ...tip } };
}

export function mechCheck(assembly, params = {}) {
  if (!assembly || typeof assembly !== 'object') return null;
  // 전도는 **모든 기계 어셈블리**에 해당한다 — 메타 유무와 무관하게 붙인다.
  return withStack(withFit(withBolted(withTipover(mechCheckInner(assembly), assembly, params), assembly, params), assembly, params), assembly);
}

/**
 * 볼트 접합 판재 검토를 붙인다 (260801b).
 *
 * ⚠ 전도와 **같은 규약**이다 — 메타 유무와 무관하게 붙인다. 특정 메타 분기 안에만 넣으면
 *   `gusset_bracket`·`motor_mount` 처럼 메타가 없는 판재 부품이 통째로 빠진다
 *   (실측: 두 템플릿이 **실판정 0** 이었고 `gusset_bracket` 은 안전검토.html 도 안 나왔다).
 * ⚠ `mechCheckInner` 가 null 이어도 **볼트 검토만으로 결과를 세운다** — 「적용 가능한 검토가
 *   없다」와 「검토가 있는데 문서가 안 나온다」는 다른 말이다.
 */
/**
 * 끼워맞춤 검토를 붙인다 (260801f) — 전도·볼트와 **같은 규약**(메타 무관, 형상에서 찾는다).
 *
 * ⚠ 처음엔 `evaluateFit` 을 **주입**받게 짰다. 그러면 소비부가 배선을 잊는 순간 판정이
 *   조용히 사라진다 — 이 세션에서 반복해 잡은 형태 ① 를 내가 다시 만드는 것이었다.
 *   `fit-check` 가 `iso286.mjs` 산식으로 **직접** 낸다(주입은 선택).
 */
/**
 * 공차 누적 검토를 붙인다 (260801j) — 끼워맞춤·볼트와 **같은 규약**(없으면 그대로 통과).
 *
 * ⚠ `tolChains` 선언이 없으면 `toleranceStackCheck` 가 **null**(해당 없음)을 낸다.
 *   그걸 「이상 없음」으로 바꿔 적지 않는다 — 체인은 설계 의도라 형상에서 추정할 수 없다.
 */
function withStack(r, assembly) {
  let st = null;
  try { st = toleranceStackCheck(assembly); } catch { st = null; }
  if (!st) return r;
  if (!r) return st;
  return {
    ...r,
    checks: { ...(r.checks ?? {}), toleranceStack: st },
    ...(Array.isArray(r.notChecked) || Array.isArray(st.notChecked)
      ? { notChecked: [...(r.notChecked ?? []), ...(st.notChecked ?? [])] } : {}),
  };
}

function withFit(r, assembly, params) {
  void params;
  let pairs = [];
  try { pairs = findPinBorePairs(assembly); } catch { pairs = []; }
  if (!pairs.length) return r;
  let f = null;
  try { f = fitCheck(pairs); } catch { f = null; }
  if (!f) return r;
  if (!r) return f;
  return {
    ...r,
    checks: { ...(r.checks ?? {}), fit: f },
    ...(Array.isArray(r.notChecked) || Array.isArray(f.notChecked)
      ? { notChecked: [...(r.notChecked ?? []), ...(f.notChecked ?? [])] } : {}),
  };
}


function withBolted(r, assembly, params) {
  let b = null;
  try { b = boltedPlateCheck(assembly, params); } catch { b = null; }
  if (!b) return r;
  if (!r) return b;
  return {
    ...r,
    checks: { ...(r.checks ?? {}), boltedPlate: b },
    ...(Array.isArray(r.notChecked) || Array.isArray(b.notChecked)
      ? { notChecked: [...(r.notChecked ?? []), ...(b.notChecked ?? [])] } : {}),
  };
}

/**
 * Turbojet concept geometry can be judged without inventing CFD or material
 * allowables. These checks prove the deterministic CAD contract only: declared
 * rotor rows exist as blade meshes, the annular flow stations are physically
 * ordered, and the module chain is coaxial. Performance, combustion and
 * certification remain explicit non-claims in `notChecked`.
 */
function checkJetEngine(assembly) {
  const meta = assembly.jetEngineMeta;
  if (!meta || !Array.isArray(assembly.parts)) return null;
  const compressorRows = assembly.parts.filter((part) => /^compressor_rotor_\d+$/.test(String(part.id ?? '')));
  const turbineRows = assembly.parts.filter((part) => /^turbine_rotor_\d+$/.test(String(part.id ?? '')));
  const bladeRows = [...compressorRows, ...turbineRows];
  const flowPath = Array.isArray(meta.flowPath) ? meta.flowPath : [];
  const axialIds = ['inlet_cowl', 'compressor_casing', 'combustor_casing', 'turbine_casing', 'exhaust_nozzle'];
  const axialModules = axialIds.map((id) => assembly.parts.find((part) => part.id === id));
  const checks = {
    declaredRotorRows: {
      labelKo: '선언 압축기·터빈 단수와 실제 블레이드 링 수 일치',
      pass: compressorRows.length === Number(meta.compressorStages)
        && turbineRows.length === Number(meta.turbineStages),
      detail: [
        `compressor ${compressorRows.length}/${meta.compressorStages}`,
        `turbine ${turbineRows.length}/${meta.turbineStages}`,
      ],
    },
    bladeMeshGeometry: {
      labelKo: '모든 회전자 행이 실제 블레이드 메시 형상 보유',
      pass: bladeRows.length > 0 && bladeRows.every((part) =>
        part.type === 'mesh'
        && part.gen?.kind === 'blade_ring'
        && Array.isArray(part.params?.verts)
        && part.params.verts.length > 0
        && Array.isArray(part.params?.faces)
        && part.params.faces.length > 0),
      detail: [`blade-ring meshes ${bladeRows.length}`],
    },
    annularFlowPath: {
      labelKo: '유로 스테이션의 외경·허브경·환형 면적 자기정합',
      pass: flowPath.length >= 4 && flowPath.every((station) => {
        const outer = Number(station.outerDiaMm);
        const inner = Number(station.hubDiaMm ?? station.innerDiaMm);
        const declaredArea = Number(station.annulusAreaMm2);
        const computedArea = Math.PI * (outer ** 2 - inner ** 2) / 4;
        return outer > inner && inner >= 0 && declaredArea > 0
          && Math.abs(declaredArea - computedArea) <= Math.max(0.2, computedArea * 1e-5);
      }),
      detail: [`flow stations ${flowPath.length}`],
    },
    axialModuleChain: {
      labelKo: '흡입구→압축기→연소기→터빈→노즐 축방향 모듈 연속성',
      pass: axialModules.every(Boolean)
        && axialModules.every((part) => Math.abs(Math.abs(Number(part?.at?.ry ?? 0)) - 90) < 1e-9)
        && axialModules.every((part, index) => index === 0 || Number(part?.at?.tx) >= Number(axialModules[index - 1]?.at?.tx)),
      detail: axialModules.map((part, index) => `${axialIds[index]}@x=${part?.at?.tx ?? 'missing'}`),
    },
    analysisBoundaryDeclared: {
      labelKo: '개념 CAD와 미검증 해석·인증 범위 명시',
      pass: meta.analysisLevel === 'preliminary-1D-geometry'
        && Array.isArray(meta.notVerified)
        && ['CFD pressure/temperature field', 'combustion stability', 'blade stress/creep', 'rotordynamics', 'containment', 'airworthiness']
          .every((claim) => meta.notVerified.includes(claim)),
      detail: Array.isArray(meta.notVerified) ? meta.notVerified : [],
    },
  };
  return {
    ok: Object.values(checks).every((check) => check.pass),
    label: '터보제트 개념 CAD 형상·유로 자기정합 검토',
    checks,
    notChecked: (meta.notVerified ?? []).map((claim) => ({
      labelKo: String(claim),
      messageKo: '개념 형상 검토 범위 밖이며 실제 해석·시험·전문가 승인이 필요합니다.',
    })),
  };
}

function mechCheckInner(assembly) {
  if (assembly.jetEngineMeta) return checkJetEngine(assembly);
  if (assembly.gearMeta) return checkGear(assembly.gearMeta);
  if (assembly.hxMeta) return checkHeatExchanger(assembly.hxMeta);
  if (assembly.robotMeta) return checkRobot(assembly.robotMeta);
  if (assembly.fourBarMeta) return checkFourBar(assembly.fourBarMeta);
  if (assembly.propellerMeta) {
    const m = assembly.propellerMeta;
    const r = dimensionOrderCheck('프로펠러 검토 (허브·외경)', [
      { labelKo: '외경 > 허브경', big: m.diameter, small: m.hubDia },
    ]);
    // 선언 날 수 ↔ 실제 날 부품 수.
    const c = declaredCount(assembly, '날 수 = 실제 블레이드 부품 수', m.blades,
      (p) => /blade/i.test(String(p.id ?? '')) || String(p.role ?? '') === 'blade');
    if (c) r.checks.bladeCount = c;
    if (Number(m.pitch) > 0 && Number(m.diameter) > 0) {
      const pd = Number(m.pitch) / Number(m.diameter);
      const pdLo = Number(m.pdRatioMin), pdHi = Number(m.pdRatioMax);
      r.checks.pdInfo = (pdLo > 0 || pdHi > 0)
        ? {
          labelKo: '피치비 P/D',
          pass: (!(pdLo > 0) || pd >= pdLo) && (!(pdHi > 0) || pd <= pdHi),
          detail: [
            `피치 ${m.pitch} / 외경 ${m.diameter} = ${pd.toFixed(3)}`,
            `선언 범위: ${pdLo > 0 ? pdLo : '하한 미선언'} ~ ${pdHi > 0 ? pdHi : '상한 미선언'}`,
          ],
          note: '범위는 **선언받은 값**이다 — 용도별 관례를 우리가 고른 것이 아니다.',
        }
        : {
          labelKo: '피치비 P/D — 판정하지 않았다(범위 미선언)', pass: null,
          needInputs: [
            { name: 'propellerMeta.pdRatioMin', labelKo: 'P/D 하한 — 용도(추진·환기·교반)와 회전수가 정한다' },
            { name: 'propellerMeta.pdRatioMax', labelKo: 'P/D 상한' },
          ],
          detail: [`피치 ${m.pitch} / 외경 ${m.diameter} = ${pd.toFixed(3)} (산출값).`,
            '허용 범위를 선언하면 그 기준으로 판정한다.'],
        };
    }
    return r;
  }
  if (assembly.pumpMeta) {
    const m = assembly.pumpMeta;
    const r = dimensionOrderCheck('펌프 검토 (볼류트·노즐 기하)', [
      { labelKo: '볼류트경 > 흡입경', big: m.voluteDia, small: m.suctionDia },
      { labelKo: '볼류트경 > 토출경', big: m.voluteDia, small: m.dischargeDia },
    ]);
    // 축 높이는 볼류트 반경 이상이어야 볼류트가 바닥에 닿지 않는다 — 순수 기하.
    if (Number(m.axisH) > 0 && Number(m.voluteDia) > 0) {
      r.checks.axisClearance = {
        labelKo: '축 높이 ≥ 볼류트 반경 (볼류트가 바닥에 닿지 않음)',
        pass: Number(m.axisH) >= Number(m.voluteDia) / 2,
        detail: [`축 높이 ${m.axisH} vs 볼류트 반경 ${Number(m.voluteDia) / 2}`],
        note: '미달이면 볼류트가 베이스면을 파고든다 — 형상이 성립하지 않는다',
      };
    }
    return r;
  }
  if (assembly.valveMeta) {
    const m = assembly.valveMeta;
    return dimensionOrderCheck('밸브 검토 (몸통·보어)', [
      { labelKo: '몸통 외경 > 호칭경(보어)', big: m.bodyDia, small: m.dn },
    ]);
  }
  /**
   * 데스크 거치대 검토 (260803) — **형상이 답을 갖고 있는 것만** 판정한다.
   *
   * ⚠ 이 제품의 핵심 공학 문제는 **힌지 마찰 토크**와 **슬라이더 클램프 유지력**인데
   *   계산기가 없다(`friction_clamp` 후속). **그걸 여기서 지어내지 않는다** —
   *   대신 하중 없이도 형상만으로 판정되는 것을 낸다. 「없다」와 「해당 없다」를 구별한다.
   * ⚠ 전도 안정은 `structural.mjs` 가 이미 tipover 로 계산한다 — 중복하지 않는다
   *   (`civil` 분기가 전도·활동을 중복하지 않은 선례와 같다).
   */
  if (assembly.standMeta) {
    const m = assembly.standMeta;
    const [baseW, baseD] = m.baseMm ?? [];
    const [plateW, plateD] = m.plateMm ?? [];
    const [ventW, ventD] = m.ventMm ?? [];
    const r = dimensionOrderCheck('거치대 검토 (지지면·개구)', [
      // 받침판이 베이스보다 크면 편심이 커진다 — 전도 여유를 형상 단계에서 본다.
      { labelKo: '받침판 폭 오버행 ≤ 베이스 폭의 30%', big: baseW * 1.3, small: plateW },
      { labelKo: '받침판 깊이 오버행 ≤ 베이스 깊이의 30%', big: baseD * 1.3, small: plateD },
      // 통풍구가 받침판을 먹어 들어가면 노트북 지지면이 남지 않는다.
      { labelKo: '통풍구 폭 < 받침판 폭', big: plateW, small: ventW },
      { labelKo: '통풍구 깊이 < 받침판 깊이', big: plateD, small: ventD },
    ]);
    if (r) {
      // 요구사항 충족 — 형상에서 직접 센다(선언을 믿지 않는다).
      const lips = (assembly.parts ?? []).filter((p) => String(p.role ?? '') === 'stop');
      const front = lips.filter((p) => Number(p.at?.ty ?? 0) < 0);
      r.checks.frontLip = {
        labelKo: '전면 걸림턱 (경사면에서 노트북은 앞으로 미끄러진다)',
        요구: '≥1개, 받침판 전면(−Y)', 실제: `${front.length}개 / 걸림턱 총 ${lips.length}개`,
        ok: front.length >= 1 && front.length === lips.length,
        note: '뒤쪽에만 있으면 기능이 반대다 — 미끄럼 방향과 맞아야 한다',
      };
      const hinges = (assembly.parts ?? []).filter((p) => /hinge_.*_pin$/.test(String(p.id ?? '')));
      r.checks.hingeCount = {
        labelKo: '힌지축 2조 (높이 조절 + 각도 조절)',
        요구: 2, 실제: hinges.length, ok: hinges.length >= 2,
      };
      const adj = new Set((assembly.parts ?? []).map((p) => String(p.id ?? '')));
      const need = m.heightAdjustParts ?? [];
      r.checks.heightAdjust = {
        labelKo: '높이 조절 기구 (지지대·슬라이더·노브)',
        요구: need.join(', '), 실제: need.filter((k) => adj.has(k)).join(', ') || '없음',
        ok: need.length > 0 && need.every((k) => adj.has(k)),
      };
      /**
       * ★260803 — `friction_clamp` 계산기가 생겼다. 그런데 **여기서 자동으로 돌리지 않는다.**
       * μ(마찰계수)·K(토크계수)는 **시험값**이라 기본값을 끼워 넣으면 결과가 시험 근거를
       * 잃는다(계산기 자신도 미입력이면 판정을 거부한다). 그래서 「계산기가 없다」가 아니라
       * **「입력이 없다」**로 바뀐 것을 정확히 적고, 어느 계산기로 가면 되는지 지목한다.
       */
      r.needInputs = [
        { field: 'mu', labelKo: '마찰계수 μ (시험값)', calculator: 'friction_clamp',
          note: '힌지 각도 유지 판정에 필요 — friction_clamp(mode:hinge)로 계산' },
        { field: 'torqueCoefK', labelKo: '토크계수 K (시험값)', calculator: 'friction_clamp',
          note: '조임토크→축력 환산에 필요. 축력을 직접 알면 불요' },
        { field: 'demandTorqueNm', labelKo: '소요 유지 토크', calculator: 'friction_clamp',
          note: '노트북 무게×편심으로 정해지는 값 — 사용 조건 입력' },
      ];
    }
    return r;
  }
  if (assembly.conveyorMeta) {
    const m = assembly.conveyorMeta;
    const r = spanCheck('컨베이어 검토 (롤러 배치)', {
      count: m.rollers, pitch: m.rollerPitch, span: m.length,
      countKo: '롤러 수', pitchKo: '롤러 피치', spanKo: '전장',
    });
    if (r) {
      const c = declaredCount(assembly, '롤러 수 = 실제 롤러 부품 수', m.rollers,
        (p) => /roller/i.test(String(p.id ?? '')) || String(p.role ?? '') === 'roller');
      if (c) r.checks.rollerCount = c;
      // ⚠ `legs` 는 **다리 벤트 조 수**이지 부품 수가 아니다(실측: legs=5 인데 부품은
      // leg_N_1·leg_N_2·legtie_N 15개). 선언 수량의 **단위가 부품과 다를 수 있다** —
      // 부품을 세어 비교하면 오탐이 된다. 명명 규칙(leg_N_*)을 읽어 조 수를 역산할 수도
      // 있지만 그건 규칙을 가정하는 것이라 하지 않는다. 다리 수는 검사하지 않는다.
    }
    return r;
  }
  if (assembly.machineLineMeta) {
    const m = assembly.machineLineMeta;
    const r = spanCheck('생산라인 검토 (스테이션 배치)', {
      count: m.stations, pitch: m.stationPitch, span: m.length,
      countKo: '스테이션 수', pitchKo: '스테이션 피치', spanKo: '전장',
    });
    if (r) {
      const c = declaredCount(assembly, '스테이션 수 = 실제 스테이션 부품 수', m.stations,
        (p) => /station|stn/i.test(String(p.id ?? '')) || String(p.role ?? '') === 'station');
      if (c) r.checks.stationCount = c;
    }
    return r;
  }
  // 지배 입력이 없어 원리상 판정 불가한 것들 — 통과로 둔갑시키지 않고 무엇이 필요한지 말한다.
  // 지배 입력이 없어 원리상 판정 불가한 것들 — 통과로 둔갑시키지 않고 무엇이 필요한지 말한다.
  if (assembly.vesselMeta) {
    return needInputs('압력용기 검토', [
      { name: 'designPressureMPa', labelKo: '설계압력(MPa)' },
      { name: 'allowableStressMPa', labelKo: '재질 허용응력(MPa)' },
    ]);
  }
  if (assembly.tankMeta) {
    return needInputs('탱크·사일로 검토', [
      { name: 'contentDensityKgM3', labelKo: '내용물 밀도(kg/m³)' },
      { name: 'designHeadM', labelKo: '설계 수두(m)' },
    ]);
  }
  if (assembly.craneMeta) {
    return needInputs('타워크레인 전도 검토', [
      { name: 'counterweightKg', labelKo: '카운터웨이트 질량(kg)' },
      { name: 'ratedLoadKg', labelKo: '정격하중(kg)' },
    ]);
  }
  if (assembly.moldMeta) {
    // 금형은 빼기 구배가 지배한다 — 구배 0 이면 이형 자체가 불가하다. 그런데 선언이 없다.
    // 블록 치수만으로 구배·살두께를 추정하면 그게 날조다.
    return needInputs('금형 이형성 검토', [
      { name: 'draftDeg', labelKo: '빼기 구배(°) — 0 이면 이형 불가' },
      { name: 'minWallMm', labelKo: '최소 살두께(mm)' },
    ]);
  }
  if (assembly.bucketMeta) {
    return needInputs('버킷 검토', [
      { name: 'breakoutForceKN', labelKo: '굴착력(kN)' },
      { name: 'materialDensityKgM3', labelKo: '굴착 대상 밀도(kg/m³)' },
    ]);
  }
  if (assembly.towerMeta) {
    // 자중 전도는 structural 이 이미 본다. 송전탑을 지배하는 것은 풍하중·전선 장력인데
    // 둘 다 선언돼 있지 않다 — 자중만 보고 "안전"이라 하면 지배 하중을 빠뜨린 판정이 된다.
    return needInputs('송전탑 검토 (풍하중·전선 장력)', [
      { name: 'basicWindSpeedMs', labelKo: '기본 설계풍속(m/s)' },
      { name: 'conductorTensionKN', labelKo: '전선 장력(kN)' },
    ]);
  }
  /**
   * ★260802 — **플랜지 짝 정합.** 메타가 없는 어셈블리는 여기까지 흘러와 `null` 이 됐고,
   * 5도메인 54템플릿 중 `flanged_fitting` 하나만 **소비자 문서에 아무것도 안 닿았다**
   * (형태 ① — 계산은커녕 검토 자체가 없었다).
   *
   * 그런데 **형상이 답을 갖고 있다**: 플랜지 두 장이 볼트로 맞물리려면 `bcd`·`boltCount`
   * ·`boltHoleD` 가 같아야 하고, 보어는 관 외경보다 커야 한다. 안 맞으면 **실제로 조립이
   * 안 된다** — 하중이 없어도 판정할 수 있는 항목이다.
   *
   * ⚠ 압력·개스킷·볼트 등급은 **보지 않는다**(선언되지 않았다). 치수 정합만이다.
   */
  const flanges = (assembly.parts ?? []).filter((p) => p.type === 'flange' && p.unverified !== true);
  if (flanges.length >= 2) return checkFlangePair(assembly, flanges);
  return null; // 적용 가능한 검토 없음 — mech 이라도 모든 어셈블리가 대상은 아니다
}

/** 두 플랜지가 서로 맞물리는가 + 보어가 관을 받는가. 전부 형상 파생. */
function checkFlangePair(assembly, flanges) {
  const [a, b] = flanges;
  const pa = a.params ?? {}, pb = b.params ?? {};
  const checks = {};
  const eq = (x, y) => Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && Math.abs(Number(x) - Number(y)) < 1e-6;

  checks.boltPattern = {
    labelKo: `플랜지 볼트 배치 정합 — ${a.id} ↔ ${b.id}`,
    pass: eq(pa.bcd, pb.bcd) && eq(pa.boltCount, pb.boltCount) && eq(pa.boltHoleD, pb.boltHoleD),
    detail: [
      `B.C.D. ${pa.bcd} ↔ ${pb.bcd} · 볼트수 ${pa.boltCount} ↔ ${pb.boltCount} · 볼트홀 ⌀${pa.boltHoleD} ↔ ⌀${pb.boltHoleD}`,
      eq(pa.bcd, pb.bcd) && eq(pa.boltCount, pb.boltCount) && eq(pa.boltHoleD, pb.boltHoleD)
        ? '세 값이 모두 일치한다 — 볼트가 들어간다.'
        : '**하나라도 다르면 볼트가 들어가지 않는다.** 같은 규격의 짝을 쓰거나 어댑터가 필요하다.',
    ],
    note: '치수 정합만 본다 — 압력 등급(PN·Class)·개스킷·볼트 강도는 선언되지 않아 미검토.',
  };

  /**
   * 보어 ↔ 관 외경. 관이 보어보다 크면 **끼워지지 않는다.**
   * ⚠ 관이 없으면 이 검토는 **해당 없음**이다 — 「이상 없음」으로 적지 않는다.
   */
  const pipe = (assembly.parts ?? []).find((p) => p.type === 'pipe_elbow' || p.type === 'tube' || p.type === 'pipe_tee');
  const od = Number(pipe?.params?.od ?? pipe?.params?.outerDia);
  if (pipe && od > 0) {
    const bore = Math.min(Number(pa.boreDia), Number(pb.boreDia));
    checks.borePipe = {
      labelKo: `플랜지 보어 ⌀${bore} ↔ 관 외경 ⌀${od}`,
      pass: bore >= od,
      detail: [
        bore >= od
          ? `여유 ${(bore - od).toFixed(1)}mm — 관이 보어를 통과한다.`
          : `**관이 보어보다 ${(od - bore).toFixed(1)}mm 크다** — 끼워지지 않는다.`,
      ],
      note: '용접·삽입식 구분과 삽입 깊이는 선언되지 않아 미검토.',
    };
  }

  return {
    ok: true,
    label: '플랜지 접합 검토 (배치 정합·보어)',
    checks,
    basis: { flanges: flanges.length, pipe: pipe?.id ?? null },
    notChecked: [
      {
        labelKo: '압력 등급·개스킷·볼트 강도',
        messageKo: '**압력·유체·온도가 선언되지 않아** 등급(PN·Class)과 개스킷·볼트 강도를 판정할 수 없다. '
          + '치수가 맞아도 **압력을 못 견디면 무의미하다.**',
      },
      {
        labelKo: '관 두께·용접부',
        messageKo: '내압에 대한 관 두께와 용접부 건전성은 미검토(설계압 미선언).',
      },
    ],
    refs: ['치수 정합(형상 파생) — 압력 등급 기준은 미적용'],
    disclaimer: '개념 검토(비법정) — 치수 정합만. 압력 배관은 관련 코드(KS B 1503 등) 검토가 별도로 필요하다.',
  };
}
