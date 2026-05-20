/**
 * ductSizing.ts — HVAC duct sizing + airflow balance per ASHRAE.
 *
 * SolidWorks Routing Premium covers HVAC ducting; this module ships
 * the engineering math:
 *
 *   - **Equivalent duct diameter** — round / rectangular / oval
 *     conversion to hydraulic equivalent for friction calcs.
 *   - **Friction loss** — ASHRAE Fundamentals Ch. 21 simplified
 *     formula (or Darcy-Weisbach when accuracy needed).
 *   - **Velocity limits per service** — ASHRAE 2017 guidance
 *     (low/medium/high pressure / noise-critical).
 *   - **Airflow balance** — given a tree of supply ducts with target
 *     CFM per outlet, size each segment.
 *   - **Pressure-drop summation** — pick the fan static pressure to
 *     overcome longest path's total ΔP.
 *
 * Standards: ASHRAE 2017, SMACNA HVAC Duct Construction Standards.
 */

export type DuctShape = 'round' | 'rectangular' | 'oval';

export interface DuctSpec {
  shape: DuctShape;
  /** For round: diameter; for rectangular: width (mm). */
  primaryMm: number;
  /** For rectangular: height (mm); for round/oval: not used. */
  secondaryMm?: number;
}

/** Hydraulic diameter (mm). For a rectangular duct W×H:
 *  Dh = 1.30·(W·H)^0.625 / (W+H)^0.25 — ASHRAE equivalent round dia. */
export function hydraulicDiameter(duct: DuctSpec): number {
  switch (duct.shape) {
    case 'round':
      return duct.primaryMm;
    case 'rectangular': {
      const W = duct.primaryMm;
      const H = duct.secondaryMm ?? duct.primaryMm;
      return 1.30 * Math.pow(W * H, 0.625) / Math.pow(W + H, 0.25);
    }
    case 'oval': {
      // Approximate flat-oval as 1.55 × (A·B)^0.625 / P^0.25 where
      // A = major, B = minor, P = perimeter ≈ π·B + 2(A-B).
      const A = duct.primaryMm;
      const B = duct.secondaryMm ?? duct.primaryMm * 0.6;
      const P = Math.PI * B + 2 * (A - B);
      return 1.55 * Math.pow(A * B, 0.625) / Math.pow(P, 0.25);
    }
  }
}

/** Cross-section area (mm²). */
export function ductArea(duct: DuctSpec): number {
  switch (duct.shape) {
    case 'round':
      return Math.PI * Math.pow(duct.primaryMm / 2, 2);
    case 'rectangular':
      return duct.primaryMm * (duct.secondaryMm ?? duct.primaryMm);
    case 'oval': {
      const A = duct.primaryMm;
      const B = duct.secondaryMm ?? duct.primaryMm * 0.6;
      return (A - B) * B + Math.PI * Math.pow(B / 2, 2);
    }
  }
}

// ── Velocity + service limits ───────────────────────────────────

export type DuctService = 'low-pressure-comfort' | 'medium-pressure' | 'high-pressure' | 'noise-critical' | 'kitchen-exhaust';

const MAX_VELOCITY_MS: Record<DuctService, number> = {
  'low-pressure-comfort': 5.0,
  'medium-pressure': 10.0,
  'high-pressure': 20.0,
  'noise-critical': 4.0,
  'kitchen-exhaust': 12.0,
};

export function velocityForFlow(flowCfm: number, duct: DuctSpec): number {
  const m3s = flowCfm * 0.00047194745;
  const area = ductArea(duct) / 1e6; // m²
  return area > 0 ? m3s / area : 0;
}

export function checkVelocity(
  flowCfm: number,
  duct: DuctSpec,
  service: DuctService,
): { velocityMs: number; underLimit: boolean; limit: number } {
  const v = velocityForFlow(flowCfm, duct);
  return { velocityMs: v, underLimit: v <= MAX_VELOCITY_MS[service], limit: MAX_VELOCITY_MS[service] };
}

// ── Friction loss (ASHRAE simplified) ───────────────────────────

/** Friction loss per 100 m of duct (Pa) — ASHRAE simplified for
 *  sheet metal with absolute roughness ε = 0.09 mm. */
export function frictionLossPa100m(
  flowCfm: number,
  duct: DuctSpec,
): number {
  // ASHRAE friction chart fit:
  //   ΔP / L = (0.022) · v^1.9 / Dh^1.22  (Pa/m), v in m/s, Dh in m.
  // We'll output per 100 m.
  const v = velocityForFlow(flowCfm, duct);
  const Dh = hydraulicDiameter(duct) / 1000; // m
  if (Dh <= 0) return 0;
  const lossPerM = 0.022 * Math.pow(v, 1.9) / Math.pow(Dh, 1.22);
  return lossPerM * 100;
}

// ── Fittings (Local losses) ─────────────────────────────────────

export type FittingType = 'elbow-90-radius' | 'elbow-45-radius' | 'tee-branch' | 'tee-straight' | 'reducer' | 'damper-open' | 'damper-half' | 'inlet' | 'outlet';

const FITTING_K_FACTORS: Record<FittingType, number> = {
  'elbow-90-radius': 0.20,
  'elbow-45-radius': 0.10,
  'tee-branch': 0.50,
  'tee-straight': 0.10,
  'reducer': 0.10,
  'damper-open': 0.20,
  'damper-half': 5.00,
  'inlet': 0.50,
  'outlet': 1.00,
};

