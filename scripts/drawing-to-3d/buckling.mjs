/**
 * 압축 좌굴 **사전 선별** — PBAS 0.7.3 이식 ④.
 *
 * ## 이미 있는 것과 무엇이 다른가 — 먼저 찾아봤다
 * 우리에겐 `engineering-core/calculators/column-buckling.mjs`(AISC 360 §E3)가 **이미 있다.**
 * 그건 **법정 코드 검토**다 — Fy·Ag·L·r·K·Pu 를 **사람이 다 적어 줘야** 돌아간다.
 * 이 모듈은 그 자리를 뺏지 않는다. 하는 일이 다르다:
 * ```
 *   column_buckling(기존)  코드 검토 · 입력 6개 수기 · φPn 판정      ← 최종 근거
 *   이 모듈(신규)          어셈블리 전수 선별 · 입력 0개(형상에서 유도) ← 「어디를 봐야 하나」
 * ```
 * 어셈블리에 부재가 40개면 사람이 40번 제원을 적을 수 없다. 형상(`part.params`)에서
 * 단면을 뽑고(①`section-properties`), 운동쌍 선언에서 단부 조건을 읽어(③`kinematics`)
 * **자동으로 훑는다.** 걸린 부재만 코드 계산기로 넘기면 된다.
 *
 * ## 방법 — Johnson/Euler 전이 + 국부 판좌굴
 * ```
 *   λ = KL/r · λt = √(2π²E/Fy)
 *   λ > λt : Euler    σcr = π²E/λ²
 *   λ ≤ λt : Johnson  σcr = Fy(1 − Fy·λ²/(4π²E))     ← 비탄성 포물선
 *   국부    σcr = kπ²E/(12(1−ν²)) · (t/b)²            ← 박판이 먼저 주름진다
 * ```
 * ⚠ **이건 판정이 아니라 선별이다.** 결과에 `precheck: true` 와 「법정 검토는 `column_buckling`」
 *   을 항상 싣는다. 선별을 코드 검토로 읽으면 근거 없는 설계가 나간다.
 */

import { ELASTIC } from './structural.mjs';
import { sectionOfPart } from './section-properties.mjs';

const EPS = 1e-12;
const fin = (v, d = NaN) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 단부 구속 → 유효좌굴계수 K(이론값).
 * ⚠ **이론값이지 설계값이 아니다.** 실무는 이음 강성 불완전을 보아 고정단을 0.5 대신
 *   0.65 로 올려 쓰는 경우가 많다(AISC 해설). 그래서 `source` 를 함께 낸다 —
 *   선언으로 받은 K 인지, 우리가 규칙으로 만든 K 인지 구분되어야 한다.
 */
export function effectiveLengthFactor(endA, endB) {
  const FIXED = new Set(['fixed', 'bonded', 'fastened', 'welded', 'weld', 'bolt', 'bolted', 'clamped']);
  const PIN = new Set(['pin', 'pinned', 'revolute', 'hinge', 'spherical', 'ball', 'cylindrical']);
  const a = String(endA ?? 'free').toLowerCase(), b = String(endB ?? 'free').toLowerCase();
  const f = (t) => FIXED.has(t), p = (t) => PIN.has(t);
  if (f(a) && f(b)) return { K: 0.5, ko: '양단 고정' };
  if ((f(a) && p(b)) || (p(a) && f(b))) return { K: 0.7, ko: '일단 고정·타단 핀' };
  if (p(a) && p(b)) return { K: 1.0, ko: '양단 핀' };
  if ((f(a) && b === 'free') || (a === 'free' && f(b))) return { K: 2.0, ko: '캔틸레버(일단 고정·타단 자유)' };
  /**
   * ⚠ 나머지는 **선언이 모자란 것**이다. 특히 핀-자유는 이론상 불안정(K→∞)이라 어떤
   *   유한한 K 도 맞지 않는다. 1.0 을 조용히 쓰면 「양단 핀으로 검토됨」으로 읽히므로
   *   `uncertain` 을 달아 선별 결과의 가정 목록에 드러낸다.
   */
  const unstable = (p(a) && b === 'free') || (a === 'free' && p(b)) || (a === 'free' && b === 'free');
  return { K: 1.0, uncertain: true,
    ko: unstable
      ? '단부 선언 부족 — 핀·자유 조합은 이론상 불안정(K→∞)이다. 선별용으로 1.0 을 쓸 뿐 검토가 아니다'
      : '단부 불명 — 양단 핀(1.0)으로 가정' };
}

