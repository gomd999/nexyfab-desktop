/**
 * api — public programmatic facade for the assembly mate solver (W5-F).
 *
 * Motivation (docs/dogfood-findings-260719.md F14): the solver engines
 * (iterativeSolver / lagrangianSolver) are strong, but the calls a
 * designer writes on first contact were all rejected by the type system:
 *
 *   - `import { solveMates } from '@/lib/assembly/mateSolver'`  → no export
 *   - specifying an instance via `{ partId: ... }`              → PartInstance has `id`
 *   - `result.converged` / `result.parts`                      → not on IterativeSolveResult
 *
 * This module closes that gap WITHOUT touching the engine contracts:
 *   - `solveMates(assembly, mates, opts?)` — one call from plain data to a
 *     solved assembly. Parts are declared with `partId`, geometry refs are
 *     plain local-frame primitives (or the built-in origin/axes/planes),
 *     mates reference `{ partId, refId }` and get their refKind inferred.
 *   - The result adapter exposes `converged`, `parts` (with per-part final
 *     position/orientation), `partById`, and keeps the raw engine result
 *     (`raw`) + AssemblyState (`state`) for downstream interop.
 *   - Every rejection is an explicit `AssemblyApiError` with the reason —
 *     unknown partId, unresolvable ref, missing mate parameter, etc.
 *     (No silent no-op mates: refs are pre-resolved before solving.)
 *
 * Back-compat: purely additive. Existing exports/signatures of
 * mateSolver / iterativeSolver / lagrangianSolver are unchanged; this file
 * is re-exported from `./mateSolver` so the dogfood-expected import path
 * `@/lib/assembly/mateSolver` works.
 */

import { type Vec3, vec3, add } from '@/lib/sketch/sketchPlane';
import {
  IDENTITY_QUAT,
  validateAssembly,
  type AssemblyState,
  type PartInstance,
  type Quat,
} from './assemblyState';
import type {
  HingeLimit,
  HingeZeroAngleRef,
  Mate,
  MateKind,
  MateRef,
  MateRefKind,
} from './mate';
import {
  iterativeSolve,
  type GeometryResolver,
  type IterativeSolveResult,
  type IterativeSolverOptions,
  type MateResidual,
  type ResolvedGeometry,
} from './iterativeSolver';
import { lagrangianSolveAnalytic } from './lagrangianSolver';
import { rotateVec } from './mateSolver';
import { applyDrives, type DriveEffect, type DriveSpec } from './kinematics';

// ─── errors ──────────────────────────────────────────────────────────────

export class AssemblyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyApiError';
  }
}

// ─── input types ─────────────────────────────────────────────────────────

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A geometry reference declared in the part's LOCAL frame. */
export type PartRefSpec =
  | { kind: 'point'; origin: Vec3Like }
  | { kind: 'axis'; origin: Vec3Like; direction: Vec3Like }
  | { kind: 'plane'; origin: Vec3Like; normal: Vec3Like };

/**
 * A part as a designer would declare it. `partId` is the canonical name
 * (the dogfood-expected spelling); `id` is accepted too so an existing
 * `PartInstance` can be passed through unchanged.
 *
 * Built-in refs available on every part (same names as geometryResolver):
 *   origin · x_axis · y_axis · z_axis · xy_plane · yz_plane · xz_plane
 * Custom refs in `refs` are added on top (and may shadow built-ins).
 */
export interface SolvePartSpec {
  partId?: string;
  /** PartInstance interop alias for partId. */
  id?: string;
  name?: string;
  partTemplateId?: string;
  /** World position of the part origin. Default (0,0,0). */
  position?: Vec3Like;
  /** World orientation. Default identity. */
  orientation?: Quat;
  /** Solver never moves fixed parts. At least one part must be fixed. */
  fixed?: boolean;
  /** Named local-frame geometry refs usable in mates. */
  refs?: Record<string, PartRefSpec>;
}

export type SolveAssemblyInput =
  | ReadonlyArray<SolvePartSpec>
  | { parts: ReadonlyArray<SolvePartSpec>; mates?: ReadonlyArray<Mate> };

