import type { DesignPackage, DesignPlan, PlanPart } from './types';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  IDENTITY_QUAT,
  validateAssembly,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';
import type { Mate, MateRef, MateRefKind } from '@/lib/assembly/mate';
import type { SolveMateSpec, SolvePartSpec } from '@/lib/assembly/api';

export const EDITABLE_WORKSPACE_CANDIDATE_SCHEMA = 'nexyfab.editable-workspace-candidate.v1' as const;

export interface EditableWorkspaceProgramFeature {
  id: string;
  type: 'sketchExtrude' | 'boss' | 'hole' | 'fillet';
  shape?: 'rect' | 'circle';
  width?: number;
  depth?: number;
  height?: number;
  profile?: [number, number][];
  diameter?: number;
  posX?: number;
  posY?: number;
  radius?: number;
}

export interface EditableWorkspaceProgram {
  part: string;
  features: EditableWorkspaceProgramFeature[];
}

export interface EditableAssemblyWorkspace {
  state: AssemblyState;
  featureTrees: Record<string, FeatureTree>;
  sourcePartExactCad?: Record<string, {
    bodyCount: number;
    exactVolumeMm3: number;
    analyticCylinderBodyCount: number;
    maxStepRoundTripVolumeRelError: number;
  }>;
  sourceSolve?: {
    converged: true;
    iterations: number;
    finalMaxResidual: number;
  };
}

export interface EditableWorkspaceCandidate {
  schema: typeof EDITABLE_WORKSPACE_CANDIDATE_SCHEMA;
  sourcePlanId: string;
  target: 'modeler-feature-tree' | 'assembly-browser';
  supported: boolean;
  blockers: string[];
  program?: EditableWorkspaceProgram;
  /** Present only for a semantic named-reference assembly revision. */
  assembly?: EditableAssemblyWorkspace;
  /** Translation into the modeler creates a new artifact revision. */
  reverificationRequired: true;
  inheritedVerification: false;
  manufacturingReleaseReady: false;
}

interface RectLoop {
  width: number;
  depth: number;
  centerX: number;
  centerY: number;
}

interface CircleLoop {
  radius: number;
  centerX: number;
  centerY: number;
}

