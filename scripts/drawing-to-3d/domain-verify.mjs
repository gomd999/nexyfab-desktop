/**
 * domain-verify.mjs — 설계 형상 → 분야별 상시검증(②).
 *
 * 원칙(design-domain-ia.md §4·§5): 설계 생성(compose)은 분야 무관. 분야가 정하는 건
 * "무엇을 검증하고 무엇을 인용하는가". 여기서 형상이 줄 수 있는 입력(단면특성·경간)은
 * section-props로 **결정론 파생**하고, 형상이 못 주는 입력(하중·재료)만 사용자에게
 * 받는다. 그 둘을 합쳐 engineering-core의 **진짜 계산기**를 돌린다. 하중을 지어내지
 * 않는다 — 없으면 INPUT_GATE로 "이 값이 필요하다"를 되돌려 폼을 띄운다.
 *
 * 정직성 게이트(§7.0): 여기 실린 계산기는 전부 status='draft'(공개예제 게이트 미충족).
 * 결과에 그 status와 "비법정 참고" disclaimer를 그대로 전달한다.
 */
import { featureToMember, memberCandidates, hollowRectProps } from './section-props.mjs';
import { runCalculator, calculators } from '../engineering-core/registry.mjs';
import { getCitations } from './citations.mjs';

const round = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(n) : v);

/** 바닥 footprint 면적 m² — 가장 큰 박스의 수평 두 변 곱(폴백; 프리셋은 intent.floorAreaM2 직접 제공). */
function footprintAreaM2(intent) {
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  let best = 0;
  for (const f of feats) {
    if (f.op === 'subtract') continue;
    if (f.kind === 'box' && Array.isArray(f.size)) {
      const s = f.size.slice().sort((a, b) => b - a); // [max, mid, min]
      best = Math.max(best, s[0] * s[1]);
    }
  }
  return best > 0 ? +(best / 1e6).toFixed(2) : 0;
}

/**
 * 분야 레지스트리. 각 계산기: derive(member)=형상파생 입력, userInputs=사용자 입력 명세.
 * geom 필드는 사용자가 덮어쓸 수 없음(형상↔검증 정합 보장). derive가 못 만드는 필드만 user.
 */
