/**
 * 체결부 강도 검토 · 접촉 선언 — PBAS 0.7.3 이식 ②.
 *
 * ## 왜 필요한가
 * 우리는 「부재가 안 겹치나」(간섭)·「받쳐져 있나」(부유)·「움직이나」(자유도)까지 봤다.
 * 그런데 **부재를 잇는 것 자체가 버티나**는 못 봤다. 핀·볼트군·용접·베어링이 그것이다.
 * 부재는 멀쩡한데 핀이 전단으로 잘리면 설계는 실패다.
 *
 * ## 이식 범위 — SI 변환 배관은 **일부러 안 가져왔다**
 * PBAS 는 mm/MPa 입력을 m/Pa 로 바꾸는 정규화 계층이 절반을 차지한다. 우리 어휘는
 * **처음부터 mm·MPa·N·N·m 로 일관**되어 있어 그 계층을 들여오면 「두 단위계가 공존하는
 * 경로」를 새로 만드는 셈이다 — 이 세션에 단일소스 결손으로 여덟 번 틀렸다. 가져온 것은
 * **공학 판정식**뿐이다.
 *
 * ## 정직성 규약
 * ⚠ **하중 선언이 없으면 검토하지 않는다.** `pass:false` 가 아니라 `status:'pending'` 이다.
 *   안 잰 것과 「불합격」은 다르다.
 * ⚠ **일부 입력만 있으면 `conditional`** 이고 무엇이 더 필요한지 적는다. 없는 항목의
 *   안전율을 Infinity 로 두고 최솟값을 내면 「검토했는데 여유롭다」로 읽힌다.
 */

const EPS = 1e-12;
const fin = (v, d = NaN) => (Number.isFinite(Number(v)) ? Number(v) : d);
const norm3 = (v) => (Array.isArray(v) ? Math.hypot(fin(v[0], 0), fin(v[1], 0), fin(v[2], 0)) : Math.abs(fin(v, 0)));

/** 별칭 흡수 — LLM 이 `bolt`·`bolted`·`fastened` 를 섞어 쓴다. */
export function connectorType(c = {}) {
  const t = String(c.type ?? c.connectorType ?? c.jointType ?? '').toLowerCase();
  if (['pin', 'pinned', 'revolute', 'clevis'].includes(t)) return 'pin';
  if (['bolt', 'bolted', 'bolt-group', 'fastened', 'flange'].includes(t) || Array.isArray(c.bolts)) return 'bolt-group';
  if (['weld', 'welded', 'weld-group', 'fillet'].includes(t) || c.weld) return 'weld-group';
  if (['bearing', 'rolling'].includes(t) || c.bearing) return 'bearing';
  return t || 'bonded';
}

const pending = (c, type, requiredInputs) => ({
  id: c.id ?? null, between: c.between ?? null, type, status: 'pending', pass: null,
  requiredInputs,
  note: `검토하지 않았다 — ${requiredInputs.join('·')} 이(가) 없다. 「불합격」이 아니라 **안 잰 것**이다.`,
});

/** 안전율 최솟값과 **어느 항목이** 지배했는지. 값만 주면 무엇을 키워야 할지 모른다. */
function governing(sf) {
  let min = Infinity, by = null;
  for (const [k, v] of Object.entries(sf)) if (Number.isFinite(v) && v < min) { min = v; by = k; }
  return { minimumSafetyFactor: min, governedBy: by };
}

const SF_KO = {
  shear: '전단', bearing: '지압', bending: '휨', tearout: '연단 찢김', tension: '인장',
  combined: '전단·인장 조합', slip: '미끄럼(마찰이음)', plateBearing: '판 지압',
  plateTearout: '판 연단 찢김', threadStripping: '나사산 뜯김', weld: '용접 목두께', life: '수명',
};

