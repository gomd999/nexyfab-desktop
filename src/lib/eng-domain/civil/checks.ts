/**
 * eng-domain/civil — Pure structural-verification GATE MATERIAL.
 *
 * Deterministic, side-effect-free closed-form checks that a later civil
 * DomainModule wires into a "plan → measured gate → verified package" driver.
 *
 * HONESTY CONTRACT (성역):
 *  - Every metric is REAL-computed from the inputs — no fabricated numbers.
 *  - `basis` states the exact formula / code basis, with approximations named.
 *  - A check REFUSES (pass:false + reason) whenever demand exceeds capacity.
 *  - Pure functions only: no I/O, no OCCT/THREE, no design-driver imports.
 *    Node/browser-agnostic.
 *
 * These closed-form checks mirror the intent of the eng-chat calc catalog
 * (src/app/api/eng-chat/calcCatalog.ts): simple_beam (휨/처짐), column_buckling,
 * slope_infinite, retaining_wall_stability. They are implemented FRESH here —
 * the repo's existing structural helpers (scad-agent FEA, motionDynamics) are
 * numerical/FEA-coupled and not the analytic forms a gate needs.
 *
 * UNIT CONVENTIONS (stated so callers can't silently mis-feed):
 *  - Stress / elastic modulus: MPa  (= N/mm²).
 *  - Force: kN in the public API; converted internally to N.
 *  - Length: mm for section geometry / deflection; m for span & slope where noted.
 *  - Section modulus Z: mm³. Second moment of area I: mm⁴.
 *  - Distributed load w: kN/m  (note 1 kN/m ≡ 1 N/mm exactly).
 *  - Unit weight γ: kN/m³.
 */

export interface CivilCheckResult {
  /** stable check id, e.g. 'beam-bending-stress' */
  id: string;
  /** true iff the design satisfies the limit state */
  pass: boolean;
  /** measured values backing the verdict (real-computed) */
  metrics: Record<string, number>;
  /** present iff !pass — why the check refused */
  reason?: string;
  /** formula / code basis, approximations named — REQUIRED */
  basis: string;
}

// ── Physical constants (sources cited) ──────────────────────────────────────
/** Structural steel elastic modulus, 200 GPa (KDS 14 31 / AISC 360, E = 200,000 MPa). */
export const STEEL_E_MPA = 200_000;
/** Normal-weight concrete elastic modulus ~ default 30 GPa reference (KDS 14 20; Ec ≈ 8500·∛(fck+4) ≈ 27–31 GPa for fck 24–35). */
export const CONCRETE_E_MPA = 30_000;
/** Unit weight of water, 9.81 kN/m³ (standard). */
export const GAMMA_WATER_KNM3 = 9.81;
/** Unit weight of reinforced concrete, 24 kN/m³ (KDS 24/41 관례). */
export const GAMMA_CONCRETE_KNM3 = 24;

