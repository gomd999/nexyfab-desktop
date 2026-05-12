/**
 * Σ — Mock solver adapters for the simulation suite.
 *
 * Each adapter implements `SolverAdapter<TIn, TOut>` for a different
 * physics domain. The mocks return shape-correct results in 50-200ms
 * so the agent loop + UI can be developed against the API surface
 * before the real Docker containers come online.
 *
 *   Σ1 cfd       — flow over part. Mock = laminar approximation.
 *   Σ2 mbd       — multibody dynamics. Mock = closed-form pendulum.
 *   Σ3 cam       — 5-axis toolpath. Mock = waterline lookup.
 *   Σ4 mold_fill — injection mold fill. Mock = volume-balance estimate.
 *   Σ5 optics    — ray trace. Mock = thin-lens equation.
 *   Σ6 thermal   — steady-state heat transfer. Mock = lumped-capacitance.
 *
 * Production swap-in: replace `solve` with a fetch to the corresponding
 * Docker container's REST endpoint. The contract (input shape →
 * output shape) is stable so the agent doesn't need to change.
 */

import { registerSolver, type SolverAdapter } from './simulationQueue';

// ─── Σ1 — CFD ──────────────────────────────────────────────────────────────

export interface CfdInput {
  /** B-rep handle of the part the fluid flows around. */
  brepHandle: string;
  /** Free-stream velocity m/s. */
  velocityMs: number;
  /** Fluid: 'air' | 'water' | 'oil' (kinematic viscosity m²/s differs). */
  fluid: 'air' | 'water' | 'oil';
  /** Reference length scale in mm (e.g. chord length). */
  referenceLengthMm: number;
}

export interface CfdOutput {
  reynolds: number;
  regime: 'laminar' | 'transitional' | 'turbulent';
  dragCoefficient: number;
  pressureDropPa?: number;
  notes: string;
}

const NU_M2S: Record<CfdInput['fluid'], number> = {
  air: 1.5e-5,
  water: 1.0e-6,
  oil: 4.0e-5,
};

const cfdMock: SolverAdapter<CfdInput, CfdOutput> = {
  name: 'cfd-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.2);
    await new Promise(r => setTimeout(r, 60));
    const L = input.referenceLengthMm / 1000;
    const Re = (input.velocityMs * L) / NU_M2S[input.fluid];
    onProgress?.(0.6);
    const regime: CfdOutput['regime'] = Re < 1000 ? 'laminar' : Re < 1e5 ? 'transitional' : 'turbulent';
    // Crude Cd table — sphere-ish reference. Real solver replaces this.
    const Cd = regime === 'laminar' ? 24 / Math.max(Re, 1) : regime === 'transitional' ? 0.5 : 0.2;
    onProgress?.(1);
    return {
      reynolds: Re,
      regime,
      dragCoefficient: Cd,
      notes: `mock-laminar approximation; replace with OpenFOAM SimpleFOAM for production accuracy`,
    };
  },
};

// ─── Σ2 — Multibody dynamics ───────────────────────────────────────────────

export interface MbdInput {
  /** Description of bodies + joints + driving forces. */
  bodies: Array<{ id: string; massKg: number; inertiaKgM2?: number }>;
  joints: Array<{ kind: 'revolute' | 'prismatic' | 'fixed'; bodyA: string; bodyB: string; axis?: [number, number, number] }>;
  /** Initial conditions per body. */
  initial?: Record<string, { positionM?: [number, number, number]; velocityMs?: [number, number, number] }>;
  /** Sim time in seconds. */
  durationS: number;
  /** Time step in seconds. */
  dtS?: number;
}

export interface MbdOutput {
  finalState: Record<string, { positionM: [number, number, number] }>;
  steps: number;
  energyJ?: number;
  notes: string;
}

const mbdMock: SolverAdapter<MbdInput, MbdOutput> = {
  name: 'mbd-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.1);
    await new Promise(r => setTimeout(r, 80));
    const dt = input.dtS ?? 0.01;
    const steps = Math.max(1, Math.floor(input.durationS / dt));
    const finalState: MbdOutput['finalState'] = {};
    for (const b of input.bodies) {
      const init = input.initial?.[b.id]?.positionM ?? [0, 0, 0];
      // Mock: gravity-only fall along z for unconstrained bodies.
      const free = !input.joints.some(j => j.bodyA === b.id || j.bodyB === b.id);
      const z = free ? init[2] - 0.5 * 9.81 * input.durationS * input.durationS : init[2];
      finalState[b.id] = { positionM: [init[0], init[1], z] };
    }
    onProgress?.(1);
    return {
      finalState,
      steps,
      notes: 'mock-pendulum; swap to Project Chrono for real contact + friction',
    };
  },
};

