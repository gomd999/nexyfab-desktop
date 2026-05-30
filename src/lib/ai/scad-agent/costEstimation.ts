/**
 * costEstimation.ts — Track B: order-of-magnitude part cost estimator.
 *
 * Closed-form helper that turns (process, material, geometry stats) into a
 * USD cost figure the agent can quote next to the geometry summary. The
 * math is intentionally simple and transparent: density × volume for
 * material, fixed machine-hour rates for process time, flat setup fee
 * amortized over quantity. The output carries a confidence label so the
 * agent (and downstream UI) can hedge appropriately — "rough" estimates
 * are for sanity-check only, "medium" implies the part has been measured.
 *
 * Density + price table (USD per kg, mid-2024 spot prices). These move
 * with the market — they're constants here so the test is deterministic;
 * production wiring will swap these for a live feed.
 *
 * Why this isn't a full quote tool: shop overhead, finish, lead time,
 * inspection, packaging, freight are missing. Same for tooling complexity
 * scaling (a deep-pocket part takes more CNC time than a simple plate of
 * the same bbox). The agent surfaces the breakdown so users see what's
 * included; this is "first approximation in 3 seconds", not "supplier RFQ".
 */

import type { ProcessForDfm } from './specVerification';

export type Material =
  | 'aluminum_6061'
  | 'steel_a36'
  | 'steel_4140'
  | 'stainless_304'
  | 'pla'
  | 'abs';

export interface CostBreakdown {
  /** Material cost in USD (density × volume × $/kg). */
  materialUsd: number;
  /** Machine time cost in USD (process-specific). */
  machineUsd: number;
  /** Setup / labor flat fee in USD. */
  setupUsd: number;
  /** Sum. */
  totalUsd: number;
  /** Diagnostics — per-line subtotals + units used. */
  breakdown: Array<{ label: string; amount: number; unit: string; rate?: number }>;
  /** Order-of-magnitude confidence: 'rough' (FOR REFERENCE ONLY) / 'low' / 'medium'. */
  confidence: 'rough' | 'low' | 'medium';
}

export interface EstimateCostOptions {
  process: ProcessForDfm;
  material: Material;
  /** Quantity for tooling amortization (sets setup-cost division). */
  quantity?: number;
  /** Volume in mm³ from a render (verify_spec's measured volume). */
  measuredVolumeMm3?: number;
  /** Fallback bbox for envelope-based machine-time estimate. */
  bboxMm?: { wMm: number; hMm: number; dMm: number };
}

/**
 * Density (g/cm³) + spot price ($/kg). Mirror of engineeringCatalog's
 * material entries — we keep numbers here to avoid parsing the catalog
 * text (which is human-prose) and to let cost math run without an async
 * import. If the catalog price ever drifts, sync this table.
 */
const MATERIAL_PHYSICS: Record<Material, { densityGPerCm3: number; priceUsdPerKg: number; type: 'metal' | 'plastic' }> = {
  aluminum_6061: { densityGPerCm3: 2.70, priceUsdPerKg: 5,  type: 'metal' },
  steel_a36:     { densityGPerCm3: 7.85, priceUsdPerKg: 1.5, type: 'metal' },
  steel_4140:    { densityGPerCm3: 7.85, priceUsdPerKg: 4,  type: 'metal' },
  stainless_304: { densityGPerCm3: 7.93, priceUsdPerKg: 7,  type: 'metal' },
  pla:           { densityGPerCm3: 1.24, priceUsdPerKg: 25, type: 'plastic' },
  abs:           { densityGPerCm3: 1.05, priceUsdPerKg: 30, type: 'plastic' },
};

/**
 * Material × process compatibility. Returns null when fine, or a string
 * blocker the caller surfaces to the user. We're strict on the obvious
 * blockers (metal into FDM, plastic into die-casting) and permissive
 * elsewhere — odd combos (CNC plastic, IM metal) generate a warning at
 * the helper level (currently inline in estimateCost via confidence).
 */
function materialProcessIncompatibility(material: Material, process: ProcessForDfm): string | null {
  const m = MATERIAL_PHYSICS[material];
  if (m.type === 'metal' && (process === 'fdm' || process === 'sla')) {
    return `${material} is metal and cannot be processed by ${process} (use cnc_mill / casting).`;
  }
  if (m.type === 'plastic' && process === 'die_cast') {
    return `${material} is plastic and cannot be die-cast (use injection_molding).`;
  }
  return null;
}

