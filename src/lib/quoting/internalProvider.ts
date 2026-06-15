/**
 * Internal quote provider — wraps the existing closed-form estimator.
 *
 * No external network. Always 'configured'. Confidence translates the
 * estimator's 'rough' | 'low' | 'medium' tier to the QuoteResponse tier
 * via a simple table:
 *   - estimator 'medium' (measured volume + supported process)  → 'indicative'
 *   - estimator 'low' / 'rough'                                  → 'rough'
 *
 * We never claim 'binding' — only a real shop quote earns that label.
 *
 * Lead time is a per-process heuristic, NOT measured from real orders.
 * It's there so the UI can render something next to the price, not as
 * an SLA. Numbers chosen from the Hubs / Xometry public copy:
 *   FDM 2d, SLA 3d, CNC 5d, sheet 4d, IM 14d (tooling lead), die-cast 21d.
 *
 * Validity window: 7 days. Material spot prices drift; we don't want
 * a stale internal quote leaking into a downstream PO.
 */
import { estimateCost, type Material } from '../ai/scad-agent/costEstimation';
import type { ProcessForDfm } from '../ai/scad-agent/specVerification';
import type { QuoteProvider, QuoteResult } from './types';

/** Same list the estimator + verifySpec recognize. Kept inline (vs. imported
 *  from the estimator) so a future estimator change can't silently shrink
 *  the surface a UI provider list advertises. */
const INTERNAL_PROCESSES: ProcessForDfm[] = [
  'cnc_mill', 'fdm', 'sla', 'sheet', 'injection_molding', 'die_cast',
];
const INTERNAL_MATERIALS: Material[] = [
  'aluminum_6061', 'steel_a36', 'steel_4140', 'stainless_304', 'pla', 'abs',
];

/** Lead-time heuristic in business days. See module header for sourcing. */
const LEAD_TIME_DAYS: Record<ProcessForDfm, number> = {
  fdm: 2,
  sla: 3,
  cnc_mill: 5,
  sheet: 4,
  injection_molding: 14,
  die_cast: 21,
};

/** Quote validity in ms (7 days). Material spot prices drift fast enough
 *  that "good for a week" is a defensible cap on a non-binding estimate. */
const VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export const internalQuoteProvider: QuoteProvider = {
  id: 'internal',
  name: 'NexyFab internal estimator',
  isConfigured: () => true,
  supports: () => ({
    processes: INTERNAL_PROCESSES.slice(),
    materials: INTERNAL_MATERIALS.slice(),
  }),
  getQuote: async (req): Promise<QuoteResult> => {
    // Quantity guard: estimator clamps to >=1 internally, but the unit-price
    // division below divides by quantity directly, so we mirror the clamp.
    const quantity = Math.max(1, Math.floor(req.quantity));
    if (!Number.isFinite(quantity)) {
      return { ok: false, code: 'INVALID_GEOMETRY', reason: 'quantity must be a positive integer' };
    }
    // Degenerate geometry: no volume AND no bbox → estimator returns
    // setup-only with $0 material/machine. That's still useful info (tooling
    // floor) but the UI shouldn't claim it as a real quote — flag it.
    if (
      (req.measuredVolumeMm3 === undefined || req.measuredVolumeMm3 <= 0)
      && !req.bboxMm
    ) {
      return {
        ok: false,
        code: 'INVALID_GEOMETRY',
        reason: 'measuredVolumeMm3 or bboxMm is required for an internal estimate',
      };
    }

    const breakdown = estimateCost({
      process: req.process,
      material: req.material,
      quantity,
      measuredVolumeMm3: req.measuredVolumeMm3,
      bboxMm: req.bboxMm,
    });

    const totalUsd = breakdown.totalUsd;
    const unitPriceUsd = totalUsd / quantity;
    const leadTimeDays = LEAD_TIME_DAYS[req.process];

    // Translate estimator confidence into the QuoteResponse tier. We never
    // emit 'binding' — that label is reserved for shop quotes.
    const confidence: 'indicative' | 'rough' =
      breakdown.confidence === 'medium' ? 'indicative' : 'rough';

    return {
      ok: true,
      quote: {
        providerId: 'internal',
        providerName: 'NexyFab internal estimator',
        totalUsd,
        unitPriceUsd,
        leadTimeDays,
        lineItems: breakdown.breakdown.map(b => ({
          label: b.label,
          amountUsd: b.amount,
          unit: b.unit,
        })),
        confidence,
        orderUrl: null,
        validUntilMs: Date.now() + VALID_FOR_MS,
        notes: [
          'Internal estimator — for budgeting only. Get real shop quotes before ordering.',
        ],
      },
    };
  },
};