export interface MateSideSpec {
  partId: string;
  refId: string;
  /** Optional — inferred from the part's ref registry when omitted. */
  refKind?: MateRefKind;
}

/**
 * A mate as plain data. `kind`-specific parameters (`value`, `ratio`,
 * `pinionRadius`, …) are validated here with explicit error messages
 * instead of failing deep inside the union types.
 */
export interface SolveMateSpec {
  id?: string;
  kind: MateKind;
  a: MateSideSpec;
  b: MateSideSpec;
  /** distance (mm) / angle (deg) mates. */
  value?: number;
  /** gear mate. */
  ratio?: number;
  reverse?: boolean;
  backlash?: number;
  /** rack_pinion mate. */
  pinionRadius?: number;
  rackTravel?: { min: number; max: number };
  /** hinge mate. */
  limit?: HingeLimit;
  zeroAngleRef?: HingeZeroAngleRef;
  /** slot mate. */
  slotLength?: number;
  suppressed?: boolean;
}

export interface SolveMatesOptions extends IterativeSolverOptions {
  /**
   * 'gauss-seidel' (default) — analytical relaxation (iterativeSolve).
   * 'newton' — Newton-Lagrange with analytic Jacobian (lagrangianSolveAnalytic).
   */
  engine?: 'gauss-seidel' | 'newton';
  /**
   * Advanced: custom GeometryResolver (e.g. featureTreeGeometryResolver).
   * When provided it takes precedence over the declared `refs` registries.
   */
  resolver?: GeometryResolver;
  /**
   * W5-F 2차: transmission drives, applied AFTER the static solve.
   * Each drive rotates a gear / rack_pinion / hinge mate (see DriveSpec
   * for the per-kind semantics) and propagates through the transmission
   * graph; the assembly is then re-solved to verify the driven pose still
   * satisfies every mate. Rejections (out-of-limit hinge target, fixed
   * part in the chain, inconsistent loop, …) throw KinematicsError with
   * the reason.
   */
  drives?: ReadonlyArray<DriveSpec>;
}

// ─── result types ────────────────────────────────────────────────────────

export interface SolvedPartPlacement {
  partId: string;
  position: Vec3;
  orientation: Quat;
  fixed: boolean;
}

export interface SolveMatesResult {
  /** True when the max mate residual fell below tolerance. */
  converged: boolean;
  iterations: number;
  finalMaxResidual: number;
  residuals: ReadonlyArray<MateResidual>;
  /** Final placement per part, in input order. */
  parts: ReadonlyArray<SolvedPartPlacement>;
  partById: ReadonlyMap<string, SolvedPartPlacement>;
  /** Lookup that THROWS on unknown id (no silent undefined). */
  part(partId: string): SolvedPartPlacement;
  /** Solved AssemblyState for downstream interop (interference, BOM, …). */
  state: AssemblyState;
  /** Raw engine result. */
  raw: IterativeSolveResult;
  /**
   * W5-F 2차: per-part motions applied by `opts.drives` (empty when no
   * drives were requested). Order = application order (seed part first).
   */
  driveEffects: ReadonlyArray<DriveEffect>;
}

// ─── normalization ───────────────────────────────────────────────────────

function normalizePart(spec: SolvePartSpec, index: number): PartInstance {
  const id = spec.partId ?? spec.id;
  if (!id) {
    throw new AssemblyApiError(
      `parts[${index}]: missing partId (either 'partId' or 'id' is required)`,
    );
  }
  const p = spec.position ?? { x: 0, y: 0, z: 0 };
  return {
    id,
    name: spec.name ?? id,
    partTemplateId: spec.partTemplateId ?? id,
    position: { x: p.x, y: p.y, z: p.z },
    orientation: spec.orientation ?? IDENTITY_QUAT,
    fixed: spec.fixed ?? false,
  };
}

type LocalRef =
  | { kind: 'point'; origin: Vec3 }
  | { kind: 'axis'; origin: Vec3; direction: Vec3 }
  | { kind: 'plane'; origin: Vec3; normal: Vec3 };