/**
 * ★체결부 하나를 검토한다. 단위는 **mm·MPa·N·N·m**.
 *
 * @param {object} c `{id, type, between, forceN, momentNm, ...제원, ...허용응력}`
 * @param {{targetSafetyFactor?:number}} opts
 */
export function checkConnection(c = {}, opts = {}) {
  const type = connectorType(c);
  const target = fin(opts.targetSafetyFactor ?? c.targetSafetyFactor, 2);
  const force = norm3(c.forceN ?? c.transferForceN);
  const moment = norm3(c.momentNm ?? c.transferMomentNm);
  if (!Number.isFinite(force) || (!force && !moment)) {
    return pending(c, type, ['forceN 또는 momentNm(전달 하중)']);
  }
  const base = { id: c.id ?? null, between: c.between ?? null, type, forceN: force, momentNm: moment, targetSafetyFactor: target };
  const done = (fields, sf, missing) => {
    const g = governing(sf);
    const status = missing.length ? 'conditional' : 'solved';
    return {
      ...base, ...fields, safetyFactors: sf, ...g, status,
      pass: g.minimumSafetyFactor >= target,
      ...(missing.length ? { requiredForFullQualification: missing } : {}),
      note: `안전율 ${g.minimumSafetyFactor === Infinity ? '∞' : g.minimumSafetyFactor.toFixed(2)}`
        + `(지배: ${SF_KO[g.governedBy] ?? g.governedBy ?? '없음'}) / 목표 ${target}`
        + (missing.length ? ` — ⚠**부분 검토**다. ${missing.join('·')} 가 없어 그 파괴모드는 **안 봤다**(여유롭다는 뜻이 아니다).` : ''),
    };
  };

  // ── 핀 ────────────────────────────────────────────────────────────────────
  if (type === 'pin') {
    const d = fin(c.pinDiameterMm ?? c.diameterMm);
    const allowShear = fin(c.allowableShearMPa);
    if (!Number.isFinite(d) || !Number.isFinite(allowShear)) {
      return pending(c, type, ['pinDiameterMm', 'allowableShearMPa']);
    }
    const planes = Math.max(1, Math.trunc(fin(c.shearPlanes, 1)));
    const shearMPa = force / Math.max(EPS, planes * Math.PI * d ** 2 / 4);
    const t = fin(c.bearingThicknessMm ?? c.lugThicknessMm);
    const allowBearing = fin(c.allowableBearingMPa);
    const bearingMPa = Number.isFinite(t) ? force / Math.max(EPS, d * t) : null;
    // 휨: 원형 단면 σ = 32M/(πd³). M 은 N·m → N·mm 로 1000 배.
    const bendMPa = 32 * moment * 1000 / Math.max(EPS, Math.PI * d ** 3);
    const allowBend = fin(c.allowableBendingMPa, allowShear * Math.sqrt(3)); // von Mises 환산
    const edge = fin(c.edgeDistanceMm);
    const allowTear = fin(c.allowableTearoutMPa, allowBearing);
    const ligament = Number.isFinite(edge) ? Math.max(EPS, edge - d / 2) : NaN;
    const tearMPa = Number.isFinite(t) && Number.isFinite(ligament) ? force / Math.max(EPS, 2 * t * ligament) : null;
    const missing = [];
    if (!Number.isFinite(t)) missing.push('bearingThicknessMm');
    if (!Number.isFinite(allowBearing)) missing.push('allowableBearingMPa');
    if (!Number.isFinite(edge)) missing.push('edgeDistanceMm');
    return done(
      { shearMPa, bearingMPa, bendingMPa: bendMPa, tearoutMPa: tearMPa, ligamentMm: Number.isFinite(ligament) ? ligament : null, shearPlanes: planes },
      {
        shear: allowShear / Math.max(EPS, shearMPa),
        ...(bearingMPa != null && Number.isFinite(allowBearing) ? { bearing: allowBearing / Math.max(EPS, bearingMPa) } : {}),
        bending: allowBend / Math.max(EPS, bendMPa),
        ...(tearMPa != null && Number.isFinite(allowTear) ? { tearout: allowTear / Math.max(EPS, tearMPa) } : {}),
      }, missing);
  }

  // ── 볼트군 ────────────────────────────────────────────────────────────────
  if (type === 'bolt-group') {
    const bolts = Array.isArray(c.bolts) ? c.bolts : [];
    const d = fin(c.boltDiameterMm);
    const n = bolts.length || Math.max(0, Math.trunc(fin(c.boltCount, 0)));
    const allowShear = fin(c.allowableBoltShearMPa);
    if (!n || !Number.isFinite(d) || !Number.isFinite(allowShear)) {
      return pending(c, type, ['boltCount 또는 bolts[]', 'boltDiameterMm', 'allowableBoltShearMPa']);
    }
    const area = Math.PI * d ** 2 / 4;
    const direct = force / n;
    /**
     * 탄성 볼트군: 모멘트를 도심 기준 극2차모멘트로 분배한다 — 가장 먼 볼트가 지배한다.
     * ⚠ 좌표가 없으면 **모멘트 분담을 못 센다.** 0 으로 두고 넘어가면 모멘트를 받는
     *   볼트군이 「전단만 받는다」로 검토된다 — 그래서 미검토 항목으로 신고한다.
     */
    let momentShear = 0;
    const haveXY = bolts.length > 0 && bolts.every((b) => Number.isFinite(fin(b.xMm)) || Number.isFinite(fin(b.yMm)));
    if (haveXY) {
      const cx = bolts.reduce((s, b) => s + fin(b.xMm, 0), 0) / bolts.length;
      const cy = bolts.reduce((s, b) => s + fin(b.yMm, 0), 0) / bolts.length;
      const r = bolts.map((b) => Math.hypot(fin(b.xMm, 0) - cx, fin(b.yMm, 0) - cy));
      const sumR2 = r.reduce((s, v) => s + v * v, 0);
      momentShear = sumR2 > EPS ? moment * 1000 * Math.max(...r) / sumR2 : 0;
    }
    const maxShearN = direct + momentShear;
    const boltShearMPa = maxShearN / area;
    const preloadTotal = fin(c.preloadN, 0) * n;
    const mu = Math.max(0, fin(c.frictionCoefficient, 0));
    const slipCapacityN = preloadTotal * mu;
    const lever = fin(c.tensionLeverArmMm, d);
    const tensionPerBolt = Math.max(0, fin(c.externalTensionN, 0) / n
      + fin(c.pryingFactor, 1) * moment * 1000 / Math.max(EPS, n * lever));
    const boltTensionMPa = tensionPerBolt / area;
    const allowTension = fin(c.allowableBoltTensionMPa);
    const sfShear = allowShear / Math.max(EPS, boltShearMPa);
    const sfTension = Number.isFinite(allowTension) ? allowTension / Math.max(EPS, boltTensionMPa) : Infinity;
    // 전단·인장 조합: 원형 상호작용식 (V/Va)² + (T/Ta)² ≤ 1
    const inter = Math.hypot(1 / Math.max(EPS, sfShear), 1 / Math.max(EPS, sfTension));
    const sfCombined = inter > EPS ? 1 / inter : Infinity;
    const tp = fin(c.plateThicknessMm);
    const edge = fin(c.edgeDistanceMm);
    const allowPB = fin(c.allowablePlateBearingMPa);
    const allowPT = fin(c.allowablePlateTearoutMPa, allowPB);
    const plateBearingMPa = Number.isFinite(tp) ? maxShearN / Math.max(EPS, d * tp) : null;
    const ligament = Number.isFinite(edge) ? Math.max(EPS, edge - d / 2) : NaN;
    const plateTearoutMPa = Number.isFinite(tp) && Number.isFinite(ligament) ? maxShearN / Math.max(EPS, 2 * tp * ligament) : null;
    const le = fin(c.engagedThreadLengthMm);
    const allowThread = fin(c.allowableThreadShearMPa);
    const threadAreaMm2 = Number.isFinite(le) ? Math.PI * d * le * 0.5 : null; // 나사산 유효 전단면 근사
    const threadMPa = threadAreaMm2 ? tensionPerBolt / Math.max(EPS, threadAreaMm2) : null;
    const missing = [];
    if (!Number.isFinite(allowTension)) missing.push('allowableBoltTensionMPa');
    if (!Number.isFinite(tp)) missing.push('plateThicknessMm');
    if (!Number.isFinite(edge)) missing.push('edgeDistanceMm');
    if (!Number.isFinite(allowPB)) missing.push('allowablePlateBearingMPa');
    if (!Number.isFinite(le) || !Number.isFinite(allowThread)) missing.push('engagedThreadLengthMm+allowableThreadShearMPa');
    if (moment > 0 && !haveXY) missing.push('bolts[].xMm/yMm(모멘트 분담 — 없으면 전단만 본 것이다)');
    return done(
      { count: n, diameterMm: d, directShearPerBoltN: direct, momentShearPerBoltN: momentShear, maxBoltShearN: maxShearN,
        boltShearMPa, boltTensionPerBoltN: tensionPerBolt, boltTensionMPa, slipCapacityN,
        plate: { thicknessMm: Number.isFinite(tp) ? tp : null, bearingMPa: plateBearingMPa, tearoutMPa: plateTearoutMPa, ligamentMm: Number.isFinite(ligament) ? ligament : null },
        thread: { engagedLengthMm: Number.isFinite(le) ? le : null, shearAreaMm2: threadAreaMm2, shearMPa: threadMPa } },
      {
        shear: sfShear, ...(Number.isFinite(sfTension) ? { tension: sfTension, combined: sfCombined } : {}),
        ...(slipCapacityN > 0 ? { slip: slipCapacityN / Math.max(EPS, force) } : {}),
        ...(plateBearingMPa != null && Number.isFinite(allowPB) ? { plateBearing: allowPB / Math.max(EPS, plateBearingMPa) } : {}),
        ...(plateTearoutMPa != null && Number.isFinite(allowPT) ? { plateTearout: allowPT / Math.max(EPS, plateTearoutMPa) } : {}),
        ...(threadMPa != null && Number.isFinite(allowThread) ? { threadStripping: allowThread / Math.max(EPS, threadMPa) } : {}),
      }, missing);
  }

  // ── 용접군 ────────────────────────────────────────────────────────────────
  if (type === 'weld-group') {
    const w = c.weld ?? c;
    const L = fin(w.totalLengthMm ?? c.weldLengthMm);
    const a = fin(w.throatMm ?? c.weldThroatMm);
    const allow = fin(w.allowableMPa ?? c.allowableWeldMPa);
    if (![L, a, allow].every(Number.isFinite)) {
      return pending(c, type, ['weldLengthMm', 'weldThroatMm', 'allowableWeldMPa']);
    }
    const throatArea = L * a;
    const directMPa = force / Math.max(EPS, throatArea);
    /**
     * ⚠ 극2차모멘트를 **군 반경 근사**로 쓴다(Ip ≈ A·r²). 실제 배치가 주어지면 틀린다 —
     *   그래서 반경을 결과에 실어 보내 무엇을 가정했는지 보이게 한다.
     */
    const rDefault = Math.max(a, L / (2 * Math.PI));
    const r = fin(w.groupRadiusMm ?? c.weldGroupRadiusMm, rDefault);
    const momentMPa = moment * 1000 * r / Math.max(EPS, throatArea * r ** 2);
    const eqMPa = Math.hypot(directMPa, momentMPa);
    const assumedRadius = !Number.isFinite(fin(w.groupRadiusMm ?? c.weldGroupRadiusMm));
    return done(
      { throatAreaMm2: throatArea, directMPa, momentMPa, equivalentMPa: eqMPa, groupRadiusMm: r,
        torsionMethod: `극2차모멘트 군반경 근사 Ip≈A·r²${assumedRadius ? '(반경 미선언 — 추정값)' : ''}` },
      { weld: allow / Math.max(EPS, eqMPa) },
      assumedRadius && moment > 0 ? ['weldGroupRadiusMm(모멘트 항이 추정 반경에 걸려 있다)'] : []);
  }

  // ── 베어링 수명 ───────────────────────────────────────────────────────────
  if (type === 'bearing') {
    const b = c.bearing ?? c;
    const C = fin(b.dynamicLoadRatingN ?? c.dynamicLoadRatingN);
    const rpm = fin(b.speedRpm ?? c.speedRpm);
    if (![C, rpm].every(Number.isFinite)) return pending(c, type, ['dynamicLoadRatingN', 'speedRpm']);
    // ISO 281: L10 = (C/P)^p 백만회전. 볼 p=3 · 롤러 p=10/3.
    const p = String(b.elementType ?? 'ball').includes('roller') ? 10 / 3 : 3;
    const P = Math.max(EPS, force);
    const l10Mrev = (C / P) ** p;
    const lifeHours = rpm > EPS ? l10Mrev * 1e6 / (rpm * 60) : Infinity;
    const required = fin(b.requiredLifeHours ?? c.requiredLifeHours);
    /**
     * ⚠⚠ **수명비에 응력 안전율을 걸지 않는다.** 다른 개념이다 — 응력 안전율 2 는
     *   「허용응력의 절반만 쓴다」이고, 수명비 2 는 「요구수명의 두 배를 산다」다.
     *   L10 자체가 이미 신뢰도 90%를 품고 있어 이중으로 깎게 된다. 실측: 수명 2083h /
     *   요구 2000h 인 정상 설계가 **응력 목표 2.0 에 걸려 불합격**으로 나왔다.
     *   목표를 따로 두고(`targetLifeRatio`, 기본 1) 그 사실을 note 에 적는다.
     */
    const targetLife = fin(b.targetLifeRatio ?? c.targetLifeRatio, 1);
    const ratio = Number.isFinite(required) ? lifeHours / Math.max(EPS, required) : null;
    const fields = {
      elementType: b.elementType ?? 'ball', exponent: p, equivalentLoadN: P, l10Mrev, l10Hours: lifeHours,
      requiredLifeHours: Number.isFinite(required) ? required : null, lifeRatio: ratio, targetLifeRatio: targetLife,
      method: 'ISO 281 L10 (기본 정격수명 — 윤활·오염·신뢰도 보정 a₁a₂a₃ 미적용)',
    };
    if (ratio == null) {
      return { ...base, ...fields, status: 'pending', pass: null,
        requiredInputs: ['requiredLifeHours(없으면 수명 판정을 못 한다)'],
        note: `L10 = ${l10Mrev.toFixed(1)} Mrev = ${lifeHours.toFixed(0)} h. 요구수명이 없어 **판정하지 않았다**.` };
    }
    return { ...base, ...fields, status: 'solved', pass: ratio >= targetLife,
      minimumSafetyFactor: ratio, governedBy: 'life', safetyFactors: { life: ratio },
      note: `L10 ${lifeHours.toFixed(0)} h / 요구 ${required} h = 수명비 ${ratio.toFixed(2)} (목표 ${targetLife})`
        + '. ⚠수명비는 **응력 안전율과 다른 개념**이라 목표값을 따로 둔다 — L10 이 이미 신뢰도 90%를 품고 있다.' };
  }

  // ── 그 밖(bonded 등) — 검토식이 없다고 **통과시키지 않는다** ────────────────
  return {
    ...base, status: 'unsupported', pass: null,
    note: `'${type}' 는 강도 검토식이 없다 — pin·bolt-group·weld-group·bearing 만 검토한다. `
      + '통과도 불합격도 아니다(안 본 것이다).',
  };
}