// ── small guards (throw on structurally-invalid params; that's a caller bug,
//    distinct from the gate verdict pass:false which means demand>capacity) ──
function requirePositive(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`civil check: '${name}' must be a positive finite number, got ${v}`);
  }
  return v;
}
function requireFinite(name: string, v: number): number {
  if (!Number.isFinite(v)) throw new Error(`civil check: '${name}' must be finite, got ${v}`);
  return v;
}
const deg2rad = (d: number) => (d * Math.PI) / 180;
const round = (v: number, p = 6) => {
  const f = 10 ** p;
  return Math.round(v * f) / f;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. BEAM BENDING STRESS  —  σ = M/Z ≤ σ_allow
// ─────────────────────────────────────────────────────────────────────────────
export type BeamLoad =
  | { type: 'moment'; momentKNm: number }
  | { type: 'udl'; w_kNpm: number; span_m: number }
  | { type: 'point'; P_kN: number; span_m: number };

/** Max simple-span moment (kN·m) for the given load case. */
export function maxSimpleSpanMomentKNm(load: BeamLoad): number {
  switch (load.type) {
    case 'moment':
      return requireFinite('momentKNm', load.momentKNm);
    case 'udl': {
      const w = requireFinite('w_kNpm', load.w_kNpm);
      const L = requirePositive('span_m', load.span_m);
      return (w * L * L) / 8; // M = wL²/8
    }
    case 'point': {
      const P = requireFinite('P_kN', load.P_kN);
      const L = requirePositive('span_m', load.span_m);
      return (P * L) / 4; // M = PL/4 (mid-span point load)
    }
  }
}

export interface BeamBendingInput {
  load: BeamLoad;
  /** elastic section modulus Z (mm³) */
  sectionModulus_mm3: number;
  /** allowable bending stress σ_allow (MPa) */
  allowableStress_MPa: number;
}

export function checkBeamBendingStress(input: BeamBendingInput): CivilCheckResult {
  const Z = requirePositive('sectionModulus_mm3', input.sectionModulus_mm3);
  const sigmaAllow = requirePositive('allowableStress_MPa', input.allowableStress_MPa);
  const M_kNm = maxSimpleSpanMomentKNm(input.load);
  // σ = M/Z. Convert M kN·m → N·mm (×1e6). Z mm³ → σ in N/mm² = MPa.
  const M_Nmm = Math.abs(M_kNm) * 1e6;
  const sigma_MPa = M_Nmm / Z;
  const utilization = sigma_MPa / sigmaAllow;
  const pass = sigma_MPa <= sigmaAllow;
  return {
    id: 'beam-bending-stress',
    pass,
    metrics: {
      moment_kNm: round(M_kNm),
      bendingStress_MPa: round(sigma_MPa),
      allowableStress_MPa: round(sigmaAllow),
      utilization: round(utilization),
    },
    reason: pass
      ? undefined
      : `bending stress σ=${round(sigma_MPa, 2)} MPa exceeds allowable ${round(sigmaAllow, 2)} MPa (util ${round(utilization, 3)})`,
    basis:
      'Elastic flexure σ = M/Z; simple-span M = wL²/8 (UDL) or PL/4 (mid-span point). ' +
      'Approx: prismatic elastic section, no lateral-torsional buckling / shear-lag (LTB gate deferred).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BEAM DEFLECTION  —  δ = 5wL⁴/(384EI) or PL³/(48EI) ≤ L/limit
// ─────────────────────────────────────────────────────────────────────────────
export type DeflectionLoad =
  | { type: 'udl'; w_kNpm: number }
  | { type: 'point'; P_kN: number };

export interface BeamDeflectionInput {
  load: DeflectionLoad;
  /** span L (mm) */
  span_mm: number;
  /** elastic modulus E (MPa = N/mm²) — default STEEL_E_MPA */
  E_MPa?: number;
  /** second moment of area I (mm⁴) */
  I_mm4: number;
  /** deflection limit denominator n in δ_lim = L/n (default 360, KDS/IBC live-load default) */
  limitDenominator?: number;
}

/** Mid-span deflection (mm), simple span. */
export function simpleSpanDeflection_mm(load: DeflectionLoad, span_mm: number, E_MPa: number, I_mm4: number): number {
  const L = requirePositive('span_mm', span_mm);
  const E = requirePositive('E_MPa', E_MPa);
  const I = requirePositive('I_mm4', I_mm4);
  if (load.type === 'udl') {
    // w kN/m ≡ N/mm exactly. δ = 5 w L⁴ / (384 E I) in mm.
    const w_Npmm = requireFinite('w_kNpm', load.w_kNpm);
    return (5 * w_Npmm * L ** 4) / (384 * E * I);
  }
  // point: P kN → N (×1000). δ = P L³ / (48 E I).
  const P_N = requireFinite('P_kN', load.P_kN) * 1000;
  return (P_N * L ** 3) / (48 * E * I);
}

export function checkBeamDeflection(input: BeamDeflectionInput): CivilCheckResult {
  const L = requirePositive('span_mm', input.span_mm);
  const E = input.E_MPa ?? STEEL_E_MPA;
  const n = input.limitDenominator ?? 360;
  requirePositive('limitDenominator', n);
  const delta = Math.abs(simpleSpanDeflection_mm(input.load, L, E, input.I_mm4));
  const deltaLimit = L / n;
  const utilization = delta / deltaLimit;
  const pass = delta <= deltaLimit;
  return {
    id: 'beam-deflection',
    pass,
    metrics: {
      deflection_mm: round(delta),
      deflectionLimit_mm: round(deltaLimit),
      span_mm: round(L),
      limitDenominator: n,
      utilization: round(utilization),
    },
    reason: pass
      ? undefined
      : `deflection δ=${round(delta, 3)} mm exceeds limit L/${n}=${round(deltaLimit, 3)} mm (util ${round(utilization, 3)})`,
    basis:
      'Simple-span elastic deflection δ = 5wL⁴/(384EI) (UDL) or PL³/(48EI) (mid-span point) vs δ_lim = L/n. ' +
      'Approx: linear-elastic, uncracked prismatic section; w kN/m ≡ N/mm.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SAFETY FACTOR  —  SF = capacity / demand ≥ required
// ─────────────────────────────────────────────────────────────────────────────
export interface SafetyFactorInput {
  /** resistance / capacity (any consistent unit) */
  capacity: number;
  /** load effect / demand (same unit as capacity) */
  demand: number;
  /** required minimum safety factor */
  requiredSF: number;
  /** optional label for what capacity/demand represent (units), for the reason string */
  quantity?: string;
}

export function checkSafetyFactor(input: SafetyFactorInput): CivilCheckResult {
  const capacity = requirePositive('capacity', input.capacity);
  const demand = requirePositive('demand', input.demand);
  const required = requirePositive('requiredSF', input.requiredSF);
  const sf = capacity / demand;
  const pass = sf >= required;
  const q = input.quantity ? ` (${input.quantity})` : '';
  return {
    id: 'safety-factor',
    pass,
    metrics: {
      capacity: round(capacity),
      demand: round(demand),
      safetyFactor: round(sf),
      requiredSF: round(required),
    },
    reason: pass ? undefined : `safety factor ${round(sf, 3)}${q} below required ${round(required, 3)}`,
    basis: 'SF = capacity / demand ≥ required (allowable-stress / global factor-of-safety form).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INFINITE-SLOPE STABILITY  —  planar shallow failure, seepage-parallel
// ─────────────────────────────────────────────────────────────────────────────
export interface InfiniteSlopeInput {
  /** slope angle β (deg) */
  slopeDeg: number;
  /** effective friction angle φ' (deg) */
  phiDeg: number;
  /** effective cohesion c' (kPa), default 0 (conservative, cohesionless) */
  cohesion_kPa?: number;
  /** failure-plane depth z (m) */
  depth_m: number;
  /** soil unit weight γ (kN/m³) */
  gamma_kNm3: number;
  /** seepage head zw (m); 0 = dry, = z = fully saturated slope-parallel seepage */
  waterDepth_m?: number;
  /** required factor of safety (project value, KDS 11 70 05 grade-dependent) */
  requiredFS: number;
}

export function checkInfiniteSlopeStability(input: InfiniteSlopeInput): CivilCheckResult {
  const beta = deg2rad(requirePositive('slopeDeg', input.slopeDeg));
  const phi = deg2rad(requirePositive('phiDeg', input.phiDeg));
  const c = Math.max(0, input.cohesion_kPa ?? 0);
  const z = requirePositive('depth_m', input.depth_m);
  const gamma = requirePositive('gamma_kNm3', input.gamma_kNm3);
  const zw = Math.min(Math.max(0, input.waterDepth_m ?? 0), z);
  const required = requirePositive('requiredFS', input.requiredFS);

  const cosB = Math.cos(beta);
  const sinB = Math.sin(beta);
  // Effective normal on plane; pore pressure u = γw·zw·cos²β (slope-parallel seepage).
  const sigmaN = gamma * z * cosB * cosB; // total normal stress (kPa)
  const u = GAMMA_WATER_KNM3 * zw * cosB * cosB; // pore pressure (kPa)
  const shearDemand = gamma * z * sinB * cosB; // driving shear (kPa)
  const shearResist = c + (sigmaN - u) * Math.tan(phi); // Mohr–Coulomb resistance (kPa)
  const fs = shearResist / shearDemand;
  const pass = fs >= required;
  return {
    id: 'slope-infinite-stability',
    pass,
    metrics: {
      factorOfSafety: round(fs),
      requiredFS: round(required),
      drivingShear_kPa: round(shearDemand),
      resistingShear_kPa: round(shearResist),
      porePressure_kPa: round(u),
    },
    reason: pass
      ? undefined
      : `slope FoS ${round(fs, 3)} below required ${round(required, 3)} (driving ${round(shearDemand, 2)} ≥ resisting ${round(shearResist, 2)} kPa)`,
    basis:
      "Infinite-slope limit equilibrium: FS = [c' + (γz cos²β − u)·tanφ'] / (γz sinβ cosβ), " +
      'u = γw·zw·cos²β (slope-parallel steady seepage). Approx: planar shallow failure, homogeneous soil.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. COLUMN BUCKLING (Euler)  —  Pcr = π²EI/(KL)²,  demand ≤ Pcr/SF, KL/r ≤ 200
// ─────────────────────────────────────────────────────────────────────────────
export interface ColumnBucklingInput {
  /** elastic modulus E (MPa), default STEEL_E_MPA */
  E_MPa?: number;
  /** second moment of area I about buckling axis (mm⁴) */
  I_mm4: number;
  /** effective-length factor K (pinned-pinned = 1.0) */
  K: number;
  /** unbraced length L (mm) */
  L_mm: number;
  /** radius of gyration r about the same axis (mm) */
  r_mm: number;
  /** demand axial compression Pu (kN) */
  demand_kN: number;
  /** required factor of safety against elastic buckling (e.g. 1.67–2.0) */
  requiredSF: number;
  /** slenderness limit KL/r (default 200 per steel-column practice) */
  slendernessLimit?: number;
}

export function checkColumnBucklingEuler(input: ColumnBucklingInput): CivilCheckResult {
  const E = input.E_MPa ?? STEEL_E_MPA;
  requirePositive('E_MPa', E);
  const I = requirePositive('I_mm4', input.I_mm4);
  const K = requirePositive('K', input.K);
  const L = requirePositive('L_mm', input.L_mm);
  const r = requirePositive('r_mm', input.r_mm);
  const Pu = requirePositive('demand_kN', input.demand_kN);
  const required = requirePositive('requiredSF', input.requiredSF);
  const slendernessLimit = input.slendernessLimit ?? 200;

  const KL = K * L;
  const slenderness = KL / r;
  // Pcr (N) = π²EI/(KL)². E N/mm², I mm⁴, KL mm → N. → kN /1000.
  const Pcr_N = (Math.PI ** 2 * E * I) / KL ** 2;
  const Pcr_kN = Pcr_N / 1000;
  const Pallow_kN = Pcr_kN / required;
  const utilization = Pu / Pallow_kN;
  const slendernessOk = slenderness <= slendernessLimit;
  const capacityOk = Pu <= Pallow_kN;
  const pass = slendernessOk && capacityOk;
  let reason: string | undefined;
  if (!slendernessOk) {
    reason = `slenderness KL/r=${round(slenderness, 1)} exceeds limit ${slendernessLimit}`;
  } else if (!capacityOk) {
    reason = `axial demand ${round(Pu, 2)} kN exceeds allowable Pcr/SF=${round(Pallow_kN, 2)} kN (Pcr ${round(Pcr_kN, 2)} kN)`;
  }
  return {
    id: 'column-buckling-euler',
    pass,
    metrics: {
      criticalLoad_kN: round(Pcr_kN),
      allowableLoad_kN: round(Pallow_kN),
      demand_kN: round(Pu),
      slenderness: round(slenderness),
      slendernessLimit,
      utilization: round(utilization),
    },
    reason,
    basis:
      'Euler elastic flexural buckling Pcr = π²EI/(KL)²; allowable = Pcr/SF; slenderness gate KL/r ≤ limit (200). ' +
      'Approx: perfectly straight prismatic column, elastic (no inelastic/AISC transition, no local buckling).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. RETAINING-WALL OVERTURNING  —  cantilever wall, Rankine active thrust
//    FS_ot = ΣM_resisting(toe) / M_overturning(toe) ≥ target
// ─────────────────────────────────────────────────────────────────────────────
export interface RetainingWallInput {
  /** total wall height H (m), base underside to top of stem */
  H: number;
  /** stem thickness (m), constant */
  stemThickness_m: number;
  /** base slab width B (m), toe→heel */
  baseWidth_m: number;
  /** base slab thickness (m) */
  baseThickness_m: number;
  /** toe length (m), front face of base to front face of stem */
  toeLength_m: number;
  /** backfill unit weight γ (kN/m³) */
  gammaBackfill_kNm3: number;
  /** backfill friction angle φ (deg) */
  phiBackfillDeg: number;
  /** surcharge q on backfill surface (kPa), default 0 */
  surcharge_kPa?: number;
  /** concrete unit weight (kN/m³), default 24 */
  gammaConcrete_kNm3?: number;
  /** required overturning FS (KDS/관례 통상 2.0) */
  requiredFS: number;
}

/** Rankine active earth-pressure coefficient Ka = tan²(45 − φ/2). */
export function rankineKa(phiDeg: number): number {
  const phi = deg2rad(requirePositive('phiDeg', phiDeg));
  return Math.tan(Math.PI / 4 - phi / 2) ** 2;
}

export function checkRetainingWallOverturning(input: RetainingWallInput): CivilCheckResult {
  const H = requirePositive('H', input.H);
  const ts = requirePositive('stemThickness_m', input.stemThickness_m);
  const B = requirePositive('baseWidth_m', input.baseWidth_m);
  const tb = requirePositive('baseThickness_m', input.baseThickness_m);
  const toe = requirePositive('toeLength_m', input.toeLength_m);
  const gammaB = requirePositive('gammaBackfill_kNm3', input.gammaBackfill_kNm3);
  const q = Math.max(0, input.surcharge_kPa ?? 0);
  const gammaC = input.gammaConcrete_kNm3 ?? GAMMA_CONCRETE_KNM3;
  const required = requirePositive('requiredFS', input.requiredFS);

  const heel = B - toe - ts;
  if (heel <= 0) {
    throw new Error(`civil check: heel length = B − toe − stem = ${round(heel)} m must be > 0`);
  }
  const hStem = H - tb; // stem height above base

  const Ka = rankineKa(input.phiBackfillDeg);

  // Driving (overturning about the toe, x measured from front face of base):
  // Active soil thrust Pa = ½·Ka·γ·H² at H/3;  surcharge thrust Ps = Ka·q·H at H/2.
  const Pa = 0.5 * Ka * gammaB * H * H; // kN/m
  const Ps = Ka * q * H; // kN/m
  const Mo = Pa * (H / 3) + Ps * (H / 2); // kN·m/m about toe

  // Resisting (vertical weights × lever arm from toe):
  const wBase = B * tb * gammaC;
  const xBase = B / 2;
  const wStem = ts * hStem * gammaC;
  const xStem = toe + ts / 2;
  const wSoil = heel * hStem * gammaB;
  const xSoil = toe + ts + heel / 2;
  const wSurcharge = q * heel; // surcharge weight over the heel
  const xSurcharge = toe + ts + heel / 2;
  const Mr = wBase * xBase + wStem * xStem + wSoil * xSoil + wSurcharge * xSurcharge;
  const totalVertical = wBase + wStem + wSoil + wSurcharge;

  const fs = Mr / Mo;
  const pass = fs >= required;
  return {
    id: 'retaining-wall-overturning',
    pass,
    metrics: {
      Ka: round(Ka),
      activeThrust_kNpm: round(Pa),
      overturningMoment_kNmpm: round(Mo),
      resistingMoment_kNmpm: round(Mr),
      verticalLoad_kNpm: round(totalVertical),
      factorOfSafety: round(fs),
      requiredFS: round(required),
    },
    reason: pass
      ? undefined
      : `overturning FS ${round(fs, 3)} below required ${round(required, 3)} (resisting ${round(Mr, 2)} vs overturning ${round(Mo, 2)} kN·m/m)`,
    basis:
      'Cantilever wall overturning about toe: FS = ΣWᵢ·xᵢ / (Pa·H/3 + Ps·H/2), ' +
      'Rankine Ka = tan²(45−φ/2), Pa = ½Ka·γ·H², Ps = Ka·q·H. ' +
      'Approx: horizontal backfill, no wall friction, passive toe resistance neglected (conservative).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry / catalog of checks (id → metadata + runner)
// ─────────────────────────────────────────────────────────────────────────────
export interface CivilCheckSpec<I = unknown> {
  id: string;
  title: string;
  domain: string;
  run: (input: I) => CivilCheckResult;
}

export const CIVIL_CHECKS: Record<string, CivilCheckSpec<never>> = {
  'beam-bending-stress': {
    id: 'beam-bending-stress',
    title: 'Beam bending stress (σ = M/Z ≤ σ_allow)',
    domain: 'civil/structural',
    run: checkBeamBendingStress as (i: never) => CivilCheckResult,
  },
  'beam-deflection': {
    id: 'beam-deflection',
    title: 'Beam deflection (δ ≤ L/n)',
    domain: 'civil/structural',
    run: checkBeamDeflection as (i: never) => CivilCheckResult,
  },
  'safety-factor': {
    id: 'safety-factor',
    title: 'Safety factor (capacity/demand ≥ required)',
    domain: 'civil/structural',
    run: checkSafetyFactor as (i: never) => CivilCheckResult,
  },
  'slope-infinite-stability': {
    id: 'slope-infinite-stability',
    title: 'Infinite-slope stability (FoS ≥ required)',
    domain: 'civil/geotech',
    run: checkInfiniteSlopeStability as (i: never) => CivilCheckResult,
  },
  'column-buckling-euler': {
    id: 'column-buckling-euler',
    title: 'Column buckling — Euler (demand ≤ Pcr/SF)',
    domain: 'civil/structural',
    run: checkColumnBucklingEuler as (i: never) => CivilCheckResult,
  },
  'retaining-wall-overturning': {
    id: 'retaining-wall-overturning',
    title: 'Retaining-wall overturning (FS ≥ required)',
    domain: 'civil/geotech',
    run: checkRetainingWallOverturning as (i: never) => CivilCheckResult,
  },
};

export type CivilCheckId = keyof typeof CIVIL_CHECKS;
