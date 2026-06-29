/**
 * consumerFeatures.ts — Mounting boss, snap hook, vent grille, rib.
 *
 * Consumer plastic-part design has a small set of specialty features
 * SolidWorks ships as dedicated commands:
 *
 *   - **Mounting boss** — cylindrical post that receives a self-
 *     tapping screw, with gussets + draft + thread-pilot hole.
 *   - **Snap hook** (Cantilever / Annular) — flexible catch that
 *     deflects on assembly + locks on release. Strength + deflection
 *     are governed by the cantilever-beam formula.
 *   - **Vent grille** — array of louvers / circular openings in a
 *     panel, sized for required CFM at given ΔP.
 *   - **Strengthening rib** — flat plate-stiffening rib with
 *     draft + fillet at base.
 *
 * Each is parametric (returns dimension specs + warnings) — the
 * actual 3D geometry is built downstream by the feature pipeline.
 */

// ── Mounting boss ───────────────────────────────────────────────

export interface MountingBossSpec {
  /** Outer diameter of the boss (mm). */
  outerDiameterMm: number;
  /** Pilot hole diameter for the self-tapping screw (mm). */
  pilotHoleDiameterMm: number;
  /** Boss height above the base (mm). */
  heightMm: number;
  /** Wall thickness around the pilot hole (mm) — typ 0.6 × screw dia. */
  wallThicknessMm: number;
  /** Optional gusset (triangular rib) count. */
  gussetCount?: number;
  /** Gusset thickness (mm). */
  gussetThicknessMm?: number;
  /** Draft angle (degrees) — typ 1-3° for plastic injection. */
  draftAngleDeg: number;
  /** Material yield strength (MPa). */
  materialYieldMpa?: number;
}

export interface MountingBossReport {
  /** Boss volume (mm³). */
  volumeMm3: number;
  /** Maximum pull-out load before pilot strip-out (N). */
  pullOutForceN: number;
  /** Warnings about manufacturability. */
  warnings: string[];
}

/** Analyze a mounting boss spec. */
export function analyzeMountingBoss(spec: MountingBossSpec): MountingBossReport {
  const warnings: string[] = [];
  const wallThickness = spec.wallThicknessMm;
  const outerR = spec.outerDiameterMm / 2;
  const innerR = spec.pilotHoleDiameterMm / 2;

  // Validate proportions.
  if (outerR <= innerR) {
    warnings.push('Outer diameter ≤ pilot — invalid boss');
  }
  if (wallThickness < 0.4) {
    warnings.push(`Wall ${wallThickness}mm < 0.4mm — thin for injection`);
  }
  if (spec.heightMm > spec.outerDiameterMm * 3) {
    warnings.push('Boss height > 3× outer dia — buckling risk');
  }
  if (spec.draftAngleDeg < 0.5) {
    warnings.push('Draft < 0.5° — part may stick in mold');
  }

  // Volume = annulus × height + gusset volume.
  const annulusArea = Math.PI * (outerR * outerR - innerR * innerR);
  const bossVol = annulusArea * spec.heightMm;
  const gussetVol = spec.gussetCount && spec.gussetThicknessMm
    ? spec.gussetCount * spec.gussetThicknessMm * outerR * spec.heightMm * 0.5
    : 0;
  const totalVol = bossVol + gussetVol;

  // Pull-out force: thread engagement × pilot perimeter × shear strength.
  // Shear strength ≈ 0.6 × yield (von Mises convention).
  const yieldMpa = spec.materialYieldMpa ?? 60; // ABS default
  const shearStrengthMpa = yieldMpa * 0.6;
  const threadArea = Math.PI * spec.pilotHoleDiameterMm * spec.heightMm;
  // Convert MPa·mm² → N (since 1 MPa = 1 N/mm²).
  const pullOut = shearStrengthMpa * threadArea;

  return { volumeMm3: totalVol, pullOutForceN: pullOut, warnings };
}

// ── Snap hook (cantilever) ──────────────────────────────────────

export type SnapHookType = 'cantilever' | 'annular' | 'torsional';

export interface SnapHookSpec {
  type: SnapHookType;
  /** Hook length (mm). */
  lengthMm: number;
  /** Beam width (mm). */
  widthMm: number;
  /** Beam thickness at the base (mm). */
  thicknessBaseMm: number;
  /** Beam thickness at the tip (mm, ≤ base). */
  thicknessTipMm: number;
  /** Catch height (deflection during assembly, mm). */
  catchHeightMm: number;
  /** Material modulus (MPa). */
  modulusMpa: number;
  /** Material yield strain (%, e.g. 4 for many engineering plastics). */
  permissibleStrainPercent: number;
  /** Friction coefficient between mating surfaces. */
  friction: number;
  /** Insertion angle (degrees from beam axis). */
  insertionAngleDeg: number;
  /** Removal angle (degrees). */
  removalAngleDeg: number;
}