function builtinRefs(): Map<string, LocalRef> {
  const O = vec3(0, 0, 0);
  const X = vec3(1, 0, 0);
  const Y = vec3(0, 1, 0);
  const Z = vec3(0, 0, 1);
  return new Map<string, LocalRef>([
    ['origin', { kind: 'point', origin: O }],
    ['x_axis', { kind: 'axis', origin: O, direction: X }],
    ['y_axis', { kind: 'axis', origin: O, direction: Y }],
    ['z_axis', { kind: 'axis', origin: O, direction: Z }],
    ['xy_plane', { kind: 'plane', origin: O, normal: Z }],
    ['yz_plane', { kind: 'plane', origin: O, normal: X }],
    ['xz_plane', { kind: 'plane', origin: O, normal: Y }],
  ]);
}

function buildRegistry(
  partId: string,
  refs: Record<string, PartRefSpec> | undefined,
): Map<string, LocalRef> {
  const registry = builtinRefs();
  if (!refs) return registry;
  for (const [refId, spec] of Object.entries(refs)) {
    if (spec.kind === 'point') {
      registry.set(refId, { kind: 'point', origin: asVec3(spec.origin, partId, refId, 'origin') });
    } else if (spec.kind === 'axis') {
      registry.set(refId, {
        kind: 'axis',
        origin: asVec3(spec.origin, partId, refId, 'origin'),
        direction: asVec3(spec.direction, partId, refId, 'direction'),
      });
    } else if (spec.kind === 'plane') {
      registry.set(refId, {
        kind: 'plane',
        origin: asVec3(spec.origin, partId, refId, 'origin'),
        normal: asVec3(spec.normal, partId, refId, 'normal'),
      });
    } else {
      throw new AssemblyApiError(
        `part '${partId}' ref '${refId}': unknown ref kind '${(spec as { kind: string }).kind}' ` +
          `(expected 'point' | 'axis' | 'plane')`,
      );
    }
  }
  return registry;
}

function asVec3(v: Vec3Like | undefined, partId: string, refId: string, field: string): Vec3 {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
    throw new AssemblyApiError(
      `part '${partId}' ref '${refId}': field '${field}' must be a finite {x, y, z}`,
    );
  }
  return vec3(v.x, v.y, v.z);
}

/** LocalRef.kind → the MateRefKind used in the Mate IR. 1:1 here. */
function refKindOf(local: LocalRef): MateRefKind {
  return local.kind;
}

function normalizeMateSide(
  side: MateSideSpec,
  mateLabel: string,
  registries: ReadonlyMap<string, ReadonlyMap<string, LocalRef>>,
  hasCustomResolver: boolean,
): MateRef {
  if (!side || !side.partId || !side.refId) {
    throw new AssemblyApiError(
      `${mateLabel}: each side needs { partId, refId } — got ${JSON.stringify(side)}`,
    );
  }
  const registry = registries.get(side.partId);
  if (!registry) {
    const known = Array.from(registries.keys()).join(', ');
    throw new AssemblyApiError(
      `${mateLabel}: unknown partId '${side.partId}' (known parts: ${known})`,
    );
  }
  const local = registry.get(side.refId);
  if (!local && !hasCustomResolver) {
    const known = Array.from(registry.keys()).join(', ');
    throw new AssemblyApiError(
      `${mateLabel}: part '${side.partId}' has no ref '${side.refId}' ` +
        `(declared refs: ${known}). Declare it in the part's 'refs' or pass a custom resolver.`,
    );
  }
  let refKind = side.refKind;
  if (!refKind) {
    if (!local) {
      throw new AssemblyApiError(
        `${mateLabel}: refKind for '${side.partId}.${side.refId}' cannot be inferred ` +
          `under a custom resolver — pass refKind explicitly`,
      );
    }
    refKind = refKindOf(local);
  }
  return { partId: side.partId, refId: side.refId, refKind };
}

function requireNumber(
  value: number | undefined,
  mateLabel: string,
  field: string,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new AssemblyApiError(`${mateLabel}: '${field}' is required and must be finite`);
  }
  return value;
}

