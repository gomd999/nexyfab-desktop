/**
 * shadow-logger.ts — write-only operational signal capture.
 *
 * "Shadow" because nothing in the user-facing flow blocks on these writes:
 * every helper is fire-and-forget, errors are swallowed with console.error,
 * and a logging failure must NEVER break the calling business path. The
 * data is collected silently and surfaces later as analytics products
 * (defect heatmaps, margin dashboards, CBAM reports — see bm-matrix.md §3).
 *
 * Hard rule: every helper takes `orderId` (or `fileId` / `quoteId`) as the
 * FIRST argument so correlation queries are trivial — `WHERE order_id = ?`
 * works across nf_defects, nf_margin_breakdown, nf_cbam_log without joins.
 * The user explicitly required this for BM-2; do not relax it.
 */

import { getDbAdapter } from './db-adapter';
import { randomUUID } from 'crypto';

/** Centralised swallow — keeps logger calls noise-free at call sites. */
function swallow(scope: string): (err: unknown) => void {
  return (err) => console.error(`[shadow-logger:${scope}]`, err);
}

// ─── 결함 로그 (#18) ──────────────────────────────────────────────────────

/** Defect cause codes — must match nf_enum_defect_cause seed in db.ts. */
export type DefectCause =
  | 'dimensional' | 'surface' | 'material' | 'assembly'
  | 'packaging'   | 'documentation' | 'other';

/** Process step codes — must match nf_enum_process_step seed in db.ts. */
export type ProcessStep =
  | 'cnc' | 'injection' | 'printing' | 'finishing'
  | 'qc'  | 'packaging' | 'shipping';

export type DefectSeverity = 'critical' | 'major' | 'minor';

export interface DefectInput {
  causeCode:        DefectCause;
  processStep:      ProcessStep;
  severity:         DefectSeverity;
  quantityAffected: number;
  reportedBy:       string;
  evidenceUrls?:    string[];
}

export async function logDefect(orderId: string, input: DefectInput): Promise<void> {
  if (!orderId || input.quantityAffected <= 0) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_defects
       (id, order_id, cause_code, process_step, severity,
        quantity_affected, reported_at, reported_by, evidence_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `dfc-${randomUUID()}`,
    orderId, input.causeCode, input.processStep, input.severity,
    input.quantityAffected, Date.now(), input.reportedBy,
    input.evidenceUrls?.length ? JSON.stringify(input.evidenceUrls) : null,
  ).catch(swallow('defect'));
}

// ─── 마진 분해 (#21) ──────────────────────────────────────────────────────

export interface MarginBreakdown {
  materialKrw:      number;
  laborKrw:         number;
  machineKrw:       number;
  overheadKrw:      number;
  platformFeeKrw:   number;
  partnerPayoutKrw: number;
  totalKrw:         number;
}

/**
 * Upsert margin breakdown for one order. CHECK constraint enforces
 * sum-equals-total within ±1 KRW (SQLite) / exact (Postgres) — caller
 * must ensure parts add up before invoking, otherwise the insert is
 * silently dropped via swallow.
 */
export async function logMargin(orderId: string, m: MarginBreakdown): Promise<void> {
  if (!orderId) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_margin_breakdown
       (order_id, material_krw, labor_krw, machine_krw, overhead_krw,
        platform_fee_krw, partner_payout_krw, total_krw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       material_krw       = excluded.material_krw,
       labor_krw          = excluded.labor_krw,
       machine_krw        = excluded.machine_krw,
       overhead_krw       = excluded.overhead_krw,
       platform_fee_krw   = excluded.platform_fee_krw,
       partner_payout_krw = excluded.partner_payout_krw,
       total_krw          = excluded.total_krw`,
    orderId, m.materialKrw, m.laborKrw, m.machineKrw, m.overheadKrw,
    m.platformFeeKrw, m.partnerPayoutKrw, m.totalKrw,
  ).catch(swallow('margin'));
}

// ─── CAD 접근 로그 (#16) ─────────────────────────────────────────────────

export type CadAccessType = 'view' | 'download' | 'share' | 'delete';

export interface CadAccessContext {
  userId:     string;
  accessType: CadAccessType;
  ip?:        string;
  userAgent?: string;
}

export async function logCadAccess(fileId: string, ctx: CadAccessContext): Promise<void> {
  if (!fileId || !ctx.userId) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_cad_access_log
       (id, user_id, file_id, access_type, ip, user_agent, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `cad-${randomUUID()}`,
    ctx.userId, fileId, ctx.accessType,
    ctx.ip ?? null, ctx.userAgent ?? null, Date.now(),
  ).catch(swallow('cad-access'));
}

// ─── CBAM (#27) ──────────────────────────────────────────────────────────

export interface CbamInput {
  materialKg:       number;
  processEnergyKwh: number;
  co2eKg:           number;
}

export async function logCbam(orderId: string, c: CbamInput): Promise<void> {
  if (!orderId) return;
  if (c.materialKg < 0 || c.processEnergyKwh < 0 || c.co2eKg < 0) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_cbam_log
       (id, order_id, material_kg, process_energy_kwh, co2e_kg, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    `cbm-${randomUUID()}`,
    orderId, c.materialKg, c.processEnergyKwh, c.co2eKg, Date.now(),
  ).catch(swallow('cbam'));
}

// ─── 견적 거절 로그 (#22) ────────────────────────────────────────────────

export interface QuoteRejectInput {
  /** Optional — set when the rejection is at RFQ-shopping stage (no quote chosen). */
  rfqId?:               string;
  rejectReasonCode:     string;
  alternativeSuggested: boolean;
  rejectedBy:           string;
}

/**
 * First arg is `quoteId` if a specific quote was rejected, or '' when only
 * an `rfqId` applies (e.g. user closed the RFQ without picking any quote).
 * Either quoteId or input.rfqId must be set; otherwise the call is dropped.
 */
export async function logQuoteReject(
  quoteId: string,
  input: QuoteRejectInput,
): Promise<void> {
  if (!quoteId && !input.rfqId) return;
  const db = getDbAdapter();
  await db.execute(
    `INSERT INTO nf_quote_reject_log
       (id, quote_id, rfq_id, reject_reason_code,
        alternative_suggested, rejected_by, rejected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `qrj-${randomUUID()}`,
    quoteId || null, input.rfqId ?? null, input.rejectReasonCode,
    input.alternativeSuggested ? 1 : 0, input.rejectedBy, Date.now(),
  ).catch(swallow('quote-reject'));
}
