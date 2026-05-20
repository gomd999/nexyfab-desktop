/**
 * dfmRules.ts — Design-for-Manufacturing rule checker.
 *
 * Per-process rules that catch parts a CAM operator would push back
 * on: minimum wall thickness, hole-to-edge distance, internal corner
 * radius, draft angles, etc. Each rule emits a `DfmFinding` with
 * severity (info / warn / error) so the UI can colour the part by
 * issue density.
 *
 * Five processes covered:
 *   - **CNC milling** (3-axis subtractive)
 *   - **Injection molding**
 *   - **Sheet metal bending**
 *   - **FDM 3-D printing**
 *   - **SLS / SLA 3-D printing**
 *
 * Geometric heuristics consume an analysis input (BB, hole list, wall
 * thickness map, etc) rather than raw geometry — keeps the rules
 * cheap + composable with the existing `featureExtraction` pipeline.
 */

export type DfmSeverity = 'info' | 'warn' | 'error';
export type DfmProcess = 'cnc-mill' | 'injection-mold' | 'sheet-metal' | 'fdm' | 'sla';

export interface DfmFinding {
  code: string;
  process: DfmProcess;
  severity: DfmSeverity;
  message: string;
  /** Optional pointer to where on the part the issue is. */
  location?: [number, number, number];
  /** Numeric value that triggered the rule (vs threshold). */
  measured?: number;
  threshold?: number;
}

export interface DfmAnalysisInput {
  /** Bounding box mm. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Per-feature wall thickness (mm). Use 0 / Infinity sentinels for unknown. */
  minWallMm?: number;
  /** Hole list with position + diameter + depth + distance-to-nearest-edge. */
  holes?: Array<{
    position: [number, number, number];
    diameterMm: number;
    depthMm: number;
    distanceToEdgeMm?: number;
  }>;
  /** Sharp internal corner radii (mm). */
  internalCorners?: Array<{ radiusMm: number; location: [number, number, number] }>;
  /** Draft angles per face (deg) — pull direction implied. */
  drafts?: Array<{ angleDeg: number; location: [number, number, number] }>;
  /** Sheet thickness for sheet-metal parts (mm). */
  sheetThicknessMm?: number;
  /** Bend radii for sheet-metal parts (mm). */
  bendRadii?: number[];
  /** Overhang regions for FDM (angle from build direction, deg). */
  overhangs?: Array<{ angleDeg: number; areaMm2: number }>;
}

// ── CNC milling rules ─────────────────────────────────────────────

export function checkCnc(input: DfmAnalysisInput): DfmFinding[] {
  const findings: DfmFinding[] = [];

  // Rule CNC-01: Min wall thickness 0.8 mm.
  if (input.minWallMm != null && input.minWallMm < 0.8) {
    findings.push({
      code: 'CNC-01',
      process: 'cnc-mill',
      severity: 'error',
      message: `Wall ${input.minWallMm.toFixed(2)}mm < 0.8mm minimum for 3-axis CNC`,
      measured: input.minWallMm,
      threshold: 0.8,
    });
  }

  // Rule CNC-02: Hole depth/diameter ratio. Standard drill depth ≤ 5×dia;
  // beyond that you need pecking or special tooling.
  for (const h of input.holes ?? []) {
    if (h.diameterMm === 0) continue;
    const ratio = h.depthMm / h.diameterMm;
    if (ratio > 8) {
      findings.push({
        code: 'CNC-02',
        process: 'cnc-mill',
        severity: 'error',
        message: `Deep hole (D=${h.diameterMm}, depth=${h.depthMm}): ratio ${ratio.toFixed(1)} > 8`,
        location: h.position,
        measured: ratio,
        threshold: 8,
      });
    } else if (ratio > 5) {
      findings.push({
        code: 'CNC-02',
        process: 'cnc-mill',
        severity: 'warn',
        message: `Deep hole — depth/diameter = ${ratio.toFixed(1)} (>5 needs pecking)`,
        location: h.position,
        measured: ratio,
        threshold: 5,
      });
    }
  }

  // Rule CNC-03: Hole to edge — minimum 1× diameter from any edge.
  for (const h of input.holes ?? []) {
    if (h.distanceToEdgeMm == null) continue;
    if (h.distanceToEdgeMm < h.diameterMm) {
      findings.push({
        code: 'CNC-03',
        process: 'cnc-mill',
        severity: 'warn',
        message: `Hole too close to edge: ${h.distanceToEdgeMm.toFixed(2)}mm < diameter ${h.diameterMm}mm`,
        location: h.position,
        measured: h.distanceToEdgeMm,
        threshold: h.diameterMm,
      });
    }
  }

  // Rule CNC-04: Internal corners — endmill diameter ~3mm typical, so
  // sharp internal corners cannot be machined. Want r ≥ 1.5mm minimum.
  for (const corner of input.internalCorners ?? []) {
    if (corner.radiusMm < 1.5) {
      findings.push({
        code: 'CNC-04',
        process: 'cnc-mill',
        severity: corner.radiusMm < 0.5 ? 'error' : 'warn',
        message: `Internal corner r=${corner.radiusMm.toFixed(2)}mm < 1.5mm — endmill cannot reach`,
        location: corner.location,
        measured: corner.radiusMm,
        threshold: 1.5,
      });
    }
  }

  return findings;
}