function normalizeMate(
  spec: SolveMateSpec,
  index: number,
  registries: ReadonlyMap<string, ReadonlyMap<string, LocalRef>>,
  hasCustomResolver: boolean,
): Mate {
  const id = spec.id ?? `mate_${index + 1}`;
  const label = `mate '${id}' (kind '${spec.kind}')`;
  const a = normalizeMateSide(spec.a, label, registries, hasCustomResolver);
  const b = normalizeMateSide(spec.b, label, registries, hasCustomResolver);
  const base = { id, a, b, ...(spec.suppressed !== undefined ? { suppressed: spec.suppressed } : {}) };

  switch (spec.kind) {
    case 'coincident':
    case 'concentric':
    case 'parallel':
    case 'perpendicular':
    case 'tangent':
      return { ...base, kind: spec.kind };
    case 'distance':
      return { ...base, kind: 'distance', value: requireNumber(spec.value, label, 'value') };
    case 'angle':
      return { ...base, kind: 'angle', value: requireNumber(spec.value, label, 'value') };
    case 'hinge':
      return {
        ...base,
        kind: 'hinge',
        ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
        ...(spec.zeroAngleRef !== undefined ? { zeroAngleRef: spec.zeroAngleRef } : {}),
      };
    case 'slot':
      return {
        ...base,
        kind: 'slot',
        ...(spec.slotLength !== undefined ? { slotLength: spec.slotLength } : {}),
      };
    case 'gear':
      return {
        ...base,
        kind: 'gear',
        ratio: requireNumber(spec.ratio, label, 'ratio'),
        ...(spec.reverse !== undefined ? { reverse: spec.reverse } : {}),
        ...(spec.backlash !== undefined ? { backlash: spec.backlash } : {}),
      };
    case 'rack_pinion':
      return {
        ...base,
        kind: 'rack_pinion',
        pinionRadius: requireNumber(spec.pinionRadius, label, 'pinionRadius'),
        ...(spec.rackTravel !== undefined ? { rackTravel: spec.rackTravel } : {}),
      };
    default:
      throw new AssemblyApiError(
        `mates[${index}]: unknown mate kind '${(spec as { kind: string }).kind}'`,
      );
  }
}

// ─── resolver over declared refs ─────────────────────────────────────────

function registryResolver(
  registries: ReadonlyMap<string, ReadonlyMap<string, LocalRef>>,
): GeometryResolver {
  return (ref: MateRef, part: PartInstance): ResolvedGeometry | null => {
    const registry = registries.get(ref.partId);
    if (!registry) return null;
    const local = registry.get(ref.refId);
    if (!local) return null;
    if (local.kind === 'point') {
      return { kind: 'point', world: add(part.position, rotateVec(local.origin, part.orientation)) };
    }
    if (local.kind === 'axis') {
      return {
        kind: 'axis',
        world: {
          origin: add(part.position, rotateVec(local.origin, part.orientation)),
          direction: rotateVec(local.direction, part.orientation),
        },
      };
    }
    return {
      kind: 'plane',
      world: {
        origin: add(part.position, rotateVec(local.origin, part.orientation)),
        normal: rotateVec(local.normal, part.orientation),
      },
    };
  };
}

// ─── solveMates ──────────────────────────────────────────────────────────

/**
 * Solve mate constraints on an assembly declared as plain data.
 *
 * @param assembly parts array (or `{ parts, mates? }` — an AssemblyState
 *   passes through; its pre-existing mates are solved too).
 * @param mates mates to add, as `SolveMateSpec` (friendly `{ partId, refId }`
 *   sides) or fully-formed `Mate` IR objects (they satisfy the spec shape).
 * @param opts solver options + engine selection + custom resolver.
 *
 * @throws AssemblyApiError / AssemblyValidationError / MateValidationError
 *   with an explicit reason for every rejected input. Refs are pre-resolved
 *   against the initial placements so a typo'd refId fails loudly instead
 *   of the engine silently skipping the mate.
 */
