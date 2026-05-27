/**
 * stockMaterialCatalog.ts — Catalog of CAM stock material grades with
 * cutting-parameter recommendations.
 *
 * Each entry provides:
 *   - Material code, name, density, hardness HB.
 *   - Recommended cutting speed (Vc, m/min).
 *   - Recommended feed per tooth (fz, mm).
 *   - Specific cutting force kc1.1 (MPa).
 *   - Common surface finish achievable.
 *
 * Used by CAM toolpath generators to populate default parameters
 * and by cost estimators (machinability index).
 */

export type StockCode =
  | 'AL-6061' | 'AL-7075' | 'STEEL-1018' | 'STEEL-4140' | 'SS-304' | 'SS-316' | 'TI-6AL4V'
  | 'INCONEL-718' | 'CAST-IRON-GG25' | 'COPPER-C110' | 'BRASS-C260' | 'POM' | 'PEEK';

export interface StockMaterial {
  code: StockCode;
  name: string;
  densityKgM3: number;
  brinellHB: number;
  /** Recommended cutting speed for end-mill, m/min. */
  recVcMpm: number;
  /** Recommended feed per tooth, mm. */
  recFzMm: number;
  /** Specific cutting force kc1.1, MPa. */
  kc11Mpa: number;
  /** Typical achievable Ra, μm. */
  achievableRaMicron: number;
  /** Machinability index (steel 1018 baseline = 100). */
  machinabilityIndex: number;
}

export const STOCK_CATALOG: Record<StockCode, StockMaterial> = {
  'AL-6061':       { code: 'AL-6061', name: 'Aluminum 6061-T6', densityKgM3: 2700, brinellHB: 95, recVcMpm: 600, recFzMm: 0.1, kc11Mpa: 800, achievableRaMicron: 0.8, machinabilityIndex: 350 },
  'AL-7075':       { code: 'AL-7075', name: 'Aluminum 7075-T6', densityKgM3: 2810, brinellHB: 150, recVcMpm: 400, recFzMm: 0.08, kc11Mpa: 1000, achievableRaMicron: 1.2, machinabilityIndex: 250 },
  'STEEL-1018':    { code: 'STEEL-1018', name: 'Mild Steel 1018', densityKgM3: 7870, brinellHB: 130, recVcMpm: 120, recFzMm: 0.08, kc11Mpa: 2000, achievableRaMicron: 1.6, machinabilityIndex: 100 },
  'STEEL-4140':    { code: 'STEEL-4140', name: 'Alloy Steel 4140', densityKgM3: 7850, brinellHB: 285, recVcMpm: 80, recFzMm: 0.06, kc11Mpa: 2800, achievableRaMicron: 1.6, machinabilityIndex: 65 },
  'SS-304':        { code: 'SS-304', name: 'Stainless 304', densityKgM3: 8000, brinellHB: 200, recVcMpm: 60, recFzMm: 0.05, kc11Mpa: 2400, achievableRaMicron: 1.2, machinabilityIndex: 40 },
  'SS-316':        { code: 'SS-316', name: 'Stainless 316', densityKgM3: 8000, brinellHB: 215, recVcMpm: 50, recFzMm: 0.05, kc11Mpa: 2600, achievableRaMicron: 1.2, machinabilityIndex: 36 },
  'TI-6AL4V':      { code: 'TI-6AL4V', name: 'Titanium Ti-6Al-4V', densityKgM3: 4430, brinellHB: 334, recVcMpm: 40, recFzMm: 0.04, kc11Mpa: 2100, achievableRaMicron: 0.8, machinabilityIndex: 22 },
  'INCONEL-718':   { code: 'INCONEL-718', name: 'Inconel 718', densityKgM3: 8190, brinellHB: 400, recVcMpm: 25, recFzMm: 0.03, kc11Mpa: 3000, achievableRaMicron: 0.8, machinabilityIndex: 12 },
  'CAST-IRON-GG25':{ code: 'CAST-IRON-GG25', name: 'Cast Iron GG25', densityKgM3: 7200, brinellHB: 220, recVcMpm: 100, recFzMm: 0.1, kc11Mpa: 1300, achievableRaMicron: 3.2, machinabilityIndex: 80 },
  'COPPER-C110':   { code: 'COPPER-C110', name: 'Copper C110', densityKgM3: 8960, brinellHB: 75, recVcMpm: 250, recFzMm: 0.08, kc11Mpa: 1200, achievableRaMicron: 0.8, machinabilityIndex: 180 },
  'BRASS-C260':    { code: 'BRASS-C260', name: 'Brass C260', densityKgM3: 8530, brinellHB: 90, recVcMpm: 300, recFzMm: 0.1, kc11Mpa: 800, achievableRaMicron: 0.8, machinabilityIndex: 220 },
  'POM':           { code: 'POM', name: 'Acetal (POM)', densityKgM3: 1410, brinellHB: 25, recVcMpm: 500, recFzMm: 0.1, kc11Mpa: 200, achievableRaMicron: 0.8, machinabilityIndex: 280 },
  'PEEK':          { code: 'PEEK', name: 'PEEK', densityKgM3: 1320, brinellHB: 28, recVcMpm: 400, recFzMm: 0.08, kc11Mpa: 250, achievableRaMicron: 1.2, machinabilityIndex: 240 },
};

