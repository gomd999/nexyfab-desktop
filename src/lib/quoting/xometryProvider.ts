/**
 * Xometry quote provider — v1 STUB.
 *
 * Real wire-up requires:
 *   1. Xometry Partners program enrollment (https://partners.xometry.com).
 *   2. API key provisioned as XOMETRY_API_KEY in the deployment env.
 *   3. Endpoint contract from the partnership PDF (the public docs only
 *      cover the customer-facing instant-quote site, not the partner API).
 *
 * Until those land, isConfigured() returns false and getQuote() returns
 * { ok: false, code: 'NOT_CONFIGURED' }. The route surfaces that as 503
 * with the reason text; the UI offers a "fall back to internal" button.
 * Honest about what's possible without a partnership.
 *
 * Materials/processes lists below are the union of what Xometry's public
 * site advertises (CNC, FDM, SLA, sheet, IM) crossed with our internal
 * Material enum. Update when the partnership doc gives a definitive list.
 */
import type { Material } from '../ai/scad-agent/costEstimation';
import type { ProcessForDfm } from '../ai/scad-agent/specVerification';
import type { QuoteProvider, QuoteResult } from './types';

const XOMETRY_PROCESSES: ProcessForDfm[] = [
  // Die-cast excluded — Xometry's instant-quote engine doesn't support it
  // (per their public capabilities page; high-volume die-cast is RFQ-only).
  'cnc_mill', 'fdm', 'sla', 'sheet', 'injection_molding',
];
const XOMETRY_MATERIALS: Material[] = [
  'aluminum_6061', 'steel_a36', 'steel_4140', 'stainless_304', 'pla', 'abs',
];

export const xometryQuoteProvider: QuoteProvider = {
  id: 'xometry',
  name: 'Xometry',
  isConfigured: () => !!process.env.XOMETRY_API_KEY,
  supports: () => ({
    processes: XOMETRY_PROCESSES.slice(),
    materials: XOMETRY_MATERIALS.slice(),
  }),
  getQuote: async (_req): Promise<QuoteResult> => {
    // Until the partnership API key lands the only honest answer is
    // NOT_CONFIGURED. Two distinct reason strings so ops can tell whether
    // the env var is missing vs. the stub never replaced.
    if (!process.env.XOMETRY_API_KEY) {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        reason: 'Xometry integration requires a partnership API key. Set XOMETRY_API_KEY in env.',
      };
    }
    // Key is present but the real fetch hasn't been wired yet. When the
    // partnership doc lands, replace this body with a fetch() to the
    // partner-quote endpoint, parse the response, and translate it into
    // a QuoteResponse (confidence: 'indicative' or 'binding' per their
    // grading; their lead-time and validity fields map straight in).
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      reason: 'Xometry provider stub — partnership integration is pending. Internal estimator is the fallback.',
    };
  },
};