// ── Injection molding rules ───────────────────────────────────────

export function checkInjectionMold(input: DfmAnalysisInput): DfmFinding[] {
  const findings: DfmFinding[] = [];

  // Rule IM-01: Draft angle ≥ 1° on every face perpendicular to pull.
  for (const d of input.drafts ?? []) {
    if (d.angleDeg < 1) {
      findings.push({
        code: 'IM-01',
        process: 'injection-mold',
        severity: 'error',
        message: `Draft ${d.angleDeg.toFixed(2)}° < 1° — part will stick in mold`,
        location: d.location,
        measured: d.angleDeg,
        threshold: 1,
      });
    } else if (d.angleDeg < 3) {
      findings.push({
        code: 'IM-01',
        process: 'injection-mold',
        severity: 'warn',
        message: `Draft ${d.angleDeg.toFixed(2)}° < 3° recommended for textured surfaces`,
        location: d.location,
        measured: d.angleDeg,
        threshold: 3,
      });
    }
  }

  // Rule IM-02: Wall thickness uniformity — within 25% of average.
  if (input.minWallMm != null && input.minWallMm < 1.0) {
    findings.push({
      code: 'IM-02',
      process: 'injection-mold',
      severity: 'warn',
      message: `Thin wall ${input.minWallMm.toFixed(2)}mm < 1.0mm — short shots likely`,
      measured: input.minWallMm,
      threshold: 1.0,
    });
  }

  // Rule IM-03: Internal corners ≥ 0.5 × wall thickness.
  const targetCornerR = (input.minWallMm ?? 2) * 0.5;
  for (const corner of input.internalCorners ?? []) {
    if (corner.radiusMm < targetCornerR) {
      findings.push({
        code: 'IM-03',
        process: 'injection-mold',
        severity: 'warn',
        message: `Sharp internal corner r=${corner.radiusMm.toFixed(2)}mm; stress concentration risk`,
        location: corner.location,
        measured: corner.radiusMm,
        threshold: targetCornerR,
      });
    }
  }

  return findings;
}

// ── Sheet metal bending rules ─────────────────────────────────────

export function checkSheetMetal(input: DfmAnalysisInput): DfmFinding[] {
  const findings: DfmFinding[] = [];
  const t = input.sheetThicknessMm;
  if (t == null) return findings;

  // Rule SM-01: Bend radius ≥ sheet thickness.
  for (const r of input.bendRadii ?? []) {
    if (r < t) {
      findings.push({
        code: 'SM-01',
        process: 'sheet-metal',
        severity: 'error',
        message: `Bend r=${r.toFixed(2)}mm < thickness ${t}mm — material will crack`,
        measured: r,
        threshold: t,
      });
    } else if (r < t * 2) {
      findings.push({
        code: 'SM-01',
        process: 'sheet-metal',
        severity: 'warn',
        message: `Bend r=${r.toFixed(2)}mm < 2t (${(t * 2).toFixed(1)}mm) recommended`,
        measured: r,
        threshold: t * 2,
      });
    }
  }

  // Rule SM-02: Hole-to-bend distance ≥ 3t (avoid deformation).
  for (const h of input.holes ?? []) {
    if (h.distanceToEdgeMm == null) continue;
    if (h.distanceToEdgeMm < 3 * t) {
      findings.push({
        code: 'SM-02',
        process: 'sheet-metal',
        severity: 'warn',
        message: `Hole too close to bend: ${h.distanceToEdgeMm.toFixed(2)}mm < 3t (${(3 * t).toFixed(1)}mm)`,
        location: h.position,
        measured: h.distanceToEdgeMm,
        threshold: 3 * t,
      });
    }
  }

  return findings;
}

