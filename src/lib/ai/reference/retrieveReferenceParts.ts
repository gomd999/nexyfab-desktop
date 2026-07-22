/**
 * retrieveReferenceParts — DETERMINISTIC, in-repo grounding for the geometry
 * planners (lever C). NO embeddings, NO network.
 *
 * Given a query (free text and/or structured geometric hints) it ranks the
 * distilled reference-part index (src/lib/ai/reference/refPartIndex.json —
 * derived measurement metadata only, see build-ref-part-index.mjs) and returns
 * the top-k as CITED, NON-AUTHORITATIVE examples. These are injected into the
 * planner prompt purely to show realistic STRUCTURE/SCALE; the deterministic
 * coerce/preflight gate downstream still decides truth, so no retrieved number
 * ever becomes a fact.
 *
 * Scoring is a transparent weighted sum over structured keys (aspect match,
 * surface-type histogram cosine, hole/pattern signature, material overlap) plus
 * a lightweight text cosine over the generic descriptor (reusing the CJK-aware
 * cosineSimilarity from ../similarity). Fully deterministic and side-effect free.
 */
import refIndex from './refPartIndex.json';
import { cosineSimilarity, frequencyVector, type FrequencyVector } from '../similarity';

export interface RefPart {
  id: string;
  format?: string;
  genericTerms?: string[];
  materials?: string[];
  size?: number[];
  aspect?: string;
  solids?: number;
  surfaceTypes?: Record<string, number>;
  analyticRatio?: number;
  holeDiameters?: number[];
  patterns?: { kind?: string; count?: number }[];
  primitiveFit?: string;
  grade?: string;
  strategy?: string;
  descriptor: string;
}

export interface ReferenceQuery {
  /** Free-text brief (cosine over the generic descriptor + generic nouns). */
  text?: string;
  /** rod | plate | block | shell | complex */
  aspect?: string;
  /** Surface-type histogram to match by cosine, e.g. { cylinder: 20, plane: 4 }. */
  surfaceTypes?: Record<string, number>;
  /** Hole signature to match: a count and/or representative diameters (mm). */
  holeSig?: { count?: number; diameters?: number[] };
  /** Material keywords (root form) to match against the part's materials. */
  materials?: string[];
}

/** A cited reference entry — descriptor as the (generic) name, never a fact. */
export interface CitedRefPart {
  /** Generic geometric descriptor (proprietary names were dropped at build). */
  name: string;
  size?: number[];
  grade?: string;
  /** Short human-readable reason this part matched (for prompt transparency). */
  why: string;
}

const PARTS: RefPart[] = (refIndex as { parts: RefPart[] }).parts;

// ─── scoring primitives ──────────────────────────────────────────────────────

