/**
 * gdt-import.mjs — STEP AP242 시맨틱 PMI(GD&T) 추출(코퍼스 R2-①, 260719).
 *
 * NIST MBE PMI 검증 모델(참고파일들/NIST-PMI) 실측 스키마 기반 — 결정론 텍스트 파스:
 *   치수  : DIMENSIONAL_SIZE/LOCATION ← DIMENSIONAL_CHARACTERISTIC_REPRESENTATION → LENGTH_MEASURE
 *   ±공차 : PLUS_MINUS_TOLERANCE → TOLERANCE_VALUE(lower,upper)
 *   기하공차: *_TOLERANCE(FLATNESS/POSITION/PERPENDICULARITY…) → magnitude + DATUM_SYSTEM
 *            → DATUM_REFERENCE_COMPARTMENT → DATUM('…','X')
 *   데이텀: DATUM 식별자, DATUM_FEATURE 수
 *
 * 정직 원칙: 파스 실패 엔티티는 unparsed 로 보고(값 날조 없음). 그래픽 PMI(폴리라인
 * 주석)·서피스 텍스처·AP203 프리젠테이션 전용은 v1 범위 외 명시. 추출값은 "모델에
 * 박힌 공차의 판독"이며 설계 판단 아님.
 */
import { readFileSync } from 'node:fs';

const GEO_TOL_KINDS = [
  'ANGULARITY_TOLERANCE', 'CIRCULAR_RUNOUT_TOLERANCE', 'COAXIALITY_TOLERANCE', 'CONCENTRICITY_TOLERANCE',
  'CYLINDRICITY_TOLERANCE', 'FLATNESS_TOLERANCE', 'LINE_PROFILE_TOLERANCE', 'PARALLELISM_TOLERANCE',
  'PERPENDICULARITY_TOLERANCE', 'POSITION_TOLERANCE', 'ROUNDNESS_TOLERANCE', 'STRAIGHTNESS_TOLERANCE',
  'SURFACE_PROFILE_TOLERANCE', 'SYMMETRY_TOLERANCE', 'TOTAL_RUNOUT_TOLERANCE',
];
const GEO_SYMBOL = {
  ANGULARITY_TOLERANCE: '∠', CIRCULAR_RUNOUT_TOLERANCE: '↗', COAXIALITY_TOLERANCE: '◎', CONCENTRICITY_TOLERANCE: '◎',
  CYLINDRICITY_TOLERANCE: '⌭', FLATNESS_TOLERANCE: '⏥', LINE_PROFILE_TOLERANCE: '⌒', PARALLELISM_TOLERANCE: '∥',
  PERPENDICULARITY_TOLERANCE: '⊥', POSITION_TOLERANCE: '⌖', ROUNDNESS_TOLERANCE: '○', STRAIGHTNESS_TOLERANCE: '—',
  SURFACE_PROFILE_TOLERANCE: '⌓', SYMMETRY_TOLERANCE: '⌯', TOTAL_RUNOUT_TOLERANCE: '↗↗',
};

