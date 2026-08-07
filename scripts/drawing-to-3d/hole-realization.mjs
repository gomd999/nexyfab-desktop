/**
 * hole-realization — K4 of the 95% accuracy plan (260808).
 *
 * The compose gate (`gateComposite`) validates each feature's own geometry
 * but never cross-checks the REQUEST: a prompt asking for "Φ8 구멍 4개"
 * could compose into a hole-less intent and still pass, leaving the hole
 * count as prose in the spec sheet (the "구멍은 개수만 표기" honesty note in
 * the 2D drawing). This module closes that gap deterministically:
 *
 *   extractHoleSpec(description)  → explicit hole demands found in the text
 *   gateHoleRealization(intent, spec) → errors when the composed intent does
 *     not materialize them as subtracted round features
 *
 * Conservative by design: only asserts what the text states explicitly
 * (digit counts / Φ·mm·M diameters), skips negated clauses ("구멍 없이"),
 * and never invents tolerances — count and nominal diameter only.
 */

const ROUND_KINDS = new Set(['cylinder', 'cone']);

/** Effective instance count of a feature (patterns expand multiplicatively). */
function instanceCount(f) {
  const n = Number(f?.pattern?.count);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/** Representative diameter of a subtracted round feature (cone → max end). */
function featureDiameter(f) {
  if (f.kind === 'cylinder') return Number(f.diameter);
  if (f.kind === 'cone') return Math.max(Number(f.dia1) || 0, Number(f.dia2) || 0);
  return NaN;
}

const NEGATION = /(없이|없는|없음|제외|빼고|no\s+holes?|without\s+holes?)/i;

/**
 * Parse explicit hole demands out of a free-text request.
 * Returns [{ count, diameter, source }] — count or diameter may be null when
 * the text only states one of them. Empty array = no explicit hole demand.
 */
export function extractHoleSpec(description) {
  if (typeof description !== 'string' || !description.trim()) return [];
  const out = [];
  const seen = new Set();
  const push = (count, diameter, source) => {
    const key = `${count ?? ''}|${diameter ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ count: count ?? null, diameter: diameter ?? null, source });
  };
  // Work clause-by-clause so a negation only suppresses its own clause.
  const clauses = description.split(/[.。,，;；\n]/);
  for (const clause of clauses) {
    if (!/(구멍|홀|타공|hole)/i.test(clause)) continue;
    if (NEGATION.test(clause)) continue;

    // "4x Φ8" / "4 x M8" / "4×8mm"
    const combo = clause.match(/(\d{1,3})\s*[x×]\s*(?:[ΦφØø⌀M]\s*)?(\d+(?:\.\d+)?)\s*(?:mm)?/i);
    if (combo) { push(parseInt(combo[1], 10), parseFloat(combo[2]), combo[0].trim()); continue; }

    // Diameter forms: Φ8 / ⌀8 / M6 / 8mm 구멍 / 지름 8
    const diaMatch = clause.match(/[ΦφØø⌀]\s*(\d+(?:\.\d+)?)/)
      ?? clause.match(/\bM\s*(\d{1,2})\b/)
      ?? clause.match(/(?:직경|지름)\s*(\d+(?:\.\d+)?)/)
      ?? clause.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:직경|지름)?\s*(?:구멍|홀|타공|hole)/i);
    const diameter = diaMatch ? parseFloat(diaMatch[1]) : null;

    // Count forms: 구멍 4개 / 4개 구멍 / 4 holes
    const cntMatch = clause.match(/(?:구멍|홀|타공|holes?)[^\d]{0,8}(\d{1,3})\s*개/)
      ?? clause.match(/(\d{1,3})\s*개(?:의)?\s*(?:구멍|홀|타공)/)
      ?? clause.match(/(\d{1,3})\s+holes?/i);
    const count = cntMatch ? parseInt(cntMatch[1], 10) : null;

    if (diameter !== null || count !== null) push(count, diameter, clause.trim().slice(0, 60));
  }
  return out;
}

/** Diameter match tolerance: max(0.1mm, 2%) — nominal-level, not result-fitted. */
function diaMatches(requested, actual) {
  if (!(requested > 0) || !(actual > 0)) return false;
  return Math.abs(requested - actual) <= Math.max(0.1, requested * 0.02);
}

/**
 * Cross-check the composed intent against the extracted demands.
 * @returns string[] gate errors (empty = realized)
 */
export function gateHoleRealization(intent, holeSpec) {
  const spec = Array.isArray(holeSpec) ? holeSpec : [];
  if (!spec.length) return [];
  const holes = (intent?.features ?? [])
    .filter((f) => f && f.op === 'subtract' && ROUND_KINDS.has(f.kind))
    .map((f) => ({ diameter: featureDiameter(f), count: instanceCount(f) }));
  const errs = [];
  for (const demand of spec) {
    const pool = demand.diameter !== null
      ? holes.filter((h) => diaMatches(demand.diameter, h.diameter))
      : holes;
    const realized = pool.reduce((sum, h) => sum + h.count, 0);
    const need = demand.count ?? 1;
    if (realized < need) {
      const what = demand.diameter !== null ? `Φ${demand.diameter}` : '지정 지름 없음';
      errs.push(
        `hole_realization: 요청 "${demand.source}" (${what} × ${need}) — intent의 subtract 원형 피처 ${realized}개만 일치. `
        + `구멍은 op:'subtract'인 cylinder(diameter,height)로, 위치는 at.translate로 실체화하라.`,
      );
    }
  }
  return errs;
}