/** Cosine over two sparse non-negative histograms keyed by surface type. */
function histCosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  for (const [k, v] of Object.entries(a)) {
    const w = b[k];
    if (w) dot += v * w;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Hole-signature closeness in [0,1]: blends count proximity + diameter overlap. */
function holeScore(sig: NonNullable<ReferenceQuery['holeSig']>, part: RefPart): number {
  const pd = part.holeDiameters;
  if (!pd || pd.length === 0) return 0;
  let s = 0;
  let terms = 0;
  if (typeof sig.count === 'number' && sig.count > 0) {
    const a = sig.count;
    const b = pd.length;
    s += 1 - Math.min(1, Math.abs(a - b) / Math.max(a, b));
    terms++;
  }
  if (Array.isArray(sig.diameters) && sig.diameters.length) {
    let hits = 0;
    for (const d of sig.diameters) {
      if (pd.some((x) => x > 0 && Math.abs(x - d) / Math.max(x, d) <= 0.1)) hits++;
    }
    s += hits / sig.diameters.length;
    terms++;
  }
  return terms ? s / terms : 0;
}

// Memoized frequency vector for each part's searchable text (descriptor + terms).
const vecCache = new WeakMap<RefPart, FrequencyVector>();
function partVector(p: RefPart): FrequencyVector {
  let v = vecCache.get(p);
  if (!v) {
    const text = [p.descriptor, ...(p.genericTerms ?? []), ...(p.materials ?? [])].join(' ');
    v = frequencyVector(text);
    vecCache.set(p, v);
  }
  return v;
}

// Weights — structured keys dominate; text cosine is a tie-breaker.
const W_ASPECT = 3;
const W_SURFACE = 3;
const W_HOLE = 2.5;
const W_MATERIAL = 1;
const W_TEXT = 2;
const W_TERM = 1.5;

interface Scored {
  part: RefPart;
  score: number;
  reasons: string[];
}

function scorePart(part: RefPart, q: ReferenceQuery, qVec: FrequencyVector | null): Scored {
  let score = 0;
  const reasons: string[] = [];

  if (q.aspect && part.aspect && q.aspect === part.aspect) {
    score += W_ASPECT;
    reasons.push(`aspect=${part.aspect}`);
  }
  if (q.surfaceTypes && part.surfaceTypes) {
    const c = histCosine(q.surfaceTypes, part.surfaceTypes);
    if (c > 0) {
      score += W_SURFACE * c;
      if (c > 0.5) reasons.push('similar surface-type mix');
    }
  }
  if (q.holeSig) {
    const h = holeScore(q.holeSig, part);
    if (h > 0) {
      score += W_HOLE * h;
      if (h > 0.4 && part.holeDiameters) reasons.push(`${part.holeDiameters.length} holes`);
    }
  }
  if (q.materials && q.materials.length && part.materials && part.materials.length) {
    const set = new Set(part.materials);
    const overlap = q.materials.filter((m) => set.has(m.toLowerCase()));
    if (overlap.length) {
      score += W_MATERIAL * overlap.length;
      reasons.push(`material ${overlap.join('/')}`);
    }
  }
  if (qVec) {
    const c = cosineSimilarity(qVec, partVector(part));
    if (c > 0) score += W_TEXT * c;
    // generic-noun overlap from the raw query text
    if (part.genericTerms && part.genericTerms.length) {
      const hit = part.genericTerms.filter((t) => qVec.counts.has(t));
      if (hit.length) {
        score += W_TERM * hit.length;
        reasons.push(hit.join('/'));
      }
    }
  }
  return { part, score, reasons };
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Return the top-k reference parts for a query, as cited non-authoritative
 * entries. Deterministic; returns [] when nothing scores above zero (so an
 * unrelated brief is NOT force-fed an irrelevant example — no fabricated ref).
 */
export function retrieveReferenceParts(query: ReferenceQuery, k = 3): CitedRefPart[] {
  const qVec =
    query.text && query.text.trim().length ? frequencyVector(query.text) : null;
  const hasSignal =
    !!qVec || !!query.aspect || !!query.surfaceTypes || !!query.holeSig || !!query.materials;
  if (!hasSignal) return [];

  const scored: Scored[] = [];
  for (const part of PARTS) {
    const s = scorePart(part, query, qVec);
    if (s.score > 0) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score || a.part.id.localeCompare(b.part.id));

  return scored.slice(0, Math.max(0, k)).map(({ part, reasons }) => ({
    name: part.descriptor,
    size: part.size,
    grade: part.grade,
    why: reasons.length ? reasons.join(', ') : 'structural match',
  }));
}

/**
 * Format retrieved parts as a compact, explicitly NON-AUTHORITATIVE prompt
 * block. Returns '' when there is nothing to cite (caller appends nothing).
 */
export function formatReferencePartsBlock(refs: CitedRefPart[]): string {
  if (!refs.length) return '';
  const lines = refs.map((r) => {
    const size = r.size && r.size.length ? ` ${r.size.join('x')}mm` : '';
    const grade = r.grade ? ` grade${r.grade}` : '';
    return `- ${r.name}${size}${grade} (${r.why})`;
  });
  return (
    'Reference parts (REAL, cited — examples of realistic structure/scale only, ' +
    'NOT authoritative values; never copy these numbers into your plan):\n' +
    lines.join('\n')
  );
}

/** Number of parts in the distilled index (for diagnostics/tests). */
export const REFERENCE_PART_COUNT = PARTS.length;