/** `joints[]`·`connections[]` 선언에서 부재 양 끝의 구속 종류를 읽는다. */
export function endConditionsOf(partId, assembly) {
  const hits = [];
  for (const j of assembly?.joints ?? []) if ((j.between ?? []).includes(partId)) hits.push(String(j.type ?? 'fixed').toLowerCase());
  for (const c of assembly?.connections ?? []) if ((c.between ?? []).includes(partId)) hits.push(String(c.type ?? 'bonded').toLowerCase());
  if (!hits.length) return { first: 'free', second: 'free', declaredCount: 0 };
  /**
   * ⚠⚠ **구속이 하나면 반대쪽 끝은 자유다.** `hits[0]`·`hits[at-1]` 로 쓰면 길이 1 일 때
   *   **같은 구속을 양 끝에 두 번 세어** 캔틸레버가 「양단 고정」이 된다 — K 가 2.0 대신
   *   0.5 로 나와 좌굴 하중이 **16배**(K²) 커진다. 가장 위험한 부재가 가장 안전해 보인다.
   *   (원본 PBAS 도 같은 형태였다 — 이식하며 그대로 따라 썼다가 회귀에 걸렸다.)
   */
  if (hits.length === 1) return { first: hits[0], second: 'free', declaredCount: 1 };
  return { first: hits[0], second: hits[hits.length - 1], declaredCount: hits.length };
}

/**
 * ★압축 부재 하나의 좌굴 선별. 단위는 **mm·MPa·N**.
 *
 * @param {object} o `{lengthMm, section, material|E/fy/nu, compressionN, K?, endConditions?, plate?}`
 */
export function evaluateBuckling(o = {}) {
  const P = Math.max(0, fin(o.compressionN, 0));
  const L = fin(o.lengthMm);
  const sec = o.section;
  const A = fin(sec?.area);
  if (!(L > 0) || !(A > 0)) {
    return { precheck: true, status: 'pending', pass: null,
      requiredInputs: [!(L > 0) && 'lengthMm', !(A > 0) && 'section(단면적)'].filter(Boolean),
      note: '좌굴을 선별하지 않았다 — 길이나 단면을 못 얻었다. 「안전하다」가 아니다.' };
  }

  // 재료: 선언값 > 표 대표값. 표를 쓰면 assumed 로 표시한다.
  const tbl = ELASTIC[o.material] ?? null;
  const E = fin(o.E, fin(tbl?.E));
  const fy = fin(o.fy, fin(tbl?.fy));
  const nu = fin(o.nu, fin(tbl?.nu, 0.3));
  if (!(E > 0) || !(fy > 0)) {
    return { precheck: true, status: 'pending', pass: null, material: o.material ?? null,
      requiredInputs: [!(E > 0) && 'E(탄성계수 MPa)', !(fy > 0) && 'fy(항복강도 MPa)'].filter(Boolean),
      /**
       * ⚠ 회주철·콘크리트·유리·FRP 는 **일부러** fy 가 없다. 여기서 숫자를 지어내면
       *   가장 위험한 재료가 가장 안전해 보인다 — 사유를 그대로 전달한다.
       */
      ...(tbl?.noYield ? { noYield: tbl.noYield } : {}),
      note: `좌굴을 선별하지 않았다 — ${o.material ?? '재료 미선언'} 의 탄성상수를 못 얻었다`
        + `${tbl?.noYield ? `(${tbl.noYield})` : ''}. 「안전하다」가 아니다.` };
  }

  // 약축 회전반경: 주축 최소 2차모멘트 기준(강축으로 재면 좌굴을 놓친다)
  const iMin = Math.min(fin(sec.principal?.iMin, fin(sec.ix, Infinity)), fin(sec.principal?.iMax, Infinity), fin(sec.ix, Infinity), fin(sec.iy, Infinity));
  const r = Math.sqrt(Math.max(EPS, iMin) / A);
  const kSrc = fin(o.K) > 0
    ? { K: fin(o.K), ko: '선언값', source: 'declared' }
    : { ...effectiveLengthFactor(o.endConditions?.first, o.endConditions?.second), source: 'rule_derived' };
  const lambda = kSrc.K * L / Math.max(EPS, r);
  const lambdaT = Math.sqrt(2 * Math.PI ** 2 * E / Math.max(EPS, fy));
  const euler = Math.PI ** 2 * E / Math.max(EPS, lambda ** 2);
  const johnson = Math.max(0, fy * (1 - fy * lambda ** 2 / Math.max(EPS, 4 * Math.PI ** 2 * E)));
  const regime = lambda > lambdaT ? 'Euler(탄성)' : 'Johnson(비탄성)';
  const crMPa = lambda > lambdaT ? euler : Math.min(fy, johnson);
  const crN = crMPa * A;

  // 국부 판좌굴 — 박판은 기둥이 버텨도 판이 먼저 주름진다
  const t = fin(o.plate?.thicknessMm ?? o.thicknessMm);
  const b = fin(o.plate?.widthMm ?? o.plateWidthMm);
  let local = { applicable: false, note: '판 제원(두께·폭)이 없어 국부 좌굴은 **안 봤다**' };
  if (t > 0 && b > t) {
    const k = fin(o.plate?.coefficient, 4); // 4=양단 단순지지 압축판
    const lcr = k * Math.PI ** 2 * E / (12 * (1 - nu ** 2)) * (t / b) ** 2;
    const applied = P / A;
    local = { applicable: true, coefficient: k, thicknessMm: t, widthMm: b,
      criticalMPa: lcr, appliedMPa: applied,
      safetyFactor: applied > EPS ? lcr / applied : Infinity,
      note: `국부 판좌굴 σcr=kπ²E/(12(1−ν²))·(t/b)², k=${k}` };
  }

  const target = fin(o.targetSafetyFactor, 2);
  const sfColumn = P > EPS ? crN / P : Infinity;
  const sf = Math.min(sfColumn, local.applicable ? local.safetyFactor : Infinity);
  const governedBy = local.applicable && local.safetyFactor < sfColumn ? '국부 판좌굴' : '기둥 휨좌굴';
  const assumed = [];
  if (!fin(o.E) && tbl) assumed.push(`E·fy=표 대표값(${o.material})`);
  if (kSrc.source === 'rule_derived') assumed.push(`K=${kSrc.K}(${kSrc.ko}${kSrc.uncertain ? '' : ' — 단부 선언에서 유도'})`);
  if (!local.applicable) assumed.push('국부 판좌굴 미검토');

  return {
    precheck: true,
    status: P > EPS ? 'screened' : 'not-in-compression',
    pass: P > EPS ? sf >= target : null,
    compressionN: P, lengthMm: L, areaMm2: A, iMinMm4: iMin, radiusGyrationMm: r,
    effectiveLengthFactor: kSrc.K, effectiveLengthFactorSource: kSrc.source, endConditionKo: kSrc.ko,
    ...(kSrc.uncertain ? { effectiveLengthUncertain: true } : {}),
    slenderness: lambda, transitionSlenderness: lambdaT, regime,
    criticalStressMPa: crMPa, criticalLoadN: crN,
    safetyFactor: sf, columnSafetyFactor: sfColumn, targetSafetyFactor: target, governedBy,
    localPlateBuckling: local, materialAssumed: assumed,
    method: 'Johnson/Euler 전이 + 국부 판좌굴(선별)',
    /**
     * ⚠ **이 문장을 반드시 함께 낸다.** 선별을 코드 검토로 읽으면 근거 없는 설계가 나간다.
     */
    note: P > EPS
      ? `λ=${lambda.toFixed(1)}(전이 ${lambdaT.toFixed(1)}) · ${regime} · σcr ${crMPa.toFixed(1)} MPa · 안전율 ${sf === Infinity ? '∞' : sf.toFixed(2)}/${target} (지배: ${governedBy})`
        + `${assumed.length ? ` · 가정: ${assumed.join(', ')}` : ''}`
        + '. ⚠**사전 선별이다** — 법정 검토는 `column_buckling` 계산기(AISC 360 §E3)로 해야 한다.'
      : '압축을 안 받는다 — 좌굴 선별 대상이 아니다(인장·무하중).',
  };
}