interface AxialCylinderStep {
  bodyId: string;
  radius: number;
  length: number;
  startZ: number;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function axisAlignedRectangle(loop: ReadonlyArray<{ x: number; y: number }>): RectLoop | null {
  if (loop.length !== 4 || loop.some(point => !finite(point.x) || !finite(point.y))) return null;
  const xs = [...new Set(loop.map(point => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(loop.map(point => point.y))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return null;
  const corners = new Set(loop.map(point => `${point.x}:${point.y}`));
  if (xs.some(x => ys.some(y => !corners.has(`${x}:${y}`)))) return null;
  const width = xs[1]! - xs[0]!;
  const depth = ys[1]! - ys[0]!;
  if (!(width > 0) || !(depth > 0)) return null;
  return { width, depth, centerX: (xs[0]! + xs[1]!) / 2, centerY: (ys[0]! + ys[1]!) / 2 };
}

function sampledCircle(loop: ReadonlyArray<{ x: number; y: number }>): CircleLoop | null {
  if (loop.length < 16 || loop.some(point => !finite(point.x) || !finite(point.y))) return null;
  const centerX = loop.reduce((sum, point) => sum + point.x, 0) / loop.length;
  const centerY = loop.reduce((sum, point) => sum + point.y, 0) / loop.length;
  const radii = loop.map(point => Math.hypot(point.x - centerX, point.y - centerY));
  const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  if (!(radius > 0)) return null;
  const tolerance = Math.max(1e-7, radius * 1e-6);
  if (radii.some(value => Math.abs(value - radius) > tolerance)) return null;

  let direction = 0;
  let total = 0;
  for (let index = 0; index < loop.length; index++) {
    const next = (index + 1) % loop.length;
    const angle = Math.atan2(loop[index]!.y - centerY, loop[index]!.x - centerX);
    const nextAngle = Math.atan2(loop[next]!.y - centerY, loop[next]!.x - centerX);
    let delta = nextAngle - angle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    if (Math.abs(delta) < 1e-9) return null;
    const sign = delta > 0 ? 1 : -1;
    if (direction === 0) direction = sign;
    else if (direction !== sign) return null;
    total += delta;
  }
  if (Math.abs(Math.abs(total) - 2 * Math.PI) > 1e-6) return null;
  return { radius, centerX, centerY };
}

function validAdditiveExtrude(feature: ExtrudeFeature): boolean {
  return feature.mode === 'add'
    && feature.direction === 'one_sided'
    && (feature.draftDegrees ?? 0) === 0
    && !(feature.profileOffsetZ && Math.abs(feature.profileOffsetZ) > 1e-12)
    && feature.depth > 0
    && finite(feature.depth);
}

/** Detect a contiguous set of concentric extrudes that is one stepped shaft. */
function axialCylinderStack(part: PlanPart): AxialCylinderStep[] | null {
  if (part.bodies.length < 2) return null;
  const steps: AxialCylinderStep[] = [];
  let center: { x: number; y: number } | null = null;
  for (const body of part.bodies) {
    if (body.feature.kind !== 'extrude') return null;
    const feature = body.feature as ExtrudeFeature;
    const circle = sampledCircle(feature.loop);
    const translation = body.translate ?? { x: 0, y: 0, z: 0 };
    if (!circle || !validAdditiveExtrude(feature)) return null;
    if (Math.abs(translation.x) > 1e-9 || Math.abs(translation.y) > 1e-9) return null;
    if (!center) center = { x: circle.centerX, y: circle.centerY };
    if (Math.hypot(circle.centerX - center.x, circle.centerY - center.y) > 1e-6) return null;
    steps.push({ bodyId: body.bodyId, radius: circle.radius, length: feature.depth, startZ: translation.z });
  }
  steps.sort((a, b) => a.startZ - b.startZ || a.bodyId.localeCompare(b.bodyId));
  if (Math.abs(steps[0]!.startZ) > 1e-6) return null;
  for (let index = 1; index < steps.length; index++) {
    const previousEnd = steps[index - 1]!.startZ + steps[index - 1]!.length;
    if (Math.abs(steps[index]!.startZ - previousEnd) > 1e-6) return null;
  }
  return steps;
}

/** Full-turn rectangular radial profile → exact editable cylinder primitive. */
function cylindricalRevolve(feature: RevolveFeature): { radius: number; length: number } | null {
  if (feature.mode !== 'add' || Math.abs(feature.angleDegrees - 360) > 1e-9) return null;
  const rect = axisAlignedRectangle(feature.loop);
  if (!rect) return null;
  const minX = Math.min(...feature.loop.map(point => point.x));
  const maxX = Math.max(...feature.loop.map(point => point.x));
  if (Math.abs(minX) > 1e-9 || !(maxX > 0)) return null;
  return { radius: maxX, length: rect.depth };
}

const BUILTIN_REF_KINDS: Readonly<Record<string, MateRefKind>> = {
  origin: 'point',
  x_axis: 'axis',
  y_axis: 'axis',
  z_axis: 'axis',
  xy_plane: 'plane',
  yz_plane: 'plane',
  xz_plane: 'plane',
};

function assemblyRef(
  side: SolveMateSpec['a'],
  parts: ReadonlyMap<string, SolvePartSpec>,
): MateRef | null {
  const part = parts.get(side.partId);
  const refKind = side.refKind ?? part?.refs?.[side.refId]?.kind ?? BUILTIN_REF_KINDS[side.refId];
  return refKind ? { partId: side.partId, refId: side.refId, refKind } : null;
}

function assemblyMate(
  spec: SolveMateSpec,
  index: number,
  parts: ReadonlyMap<string, SolvePartSpec>,
): Mate | null {
  const a = assemblyRef(spec.a, parts);
  const b = assemblyRef(spec.b, parts);
  if (!a || !b) return null;
  const base = {
    id: spec.id ?? `mate_${index + 1}`,
    a,
    b,
    ...(spec.suppressed !== undefined ? { suppressed: spec.suppressed } : {}),
  };
  switch (spec.kind) {
    case 'coincident':
    case 'concentric':
    case 'parallel':
    case 'perpendicular':
    case 'tangent':
      return { ...base, kind: spec.kind };
    case 'distance':
    case 'angle':
      return Number.isFinite(spec.value) ? { ...base, kind: spec.kind, value: spec.value! } : null;
    case 'hinge':
      return { ...base, kind: 'hinge', ...(spec.limit ? { limit: spec.limit } : {}), ...(spec.zeroAngleRef ? { zeroAngleRef: spec.zeroAngleRef } : {}) };
    case 'slot':
      return { ...base, kind: 'slot', ...(spec.slotLength !== undefined ? { slotLength: spec.slotLength } : {}) };
    case 'gear':
      return Number.isFinite(spec.ratio)
        ? { ...base, kind: 'gear', ratio: spec.ratio!, ...(spec.reverse !== undefined ? { reverse: spec.reverse } : {}), ...(spec.backlash !== undefined ? { backlash: spec.backlash } : {}) }
        : null;
    case 'rack_pinion':
      return Number.isFinite(spec.pinionRadius)
        ? { ...base, kind: 'rack_pinion', pinionRadius: spec.pinionRadius!, ...(spec.rackTravel ? { rackTravel: spec.rackTravel } : {}) }
        : null;
  }
}

function buildEditableAssemblyCandidate(
  plan: DesignPlan,
  designPackage?: DesignPackage,
): EditableWorkspaceCandidate {
  const declared = plan.assembly!;
  const blockers: string[] = [];
  if (plan.parts.length < 2) blockers.push('assembly_workspace_requires_multiple_parts');
  const planParts = new Map(plan.parts.map(part => [part.partId, part]));
  const solveParts = new Map<string, SolvePartSpec>();
  for (const spec of declared.parts) {
    const id = spec.partId ?? spec.id;
    if (!id || solveParts.has(id)) blockers.push(`invalid_or_duplicate_assembly_part:${id ?? 'missing'}`);
    else solveParts.set(id, spec);
  }
  for (const part of plan.parts) {
    if (!solveParts.has(part.partId)) blockers.push(`assembly_missing_part:${part.partId}`);
    const perPart = buildEditableWorkspaceCandidate({ ...plan, parts: [part], assembly: undefined });
    for (const blocker of perPart.blockers) blockers.push(`${part.partId}:${blocker}`);
    // The standalone assembly viewer consumes one part-local FeatureTree.
    // Translated/multi-body composites need a dedicated exact part document.
    if (part.bodies.length !== 1) blockers.push(`${part.partId}:assembly_feature_tree_requires_single_body`);
    if (part.bodies.some(body => body.translate && [body.translate.x, body.translate.y, body.translate.z].some(value => Math.abs(value) > 1e-12))) {
      blockers.push(`${part.partId}:translated_assembly_body_not_supported`);
    }
    if (part.holes?.length) blockers.push(`${part.partId}:assembly_hole_tree_adapter_not_implemented`);
    if (part.curved) blockers.push(`${part.partId}:assembly_curved_tree_adapter_not_implemented`);
  }
  for (const id of solveParts.keys()) {
    if (!planParts.has(id)) blockers.push(`assembly_part_has_no_geometry:${id}`);
  }

  const normalizedMates: Mate[] = [];
  declared.mates.forEach((spec, index) => {
    const mate = assemblyMate(spec, index, solveParts);
    if (mate) normalizedMates.push(mate);
    else blockers.push(`assembly_mate_reference_not_resolved:${spec.id ?? index + 1}`);
  });

  const solved = new Map(designPackage?.assembly?.placements.map(placement => [placement.partId, placement]) ?? []);
  const parts: PartInstance[] = [];
  for (const [id, spec] of solveParts) {
    const sourcePart = planParts.get(id);
    const placement = solved.get(id);
    parts.push({
      id,
      name: spec.name ?? sourcePart?.name ?? id,
      partTemplateId: spec.partTemplateId ?? id,
      position: placement?.position ?? spec.position ?? { x: 0, y: 0, z: 0 },
      orientation: placement?.orientation ?? spec.orientation ?? IDENTITY_QUAT,
      fixed: placement?.fixed ?? spec.fixed ?? false,
      ...(spec.refs ? { refs: spec.refs } : {}),
    });
  }
  const state: AssemblyState = { parts, mates: normalizedMates };
  if (blockers.length === 0) {
    try {
      validateAssembly(state);
    } catch (error) {
      blockers.push(`assembly_state_invalid:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const base: EditableWorkspaceCandidate = {
    schema: EDITABLE_WORKSPACE_CANDIDATE_SCHEMA,
    sourcePlanId: plan.planId,
    target: 'assembly-browser',
    supported: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    reverificationRequired: true,
    inheritedVerification: false,
    manufacturingReleaseReady: false,
  };
  if (uniqueBlockers.length) return base;

  const featureTrees = Object.fromEntries(plan.parts.map(part => [
    part.partId,
    {
      nodes: part.bodies.map(body => ({
        id: `${part.partId}:${body.bodyId}`,
        name: `${part.name} · ${body.bodyId}`,
        dependencies: [],
        payload: body.feature,
      })),
    } satisfies FeatureTree,
  ]));
  const sourcePartExactCad = designPackage
    ? Object.fromEntries(designPackage.parts.map(part => [part.partId, {
      bodyCount: part.exactCad.bodies.length,
      exactVolumeMm3: part.exactCad.exactVolumeMm3,
      analyticCylinderBodyCount: part.exactCad.bodies.filter(body => body.analyticCylinder).length,
      maxStepRoundTripVolumeRelError: part.exactCad.bodies.reduce(
        (max, body) => Math.max(max, body.roundTripVolumeRelError),
        0,
      ),
    }]))
    : undefined;
  return {
    ...base,
    assembly: {
      state,
      featureTrees,
      ...(sourcePartExactCad ? { sourcePartExactCad } : {}),
      ...(designPackage?.assembly ? {
        sourceSolve: {
          converged: true,
          iterations: designPackage.assembly.iterations,
          finalMaxResidual: designPackage.assembly.finalMaxResidual,
        },
      } : {}),
    },
  };
}

/**
 * Builds the smallest honest bridge from a verified DesignPlan to the live
 * editable modeler. Unsupported semantics fail closed: no partial program is
 * returned, so the UI cannot silently drop a body or manufacturing feature.
 * The translated artifact ALWAYS requires a fresh kernel/gate run.
 */
export function buildEditableWorkspaceCandidate(
  plan: DesignPlan,
  designPackage?: DesignPackage,
): EditableWorkspaceCandidate {
  if (plan.assembly) return buildEditableAssemblyCandidate(plan, designPackage);
  const blockers: string[] = [];
  if (plan.parts.length !== 1) blockers.push('workspace_adapter_requires_single_part');
  if (plan.assembly) blockers.push('assembly_workspace_adapter_not_implemented');

  const part = plan.parts[0];
  if (!part) blockers.push('workspace_adapter_requires_part');
  const stack = part ? axialCylinderStack(part) : null;
  if (part && part.bodies.length !== 1 && !stack) blockers.push('workspace_adapter_requires_single_or_contiguous_axial_body');
  if (part?.sheetMetal) blockers.push('sheet_metal_workspace_adapter_not_implemented');
  if (part?.weldment) blockers.push('weldment_workspace_adapter_not_implemented');
  if (part?.fasteners?.length) blockers.push('fastener_workspace_adapter_not_implemented');
  if (part?.patterns?.length) blockers.push('pattern_workspace_adapter_not_implemented');

  const feature = part?.bodies[0]?.feature;
  const extrude = !stack && feature?.kind === 'extrude' ? feature as ExtrudeFeature : null;
  const revolvedCylinder = !stack && feature?.kind === 'revolve'
    ? cylindricalRevolve(feature as RevolveFeature)
    : null;
  if (!stack && !extrude && !revolvedCylinder) blockers.push(`base_feature_not_supported:${feature?.kind ?? 'missing'}`);
  if (extrude) {
    if (!validAdditiveExtrude(extrude)) blockers.push('extrude_semantics_not_supported');
    if (!(extrude.depth > 0) || !finite(extrude.depth) || extrude.loop.length < 3
      || extrude.loop.some(point => !finite(point.x) || !finite(point.y))) blockers.push('invalid_extrude_geometry');
    const translation = part?.bodies[0]?.translate;
    if (translation && [translation.x, translation.y, translation.z].some(value => Math.abs(value) > 1e-12)) {
      blockers.push('translated_body_not_supported');
    }
  }

  const rect = extrude ? axisAlignedRectangle(extrude.loop) : null;
  const circle = extrude ? sampledCircle(extrude.loop) : null;
  const baseCenter = rect
    ? { x: rect.centerX, y: rect.centerY }
    : circle ? { x: circle.centerX, y: circle.centerY } : null;
  for (const hole of part?.holes ?? []) {
    if (!baseCenter || stack || revolvedCylinder) blockers.push(`hole_requires_single_prismatic_base:${hole.id}`);
    if ((hole.shape ?? 'round') !== 'round') blockers.push(`rectangular_hole_not_supported:${hole.id}`);
    if ((hole.kind ?? 'through') !== 'through') blockers.push(`blind_hole_not_supported:${hole.id}`);
    if (!(hole.diameterMm && finite(hole.diameterMm) && hole.diameterMm > 0)) blockers.push(`invalid_hole:${hole.id}`);
  }
  if (stack && part?.curved) blockers.push('curved_feature_on_axial_stack_not_supported');
  if (part?.curved) {
    if (part.curved.kind !== 'fillet') blockers.push(`curved_feature_not_supported:${part.curved.kind}`);
    const edges = part.curved.edges ?? ['sel:all'];
    if (edges.length !== 1 || edges[0] !== 'sel:all') blockers.push('selected_edge_fillet_not_supported');
    if (!(part.curved.radiusMm && finite(part.curved.radiusMm) && part.curved.radiusMm > 0)) blockers.push('invalid_fillet_radius');
  }

  const uniqueBlockers = [...new Set(blockers)];
  const base: Omit<EditableWorkspaceCandidate, 'program'> = {
    schema: EDITABLE_WORKSPACE_CANDIDATE_SCHEMA,
    sourcePlanId: plan.planId,
    target: 'modeler-feature-tree',
    supported: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    reverificationRequired: true,
    inheritedVerification: false,
    manufacturingReleaseReady: false,
  };
  if (uniqueBlockers.length || !part) return base;

  const features: EditableWorkspaceProgramFeature[] = [];
  if (stack) {
    const first = stack[0]!;
    features.push({
      id: `${part.partId}:${first.bodyId}`,
      type: 'sketchExtrude',
      shape: 'circle',
      width: first.radius * 2,
      height: first.length,
    });
    for (const step of stack.slice(1)) {
      features.push({
        id: `${part.partId}:${step.bodyId}`,
        type: 'boss',
        diameter: step.radius * 2,
        height: step.length,
        posX: 0,
        posY: 0,
      });
    }
  } else if (revolvedCylinder) {
    features.push({
      id: `${part.partId}:base`,
      type: 'sketchExtrude',
      shape: 'circle',
      width: revolvedCylinder.radius * 2,
      height: revolvedCylinder.length,
    });
  } else if (extrude) {
    features.push(rect
      ? { id: `${part.partId}:base`, type: 'sketchExtrude', shape: 'rect', width: rect.width, depth: rect.depth, height: extrude.depth }
      : circle
        ? { id: `${part.partId}:base`, type: 'sketchExtrude', shape: 'circle', width: circle.radius * 2, height: extrude.depth }
        : { id: `${part.partId}:base`, type: 'sketchExtrude', profile: extrude.loop.map(point => [point.x, point.y]), height: extrude.depth });
  }
  for (const hole of part.holes ?? []) {
    features.push({
      id: `${part.partId}:${hole.id}`,
      type: 'hole',
      diameter: hole.diameterMm,
      posX: hole.at.x - baseCenter!.x,
      posY: hole.at.y - baseCenter!.y,
    });
  }
  if (part.curved?.kind === 'fillet') {
    features.push({ id: `${part.partId}:fillet`, type: 'fillet', radius: part.curved.radiusMm });
  }
  return { ...base, program: { part: part.name || part.partId, features } };
}