/** STEP 텍스트 → {id: body} (멀티라인 재조립·공백 정규화). */
function parseEntities(text) {
  const map = new Map();
  for (const m of text.matchAll(/#(\d+)\s*=\s*([\s\S]*?);[ \t]*\r?\n/g)) {
    map.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return map;
}
const refsOf = (body) => [...(body ?? '').matchAll(/#(\d+)/g)].map((m) => m[1]);
const numFrom = (body, kind = 'LENGTH_MEASURE') => {
  const m = (body ?? '').match(new RegExp(`${kind}\\(([-0-9.Ee+]+)\\)`));
  return m ? parseFloat(m[1]) : null;
};

/**
 * AP242 시맨틱 PMI 추출.
 * @param {string} stepText STEP 파일 텍스트
 * @returns {{ datums, datumFeatureCount, dims, geoTols, counts, unparsed, note }}
 */
export function extractGdt(stepText) {
  const E = parseEntities(stepText);
  const unparsed = [];

  // 데이텀 식별자
  const datums = new Map(); // id → label
  for (const [id, b] of E) {
    if (/(^|\s|\()DATUM\(/.test(b)) {
      const lm = b.match(/'([A-Z]{1,3})'\s*\)$/);
      if (lm) datums.set(id, lm[1]);
      else unparsed.push({ id, kind: 'DATUM', why: '식별자 미검출' });
    }
  }
  const datumFeatureCount = [...E.values()].filter((b) => /(^|\s|\()DATUM_FEATURE\(/.test(b)).length;

  // 데이텀 참조 해석: id → 레이블 배열(시스템/컴파트먼트 2홉)
  const datumLabelsFrom = (ids, depth = 0) => {
    const out = [];
    if (depth > 3) return out;
    for (const rid of ids) {
      if (datums.has(rid)) { out.push(datums.get(rid)); continue; }
      const b = E.get(rid) ?? '';
      if (/DATUM_SYSTEM\(|DATUM_REFERENCE_COMPARTMENT\(|DATUM_REFERENCE\(/.test(b)) {
        out.push(...datumLabelsFrom(refsOf(b), depth + 1));
      }
    }
    return [...new Set(out)];
  };

  // 치수: DCR(#dim,#rep) 인덱스
  const dimValue = new Map(); // dimId → nominal
  for (const b of E.values()) {
    const m = b.match(/^DIMENSIONAL_CHARACTERISTIC_REPRESENTATION\(#(\d+),#(\d+)\)$/);
    if (!m) continue;
    const rep = E.get(m[2]) ?? '';
    for (const item of refsOf(rep)) {
      const v = numFrom(E.get(item), 'LENGTH_MEASURE') ?? numFrom(E.get(item), 'PLANE_ANGLE_MEASURE');
      if (v !== null) { dimValue.set(m[1], v); break; }
    }
  }
  // ±공차: PLUS_MINUS_TOLERANCE(#tv,#dim)
  const dimTol = new Map();
  for (const b of E.values()) {
    const m = b.match(/^PLUS_MINUS_TOLERANCE\(#(\d+),#(\d+)\)$/);
    if (!m) continue;
    const tv = E.get(m[1]) ?? '';
    const tm = tv.match(/^TOLERANCE_VALUE\(#(\d+),#(\d+)\)$/);
    if (tm) {
      dimTol.set(m[2], {
        lower: numFrom(E.get(tm[1])),
        upper: numFrom(E.get(tm[2])),
      });
    } else unparsed.push({ kind: 'PLUS_MINUS_TOLERANCE', why: 'TOLERANCE_VALUE 아님(LIMITS_AND_FITS 등 v1 범위 외)' });
  }
  const dims = [];
  for (const [id, b] of E) {
    let m = b.match(/^DIMENSIONAL_SIZE\(#\d+,'([^']*)'\)$/);
    if (m) { dims.push({ id, kind: 'size', name: m[1], value: dimValue.get(id) ?? null, tol: dimTol.get(id) ?? null }); continue; }
    m = b.match(/^DIMENSIONAL_LOCATION\('([^']*)'/);
    if (m) dims.push({ id, kind: 'location', name: m[1], value: dimValue.get(id) ?? null, tol: dimTol.get(id) ?? null });
  }

  // 기하공차(단순+복합 인스턴스)
  const geoTols = [];
  for (const [id, b] of E) {
    const kind = GEO_TOL_KINDS.find((k) => b.includes(k + '('));
    if (!kind) continue;
    // magnitude: 참조 중 LENGTH_MEASURE 보유 첫 엔티티
    let magnitudeMm = null;
    for (const rid of refsOf(b)) {
      const v = numFrom(E.get(rid), 'LENGTH_MEASURE');
      if (v !== null) { magnitudeMm = v; break; }
    }
    const nameM = b.match(/'([^']*)'/);
    const modifiers = [...b.matchAll(/\.([A-Z_]+)\./g)].map((q) => q[1]).filter((q) => ['MAXIMUM_MATERIAL_REQUIREMENT', 'LEAST_MATERIAL_REQUIREMENT'].includes(q));
    geoTols.push({
      id, kind, symbol: GEO_SYMBOL[kind] ?? '□', name: nameM ? nameM[1] : '',
      magnitudeMm, datums: datumLabelsFrom(refsOf(b)),
      ...(modifiers.length ? { modifiers } : {}),
      ...(magnitudeMm === null ? { note: 'magnitude 미해석(정직)' } : {}),
    });
    if (magnitudeMm === null) unparsed.push({ id, kind, why: 'magnitude 미해석' });
  }

  return {
    datums: [...datums.values()].sort(),
    datumFeatureCount,
    dims, geoTols,
    counts: { datums: datums.size, dims: dims.length, geoTols: geoTols.length, plusMinus: dimTol.size },
    unparsed,
    note: '시맨틱 PMI 판독(AP242) — 그래픽 주석·서피스 텍스처·LIMITS_AND_FITS 는 v1 범위 외(정직). 값=모델 내장 공차의 판독이며 설계 판단 아님.',
  };
}

/** 파일 경로 편의 래퍼. */
export function extractGdtFile(path) {
  return extractGdt(readFileSync(path, 'utf8'));
}
