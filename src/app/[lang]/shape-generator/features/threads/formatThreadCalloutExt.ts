/**
 * formatThreadCalloutExt.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * Extension of D5's `formatThreadCallout`. The D5 helper covers ISO 6410-1.
 * Production CAD frequently needs other drawing-standard conventions:
 *
 * - **ISO 6410-1** (default) — `M8-6H ↧ 20` / `M10×1.25-6H ↧ 15` etc.
 * - **ASME Y14.6** — adds a tap-drill dia suffix `1/4-20 UNC-2B / .201`
 *   (decimal-inch, three decimals) where `.201` is the drill diameter.
 * - **JIS B 0205** — Japanese metric drawings prefer spaces around `×` and
 *   class: `M8 × 1.25-6H` (and `M8 × 1.25-6H ↧ 20` with depth).
 * - **DIN 13** — German drawings omit the class on general production
 *   drawings (the tightness class is on the part spec sheet, not the
 *   geometry callout): `M8` / `M8 ↧ 20`.
 * - **GB 196** — Chinese standard, identical numeric form to ISO 6410-1
 *   but draws the depth marker with a Chinese suffix `深`: `M8-6H 深 20`.
 *
 * The helper stays pure (no React, no I/O, no async). The D5 default
 * (`ISO_6410_1`) remains the public-API stable output for every existing
 * test — extension is additive only.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §12 (drawing-callout pipeline),
 * §15 W8 (this PR scope: callout standards + BOM + drawing-rep + STEP).
 */

import {
  formatThreadCallout as formatThreadCalloutIso,
  type FormatCalloutOptions,
  type ThreadFeature,
} from './threadFeature';
import { findThreadRow, type ThreadStandardRow } from './threadCatalog';

/**
 * Supported drawing standards for thread callouts. `ISO_6410_1` is the
 * default — every existing caller gets the D5 behaviour unchanged.
 */
export type ThreadCalloutStandard =
  | 'ISO_6410_1'   // ISO 6410-1 (default; D5 behaviour)
  | 'ASME_Y14_6'   // US inch drawings; appends tap-drill dia
  | 'JIS_B_0205'   // Japanese metric drawings; spaces around × and class
  | 'DIN_13'       // German drawings; class omitted on geometry callout
  | 'GB_196';      // Chinese drawings; depth marker drawn as 深

/** Options for the extended callout formatter. */
export interface FormatThreadCalloutExtOptions extends FormatCalloutOptions {
  /** Drawing standard. Default `'ISO_6410_1'`. */
  standard?: ThreadCalloutStandard;
  /**
   * Tap-drill diameter override (mm). Used by ASME Y14.6 to print the
   * decimal-inch suffix. If omitted, falls back to the catalog row's
   * `tapDrill`.
   */
  tapDrillMm?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Round a number to a fixed decimal count (no trailing zero stripping). */
function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(decimals);
}

/** Convert mm to inches, with three-decimal rounding (ASME Y14.6 default). */
function mmToInchTapDrill(mm: number): string {
  const inches = mm / 25.4;
  // ASME Y14.6 prefers leading-dot form (".201") for sub-inch values.
  // Format with three decimals.
  const s = fixed(inches, 3);
  // Drop the leading "0" when present so 0.201 → ".201".
  return s.startsWith('0.') ? s.slice(1) : s;
}

/** Strip the ISO depth marker (`↧ N`) and return both halves. */
function splitOnDepth(callout: string): { body: string; depth: string | null } {
  const idx = callout.indexOf(' ↧');
  if (idx < 0) return { body: callout, depth: null };
  return { body: callout.slice(0, idx), depth: callout.slice(idx + 1).trim() };
}

/** Strip the LH suffix from the body, returning both halves. */
function splitOnLeftHand(body: string): { naked: string; lh: '' | ' LH' } {
  if (body.endsWith(' LH')) {
    return { naked: body.slice(0, -3), lh: ' LH' };
  }
  return { naked: body, lh: '' };
}

/** Strip the `-CLASS` trailing class on the body. Returns body w/o class + the class. */
function splitOnClass(naked: string): { stem: string; classSuffix: string } {
  const m = /-(\d?[HhGgABab](?:\d?[HhGgABab])?|Rc)$/.exec(naked);
  if (m) {
    return { stem: naked.slice(0, m.index), classSuffix: m[0] };
  }
  return { stem: naked, classSuffix: '' };
}

// ─── Per-standard adapters ──────────────────────────────────────────────────