// ─── Σ3 — 5-axis CAM toolpath ──────────────────────────────────────────────

export interface CamInput {
  /** STL bytes (or B-rep handle the server tessellates). */
  brepHandle: string;
  /** Tool diameter in mm. */
  toolDiameterMm: number;
  /** Stepover (% of tool diameter). */
  stepoverPct: number;
  /** Operation: roughing/finishing/parting. */
  operation: 'rough' | 'finish' | 'part';
  /** Stock bbox in mm. */
  stockBboxMm: { w: number; h: number; d: number };
}

export interface CamOutput {
  toolpathSegments: number;
  estimatedTimeMin: number;
  /** Sampled toolpath as polyline (compact, ≤200 points). */
  preview: Array<[number, number, number]>;
  notes: string;
}

const camMock: SolverAdapter<CamInput, CamOutput> = {
  name: 'cam-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.2);
    await new Promise(r => setTimeout(r, 100));
    const stepover = (input.stepoverPct / 100) * input.toolDiameterMm;
    const passes = Math.ceil(input.stockBboxMm.h / Math.max(stepover, 0.1));
    const segs = passes * 30;
    // Synthetic waterline: zigzag across the bbox.
    const preview: Array<[number, number, number]> = [];
    for (let i = 0; i < passes && preview.length < 200; i++) {
      const y = i * stepover;
      const z = input.stockBboxMm.d - i * 0.5;
      preview.push([0, y, z]);
      preview.push([input.stockBboxMm.w, y, z]);
    }
    const speedMmPerMin = input.operation === 'finish' ? 800 : 1500;
    const distance = passes * input.stockBboxMm.w;
    const estimatedTimeMin = distance / speedMmPerMin;
    onProgress?.(1);
    return {
      toolpathSegments: segs,
      estimatedTimeMin,
      preview,
      notes: 'mock-waterline; replace with OpenCAMLib for adaptive 5-axis',
    };
  },
};

// ─── Σ4 — Injection mold fill ──────────────────────────────────────────────

export interface MoldFillInput {
  brepHandle: string;
  /** Plastic material spec (PA66, PC, ABS, ...). */
  material: string;
  /** Melt temp °C. */
  meltTempC: number;
  /** Injection pressure MPa. */
  pressureMPa: number;
  /** Wall thickness mm — used for fill time estimation. */
  wallThicknessMm: number;
  /** Volume cm³ — derived from geometry, but exposed for mock convenience. */
  volumeCm3: number;
}

export interface MoldFillOutput {
  fillTimeS: number;
  shotWeightG: number;
  warningHotspots: Array<{ location: 'mock'; severity: 'low' | 'medium' | 'high'; note: string }>;
  notes: string;
}

const MATERIAL_DENSITY_G_CM3: Record<string, number> = {
  PA66: 1.14, PC: 1.20, ABS: 1.05, PP: 0.91, PE: 0.95, POM: 1.41,
};

const moldFillMock: SolverAdapter<MoldFillInput, MoldFillOutput> = {
  name: 'mold-fill-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.2);
    await new Promise(r => setTimeout(r, 80));
    const density = MATERIAL_DENSITY_G_CM3[input.material.toUpperCase()] ?? 1.0;
    const shotWeightG = input.volumeCm3 * density;
    // Crude fill time: fill volume / (pressure × thickness² heuristic)
    const fillTimeS = Math.max(0.3, input.volumeCm3 / (input.pressureMPa * Math.max(input.wallThicknessMm, 0.5) * 5));
    const warnings: MoldFillOutput['warningHotspots'] = [];
    if (input.wallThicknessMm < 0.8) {
      warnings.push({ location: 'mock', severity: 'high', note: 'wall < 0.8mm risks short shots / high pressure' });
    }
    if (input.wallThicknessMm > 4) {
      warnings.push({ location: 'mock', severity: 'medium', note: 'wall > 4mm risks sink marks; consider coring out' });
    }
    onProgress?.(1);
    return {
      fillTimeS,
      shotWeightG,
      warningHotspots: warnings,
      notes: 'mock-volume-balance; replace with Moldex3D / OpenMold for real flow + cooling',
    };
  },
};