/** Setup-cost-per-job dollars per process, before quantity amortization. */
const SETUP_USD: Record<ProcessForDfm, number> = {
  cnc_mill: 30,          // 0.5 hr setup × ($60/hr machine + $40/hr op effective)
  fdm: 5,                // ~6 min slicing + bed prep at $50/hr op rate
  sla: 10,               // ~0.2 hr × ($8 machine + $40 op) ≈ 10
  injection_molding: 2000, // tooling amortization (single mold)
  die_cast: 5000,         // tooling amortization (steel die)
  sheet: 20,              // ~0.3 hr setup × ($40 + $25) — approximated
};

/**
 * Compute machine-hours required for a part.
 *
 * - cnc_mill: time = bbox volume (cm³) / 50, charged at $100/hr blended
 *   (machine $60 + operator $40). 0.5 hr setup is in SETUP_USD.
 * - fdm:      time = part volume × 0.8 hr/cm³ (20% infill assumption),
 *   charged at $3/hr (amortized small printer; operator ~$0/hr after
 *   setup since FDM runs unattended).
 * - sla:      time = bbox-z × 0.05 hr/mm (layer time), charged at $8/hr.
 * - injection_molding: 30 s cycle ⇒ runtime $0.5/part (rolled into machineUsd).
 * - die_cast: 60 s cycle ⇒ runtime $1/part (rolled into machineUsd).
 * - sheet:    no straight volume→time mapping — quoted as a $5 placeholder
 *   per part with `'rough'` confidence and a note that perimeter cuts /
 *   bend count drive real time.
 *
 * Returns the machineUsd plus the diagnostics row for the breakdown list.
 */
function machineCost(
  opts: EstimateCostOptions,
  volumeMm3: number,
): { machineUsd: number; row: { label: string; amount: number; unit: string; rate?: number } } {
  const volumeCm3 = volumeMm3 / 1000;
  const bbox = opts.bboxMm;
  switch (opts.process) {
    case 'cnc_mill': {
      // Use bbox envelope when we have it (CNC removes material from raw
      // stock so envelope drives chip volume); fall back to measured volume
      // when bbox absent (over-estimate of cycle time).
      const envelopeCm3 = bbox ? (bbox.wMm * bbox.hMm * bbox.dMm) / 1000 : volumeCm3;
      const hours = envelopeCm3 / 50; // 50 cm³/hr removal rate
      const rate = 100; // $60 machine + $40 op blended
      const usd = hours * rate;
      return { machineUsd: usd, row: { label: 'CNC mill time', amount: usd, unit: `${hours.toFixed(2)} hr`, rate } };
    }
    case 'fdm': {
      const hours = volumeCm3 * 0.8; // 0.8 hr/cm³ at 20% infill
      const rate = 3;
      const usd = hours * rate;
      return { machineUsd: usd, row: { label: 'FDM print time', amount: usd, unit: `${hours.toFixed(2)} hr`, rate } };
    }
    case 'sla': {
      const layerMm = bbox?.dMm ?? Math.cbrt(volumeMm3); // fall back to cube-root proxy
      const hours = layerMm * 0.05; // 0.05 hr/mm of build height
      const rate = 8;
      const usd = hours * rate;
      return { machineUsd: usd, row: { label: 'SLA layer time', amount: usd, unit: `${hours.toFixed(2)} hr`, rate } };
    }
    case 'injection_molding': {
      // 30 s cycle at $60/hr machine → $0.5/part runtime
      const usd = 0.5;
      return { machineUsd: usd, row: { label: 'IM cycle runtime', amount: usd, unit: '1 part', rate: 0.5 } };
    }
    case 'die_cast': {
      // 60 s cycle at $60/hr machine → $1/part runtime
      const usd = 1;
      return { machineUsd: usd, row: { label: 'Die cast cycle', amount: usd, unit: '1 part', rate: 1 } };
    }
    case 'sheet': {
      // Without perimeter / bend count we can't compute laser/brake time.
      // Quote a $5 placeholder and let the caller's 'rough' confidence
      // signal the user that this isn't trustworthy.
      const usd = 5;
      return { machineUsd: usd, row: { label: 'Sheet cut/brake (placeholder)', amount: usd, unit: '1 part', rate: 5 } };
    }
  }
}

/**
 * Estimate part cost. Pure / synchronous — never reaches the network or
 * runs an async catalog query. Throws on unknown material (callers must
 * validate the enum); returns a zero-material result with confidence
 * 'rough' on non-positive volume (degenerate render).
 */
