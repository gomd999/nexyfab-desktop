/**
 * Quoting layer — provider-agnostic interface for manufacturer price quotes.
 *
 * Why this exists: NexyFab's v1 quote story is the internal estimator
 * (closed-form math from costEstimation.ts). External quote APIs like
 * Xometry / Hubs / Protolabs all require partnership agreements + paid
 * API keys that we haven't provisioned yet. Rather than ship a fake or
 * skip the conversion-funnel UX, we ship an adapter layer so:
 *
 *   1. The internal estimator answers TODAY (free, rough/indicative).
 *   2. External providers slot in LATER (one file each, no UI/route changes).
 *   3. The Xometry stub returns NOT_CONFIGURED until a key arrives — the UI
 *      shows the provider as "Not configured" without lying about coverage.
 *
 * Contract notes:
 *  - Quotes are USD only in v1. Currency conversion is a separate concern.
 *  - confidence tier maps to internal estimator's CostBreakdown.confidence
 *    via a translation table (internal 'medium' → 'indicative', 'low'/'rough'
 *    → 'rough'). Real providers return 'binding' or 'indicative' from their
 *    own grading; we never re-label.
 *  - validUntilMs is provider-supplied. Internal estimator uses 7 days
 *    (material spot prices drift; we don't want stale quotes leaking into
 *    POs).
 *  - orderUrl is null when no external order path exists. The UI hides
 *    the "click to order" button rather than rendering a dead link.
 */
import type { Material } from '../ai/scad-agent/costEstimation';
import type { ProcessForDfm } from '../ai/scad-agent/specVerification';

export interface QuoteRequest {
  process: ProcessForDfm;
  material: Material;
  quantity: number;
  /** Measured volume from verify_spec (or render). Higher confidence when set. */
  measuredVolumeMm3?: number;
  /** Bounding box, fallback for envelope-driven machine-time when volume absent. */
  bboxMm?: { wMm: number; hMm: number; dMm: number };
  /** Free-form context the provider may use (e.g. tolerance class, finish). */
  notes?: string;
}

export interface QuoteLineItem {
  label: string;
  amountUsd: number;
  /** Optional human unit ("0.50 hr", "0.0125 kg", "÷ qty 100"). */
  unit?: string;
}

export interface QuoteResponse {
  /** Stable provider id (e.g. 'internal', 'xometry'). */
  providerId: string;
  /** Human-friendly provider name. */
  providerName: string;
  /** Quote total in USD. */
  totalUsd: number;
  /** Per-unit price (totalUsd / quantity). */
  unitPriceUsd: number;
  /** Lead time in business days (provider-supplied or estimated). */
  leadTimeDays: number;
  /** Per-line breakdown. */
  lineItems: QuoteLineItem[];
  /**
   * Confidence tier:
   *   - 'binding'    — real shop quote, valid for the validUntilMs window.
   *   - 'indicative' — instant quote engine (Xometry-style), not contractual.
   *   - 'rough'      — internal estimator / order-of-magnitude only.
   */
  confidence: 'binding' | 'indicative' | 'rough';
  /** Provider-supplied next-step URL (e.g. "click to order"). null when
   *  no external order path exists. */
  orderUrl: string | null;
  /** Validity window — quotes expire so spot prices don't leak into a PO. */
  validUntilMs: number;
  /** Free-form notes from the provider (caveats, fine print, etc). */
  notes: string[];
}

/** Stable failure codes the UI maps to localized messages. */
export type QuoteFailureCode =
  | 'NOT_CONFIGURED'       // provider needs API key / partnership setup
  | 'UNSUPPORTED_PROCESS'  // provider doesn't offer this process
  | 'UNSUPPORTED_MATERIAL' // provider doesn't stock this material
  | 'INVALID_GEOMETRY'     // input couldn't be priced (e.g. zero volume + no bbox)
  | 'PROVIDER_ERROR';      // external API error (network / 5xx / parse)

export type QuoteResult =
  | { ok: true; quote: QuoteResponse }
  | { ok: false; code: QuoteFailureCode; reason: string };

export interface QuoteProvider {
  /** Stable id, e.g. 'internal' or 'xometry'. Must be unique in the registry. */
  id: string;
  /** Human-readable name shown in the UI dropdown + quote header. */
  name: string;
  /** Whether this provider is ready to take requests (api key set, etc).
   *  Drives the "Configured" / "Not configured" badge in the UI. */
  isConfigured(): boolean;
  /** Returns supported (process, material) pairs. The UI uses this to grey
   *  out incompatible options before a getQuote round-trip. */
  supports(): { processes: ProcessForDfm[]; materials: Material[] };
  /** Get a quote for the request. Implementations MUST resolve (never throw)
   *  so the route layer doesn't need a try/catch around every provider. */
  getQuote(req: QuoteRequest): Promise<QuoteResult>;
}