export interface SnapHookReport {
  /** Required deflection force (N). */
  insertionForceN: number;
  /** Force needed to disassemble (N). */
  removalForceN: number;
  /** Maximum strain at the base when deflected (%). */
  maxStrainPercent: number;
  /** Safety factor (permissibleStrain / maxStrain). */
  strainSafetyFactor: number;
  warnings: string[];
}

/** Cantilever snap fit per Bayer / GE design guide. */
export function analyzeSnapHook(spec: SnapHookSpec): SnapHookReport {
  const warnings: string[] = [];
  const t = spec.thicknessBaseMm;
  const L = spec.lengthMm;
  const y = spec.catchHeightMm;
  const E = spec.modulusMpa;
  // Tapered-beam Q factor (Bayer): Q = 1.5 + (h_tip/h_base) × 0.3 (approx).
  const Q = 1.5 + (spec.thicknessTipMm / spec.thicknessBaseMm) * 0.3;
  // Max strain ε = (1.5 × t × y) / (L² × Q).
  const strain = (1.5 * t * y) / (L * L * Q);
  const strainPercent = strain * 100;

  // Permissible strain.
  if (strainPercent > spec.permissibleStrainPercent) {
    warnings.push(`Strain ${strainPercent.toFixed(2)}% exceeds permissible ${spec.permissibleStrainPercent}% — beam will crack`);
  }
  const strainSF = spec.permissibleStrainPercent / Math.max(0.01, strainPercent);

  // Deflection force (cantilever): P = (b × t³ × E × y) / (4 × L³).
  const b = spec.widthMm;
  const deflectionForce = (b * Math.pow(t, 3) * E * y) / (4 * Math.pow(L, 3));

  // Effective insertion / removal forces (friction + angle).
  const insAngle = spec.insertionAngleDeg * Math.PI / 180;
  const remAngle = spec.removalAngleDeg * Math.PI / 180;
  const mu = spec.friction;
  const insTan = Math.tan(insAngle);
  const remTan = Math.tan(remAngle);
  // Guard the (1 − μ·tanθ) denominator: at self-locking it hits 0 → a silent
  // Infinity (or a negative, physically nonsensical force). Treat ≤0 as
  // self-locking (force effectively infinite) and warn for BOTH directions.
  const insDenom = 1 - mu * insTan;
  const remDenom = 1 - mu * remTan;
  const insertionForce = insDenom > 1e-6 ? deflectionForce * (insTan + mu) / insDenom : Infinity;
  const removalForce = remDenom > 1e-6 ? deflectionForce * (remTan + mu) / remDenom : Infinity;

  if (mu * insTan >= 1) {
    warnings.push('Insertion geometry self-locking — cannot be assembled');
  }
  if (mu * remTan >= 1) {
    warnings.push('Removal geometry self-locking — irreversible snap');
  }

  return {
    insertionForceN: insertionForce,
    removalForceN: removalForce > 0 ? removalForce : Infinity,
    maxStrainPercent: strainPercent,
    strainSafetyFactor: strainSF,
    warnings,
  };
}

// ── Vent grille ─────────────────────────────────────────────────

export type VentPattern = 'louver' | 'circular-holes' | 'slot-array' | 'hex-mesh';

export interface VentGrilleSpec {
  pattern: VentPattern;
  /** Panel width × height (mm). */
  widthMm: number;
  heightMm: number;
  /** Opening characteristic dimension (mm) — louver gap, hole dia, slot width. */
  openingMm: number;
  /** Spacing between openings (mm). */
  spacingMm: number;
  /** Material thickness (mm). */
  thicknessMm: number;
  /** Edge margin (mm). */
  edgeMarginMm: number;
}

export interface VentGrilleReport {
  /** Number of openings. */
  openingCount: number;
  /** Total open area (mm²). */
  openAreaMm2: number;
  /** Open-area ratio (0..1) — open / total panel. */
  openAreaRatio: number;
  /** Estimated max airflow at ΔP = 25 Pa (typical fan curve). */
  airflowCfmAt25Pa: number;
  /** Estimated stiffness loss vs solid panel (0..1). */
  stiffnessLoss: number;
  warnings: string[];
}