/** 부재의 **압축 방향 길이** = 배치를 고려한 최장 변(기둥은 긴 쪽으로 좌굴한다). */
function longestSideMm(part) {
  const p = part?.params ?? {};
  const cands = [p.height, p.length, p.width, p.depth, p.H].map((v) => fin(v)).filter((v) => v > 0);
  return cands.length ? Math.max(...cands) : NaN;
}

/**
 * ★어셈블리 전수 선별. `axialN`(음수=압축) 또는 `compressionN` 을 **선언한 부재만** 본다.
 * ⚠ 하중을 선언 안 한 부재를 「좌굴 안 한다」로 세지 않는다 — 안 잰 것이다.
 */
export function bucklingPrecheck(assembly, opts = {}) {
  const parts = (assembly?.parts ?? []).filter((p) =>
    Number.isFinite(fin(p.compressionN)) || fin(p.axialN, 0) < 0);
  if (!parts.length) return null;
  const results = parts.map((p) => {
    const P = Number.isFinite(fin(p.compressionN)) ? fin(p.compressionN) : -fin(p.axialN, 0);
    const section = (() => { try { return sectionOfPart(p.type, p.params ?? {}); } catch { return null; } })();
    const r = evaluateBuckling({
      lengthMm: fin(p.lengthMm, longestSideMm(p)), section, compressionN: P,
      material: p.material, E: p.E, fy: p.fy, nu: p.nu, K: p.bucklingLengthFactor,
      endConditions: endConditionsOf(p.id ?? p.type, assembly),
      plate: p.plate ?? (fin(p.params?.wallThk) > 0 ? { thicknessMm: fin(p.params.wallThk), widthMm: fin(p.params.width ?? p.params.H) } : null),
      targetSafetyFactor: opts.targetSafetyFactor,
    });
    return { id: p.id ?? p.type, ...r };
  });
  const screened = results.filter((r) => r.status === 'screened');
  const flagged = screened.filter((r) => r.pass === false);
  const notScreened = results.filter((r) => r.status === 'pending');
  return {
    precheck: true, results,
    counts: { declared: results.length, screened: screened.length, flagged: flagged.length, notScreened: notScreened.length },
    flaggedIds: flagged.map((r) => r.id),
    note: `압축 선언 ${results.length}건 — 선별 ${screened.length} · ⚠주의 ${flagged.length} · 미선별 ${notScreened.length}`
      + (notScreened.length ? '(제원을 못 얻어 **안 본** 것이다 — 안전하다는 뜻이 아니다)' : '')
      + '. ⚠**사전 선별이다** — 걸린 부재는 `column_buckling` 계산기(AISC 360 §E3)로 확정해야 한다.',
  };
}
