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
  // 언더컷: 표준 인벌류트에서 압력각에 따라 최소 잇수가 정해진다. **압력각이 선언돼 있지
  // 않으므로 판정하지 않고 산출값만 적는다** — 20° 를 가정해 합·불을 내면 그게 날조다.
  const minZ = Math.min(...teeth);
  checks.undercutInfo = {
    labelKo: '최소 잇수(언더컷 참고)',
    pass: null,
    detail: [`최소 잇수 ${minZ} — 압력각 20° 표준이면 17 이상 권장, 14.5° 면 32 이상. ` +
      `이 어셈블리엔 압력각이 선언돼 있지 않아 합·불을 판정하지 않는다(산출값만).`],
  };
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
  return {
    ok: true,
    label: '열교환기 검토 (튜브 배열)',
    checks: {
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
    checks.transmissionInfo = {
      labelKo: '전달각(참고)',
      pass: null,
      detail: [`${m.transmissionDeg}° — 관례상 40~50° 이상을 권장하나 허용 하한은 용도·하중에 따라 다르다. `
        + '이 어셈블리엔 용도가 선언돼 있지 않아 합·불을 판정하지 않는다(산출값만).'],
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
export function mechCheck(assembly) {
  if (!assembly || typeof assembly !== 'object') return null;
  if (assembly.gearMeta) return checkGear(assembly.gearMeta);
  if (assembly.hxMeta) return checkHeatExchanger(assembly.hxMeta);
  if (assembly.robotMeta) return checkRobot(assembly.robotMeta);
  if (assembly.fourBarMeta) return checkFourBar(assembly.fourBarMeta);
  if (assembly.propellerMeta) {
    const m = assembly.propellerMeta;
    return dimensionOrderCheck('프로펠러 검토 (허브·외경)', [
      { labelKo: '외경 > 허브경', big: m.diameter, small: m.hubDia },
    ]);
  }
  if (assembly.pumpMeta) {
    const m = assembly.pumpMeta;
    return dimensionOrderCheck('펌프 검토 (볼류트·노즐 기하)', [
      { labelKo: '볼류트경 > 흡입경', big: m.voluteDia, small: m.suctionDia },
      { labelKo: '볼류트경 > 토출경', big: m.voluteDia, small: m.dischargeDia },
    ]);
  }
  if (assembly.valveMeta) {
    const m = assembly.valveMeta;
    return dimensionOrderCheck('밸브 검토 (몸통·보어)', [
      { labelKo: '몸통 외경 > 호칭경(보어)', big: m.bodyDia, small: m.dn },
    ]);
  }
  if (assembly.conveyorMeta) {
    const m = assembly.conveyorMeta;
    return spanCheck('컨베이어 검토 (롤러 배치)', {
      count: m.rollers, pitch: m.rollerPitch, span: m.length,
      countKo: '롤러 수', pitchKo: '롤러 피치', spanKo: '전장',
    });
  }
  if (assembly.machineLineMeta) {
    const m = assembly.machineLineMeta;
    return spanCheck('생산라인 검토 (스테이션 배치)', {
      count: m.stations, pitch: m.stationPitch, span: m.length,
      countKo: '스테이션 수', pitchKo: '스테이션 피치', spanKo: '전장',
    });
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
  return null; // 적용 가능한 검토 없음 — mech 이라도 모든 어셈블리가 대상은 아니다
}