export const DOMAIN_VERIFIERS = {
  'temporary-rack': {
    labelKo: '가설·랙·경량철골',
    labelEn: 'Temporary / rack / light steel',
    note: '프리즘형 부재(포스트·빔)를 형상에서 인식 → 좌굴·휨 검토. 단면특성·경간=형상 파생, 하중·재료=입력.',
    calculators: [
      {
        id: 'column_buckling',
        labelKo: '압축재 좌굴 (포스트·동바리)',
        derive: (m) => ({ Ag: round(m.section.A, 1), r: round(Math.min(m.section.rx, m.section.ry), 3), L: round(m.L, 1) }),
        userInputs: [
          { name: 'Fy', labelKo: '항복강도', unit: 'MPa', default: 235, min: 200, max: 700 },
          { name: 'Pu', labelKo: '소요축력(계수하중)', unit: 'kN', min: 0 },
          { name: 'K', labelKo: '유효좌굴계수', unit: '', default: 1.0, min: 0.5, max: 2.4, optional: true },
        ],
      },
      {
        id: 'simple_beam',
        labelKo: '단순보 휨·전단·처짐',
        derive: (m) => ({ Sx: round(m.section.Sx, 1), Ix: round(m.section.Ix, 1), Aw: round(m.section.A, 1), L: round(m.L, 1) }),
        userInputs: [
          { name: 'Fy', labelKo: '항복강도', unit: 'MPa', default: 235, min: 200, max: 700 },
          { name: 'w', labelKo: '등분포하중', unit: 'kN/m', min: 0, optional: true },
          { name: 'P', labelKo: '중앙 집중하중', unit: 'kN', min: 0, optional: true },
        ],
      },
    ],
  },
  'building-member': {
    labelKo: '건축 부재 (RC)',
    labelEn: 'Building member (RC)',
    note: '직사각 단면 b×h를 형상에서 파생 → RC 보/기둥/기초 검토. 철근량·하중=입력(설계 결정).',
    calculators: [
      {
        id: 'rc_beam',
        labelKo: 'RC 보 휨·전단',
        // 단면 폭 b=단면 x폭, 유효깊이 d=단면높이−피복(cover 입력, 기본 50)
        derive: (m, extra) => {
          const b = round(m.section.cmaxX * 2, 1);
          const h = round(m.section.cmaxY * 2, 1);
          const cover = extra?.cover ?? 50;
          return { b, d: round(h - cover, 1) };
        },
        userInputs: [
          { name: 'fck', labelKo: '콘크리트 강도', unit: 'MPa', default: 24, min: 18, max: 60 },
          { name: 'fy', labelKo: '철근 항복강도', unit: 'MPa', default: 400, min: 300, max: 600 },
          { name: 'As', labelKo: '인장철근 단면적', unit: 'mm²', min: 0 },
          { name: 'Mu', labelKo: '소요휨모멘트', unit: 'kN·m', min: 0 },
          { name: 'cover', labelKo: '피복(유효깊이 산정)', unit: 'mm', default: 50, min: 20, max: 120, optional: true, extraOnly: true },
        ],
      },
      {
        id: 'rc_column_pm',
        labelKo: 'RC 기둥 P-M 상관 (축력+휨)',
        // 단면 b×h를 형상(프리즘 단면)에서 파생. 철근·하중=입력.
        derive: (m) => ({ b: round(m.section.cmaxX * 2, 1), h: round(m.section.cmaxY * 2, 1) }),
        userInputs: [
          { name: 'fck', labelKo: '콘크리트 강도', unit: 'MPa', default: 24, min: 18, max: 90 },
          { name: 'fy', labelKo: '철근 항복강도', unit: 'MPa', default: 400, min: 300, max: 600 },
          { name: 'Ast', labelKo: '주철근 총단면적', unit: 'mm²', min: 0 },
          { name: 'Pu', labelKo: '계수축력', unit: 'kN', min: 0 },
          { name: 'Mu', labelKo: '계수휨모멘트(장주효과 반영)', unit: 'kN·m', default: 0, min: 0 },
        ],
      },
      {
        id: 'isolated_footing',
        labelKo: '독립기초 (지지력·뚫림·1방향전단)',
        // 기초 치수·하중·지반은 설계 조건 — 전부 입력 (형상 파생 없음. 하중경로 체인이 Pu·Pservice를 채워줄 수 있음)
        derive: () => ({}),
        userInputs: [
          { name: 'B', labelKo: '기초 폭', unit: 'mm', min: 0 },
          { name: 'L', labelKo: '기초 길이', unit: 'mm', min: 0 },
          { name: 't', labelKo: '기초 두께', unit: 'mm', default: 500, min: 0 },
          { name: 'd', labelKo: '유효깊이', unit: 'mm', default: 420, min: 0 },
          { name: 'cb', labelKo: '기둥 폭(B방향)', unit: 'mm', min: 0 },
          { name: 'cl', labelKo: '기둥 깊이(L방향)', unit: 'mm', min: 0 },
          { name: 'Pu', labelKo: '계수축하중', unit: 'kN', min: 0 },
          { name: 'Pservice', labelKo: '사용축하중', unit: 'kN', min: 0 },
          { name: 'qAllow', labelKo: '허용지지력', unit: 'kPa', default: 200, min: 0 },
          { name: 'fck', labelKo: '콘크리트 강도', unit: 'MPa', default: 24, min: 18, max: 90 },
        ],
      },
    ],
  },
  'civil': {
    labelKo: '토목 소구조물',
    labelEn: 'Civil small structures',
    note: '옹벽 안정(전도·활동·지지력). 옹벽 단면(H·저판·벽체)은 형상에서 자동 파생(C1), 토질·지지력만 입력.',
    calculators: [
      {
        id: 'retaining_wall_stability',
        labelKo: '옹벽 안정 (전도·활동·지지력)',
        // C1: 옹벽 프리셋 intent.retainingWall 메타(m)에서 단면 자동 파생 — 없으면 사용자 입력 폴백.
        derive: (m, extra) => {
          const rw = extra?._rw;
          if (!rw) return {};
          return { H: rw.H, stemThickness: rw.stemThickness, baseWidth: rw.baseWidth, baseThickness: rw.baseThickness, toeLength: rw.toeLength };
        },
        userInputs: [
          { name: 'H', labelKo: '벽고', unit: 'm', min: 0, max: 12 },
          { name: 'stemThickness', labelKo: '벽체 두께', unit: 'm', default: 0.3, min: 0 },
          { name: 'baseWidth', labelKo: '저판 폭', unit: 'm', min: 0 },
          { name: 'baseThickness', labelKo: '저판 두께', unit: 'm', default: 0.4, min: 0 },
          { name: 'toeLength', labelKo: '앞굽 길이', unit: 'm', default: 0.6, min: 0 },
          { name: 'gammaBackfill', labelKo: '뒤채움 단위중량', unit: 'kN/m³', default: 18, min: 10, max: 24 },
          { name: 'phiBackfill', labelKo: '내부마찰각', unit: '°', default: 30, min: 15, max: 45 },
          { name: 'baseFriction', labelKo: '기초 마찰계수', unit: '', default: 0.5, min: 0, max: 1 },
          { name: 'allowableBearing', labelKo: '허용지지력', unit: 'kPa', default: 200, min: 0 },
          { name: 'surcharge', labelKo: '상재하중', unit: 'kPa', default: 0, min: 0, optional: true },
          { name: 'seismicKh', labelKo: '수평지진계수 kh(0=정적만)', unit: '', default: 0, min: 0, max: 0.5, optional: true },
        ],
      },
      {
        id: 'box_culvert_frame',
        labelKo: '박스 암거 라멘 단면력',
        // 내공·벽두께는 형상(boxCulvert 메타)에서 파생, 토피·토압계수·상재=입력
        derive: (m, extra) => {
          const bc = extra?._bc;
          if (!bc) return {};
          return { innerWidth: bc.innerWidth, innerHeight: bc.innerHeight, wallThk: bc.wallThk };
        },
        userInputs: [
          { name: 'cover', labelKo: '토피고', unit: 'm', default: 1.0, min: 0, max: 20 },
          { name: 'gammaSoil', labelKo: '흙 단위중량', unit: 'kN/m³', default: 18, min: 10, max: 24 },
          { name: 'K', labelKo: '측방토압계수', unit: '', default: 0.5, min: 0.2, max: 1.0 },
          { name: 'surcharge', labelKo: '상재하중', unit: 'kPa', default: 0, min: 0, optional: true },
        ],
      },
    ],
  },
  'interior': {
    labelKo: '인테리어 (상업공간)',
    labelEn: 'Interior (commercial space)',
    note: '수용인원·피난 검토. 바닥면적·좌석은 형상/레이아웃에서 파생, 피난폭·출구·밀도는 용도/기준에서 입력.',
    calculators: [
      {
        id: 'occupancy_egress',
        labelKo: '수용인원·피난 (재실자·유효폭·출구)',
        // 바닥면적(m²)·좌석수는 intent(레이아웃)에서 파생.
        derive: (m, extra) => {
          const g = {};
          if (extra?._floorAreaM2 > 0) g.floorAreaM2 = extra._floorAreaM2;
          if (extra?._seatCount > 0) g.seatCount = extra._seatCount;
          return g;
        },
        userInputs: [
          { name: 'occupantDensityM2', labelKo: '인당 점유면적', unit: 'm²/인', default: 1.4, min: 0.3, max: 20 },
          { name: 'egressWidthProvidedMm', labelKo: '확보 피난폭(합)', unit: 'mm', min: 0 },
          { name: 'egressFactorMmPerOcc', labelKo: '재실자당 피난폭', unit: 'mm/인', default: 5.0, min: 1, max: 20, optional: true },
          { name: 'exitCount', labelKo: '출구 수', unit: '', default: 2, min: 1 },
          { name: 'doorClearWidthMm', labelKo: '출입문 유효폭', unit: 'mm', min: 0, optional: true },
        ],
      },
    ],
  },
  'landscape': {
    labelKo: '조경 구조·배수',
    labelEn: 'Landscape / drainage',
    note: '목재 부재(장선·보)는 단면·스팬을 형상에서 파생 → timber_beam(KDS 41 50 10). 배수는 유역·강우 조건 — 입력.',
    calculators: [
      {
        id: 'timber_beam',
        labelKo: '목재 휨부재 (장선·보 — 허용응력)',
        // 단면 b×h·스팬 L을 형상(프리즘 부재)에서 파생. 수종·등급·하중=입력.
        derive: (m) => ({ b: round(m.section.cmaxX * 2, 0), h: round(m.section.cmaxY * 2, 0), L: round(m.L, 0) }),
        userInputs: [
          { name: 'species', labelKo: '수종군(larch/pine/koreanpine/cedar)', unit: '', default: 'pine' },
          { name: 'grade', labelKo: '육안등급(1~3)', unit: '', default: 2, min: 1, max: 3 },
          { name: 'w', labelKo: '등분포하중', unit: 'kN/m', min: 0, optional: true },
          { name: 'P', labelKo: '중앙 집중하중', unit: 'kN', min: 0, optional: true },
          { name: 'deflLimit', labelKo: '처짐한계 L/n', unit: '', default: 240, min: 100, max: 500, optional: true },
        ],
      },
      {
        id: 'landscape_drainage',
        labelKo: '우수 배수 (합리식)',
        derive: () => ({}),
        userInputs: [
          { name: 'areaHa', labelKo: '유역면적', unit: 'ha', min: 0 },
          { name: 'C', labelKo: '유출계수', unit: '', min: 0, max: 1, default: 0.7 },
          { name: 'i_mmhr', labelKo: '강우강도', unit: 'mm/hr', min: 0 },
        ],
      },
    ],
  },
};

