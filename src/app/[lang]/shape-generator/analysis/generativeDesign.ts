/**
 * generativeDesign — the one-call generative-design pipeline (Track G, headless
 * core for the UI / an API route).
 *
 * Ties together everything the generative tracks built: constrained 3D SIMP
 * optimisation (overhang / minimum-feature / passive regions) → watertight
 * surface extraction → optional Taubin smoothing → a printable mesh + metadata.
 * A UI panel or an API route wraps THIS; the orchestration itself is pure and
 * unit-tested headlessly.
 */
import {
  TopologyGrid, optimizeTopology3D, cantileverBC, countUnsupportedOverhang,
  type BuildAxis, type BoundaryConditions3D,
} from './topology3D';
import {
  extractSolidSurface, taubinSmooth, thresholdForFraction, type ExtractedMesh,
} from './topologyExtract';

export interface GenerativeSpec {
  nx: number; ny: number; nz: number;
  volfrac: number;
  /** Built-in 'cantilever' load case, or explicit boundary conditions. */
  load?: 'cantilever' | BoundaryConditions3D;
  penal?: number;
  rmin?: number;
  maxIter?: number;
  nu?: number;
  /** Additive-manufacturing build direction (support-free print). */
  overhang?: BuildAxis;
  /** Enforce a manufacturable minimum feature size (filter + projection). */
  minFeature?: boolean | { beta?: number };
  /** Pinned regions (element indices). */
  passiveSolid?: Iterable<number>;
  passiveVoid?: Iterable<number>;
  /** Taubin smoothing iterations on the extracted surface (0 = blocky). */
  smooth?: number;
  /** World size of one voxel for the extracted mesh. */
  cell?: number;
}

export interface GenerativeResult {
  /** The optimised element density field. */
  density: Float32Array;
  /** Watertight printable surface mesh. */
  mesh: ExtractedMesh;
  volumeFraction: number;
  compliance: number;
  iterations: number;
  /** Unprintable overhangs in the final design (0 when `overhang` is set). */
  unsupportedOverhangs: number;
}

/** Run the full constrained generative-design pipeline and return a printable
 *  mesh + metadata. Pure + headless. */
export function runGenerativeDesign(spec: GenerativeSpec): GenerativeResult {
  const grid = new TopologyGrid(spec.nx, spec.ny, spec.nz);
  const bc: BoundaryConditions3D =
    !spec.load || spec.load === 'cantilever' ? cantileverBC(grid, -1) : spec.load;

  const projection = spec.minFeature
    ? { beta: typeof spec.minFeature === 'object' ? spec.minFeature.beta : undefined }
    : undefined;

  const opt = optimizeTopology3D(
    {
      nx: spec.nx, ny: spec.ny, nz: spec.nz, volfrac: spec.volfrac,
      penal: spec.penal, rmin: spec.rmin, maxIter: spec.maxIter, nu: spec.nu,
      overhang: spec.overhang, projection,
      passiveSolid: spec.passiveSolid, passiveVoid: spec.passiveVoid,
    },
    bc,
  );

  // Extract at the threshold that realises the achieved volume, so the mesh
  // matches the optimised material distribution.
  const thr = thresholdForFraction(opt.density, opt.volumeFraction);
  let mesh = extractSolidSurface(opt.density, grid, thr, spec.cell ?? 1);
  if (spec.smooth && spec.smooth > 0 && mesh.indices.length > 0) {
    mesh = taubinSmooth(mesh, spec.smooth);
  }

  return {
    density: opt.density,
    mesh,
    volumeFraction: opt.volumeFraction,
    compliance: opt.complianceHistory[opt.complianceHistory.length - 1] ?? 0,
    iterations: opt.iterations,
    unsupportedOverhangs: spec.overhang ? countUnsupportedOverhang(opt.density, grid, spec.overhang) : 0,
  };
}