export function fittingPressureDropPa(
  flowCfm: number,
  duct: DuctSpec,
  fitting: FittingType,
  airDensityKgM3: number = 1.2,
): number {
  const v = velocityForFlow(flowCfm, duct);
  const K = FITTING_K_FACTORS[fitting];
  return K * 0.5 * airDensityKgM3 * v * v;
}

// ── Duct sizing (given flow, find size) ─────────────────────────

const STANDARD_ROUND_DIAS_MM = [100, 125, 150, 200, 250, 300, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000];

/** Pick the smallest standard round diameter that keeps velocity
 *  under the service limit. */
export function sizeRoundDuct(flowCfm: number, service: DuctService): DuctSpec {
  for (const d of STANDARD_ROUND_DIAS_MM) {
    const spec: DuctSpec = { shape: 'round', primaryMm: d };
    if (checkVelocity(flowCfm, spec, service).underLimit) return spec;
  }
  return { shape: 'round', primaryMm: STANDARD_ROUND_DIAS_MM[STANDARD_ROUND_DIAS_MM.length - 1]! };
}

/** Pick a rectangular duct with target aspect ratio ≤ 4:1 that
 *  meets velocity limits and matches the flow.
 *  Aspect ratio < 4:1 keeps friction low. */
export function sizeRectangularDuct(flowCfm: number, service: DuctService): DuctSpec {
  const maxVel = MAX_VELOCITY_MS[service];
  const m3s = flowCfm * 0.00047194745;
  // Required area = flow / max velocity (in m²).
  const reqArea = m3s / maxVel * 1.1; // 10% safety margin
  const reqAreaMm2 = reqArea * 1e6;
  // Pick W = 1.5 × H (typical), then H = sqrt(area / 1.5).
  const H = Math.sqrt(reqAreaMm2 / 1.5);
  // Snap to nearest 50mm.
  const Hsnap = Math.ceil(H / 50) * 50;
  const Wsnap = Math.ceil(Hsnap * 1.5 / 50) * 50;
  return { shape: 'rectangular', primaryMm: Wsnap, secondaryMm: Hsnap };
}

// ── Airflow balance (segment sizing for a tree) ─────────────────

export interface DuctSegment {
  id: string;
  /** Parent segment id; root has no parent. */
  parentId?: string;
  /** Flow demand at the *end* of this segment (CFM). */
  flowCfm: number;
  /** Length (m). */
  lengthM: number;
  /** Optional shape preference. */
  shapePreference?: DuctShape;
  /** Optional fittings on this segment. */
  fittings?: FittingType[];
  /** Resolved size (output). */
  resolvedSpec?: DuctSpec;
  /** Resolved pressure drop (output). */
  resolvedDropPa?: number;
}

/** Walk a duct tree, size each segment, and sum pressure drops.
 *  Returns the longest-path total ΔP — the fan static-pressure
 *  requirement. */
export function balanceAirflow(
  segments: DuctSegment[],
  service: DuctService,
): { sizedSegments: DuctSegment[]; fanPressurePa: number; longestPath: string[] } {
  // Build parent map + accumulate flow upstream.
  const segMap = new Map(segments.map(s => [s.id, { ...s }]));
  const childrenMap = new Map<string, string[]>();
  for (const s of segMap.values()) {
    if (s.parentId) {
      if (!childrenMap.has(s.parentId)) childrenMap.set(s.parentId, []);
      childrenMap.get(s.parentId)!.push(s.id);
    }
  }

  // Roots are segments without parent.
  const roots = Array.from(segMap.values()).filter(s => !s.parentId);
  // Cumulative flow: parent's flow = sum of children's flow + own flow.
  // Walk leaves-first (post-order).
  const visited = new Set<string>();
  const cumulativeFlow = new Map<string, number>();
  function postOrder(id: string): number {
    if (visited.has(id)) return cumulativeFlow.get(id) ?? 0;
    visited.add(id);
    const s = segMap.get(id);
    if (!s) return 0;
    let total = s.flowCfm;
    for (const c of childrenMap.get(id) ?? []) total += postOrder(c);
    cumulativeFlow.set(id, total);
    return total;
  }
  for (const r of roots) postOrder(r.id);

  // Size each segment.
  for (const s of segMap.values()) {
    const flow = cumulativeFlow.get(s.id) ?? s.flowCfm;
    s.resolvedSpec = s.shapePreference === 'rectangular'
      ? sizeRectangularDuct(flow, service)
      : sizeRoundDuct(flow, service);
    const straight = frictionLossPa100m(flow, s.resolvedSpec) * (s.lengthM / 100);
    const fittings = (s.fittings ?? []).reduce(
      (sum, f) => sum + fittingPressureDropPa(flow, s.resolvedSpec!, f), 0);
    s.resolvedDropPa = straight + fittings;
  }

  // Longest-path ΔP via DFS leaf accumulation.
  let maxDrop = 0;
  let longestPath: string[] = [];
  function dfs(id: string, drop: number, path: string[]): void {
    const s = segMap.get(id);
    if (!s) return;
    const newDrop = drop + (s.resolvedDropPa ?? 0);
    const newPath = [...path, id];
    const kids = childrenMap.get(id) ?? [];
    if (kids.length === 0) {
      if (newDrop > maxDrop) { maxDrop = newDrop; longestPath = newPath; }
    } else {
      for (const k of kids) dfs(k, newDrop, newPath);
    }
  }
  for (const r of roots) dfs(r.id, 0, []);

  return {
    sizedSegments: Array.from(segMap.values()),
    fanPressurePa: maxDrop,
    longestPath,
  };
}