export function estimateCost(opts: EstimateCostOptions): CostBreakdown {
  const material = MATERIAL_PHYSICS[opts.material];
  if (!material) {
    throw new Error(`unknown material "${opts.material}"`);
  }

  const incompat = materialProcessIncompatibility(opts.material, opts.process);
  if (incompat) {
    // Surface as a $0 breakdown with a single diagnostic row + 'rough'
    // confidence. Callers (the tool wrapper) treat this as a soft fail
    // and inline the message into the human-readable output.
    return {
      materialUsd: 0,
      machineUsd: 0,
      setupUsd: 0,
      totalUsd: 0,
      breakdown: [{ label: `INCOMPATIBLE: ${incompat}`, amount: 0, unit: '—' }],
      confidence: 'rough',
    };
  }

  const quantity = Math.max(1, Math.round(opts.quantity ?? 1));
  const bbox = opts.bboxMm;
  const measuredVolumeMm3 = opts.measuredVolumeMm3;

  // Determine the volume used for material + (some) machine math. Prefer
  // the measured value; fall back to bbox if it's all we have.
  let effectiveVolumeMm3 = measuredVolumeMm3 ?? 0;
  if ((!effectiveVolumeMm3 || effectiveVolumeMm3 <= 0) && bbox) {
    effectiveVolumeMm3 = bbox.wMm * bbox.hMm * bbox.dMm;
  }

  // Degenerate volume: nothing to price for material, but still report
  // setup as the lower-bound floor so the user knows "tooling alone costs X".
  if (effectiveVolumeMm3 <= 0) {
    const setupPerPart = SETUP_USD[opts.process] / quantity;
    return {
      materialUsd: 0,
      machineUsd: 0,
      setupUsd: setupPerPart,
      totalUsd: setupPerPart,
      breakdown: [
        { label: 'volume', amount: 0, unit: 'mm³' },
        { label: 'setup (amortized)', amount: setupPerPart, unit: `÷ qty ${quantity}`, rate: SETUP_USD[opts.process] },
      ],
      confidence: 'rough',
    };
  }

  // Material cost. volumeCm3 × densityGPerCm3 = grams; ÷ 1000 = kg.
  const volumeCm3 = effectiveVolumeMm3 / 1000;
  const massKg = (volumeCm3 * material.densityGPerCm3) / 1000;
  const materialUsd = massKg * material.priceUsdPerKg;

  // Machine cost.
  const { machineUsd, row: machineRow } = machineCost(opts, effectiveVolumeMm3);

  // Setup cost (amortized per part).
  const setupRaw = SETUP_USD[opts.process];
  const setupUsd = setupRaw / quantity;

  const totalUsd = materialUsd + machineUsd + setupUsd;

  // Confidence:
  //   medium = measured volume + a process whose machine-time model is
  //            volume-driven (fdm / cnc_mill / sla).
  //   low    = either measured volume present but odd-fit process, OR
  //            no measurement and we synthesized volume from bbox.
  //   rough  = sheet metal (model is a placeholder), OR no volume info
  //            at all (handled above).
  let confidence: CostBreakdown['confidence'];
  if (opts.process === 'sheet') {
    confidence = 'rough';
  } else if (measuredVolumeMm3 !== undefined && measuredVolumeMm3 > 0 &&
      (opts.process === 'fdm' || opts.process === 'cnc_mill' || opts.process === 'sla')) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const breakdown: CostBreakdown['breakdown'] = [
    {
      label: `material (${opts.material})`,
      amount: materialUsd,
      unit: `${massKg.toFixed(4)} kg`,
      rate: material.priceUsdPerKg,
    },
    machineRow,
    {
      label: 'setup (amortized)',
      amount: setupUsd,
      unit: `÷ qty ${quantity}`,
      rate: setupRaw,
    },
  ];

  return {
    materialUsd,
    machineUsd,
    setupUsd,
    totalUsd,
    breakdown,
    confidence,
  };
}

/**
 * Human-readable formatter for tool output. Renders each breakdown row
 * with amount + unit + rate, then a total line and a confidence note.
 */
export function formatCostBreakdown(opts: EstimateCostOptions, cost: CostBreakdown): string {
  const lines: string[] = [];
  lines.push(`Cost estimate for ${opts.process} / ${opts.material} (qty ${opts.quantity ?? 1}):`);
  for (const row of cost.breakdown) {
    const rate = row.rate !== undefined ? ` @ $${row.rate}` : '';
    lines.push(`  ${row.label}: $${row.amount.toFixed(2)} (${row.unit}${rate})`);
  }
  lines.push(`  ─────`);
  lines.push(`  TOTAL: $${cost.totalUsd.toFixed(2)} per part [confidence: ${cost.confidence}]`);
  if (cost.confidence === 'rough') {
    lines.push(`  ⚠ FOR REFERENCE ONLY — sheet metal & geometry-less estimates need a real quote.`);
  }
  return lines.join('\n');
}
