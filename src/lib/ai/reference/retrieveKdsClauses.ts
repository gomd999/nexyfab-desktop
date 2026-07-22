/**
 * retrieveKdsClauses — DETERMINISTIC, in-repo KDS/KCS clause grounding for the
 * eng-domain planners (lever C). NO network, NO external Worker.
 *
 * The engineering calculator catalog (src/app/api/eng-chat/calcCatalog.ts,
 * auto-generated from engineering-core) already cites KDS/KCS design-code
 * clauses INLINE in each calculator's `title`/`description`. This module keyword-
 * indexes those strings (id tokens + title + description + domain) and, for a
 * brief's free text, returns the top-k most relevant clauses as CITED grounding.
 *
 * The clauses are injected into the planner prompt only to remind the model
 * which code governs (so it cites rather than invents). The deterministic
 * coerce gate + the KDS-verified engineering-core still decide truth — no
 * retrieved number is ever promoted into a plan value.
 *
 * Reuses the CJK-aware cosineSimilarity from ../similarity; the English id
 * tokens make the index cross-lingual (a "beam"/"wall" query hits the Korean-
 * titled clauses). Fully deterministic and side-effect free.
 */
import { CALC_CATALOG, type CalcSpec } from '@/app/api/eng-chat/calcCatalog';
import { cosineSimilarity, frequencyVector, type FrequencyVector } from '../similarity';

export interface KdsClause {
  /** The cited design-code clause(s), e.g. "KDS 14 31 25". */
  clause: string;
  /** The calculator title that governs (context for the citation). */
  title: string;
  /** Provenance — which catalog entry the clause came from. */
  source: string;
}

// KDS/KCS references: the code letters + 2..4 two-digit groups (e.g.
// "KDS 14 31 25", "KDS 41 17", "KCS 14 20 01").
const CLAUSE_RE = /K[DC]S(?:\s+\d{2}){2,4}/g;

interface IndexedSpec {
  clauses: string[];
  title: string;
  source: string;
  vector: FrequencyVector;
}

function extractClauses(spec: CalcSpec): string[] {
  const hay = `${spec.title} ${spec.description}`;
  const found = hay.match(CLAUSE_RE);
  if (!found) return [];
  // normalize whitespace + dedupe, preserve order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of found) {
    const norm = c.replace(/\s+/g, ' ').trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// Build the index once at module load. Only specs that actually cite a clause
// are indexed (this is a CLAUSE retriever — a spec with no code reference has
// nothing to ground on).
const INDEX: IndexedSpec[] = (() => {
  const out: IndexedSpec[] = [];
  for (const spec of CALC_CATALOG) {
    const clauses = extractClauses(spec);
    if (clauses.length === 0) continue;
    // id tokens give English keywords for cross-lingual matching against the
    // Korean titles/descriptions.
    const idWords = spec.id.replace(/_/g, ' ');
    const text = `${idWords} ${spec.domain} ${spec.title} ${spec.description}`;
    out.push({
      clauses,
      title: spec.title,
      source: `calcCatalog:${spec.id}`,
      vector: frequencyVector(text),
    });
  }
  return out;
})();

/**
 * Return the top-k KDS/KCS clauses most relevant to `text`. Deterministic;
 * returns [] when the text has no signal or nothing scores above zero (so an
 * off-topic brief is not force-fed an irrelevant clause).
 */
export function retrieveKdsClauses(text: string, k = 3): KdsClause[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const qVec = frequencyVector(text);
  if (qVec.total === 0) return [];

  const scored = INDEX.map((entry) => ({
    entry,
    score: cosineSimilarity(qVec, entry.vector),
  })).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score || a.entry.source.localeCompare(b.entry.source));

  return scored.slice(0, Math.max(0, k)).map(({ entry }) => ({
    clause: entry.clauses.join(', '),
    title: entry.title,
    source: entry.source,
  }));
}

/**
 * Format retrieved clauses as a compact, explicitly non-authoritative prompt
 * block. Returns '' when there is nothing to cite.
 */
export function formatKdsClausesBlock(clauses: KdsClause[]): string {
  if (!clauses.length) return '';
  const lines = clauses.map((c) => `- ${c.clause} — ${c.title}`);
  return (
    'Relevant KDS/KCS design-code clauses (CITE these where they govern; do NOT ' +
    'invent code numbers or copy values — the KDS-verified engine checks every member):\n' +
    lines.join('\n')
  );
}

/** Number of clause-bearing catalog specs indexed (for diagnostics/tests). */
export const KDS_CLAUSE_SPEC_COUNT = INDEX.length;