// ─── Σ5 — Optical ray trace ────────────────────────────────────────────────

export interface OpticsInput {
  /** List of optical surfaces in optical-axis order. */
  surfaces: Array<{
    kind: 'lens_thin' | 'mirror_flat' | 'aperture';
    /** Focal length (mm) for thin lens. */
    focalLengthMm?: number;
    /** Position along axis (mm). */
    zMm: number;
    /** Diameter (mm). */
    diameterMm: number;
  }>;
  /** Source: 'parallel' (collimated) or { distanceMm }. */
  source: 'parallel' | { distanceMm: number };
}

export interface OpticsOutput {
  imagePlaneZMm: number;
  magnification: number;
  notes: string;
}

const opticsMock: SolverAdapter<OpticsInput, OpticsOutput> = {
  name: 'optics-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.3);
    await new Promise(r => setTimeout(r, 50));
    const lens = input.surfaces.find(s => s.kind === 'lens_thin');
    if (!lens || typeof lens.focalLengthMm !== 'number') {
      throw new Error('mock requires at least one thin lens with focalLengthMm');
    }
    const f = lens.focalLengthMm;
    if (input.source === 'parallel') {
      onProgress?.(1);
      return {
        imagePlaneZMm: lens.zMm + f,
        magnification: 0,  // collimated → image at f, point image
        notes: 'mock-thin-lens; use POV-ray or Zemax-equivalent for real ray-trace',
      };
    }
    // 1/f = 1/u + 1/v → v = (f*u)/(u-f)
    const u = input.source.distanceMm;
    if (u === f) throw new Error('source at focal point — image at infinity');
    const v = (f * u) / (u - f);
    onProgress?.(1);
    return {
      imagePlaneZMm: lens.zMm + v,
      magnification: -v / u,
      notes: 'mock-thin-lens; for aberrations + spot size use real ray-trace',
    };
  },
};

// ─── Σ6 — Thermal (steady-state) ───────────────────────────────────────────

export interface ThermalInput {
  brepHandle: string;
  /** Power dissipation W (heat source). */
  powerW: number;
  /** Material thermal conductivity W/(m·K). */
  conductivityWmK: number;
  /** Ambient temp °C. */
  ambientC: number;
  /** Convection coefficient W/(m²·K). Default 10 (still air). */
  convectionWm2K?: number;
  /** Surface area exposed to ambient cm². */
  surfaceAreaCm2: number;
}

export interface ThermalOutput {
  steadyStateTempC: number;
  thermalResistanceKW: number;
  notes: string;
}

const thermalMock: SolverAdapter<ThermalInput, ThermalOutput> = {
  name: 'thermal-mock-v0',
  isMock: true,
  async solve(input, onProgress) {
    onProgress?.(0.3);
    await new Promise(r => setTimeout(r, 50));
    const h = input.convectionWm2K ?? 10;
    const Am2 = input.surfaceAreaCm2 / 10000;
    // R = 1 / (h × A); ΔT = P × R
    const R = 1 / Math.max(h * Am2, 1e-6);
    const dT = input.powerW * R;
    onProgress?.(1);
    return {
      steadyStateTempC: input.ambientC + dT,
      thermalResistanceKW: R,
      notes: 'mock-lumped-capacitance; replace with OpenFOAM chtMultiRegionFoam for spatial gradient',
    };
  },
};

// ─── Bootstrap registration ────────────────────────────────────────────────

let booted = false;
export function bootstrapMockSolvers(): void {
  if (booted) return;
  registerSolver('cfd', cfdMock);
  registerSolver('mbd', mbdMock);
  registerSolver('cam', camMock);
  registerSolver('mold_fill', moldFillMock);
  registerSolver('optics', opticsMock);
  registerSolver('thermal', thermalMock);
  booted = true;
}

/** Test-only: clear the boot guard so a registry reset can re-register. */
export function _resetMockSolversBoot(): void {
  booted = false;
}