export function solveMates(
  assembly: SolveAssemblyInput,
  mates: ReadonlyArray<SolveMateSpec | Mate> = [],
  opts: SolveMatesOptions = {},
): SolveMatesResult {
  const partSpecs = Array.isArray(assembly)
    ? (assembly as ReadonlyArray<SolvePartSpec>)
    : (assembly as { parts: ReadonlyArray<SolvePartSpec> }).parts;
  if (!partSpecs || partSpecs.length === 0) {
    throw new AssemblyApiError('solveMates: assembly has no parts');
  }
  const carriedMates: ReadonlyArray<Mate> = Array.isArray(assembly)
    ? []
    : ((assembly as { mates?: ReadonlyArray<Mate> }).mates ?? []);

  const parts = partSpecs.map((spec, i) => normalizePart(spec, i));

  // Per-part ref registries (built-ins + declared refs).
  const registries = new Map<string, ReadonlyMap<string, LocalRef>>();
  for (let i = 0; i < parts.length; i++) {
    registries.set(parts[i]!.id, buildRegistry(parts[i]!.id, partSpecs[i]!.refs));
  }

  const hasCustomResolver = opts.resolver !== undefined;
  const normalizedMates = mates.map((m, i) =>
    normalizeMate(m as SolveMateSpec, carriedMates.length + i, registries, hasCustomResolver),
  );
  const allMates: Mate[] = [...carriedMates, ...normalizedMates];

  const state: AssemblyState = { parts, mates: allMates };
  validateAssembly(state); // throws with reasons (dup ids, no fixed part, bad combos, …)

  const resolve = opts.resolver ?? registryResolver(registries);

  // Pre-flight: every mate ref must resolve NOW — the engines treat a null
  // resolution as "skip this mate", which reads as false convergence.
  const partById = new Map(parts.map((p) => [p.id, p]));
  for (const mate of allMates) {
    for (const side of [mate.a, mate.b] as const) {
      const part = partById.get(side.partId)!;
      if (resolve(side, part) === null) {
        throw new AssemblyApiError(
          `mate '${mate.id}': ref '${side.partId}.${side.refId}' did not resolve to geometry — ` +
            `the engine would silently skip this mate, refusing instead`,
        );
      }
    }
  }

  const engine = opts.engine ?? 'gauss-seidel';
  const engineOpts: IterativeSolverOptions = {
    ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}),
    ...(opts.relaxation !== undefined ? { relaxation: opts.relaxation } : {}),
  };
  const runEngine = (s: AssemblyState): IterativeSolveResult =>
    engine === 'newton'
      ? lagrangianSolveAnalytic(s, resolve, engineOpts)
      : iterativeSolve(s, resolve, engineOpts);

  let raw = runEngine(state);
  let driveEffects: ReadonlyArray<DriveEffect> = [];

  // ── W5-F 2차: transmission drives (gear / rack_pinion / hinge) ────────
  // Applied on the STATICS-SOLVED state, then re-solved so the returned
  // residuals/convergence reflect the driven pose (a drive that fights
  // another mate surfaces as non-convergence instead of being hidden).
  if (opts.drives && opts.drives.length > 0) {
    const preIterations = raw.iterations;
    const driven = applyDrives(raw.state, resolve, opts.drives);
    driveEffects = driven.effects;
    const verified = runEngine(driven.state);
    raw = { ...verified, iterations: preIterations + verified.iterations };
  }

  const solvedParts: SolvedPartPlacement[] = raw.state.parts.map((p) => ({
    partId: p.id,
    position: vec3(p.position.x, p.position.y, p.position.z),
    orientation: p.orientation,
    fixed: p.fixed ?? false,
  }));
  const solvedById = new Map(solvedParts.map((p) => [p.partId, p]));

  return {
    converged: raw.success,
    iterations: raw.iterations,
    finalMaxResidual: raw.finalMaxResidual,
    residuals: raw.residuals,
    parts: solvedParts,
    partById: solvedById,
    part(partId: string): SolvedPartPlacement {
      const found = solvedById.get(partId);
      if (!found) {
        const known = solvedParts.map((p) => p.partId).join(', ');
        throw new AssemblyApiError(`part('${partId}'): unknown part (known: ${known})`);
      }
      return found;
    },
    state: raw.state,
    raw,
    driveEffects,
  };
}

// ─── kinematics re-exports (W5-F 2차 — additive) ─────────────────────────

export { applyDrives, KinematicsError, measureHingeSwingRad } from './kinematics';
export type { DriveSpec, DriveEffect, DriveResult } from './kinematics';