// ── Lookup ────────────────────────────────────────────────────

export function lookup(code: StockCode): StockMaterial {
  return STOCK_CATALOG[code];
}

// ── Filter by criteria ───────────────────────────────────────

export interface FilterCriteria {
  minMachinability?: number;
  maxBrinell?: number;
  maxKc11?: number;
  achievableRaMax?: number;
}

export function filterByCriteria(criteria: FilterCriteria): StockMaterial[] {
  return Object.values(STOCK_CATALOG).filter(m => {
    if (criteria.minMachinability !== undefined && m.machinabilityIndex < criteria.minMachinability) return false;
    if (criteria.maxBrinell !== undefined && m.brinellHB > criteria.maxBrinell) return false;
    if (criteria.maxKc11 !== undefined && m.kc11Mpa > criteria.maxKc11) return false;
    if (criteria.achievableRaMax !== undefined && m.achievableRaMicron > criteria.achievableRaMax) return false;
    return true;
  });
}

// ── Spindle speed (RPM) from Vc + tool diameter ──────────────

export function spindleRpm(material: StockMaterial, toolDiameterMm: number): number {
  if (toolDiameterMm <= 0) return 0;
  return (material.recVcMpm * 1000) / (Math.PI * toolDiameterMm);
}

// ── Feed rate (mm/min) from fz, flutes, spindle ──────────────

export function feedMmMin(material: StockMaterial, flutes: number, rpm: number): number {
  return material.recFzMm * flutes * rpm;
}

// ── Material weight ───────────────────────────────────────────

export function blockWeightKg(material: StockMaterial, volumeCm3: number): number {
  return (material.densityKgM3 * volumeCm3) / 1e6;
}

// ── Compare two materials ────────────────────────────────────

export interface MaterialComparison {
  baseCode: StockCode;
  candidateCode: StockCode;
  machinabilityRatio: number;
  costFactorEstimate: number;
}

export function compare(base: StockCode, candidate: StockCode): MaterialComparison {
  const b = STOCK_CATALOG[base];
  const c = STOCK_CATALOG[candidate];
  const ratio = c.machinabilityIndex / Math.max(0.001, b.machinabilityIndex);
  // Naive cost estimate: lower machinability → higher cost per piece.
  const cost = b.machinabilityIndex / Math.max(0.001, c.machinabilityIndex);
  return {
    baseCode: base,
    candidateCode: candidate,
    machinabilityRatio: ratio,
    costFactorEstimate: cost,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CatalogSummary {
  totalMaterials: number;
  hardestBrinell: number;
  highestMachinability: StockCode;
}

export function summarize(): CatalogSummary {
  const all = Object.values(STOCK_CATALOG);
  let hardest = 0;
  let bestMachinability = 0;
  let bestCode: StockCode = 'AL-6061';
  for (const m of all) {
    if (m.brinellHB > hardest) hardest = m.brinellHB;
    if (m.machinabilityIndex > bestMachinability) {
      bestMachinability = m.machinabilityIndex;
      bestCode = m.code;
    }
  }
  return {
    totalMaterials: all.length,
    hardestBrinell: hardest,
    highestMachinability: bestCode,
  };
}