export function analyzeVentGrille(spec: VentGrilleSpec): VentGrilleReport {
  const warnings: string[] = [];
  const usableW = spec.widthMm - spec.edgeMarginMm * 2;
  const usableH = spec.heightMm - spec.edgeMarginMm * 2;
  const panelArea = spec.widthMm * spec.heightMm;
  let openingCount = 0;
  let openArea = 0;

  switch (spec.pattern) {
    case 'louver': {
      const louverCount = Math.floor(usableH / spec.spacingMm);
      openingCount = louverCount;
      openArea = louverCount * usableW * spec.openingMm;
      break;
    }
    case 'circular-holes': {
      const cols = Math.floor(usableW / spec.spacingMm);
      const rows = Math.floor(usableH / spec.spacingMm);
      openingCount = cols * rows;
      openArea = openingCount * Math.PI * Math.pow(spec.openingMm / 2, 2);
      break;
    }
    case 'slot-array': {
      const rows = Math.floor(usableH / spec.spacingMm);
      const cols = Math.floor(usableW / (spec.openingMm * 3 + spec.spacingMm));
      openingCount = rows * cols;
      openArea = openingCount * spec.openingMm * 3 * spec.openingMm;
      break;
    }
    case 'hex-mesh': {
      const rowSpacing = spec.spacingMm * Math.sqrt(3) / 2;
      const rows = Math.floor(usableH / rowSpacing);
      const cols = Math.floor(usableW / spec.spacingMm);
      openingCount = rows * cols;
      const hexArea = (3 * Math.sqrt(3) / 2) * Math.pow(spec.openingMm / 2, 2);
      openArea = openingCount * hexArea;
      break;
    }
  }

  const openRatio = panelArea > 0 ? openArea / panelArea : 0;
  // Airflow estimate via empirical orifice flow:
  // Q (CFM) = 0.8 × area_in² × √(ΔP_inH₂O)
  // 25 Pa = 0.1 inH₂O; 1 mm² = 0.00155 in².
  const areaIn2 = openArea * 0.00155;
  const cfm = 0.8 * areaIn2 * Math.sqrt(0.1) * 60;
  const stiffnessLoss = openRatio * 0.7; // Empirical: open area × 0.7 ≈ stiffness loss

  if (openRatio < 0.1) warnings.push(`Open ratio ${(openRatio * 100).toFixed(0)}% < 10% — restricted airflow`);
  if (openRatio > 0.5) warnings.push(`Open ratio ${(openRatio * 100).toFixed(0)}% > 50% — panel structural risk`);
  if (spec.openingMm < spec.thicknessMm) warnings.push('Opening smaller than thickness — mold flash risk');

  return {
    openingCount,
    openAreaMm2: openArea,
    openAreaRatio: openRatio,
    airflowCfmAt25Pa: cfm,
    stiffnessLoss,
    warnings,
  };
}

// ── Strengthening rib ───────────────────────────────────────────

export interface RibSpec {
  /** Rib length along the panel (mm). */
  lengthMm: number;
  /** Rib height above the base panel (mm). */
  heightMm: number;
  /** Rib base thickness (mm). */
  baseThicknessMm: number;
  /** Wall (panel) thickness the rib reinforces (mm). */
  wallThicknessMm: number;
  /** Draft angle (degrees). */
  draftAngleDeg: number;
  /** Fillet radius at the base (mm). */
  baseFilletMm: number;
}

export interface RibReport {
  /** Rib volume (mm³). */
  volumeMm3: number;
  /** Bending stiffness multiplier vs unstiffened panel. */
  stiffnessMultiplier: number;
  warnings: string[];
}

export function analyzeRib(spec: RibSpec): RibReport {
  const warnings: string[] = [];

  // Rib volume = trapezoid (base wider than tip by 2 × tan(draft) × height).
  const tipReduction = 2 * Math.tan(spec.draftAngleDeg * Math.PI / 180) * spec.heightMm;
  const tipThickness = Math.max(0.1, spec.baseThicknessMm - tipReduction);
  const crossSection = (spec.baseThicknessMm + tipThickness) / 2 * spec.heightMm;
  const volumeMm3 = crossSection * spec.lengthMm;

  // Stiffness ≈ 1 + (rib_I / panel_I) where I scales as h³.
  // Panel I per unit width = wallThickness³ / 12.
  // Rib I per unit length = (baseThickness + tipThickness)/2 × height³ / 12.
  const panelI = Math.pow(spec.wallThicknessMm, 3) / 12;
  const ribI = (spec.baseThicknessMm + tipThickness) / 2 * Math.pow(spec.heightMm, 3) / 12;
  const stiffnessMultiplier = 1 + (ribI / panelI);

  // Design rules.
  if (spec.baseThicknessMm > spec.wallThicknessMm * 0.6) {
    warnings.push(`Rib base ${spec.baseThicknessMm}mm > 60% wall — sink mark risk on plastic part`);
  }
  if (spec.heightMm > spec.wallThicknessMm * 3) {
    warnings.push(`Rib height > 3× wall — bowing risk; consider cross-ribs`);
  }
  if (spec.baseFilletMm < spec.baseThicknessMm * 0.25) {
    warnings.push('Base fillet < 0.25 × thickness — stress concentration');
  }

  return { volumeMm3, stiffnessMultiplier, warnings };
}