/** JIS B 0205 — insert spaces around × and around the class hyphen. */
function applyJis(isoCallout: string): string {
  const { body, depth } = splitOnDepth(isoCallout);
  const { naked, lh } = splitOnLeftHand(body);
  // ISO M fine in D5 emits "M10×1.25-6H" — convert × to " × " and "-" before
  // class to " - ".
  let formatted = naked
    .replace(/×/g, ' × ')
    .replace(/-([\dA-Za-z]+)$/, ' - $1');
  formatted = `${formatted}${lh}`;
  return depth !== null ? `${formatted} ${depth}` : formatted;
}

/** DIN 13 — strip the class suffix entirely from the callout. */
function applyDin(isoCallout: string): string {
  const { body, depth } = splitOnDepth(isoCallout);
  const { naked, lh } = splitOnLeftHand(body);
  const { stem } = splitOnClass(naked);
  const formatted = `${stem}${lh}`;
  return depth !== null ? `${formatted} ${depth}` : formatted;
}

/** GB 196 — same as ISO but the depth glyph is `深` (Chinese "depth"). */
function applyGb(isoCallout: string): string {
  const { body, depth } = splitOnDepth(isoCallout);
  if (depth === null) return body;
  // Drop the leading "↧ " and replace with "深 ".
  const numeric = depth.startsWith('↧') ? depth.slice(1).trim() : depth;
  return `${body} 深 ${numeric}`;
}

/**
 * ASME Y14.6 — append the tap-drill suffix `/ .XYZ` (decimal inch, no
 * leading zero). Pure-inch UTS feature: the suffix is the recommended
 * drill diameter the operator runs **before** tapping.
 */
function applyAsme(
  isoCallout: string,
  row: ThreadStandardRow | null,
  override?: number,
): string {
  const dia = override ?? row?.tapDrill;
  if (!dia || !Number.isFinite(dia)) return isoCallout;
  // Tap drills for ISO M are conventionally still printed in mm even on
  // ASME drawings ("M8-6H / 6.80"); for UTS rows we emit decimal inches.
  const isInch = row?.series === 'UNC' || row?.series === 'UNF' || row?.series === 'NPT';
  const suffix = isInch ? mmToInchTapDrill(dia) : fixed(dia, 2);
  // Insert the suffix immediately before the depth marker (if any).
  const { body, depth } = splitOnDepth(isoCallout);
  const head = `${body} / ${suffix}`;
  return depth !== null ? `${head} ${depth}` : head;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Format a thread callout for the given drawing standard. Default standard is
 * ISO 6410-1; the helper is fully back-compatible with the D5 default.
 *
 * Pure function — no React, no I/O. Safe to call from the worker, the
 * drawing-rep builder, or the BOM exporter.
 *
 * @example
 *   formatThreadCalloutExt(f, null, { standard: 'JIS_B_0205' })
 *   // "M10 × 1.25 - 6H ↧ 15"
 *
 *   formatThreadCalloutExt(f, null, { standard: 'ASME_Y14_6' })
 *   // "1/4-20 UNC-2B / .201 ↧ 20"
 *
 *   formatThreadCalloutExt(f, null, { standard: 'DIN_13' })
 *   // "M8 ↧ 20"
 *
 *   formatThreadCalloutExt(f, null, { standard: 'GB_196' })
 *   // "M8-6H 深 20"
 */
export function formatThreadCalloutExt(
  feature: Pick<ThreadFeature, 'threadRef' | 'class' | 'threadDirection' | 'length'>,
  row: ThreadStandardRow | null = null,
  options: FormatThreadCalloutExtOptions = {},
): string {
  const standard = options.standard ?? 'ISO_6410_1';
  const r = row ?? findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  const isoCallout = formatThreadCalloutIso(feature, r, options);

  switch (standard) {
    case 'ISO_6410_1':
      return isoCallout;
    case 'JIS_B_0205':
      return applyJis(isoCallout);
    case 'DIN_13':
      return applyDin(isoCallout);
    case 'GB_196':
      return applyGb(isoCallout);
    case 'ASME_Y14_6':
      return applyAsme(isoCallout, r, options.tapDrillMm);
    default: {
      const _exhaustive: never = standard;
      return _exhaustive;
    }
  }
}

/** Public list of supported standards — for use by UI dropdowns. */
export const SUPPORTED_CALLOUT_STANDARDS: readonly ThreadCalloutStandard[] = Object.freeze([
  'ISO_6410_1',
  'ASME_Y14_6',
  'JIS_B_0205',
  'DIN_13',
  'GB_196',
]);
