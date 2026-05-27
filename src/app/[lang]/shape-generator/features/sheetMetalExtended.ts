/**
 * sheetMetalExtended.ts — Edge flange, miter flange, tab + slot,
 * louver, lance, dimple sheet-metal features.
 *
 * Stage 1 (`sheetMetal.ts`) covers Bend / Flange / Hem / Jog. This
 * module adds the rest of the SolidWorks sheet-metal toolset:
 *
 *   - **Edge flange** — fold a strip of material 90° from a selected
 *     edge. Differs from generic Flange by referencing the edge
 *     directly (no profile sketch).
 *   - **Miter flange** — chain edge flanges along a series of edges,
 *     auto-mitering the corner cuts so adjacent flanges meet at 45°.
 *   - **Tab + slot** — drop-in mating pair (tab on part A, matching
 *     slot on part B) for self-locating weld joints.
 *   - **Louver** — angled cut + bend used for ventilation panels.
 *   - **Lance** — partial cut + bend (no material removed) for tabs.
 *   - **Dimple** — small dome embossed for stiffening or alignment.
 *
 * Returns parametric specs the renderer / pipeline can build geometry
 * from. Validates against material thickness + bend radius rules.
 */

export interface EdgeRef {
  /** Body / shell id the edge belongs to. */
  bodyId: string;
  /** Edge index in the body's mesh. */
  edgeIndex: number;
  /** Edge length (mm). */
  lengthMm: number;
  /** Edge direction unit vector. */
  direction: [number, number, number];
}

// ── Edge flange ─────────────────────────────────────────────────

export interface EdgeFlangeSpec {
  edge: EdgeRef;
  /** Material thickness (mm). */
  thicknessMm: number;
  /** Inner bend radius (mm). */
  innerRadiusMm: number;
  /** Flange angle (deg). 90 = perpendicular, 180 = closed hem. */
  angleDeg: number;
  /** Flange length (mm). */
  flangeLengthMm: number;
  /** Whether to gap-cut at both ends (typ. thickness on each side). */
  gapEnds: boolean;
}

export interface EdgeFlangeReport {
  /** Total bend allowance (mm) added to the flat blank. */
  bendAllowanceMm: number;
  /** Required minimum flange length for the press brake. */
  minFlangeLengthMm: number;
  warnings: string[];
}

export function analyzeEdgeFlange(spec: EdgeFlangeSpec): EdgeFlangeReport {
  const warnings: string[] = [];
  // Bend allowance: π · θ · (R + K·t).
  const k = 0.4; // K-factor approximation
  const ba = (Math.PI / 180) * spec.angleDeg * (spec.innerRadiusMm + k * spec.thicknessMm);
  // Min flange = R + 2t (typical press-brake rule).
  const minLen = spec.innerRadiusMm + 2 * spec.thicknessMm;
  if (spec.flangeLengthMm < minLen) {
    warnings.push(`Flange length ${spec.flangeLengthMm}mm < minimum ${minLen.toFixed(1)}mm`);
  }
  if (spec.innerRadiusMm < spec.thicknessMm) {
    warnings.push(`Bend radius ${spec.innerRadiusMm}mm < thickness ${spec.thicknessMm}mm — may crack`);
  }
  if (spec.angleDeg > 90 && !spec.gapEnds) {
    warnings.push('Over-bend without end gaps may interfere — recommend gapEnds = true');
  }
  return { bendAllowanceMm: ba, minFlangeLengthMm: minLen, warnings };
}

// ── Miter flange ────────────────────────────────────────────────

export interface MiterFlangeSpec {
  /** Sequence of edges (must share endpoints — chain). */
  edges: EdgeRef[];
  thicknessMm: number;
  innerRadiusMm: number;
  /** Common flange length applied along the entire chain. */
  flangeLengthMm: number;
}

export interface MiterCornerReport {
  /** Index of the corner (between edges[i] and edges[i+1]). */
  cornerIndex: number;
  /** Miter cut angle measured between the two edges (deg, 0..180). */
  cornerAngleDeg: number;
  /** True when corner is an outside (convex) corner. */
  isConvex: boolean;
}

export function analyzeMiterFlange(spec: MiterFlangeSpec): { corners: MiterCornerReport[]; warnings: string[] } {
  const corners: MiterCornerReport[] = [];
  const warnings: string[] = [];
  if (spec.edges.length < 2) {
    warnings.push('Miter requires at least 2 edges');
    return { corners, warnings };
  }
  for (let i = 0; i < spec.edges.length - 1; i++) {
    const a = spec.edges[i]!;
    const b = spec.edges[i + 1]!;
    const dot = a.direction[0] * b.direction[0]
      + a.direction[1] * b.direction[1]
      + a.direction[2] * b.direction[2];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    corners.push({
      cornerIndex: i,
      cornerAngleDeg: angle,
      isConvex: dot < 0,
    });
    if (angle < 30) {
      warnings.push(`Corner ${i} angle ${angle.toFixed(0)}° < 30° — flanges may collide`);
    }
  }
  return { corners, warnings };
}

// ── Tab + slot pair ─────────────────────────────────────────────