/** 페이지용: 도메인·계산기·입력 명세(형상 무관 메타). */
export function listDomains() {
  return Object.entries(DOMAIN_VERIFIERS).map(([slug, d]) => ({
    slug,
    labelKo: d.labelKo,
    labelEn: d.labelEn,
    note: d.note,
    calculators: d.calculators.map((c) => {
      const meta = calculators.find((k) => k.id === c.id);
      return {
        id: c.id,
        labelKo: c.labelKo,
        status: meta?.status ?? 'unknown',
        refs: meta?.refs ?? [],
        userInputs: c.userInputs,
      };
    }),
  }));
}

/**
 * 형상+분야+사용자입력 → 진짜 계산기 실행.
 * @param intent compose intent (features[])
 * @param domain DOMAIN_VERIFIERS 키
 * @param calculatorId 분야 내 계산기
 * @param memberRef 부재 피처 선택(id 또는 index). 없으면 첫 프리즘형 후보.
 * @param params 사용자 입력값 {name: value}
 * @param standardId 기준(기본 KDS)
 * @returns { ok, verdict?, checks?, member?, derived?, provenance?, refs?, status?, disclaimer?, needInputs?, error? }
 */
export function verifyDomain({ intent, domain, calculatorId, memberRef, params = {}, standardId = 'KDS' }) {
  const d = DOMAIN_VERIFIERS[domain];
  if (!d) return { ok: false, error: `unknown domain: ${domain} (available: ${Object.keys(DOMAIN_VERIFIERS).join(', ')})` };
  const calc = d.calculators.find((c) => c.id === calculatorId);
  if (!calc) return { ok: false, error: `unknown calculator ${calculatorId} in ${domain}` };

  // 부재 선택(형상 파생이 필요한 계산기만)
  const feats = Array.isArray(intent?.features) ? intent.features : [];
  let member = null;
  const needsMember = Object.keys(calc.derive({ section: { A: 1, Ix: 1, Sx: 1, rx: 1, ry: 1, cmaxX: 1, cmaxY: 1 }, L: 1 }, params)).length > 0;
  if (needsMember) {
    let feat = null;
    if (memberRef !== undefined && memberRef !== null) {
      feat = feats.find((f, i) => f.id === memberRef || i === memberRef || `f${i}` === memberRef) ?? null;
    }
    if (!feat) {
      // 첫 프리즘형 후보
      for (const f of feats) { if (featureToMember(f)) { feat = f; break; } }
    }
    if (!feat) return { ok: false, error: '프리즘형 부재(압출·박스·원통)를 형상에서 찾지 못했습니다. 부재를 지정하거나 부재형 설계를 사용하세요.', candidates: memberCandidates(intent) };
    member = featureToMember(feat);
    if (!member) return { ok: false, error: '선택한 피처는 프리즘형 부재가 아닙니다.', candidates: memberCandidates(intent) };
    member.id = feat.id ?? null;
    // 중공 보정: box 부재에 동심 subtract box(내부 보어)가 있으면 중공 단면으로 재계산.
    // (안 하면 각관을 솔리드로 봐 단면적·강도를 위험측으로 과대평가.)
    if (feat.kind === 'box' && Array.isArray(feat.size)) {
      const li = feat.size.indexOf(Math.max(...feat.size));
      const outerFace = feat.size.filter((_, i) => i !== li);
      const bore = feats.find((f) => f.op === 'subtract' && f.kind === 'box' && Array.isArray(f.size) && f.size.length === 3);
      if (bore) {
        const innerFace = bore.size.filter((_, i) => i !== li);
        if (innerFace[0] > 0 && innerFace[1] > 0 && innerFace[0] < outerFace[0] && innerFace[1] < outerFace[1]) {
          member.section = hollowRectProps(outerFace[0], outerFace[1], innerFace[0], innerFace[1]);
          member.note = (member.note ?? '') + ' · 중공';
        }
      }
    }
  }

  // 레이아웃/형상 스칼라(인테리어 등 부재 아닌 파생용): 바닥면적·좌석수·옹벽 단면(C1).
  const floorAreaM2 = intent?.floorAreaM2 ?? footprintAreaM2(intent);
  const seatCount = Array.isArray(intent?.furniture) ? intent.furniture.reduce((s, f) => s + (f.seats > 0 ? f.count : 0), 0) : 0;
  const geomCtx = { ...params, _floorAreaM2: floorAreaM2, _seatCount: seatCount, _rw: intent?.retainingWall ?? null, _bc: intent?.boxCulvert ?? null };

  // 형상 파생 입력: 부재형(member)이면 단면특성, 아니면 레이아웃 스칼라.
  const derived = member ? calc.derive(member, geomCtx) : calc.derive(null, geomCtx);
  // 사용자 입력(선언된 것만, geom 필드는 못 덮어씀). extraOnly 필드는 derive 인자로만 쓰이고 계산기 입력엔 안 감.
  const userVals = {};
  for (const spec of calc.userInputs) {
    if (spec.extraOnly) continue;
    let v = params[spec.name];
    if ((v === undefined || v === null) && spec.default !== undefined) v = spec.default;
    if (v !== undefined && v !== null && !(spec.name in derived)) userVals[spec.name] = v;
  }
  const input = { ...userVals, ...derived };

  try {
    const result = runCalculator(calculatorId, input, standardId);
    return {
      ok: true,
      verdict: result.verdict,
      checks: result.checks,
      seismic: result.seismic ?? null,
      moments: result.moments_kNm ?? null,
      shears: result.shears_kN ?? null,
      intermediate: result.intermediate,
      member: member ? { id: member.id, kind: member.kind, L: round(member.L, 1), note: member.note } : null,
      candidates: needsMember ? memberCandidates(intent) : [],
      derived,
      provenance: { geometry: Object.keys(derived), user: Object.keys(userVals) },
      input,
      standard: result.standard,
      standardDraft: result.standardDraft,
      status: result.status,
      refs: result.refs,
      citations: getCitations(calculatorId),
      disclaimer: result.disclaimer,
      notes: result.notes,
    };
  } catch (e) {
    // INPUT_GATE = 필수 입력 누락 → 폼 유도(하중 지어내지 않음)
    if (e.code === 'INPUT_GATE') {
      const missing = calc.userInputs.filter((s) => !s.optional && !s.extraOnly && (params[s.name] === undefined || params[s.name] === null) && s.default === undefined);
      return { ok: false, needInputs: missing, gateError: e.message, derived, member: member ? { id: member.id, kind: member.kind, L: round(member.L, 1) } : null, candidates: needsMember ? memberCandidates(intent) : [] };
    }
    return { ok: false, error: e.message };
  }
}

// --- CLI ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('domain-verify.mjs');
if (isMain) {
  const arg = process.argv[2];
  if (arg === 'list') { console.log(JSON.stringify(listDomains(), null, 2)); }
  else if (arg) {
    const spec = JSON.parse(arg);
    console.log(JSON.stringify(verifyDomain(spec), null, 2));
  } else {
    console.log('usage: node domain-verify.mjs list | \'{"intent":…,"domain":…,"calculatorId":…,"params":…}\'');
  }
}