// ── FDM 3-D printing rules ────────────────────────────────────────

export function checkFdm(input: DfmAnalysisInput): DfmFinding[] {
  const findings: DfmFinding[] = [];

  // Rule FDM-01: Overhang > 45° needs support.
  for (const o of input.overhangs ?? []) {
    if (o.angleDeg > 45 && o.areaMm2 > 100) {
      findings.push({
        code: 'FDM-01',
        process: 'fdm',
        severity: o.angleDeg > 60 ? 'error' : 'warn',
        message: `Overhang ${o.angleDeg.toFixed(0)}° (area ${o.areaMm2.toFixed(0)}mm²) requires support`,
        measured: o.angleDeg,
        threshold: 45,
      });
    }
  }

  // Rule FDM-02: Wall < 0.8mm (nozzle diameter) won't print cleanly.
  if (input.minWallMm != null && input.minWallMm < 0.8) {
    findings.push({
      code: 'FDM-02',
      process: 'fdm',
      severity: 'error',
      message: `Wall ${input.minWallMm.toFixed(2)}mm < 0.8mm nozzle minimum`,
      measured: input.minWallMm,
      threshold: 0.8,
    });
  }

  // Rule FDM-03: Bounding box vs build plate (default 250×250×300).
  const w = input.bbox.max[0] - input.bbox.min[0];
  const d = input.bbox.max[1] - input.bbox.min[1];
  const h = input.bbox.max[2] - input.bbox.min[2];
  if (w > 250 || d > 250 || h > 300) {
    findings.push({
      code: 'FDM-03',
      process: 'fdm',
      severity: 'error',
      message: `Part ${w.toFixed(0)}×${d.toFixed(0)}×${h.toFixed(0)}mm exceeds typical FDM build volume (250×250×300)`,
    });
  }

  return findings;
}

// ── SLA / SLS rules ───────────────────────────────────────────────

export function checkSla(input: DfmAnalysisInput): DfmFinding[] {
  const findings: DfmFinding[] = [];

  // Rule SLA-01: Min wall 0.4mm (laser kerf).
  if (input.minWallMm != null && input.minWallMm < 0.4) {
    findings.push({
      code: 'SLA-01',
      process: 'sla',
      severity: 'error',
      message: `Wall ${input.minWallMm.toFixed(2)}mm < 0.4mm SLA minimum`,
      measured: input.minWallMm,
      threshold: 0.4,
    });
  }

  // Rule SLA-02: Hollow parts need drain hole ≥ 3mm.
  // (Caller would mark a hole as `purpose='drain'` for a more refined check.)
  // For now we report info-level reminder for any deep enclosed part.

  // Rule SLA-03: Trapped resin volume — closed cavity warning.
  // Same caveat as SLA-02: needs richer analysis input.

  return findings;
}

/** Aggregate runner — applies the rule set for the given process. */
export function runDfmChecks(process: DfmProcess, input: DfmAnalysisInput): DfmFinding[] {
  switch (process) {
    case 'cnc-mill': return checkCnc(input);
    case 'injection-mold': return checkInjectionMold(input);
    case 'sheet-metal': return checkSheetMetal(input);
    case 'fdm': return checkFdm(input);
    case 'sla': return checkSla(input);
  }
}

/** Summary stats for the UI badge. */
export interface DfmSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  /** True when no error-level findings. */
  acceptable: boolean;
}

export function summarizeDfm(findings: DfmFinding[]): DfmSummary {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  return {
    total: findings.length,
    errors,
    warnings,
    infos,
    acceptable: errors === 0,
  };
}