/** 어셈블리의 `connections[]` 전체 검토 + 요약. 선언이 없으면 **null**(안 잰 것과 0 은 다르다). */
export function analyzeConnections(assembly, opts = {}) {
  const list = assembly?.connections;
  if (!Array.isArray(list) || !list.length) return null;
  const checks = list.map((c) => checkConnection(c, opts));
  const solved = checks.filter((k) => k.status === 'solved');
  const conditional = checks.filter((k) => k.status === 'conditional');
  const notChecked = checks.filter((k) => k.status === 'pending' || k.status === 'unsupported');
  const failed = checks.filter((k) => k.pass === false);
  return {
    checks,
    counts: { total: checks.length, solved: solved.length, conditional: conditional.length, notChecked: notChecked.length, failed: failed.length },
    /**
     * ⚠ **`allPass` 는 「검토한 것 중」이다.** 미검토를 성공으로 세면 제원을 안 적을수록
     *   통과율이 올라간다 — 정확히 거꾸로다. 그래서 미검토 개수를 항상 함께 낸다.
     */
    allPass: failed.length === 0 && (solved.length + conditional.length) > 0,
    note: `체결부 ${checks.length}건 — 완전검토 ${solved.length} · 부분검토 ${conditional.length} · 미검토 ${notChecked.length} · 불합격 ${failed.length}`
      + (notChecked.length ? '. ⚠미검토는 통과가 아니다 — 제원을 안 적으면 검토가 안 될 뿐이다.' : ''),
  };
}