export interface TabSpec {
  /** Tab width along the edge (mm). */
  widthMm: number;
  /** Tab height (protrudes from base, mm). */
  heightMm: number;
  /** Tab clearance on each side of width (mm) for assembly fit. */
  clearanceMm: number;
}

export interface TabSlotPair {
  tabSide: { tabs: Array<{ positionAlongEdgeMm: number; spec: TabSpec }> };
  slotSide: { slots: Array<{ positionAlongEdgeMm: number; widthMm: number; heightMm: number }> };
}

/** Generate evenly spaced tab/slot pairs along an edge. */
export function generateTabSlot(
  edge: EdgeRef,
  tabSpec: TabSpec,
  count: number,
  endMargin: number = 20,
): TabSlotPair {
  const usableLen = edge.lengthMm - endMargin * 2;
  const tabs: TabSlotPair['tabSide']['tabs'] = [];
  const slots: TabSlotPair['slotSide']['slots'] = [];
  if (count < 1 || usableLen <= 0) return { tabSide: { tabs }, slotSide: { slots } };
  const spacing = count > 1 ? usableLen / (count - 1) : usableLen / 2;
  for (let i = 0; i < count; i++) {
    const pos = endMargin + (count > 1 ? i * spacing : spacing);
    tabs.push({ positionAlongEdgeMm: pos, spec: tabSpec });
    slots.push({
      positionAlongEdgeMm: pos,
      widthMm: tabSpec.widthMm + tabSpec.clearanceMm * 2,
      heightMm: tabSpec.heightMm + tabSpec.clearanceMm,
    });
  }
  return { tabSide: { tabs }, slotSide: { slots } };
}

// ── Louver ──────────────────────────────────────────────────────

export interface LouverSpec {
  /** Louver width (mm). */
  widthMm: number;
  /** Louver length (mm). */
  lengthMm: number;
  /** Louver opening height when bent (mm). */
  openingMm: number;
  /** Material thickness (mm). */
  thicknessMm: number;
}

export interface LouverReport {
  /** Calculated bend angle from triangle geometry. */
  bendAngleDeg: number;
  /** Total cut length on the flat blank (for laser job time). */
  cutLengthMm: number;
  warnings: string[];
}

export function analyzeLouver(spec: LouverSpec): LouverReport {
  // Bend angle = atan(opening / lengthHalf).
  const halfLen = spec.lengthMm / 2;
  const angle = Math.atan2(spec.openingMm, halfLen) * 180 / Math.PI;
  // Cut on flat: 3 sides (front + 2 ends).
  const cutLen = spec.widthMm + 2 * halfLen;
  const warnings: string[] = [];
  if (spec.openingMm < spec.thicknessMm * 2) {
    warnings.push('Opening < 2× thickness — louver functionally closed');
  }
  if (angle > 30) {
    warnings.push(`Louver bend ${angle.toFixed(0)}° > 30° — material may tear`);
  }
  return { bendAngleDeg: angle, cutLengthMm: cutLen, warnings };
}

// ── Lance + form ────────────────────────────────────────────────

export interface LanceSpec {
  /** Cut length (mm). */
  cutLengthMm: number;
  /** Form (lift) height (mm). */
  formHeightMm: number;
  /** Material thickness (mm). */
  thicknessMm: number;
}

export function lanceForce(spec: LanceSpec, materialUts: number = 400): number {
  // Approximate force to lance & form (N) = perimeter × thickness × UTS / 2.
  return spec.cutLengthMm * spec.thicknessMm * materialUts / 2;
}

// ── Dimple ──────────────────────────────────────────────────────

export interface DimpleSpec {
  /** Outer rim diameter (mm). */
  rimDiameterMm: number;
  /** Dimple depth (mm). */
  depthMm: number;
  /** Material thickness (mm). */
  thicknessMm: number;
}

export interface DimpleReport {
  /** Dome surface area (mm²) — for waste / weight calc. */
  surfaceAreaMm2: number;
  /** Estimated stretch ratio in the dome material. */
  stretchRatio: number;
  warnings: string[];
}

export function analyzeDimple(spec: DimpleSpec): DimpleReport {
  // Spherical-cap approximation: r = rimDia/2, h = depth.
  // Sphere R = (r² + h²) / (2h).
  const r = spec.rimDiameterMm / 2;
  const h = spec.depthMm;
  if (h === 0) {
    return { surfaceAreaMm2: 0, stretchRatio: 1, warnings: [] };
  }
  const R = (r * r + h * h) / (2 * h);
  // Cap area = 2πRh.
  const capArea = 2 * Math.PI * R * h;
  const rimArea = Math.PI * r * r;
  const stretch = capArea / rimArea;
  const warnings: string[] = [];
  if (stretch > 1.2) {
    warnings.push(`Dimple stretch ${stretch.toFixed(2)} > 1.2 — material may thin >15%`);
  }
  if (spec.rimDiameterMm < spec.thicknessMm * 6) {
    warnings.push('Dimple rim < 6× thickness — may not form cleanly');
  }
  return { surfaceAreaMm2: capArea, stretchRatio: stretch, warnings };
}
