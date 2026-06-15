/**
 * matchSelection — pure RFQ→factory assignment policy for auto-match.
 *
 * Lives beside the route (not IN it): Next.js 16 rejects non-handler exports from
 * a route.ts ("Route does not match the required types"), so the testable types +
 * scoring functions are factored out here and imported by the route + the test.
 *
 * Scoring (0–100):
 *   +10 base · +40 process match (dfm_process ∈ factory.processes[])
 *   +30 rating ((rating/5)·30) · +20 price (((3−price_level)/2)·20)
 */

export interface RfqRow {
  id: string;
  material_id: string | null;
  dfm_process: string | null;
  volume_cm3: number | null;
  quantity: number;
  shape_name: string | null;
  status: string;
  preferred_factory_id: string | null;
}

export interface FactoryRow {
  id: string;
  name: string;
  partner_email: string | null;
  contact_email: string | null;
  processes: string | null; // JSON text array
  rating: number | null;
  price_level: number | null;
}

export interface ScoredFactory extends FactoryRow {
  score: number;
}

export function scoreFactory(rfq: RfqRow, factory: FactoryRow): number {
  let score = 10; // base

  // Process match: +40
  if (rfq.dfm_process && factory.processes) {
    try {
      const procs: string[] = JSON.parse(factory.processes);
      if (Array.isArray(procs) && procs.includes(rfq.dfm_process)) {
        score += 40;
      }
    } catch {
      // malformed JSON — skip process score
    }
  }

  // Rating: (rating / 5) * 30 — clamped [0, 30]
  const rating = typeof factory.rating === 'number' ? factory.rating : 0;
  const ratingScore = (Math.min(5, Math.max(0, rating)) / 5) * 30;
  score += ratingScore;

  // Price level: lower price_level = higher score (1→20, 2→10, 3→0)
  const priceLevel = typeof factory.price_level === 'number' ? factory.price_level : 3;
  const clamped = Math.min(3, Math.max(1, priceLevel));
  const priceScore = ((3 - clamped) / 2) * 20;
  score += priceScore;

  return Math.round(score * 100) / 100;
}

/**
 * Decide which active factory an RFQ is assigned to. A customer-named factory
 * (preferred_factory_id), when active, wins outright — an explicit choice
 * overrides the scorer; otherwise the highest-scoring factory is picked.
 */
export function pickAssignedFactory(
  rfq: RfqRow,
  factories: FactoryRow[],
): { factory: FactoryRow; score: number; matchedBy: 'preference' | 'score' } | null {
  if (factories.length === 0) return null;
  const preferred = rfq.preferred_factory_id
    ? factories.find((f) => f.id === rfq.preferred_factory_id) ?? null
    : null;
  if (preferred) return { factory: preferred, score: -1, matchedBy: 'preference' };
  const scored = factories
    .map((f) => ({ f, s: scoreFactory(rfq, f) }))
    .sort((a, b) => b.s - a.s);
  return { factory: scored[0]!.f, score: scored[0]!.s, matchedBy: 'score' };
}