/** 접촉 선언 정규화. `kind` 는 판정이 아니라 **선언**이다 — 배치가 우연히 닿았다고 붙이지 않는다. */
export const CONTACT_KINDS = {
  bonded: { ko: '접합(용접·접착 — 상대 변위 없음)', separates: false, slides: false },
  sliding: { ko: '미끄럼(마찰 접촉 — 법선만 전달)', separates: false, slides: true },
  unilateral: { ko: '편측(눌리면 받고 당기면 떨어진다)', separates: true, slides: true },
  'interference-fit': { ko: '억지 끼워맞춤(설계상 과盈 — 겹침이 정상)', separates: false, slides: false },
};

export function declaredContacts(assembly) {
  const list = assembly?.contacts;
  if (!Array.isArray(list) || !list.length) return null;
  const cards = [], errors = [];
  for (const [i, c] of list.entries()) {
    const kind = String(c?.kind ?? 'bonded').toLowerCase();
    const spec = CONTACT_KINDS[kind];
    if (!spec) { errors.push(`contacts[${i}]: 알 수 없는 접촉 '${kind}' — ${Object.keys(CONTACT_KINDS).join('·')}`); continue; }
    const [a, b] = c.between ?? [];
    if (!a || !b || a === b) { errors.push(`contacts[${i}]: between:[A,B] 가 필요하고 서로 달라야 한다`); continue; }
    cards.push({
      between: [a, b], kind, ko: spec.ko, ...spec,
      frictionCoefficient: Math.max(0, fin(c.mu ?? c.frictionCoefficient, 0)),
      initialGapMm: fin(c.gapMm ?? c.initialGapMm, 0),
      ...(Number.isFinite(fin(c.interferenceMm)) ? { interferenceMm: fin(c.interferenceMm) } : {}),
      ...(Number.isFinite(fin(c.normalStiffnessNPerMm)) ? { normalStiffnessNPerMm: fin(c.normalStiffnessNPerMm) } : {}),
    });
  }
  return { contacts: cards, errors,
    note: `접촉 선언 ${cards.length}건. ⚠선언이지 판정이 아니다 — 배치가 우연히 닿는다고 접촉으로 세지 않는다.` };
}
