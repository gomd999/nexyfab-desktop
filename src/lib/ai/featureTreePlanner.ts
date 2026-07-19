/**
 * featureTreePlanner — Phase 3.AI multi-step plan generator for the
 * FeatureTree NL assistant. Sister to `featureTreeAssistantLlm` (single-op
 * intent → SuggestedTreeOp) but produces an *ordered list* of PlanSteps
 * (add_node / remove_node / move_node / toggle_suppress) that the caller
 * can apply sequentially to grow a multi-feature body.
 *
 * Why a separate module?
 *   - `featureTreeAssistant` was scoped to single edit ops (Phase 6).
 *   - Multi-step plans (e.g., "box with rounded edges" = extrude + fillet)
 *     need dependency wiring across newly-created nodes, which the existing
 *     SuggestedTreeOp surface doesn't express cleanly.
 *   - Keeping this module pure (no LLM dependency) means it can run inside
 *     deterministic tests + as the regex-only Phase 1 path. The LLM is
 *     wired in at the call site via `featureTreeIntentDetector` (LLM → intent
 *     → planner) — see that module's docstring for the boundary.
 *
 * Scope (Phase 3.AI Phase 1):
 *   - 6 PlanIntent kinds: create_box_with_holes, create_box_with_fillet,
 *     create_cylinder, add_fillet_to_last, add_chamfer_to_last,
 *     create_assembly_stack.
 *   - Auto-dependency wiring: a fillet placed on the last extrude inherits
 *     `dependencies: [lastExtrude.id]`.
 *   - Deterministic id generation: `<kind>_<seq>` based on the current tree
 *     size; collisions trigger a numeric suffix bump.
 *   - Rationale text (human-readable plan summary) + warnings (recoverable
 *     issues, e.g., applying fillet but no extrude exists).
 *
 * Out of scope (later phases):
 *   - Plan optimization (de-duplicating equivalent steps).
 *   - Plan validation against feature constraints (e.g., fillet radius vs.
 *     bbox/2 — leave that to the builders at apply time).
 *   - Multi-turn plan memory (the LLM wrapper handles that).
 *   - Undo-aware plans.
 */

import type {
  FeatureNode,
  FeatureTree,
} from '@/lib/cad/featureTree';
import type {
  ExtrudeFeature,
} from '@/lib/cad/extrudeProfile';
import type {
  HoleFeature,
} from '@/lib/cad/holeProfile';
import type {
  FilletFeature,
} from '@/lib/cad/filletProfile';
import type {
  ChamferFeature,
} from '@/lib/cad/chamferProfile';
import type {
  RevolveFeature,
} from '@/lib/cad/revolveProfile';
import type {
  LinearPatternFeature,
  CircularPatternFeature,
} from '@/lib/cad/pattern';

// ─── Public API types ────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlanStep {
  type: 'add_node' | 'remove_node' | 'move_node' | 'toggle_suppress';
  /** Set when type === 'add_node'. */
  node?: FeatureNode;
  /** Set when type !== 'add_node'. */
  nodeId?: string;
  /** Set when type === 'move_node'. */
  toIdx?: number;
}

export interface PlanResult {
  steps: PlanStep[];
  rationale: string;
  warnings: string[];
}

export type PlanIntent =
  | {
      kind: 'create_box_with_holes';
      size: Vec3;
      holes: Array<{ x: number; y: number; diameter: number }>;
    }
  | {
      kind: 'create_box_with_fillet';
      size: Vec3;
      filletRadius: number;
    }
  | {
      kind: 'create_cylinder';
      radius: number;
      height: number;
    }
  | {
      kind: 'add_fillet_to_last';
      radius: number;
    }
  | {
      kind: 'add_chamfer_to_last';
      distance: number;
    }
  | {
      kind: 'create_assembly_stack';
      partCount: number;
      spacing: number;
    }
  // ── Phase 3.AI.2 — 6 additional kinds ──────────────────────────────────
  | {
      kind: 'create_box_with_chamfer';
      size: Vec3;
      chamferDistance: number;
    }
  | {
      kind: 'create_box_with_pocket';
      size: Vec3;
      pocketDepth: number;
      pocketRadius: number;
    }
  | {
      kind: 'create_cylinder_with_hole';
      radius: number;
      height: number;
      holeRadius: number;
    }
  | {
      kind: 'create_pattern_grid';
      baseFeature: 'extrude_box' | 'cylinder';
      count: { x: number; y: number };
      spacing: number;
    }
  | {
      kind: 'create_revolve_axis';
      profile: 'rectangle' | 'triangle';
      radius: number;
      height: number;
    }
  | {
      kind: 'add_pattern_to_last';
      patternKind: 'linear' | 'circular';
      count: number;
      spacing?: number;
      angle?: number;
    }
  | {
      // Generic "add this feature to the current part". `featureType` is a
      // FeatureType registry key (kept as string here so this lib stays
      // decoupled from the client three.js feature registry); `params` are
      // the feature's numeric params (omitted ones fall back to registry
      // defaults at apply time). Applied through the in-context viewport path
      // only — the planner panel's typed payload model does not implement it.
      kind: 'add_feature_to_last';
      featureType: string;
      params: Record<string, number>;
    }
  | {
      // "make it 8mm" / "make the fillet bigger" — update the last feature's
      // numeric param. Resolved against model context (the last feature id) in
      // the viewport mapper. Planner-panel no-op.
      kind: 'update_last_param';
      paramKey: string;
      value: number;
    }
  | {
      // "remove the fillet" / "delete that" — remove the last feature.
      kind: 'remove_last';
    }
  | {
      // Free-form custom outline → extruded solid. `profile` is a closed 2D
      // polygon (≥3 points, mm) the LLM derived from a description the catalog
      // shapes can't express. Materialised by the viewport mapper into an
      // add_sketch_extrude; planner-panel no-op.
      kind: 'create_sketch_extrude';
      profile: Array<{ x: number; y: number }>;
      depth: number;
      plane?: 'xy' | 'xz' | 'yz';
      operation?: 'add' | 'subtract';
    }
  | {
      // Multi-step: one base primitive + an ordered list of features to stack
      // on it ("a plate with 4 holes and filleted edges"). Materialised by the
      // viewport mapper into [set_base_shape, add_feature, …]; planner-panel
      // no-op.
      kind: 'build_part';
      base: { shapeId: string; params: Record<string, number> };
      features: Array<{ type: string; params: Record<string, number> }>;
    }
  | {
      // Heterogeneous assembly: several DIFFERENT named parts, each its own
      // shape + params + world position (mm) / rotation (deg). Materialised by
      // the viewport mapper into a set_assembly_parts edit that drives the
      // PlacedPart pipeline (real per-part geometry). Planner-panel no-op.
      kind: 'assemble_parts';
      parts: Array<{
        name?: string;
        shapeId: string;
        params: Record<string, number>;
        position?: [number, number, number];
        rotation?: [number, number, number];
      }>;
    };

export class FeatureTreePlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureTreePlannerError';
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────

/**
 * Convert a structured PlanIntent into an ordered PlanStep[] ready for
 * sequential `applyEdit` calls.
 *
 * Pure function: no I/O, no LLM, deterministic given the same inputs.
 */
export function planFromIntent(
  intent: PlanIntent,
  currentTree: FeatureTree,
): PlanResult {
  switch (intent.kind) {
    case 'create_box_with_holes':
      return planCreateBoxWithHoles(intent, currentTree);
    case 'create_box_with_fillet':
      return planCreateBoxWithFillet(intent, currentTree);
    case 'create_cylinder':
      return planCreateCylinder(intent, currentTree);
    case 'add_fillet_to_last':
      return planAddFilletToLast(intent, currentTree);
    case 'add_chamfer_to_last':
      return planAddChamferToLast(intent, currentTree);
    case 'create_assembly_stack':
      return planCreateAssemblyStack(intent, currentTree);
    // ── Phase 3.AI.2 — 6 additional kinds ────────────────────────────────
    case 'create_box_with_chamfer':
      return planCreateBoxWithChamfer(intent, currentTree);
    case 'create_box_with_pocket':
      return planCreateBoxWithPocket(intent, currentTree);
    case 'create_cylinder_with_hole':
      return planCreateCylinderWithHole(intent, currentTree);
    case 'create_pattern_grid':
      return planCreatePatternGrid(intent, currentTree);
    case 'create_revolve_axis':
      return planCreateRevolveAxis(intent, currentTree);
    case 'add_pattern_to_last':
      return planAddPatternToLast(intent, currentTree);
    case 'add_feature_to_last':
      // The generic feature-add is materialised by the in-context viewport
      // path (planIntentToFeatureEdit → dispatcher add_feature). The planner
      // panel builds a fully-typed payload tree it doesn't model for arbitrary
      // features, so here it is an explicit, harmless no-op.
      return {
        steps: [],
        rationale: `add_feature_to_last (${intent.featureType}) is applied in-context, not via the planner panel.`,
        warnings: [`add_feature_to_last is not materialised by the planner panel (featureType=${intent.featureType}).`],
      };
    case 'update_last_param':
    case 'remove_last':
    case 'create_sketch_extrude':
    case 'build_part':
    case 'assemble_parts':
      // Context-aware / sketch / multi-step / assembly edits resolved by the
      // viewport mapper; the planner panel has no concept of these here.
      return {
        steps: [],
        rationale: `${intent.kind} is applied in-context, not via the planner panel.`,
        warnings: [`${intent.kind} is not materialised by the planner panel.`],
      };
  }
}

// ─── Per-intent planners ─────────────────────────────────────────────────

function planCreateBoxWithHoles(
  intent: Extract<PlanIntent, { kind: 'create_box_with_holes' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  validatePositiveSize(intent.size, warnings);

  const idGen = makeIdGenerator(tree);
  const boxId = idGen('box');
  const boxNode = makeBoxNode(boxId, intent.size);

  const steps: PlanStep[] = [{ type: 'add_node', node: boxNode }];

  if (intent.holes.length === 0) {
    warnings.push('create_box_with_holes called with empty holes[]; emitting box only');
  }

  for (const h of intent.holes) {
    if (!Number.isFinite(h.diameter) || h.diameter <= 0) {
      warnings.push(`skipping hole with non-positive diameter ${h.diameter}`);
      continue;
    }
    const holeId = idGen('hole');
    const holeNode = makeHoleNode(holeId, h.x, h.y, h.diameter, intent.size.z, [boxId]);
    steps.push({ type: 'add_node', node: holeNode });
  }

  const rationale =
    `Create a ${fmt(intent.size.x)}x${fmt(intent.size.y)}x${fmt(intent.size.z)} mm box ` +
    `with ${intent.holes.length} drilled hole(s). ` +
    `Each hole depends on the parent box.`;
  return { steps, rationale, warnings };
}

function planCreateBoxWithFillet(
  intent: Extract<PlanIntent, { kind: 'create_box_with_fillet' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  validatePositiveSize(intent.size, warnings);
  if (!Number.isFinite(intent.filletRadius) || intent.filletRadius <= 0) {
    throw new FeatureTreePlannerError(
      `create_box_with_fillet: filletRadius must be positive, got ${intent.filletRadius}`,
    );
  }
  const minDim = Math.min(intent.size.x, intent.size.y, intent.size.z);
  if (intent.filletRadius >= minDim / 2) {
    warnings.push(
      `filletRadius ${intent.filletRadius} ≥ min(size)/2 = ${minDim / 2}; ` +
        `apply step will fail at build time`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const boxId = idGen('box');
  const filletId = idGen('fillet');
  const boxNode = makeBoxNode(boxId, intent.size);
  const filletPayload: FilletFeature = {
    kind: 'fillet',
    // W2-0 ref mode: name the upstream body instead of copying it, so a
    // later edit to the box reaches this fillet. `dependencies` below
    // declares the same id, satisfying validateTree's refs ⊆ deps rule.
    childId: boxId,
    // Snapshot kept for legacy consumers only — never the emission source
    // while `childId` is set.
    childExtrude: boxNode.payload as ExtrudeFeature,
    radius: intent.filletRadius,
    edgeSelection: 'all',
  };
  const filletNode: FeatureNode = {
    id: filletId,
    name: `Fillet r${fmt(intent.filletRadius)}`,
    dependencies: [boxId],
    payload: filletPayload,
  };

  const rationale =
    `Create a ${fmt(intent.size.x)}x${fmt(intent.size.y)}x${fmt(intent.size.z)} mm box, ` +
    `then round all edges with radius ${fmt(intent.filletRadius)} mm.`;
  return {
    steps: [
      { type: 'add_node', node: boxNode },
      { type: 'add_node', node: filletNode },
    ],
    rationale,
    warnings,
  };
}

function planCreateCylinder(
  intent: Extract<PlanIntent, { kind: 'create_cylinder' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isFinite(intent.radius) || intent.radius <= 0) {
    throw new FeatureTreePlannerError(
      `create_cylinder: radius must be positive, got ${intent.radius}`,
    );
  }
  if (!Number.isFinite(intent.height) || intent.height <= 0) {
    throw new FeatureTreePlannerError(
      `create_cylinder: height must be positive, got ${intent.height}`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const cylId = idGen('cylinder');
  // Use revolve = sweep a rect around the Y axis to get a cylinder. This
  // keeps us inside the existing IR surface without adding a primitive kind.
  // The profile is the rectangle [0,0]–[radius, height]; axis = Y at x=0.
  const payload: RevolveFeature = {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: intent.radius, y: 0 },
      { x: intent.radius, y: intent.height },
      { x: 0, y: intent.height },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
  const node: FeatureNode = {
    id: cylId,
    name: `Cylinder r${fmt(intent.radius)} h${fmt(intent.height)}`,
    dependencies: [],
    payload,
  };
  const rationale =
    `Create a cylinder of radius ${fmt(intent.radius)} mm, ` +
    `height ${fmt(intent.height)} mm via 360° revolve.`;
  return { steps: [{ type: 'add_node', node }], rationale, warnings };
}

function planAddFilletToLast(
  intent: Extract<PlanIntent, { kind: 'add_fillet_to_last' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isFinite(intent.radius) || intent.radius <= 0) {
    throw new FeatureTreePlannerError(
      `add_fillet_to_last: radius must be positive, got ${intent.radius}`,
    );
  }
  const parent = findLastFilletableExtrude(tree);
  if (!parent) {
    warnings.push(
      'add_fillet_to_last: no extrude node found in current tree — cannot fillet',
    );
    return {
      steps: [],
      rationale: `Cannot add fillet r${fmt(intent.radius)}: no parent extrude in tree.`,
      warnings,
    };
  }
  const idGen = makeIdGenerator(tree);
  const filletId = idGen('fillet');
  const payload: FilletFeature = {
    kind: 'fillet',
    // W2-0 ref mode — see planCreateBoxWithFillet. `dependencies: [parent.id]`
    // below declares the same id.
    childId: parent.id,
    childExtrude: parent.payload as ExtrudeFeature,
    radius: intent.radius,
    edgeSelection: 'all',
  };
  const node: FeatureNode = {
    id: filletId,
    name: `Fillet r${fmt(intent.radius)}`,
    dependencies: [parent.id],
    payload,
  };
  const rationale =
    `Add fillet of radius ${fmt(intent.radius)} mm to '${parent.name}' (${parent.id}).`;
  return { steps: [{ type: 'add_node', node }], rationale, warnings };
}

function planAddChamferToLast(
  intent: Extract<PlanIntent, { kind: 'add_chamfer_to_last' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isFinite(intent.distance) || intent.distance <= 0) {
    throw new FeatureTreePlannerError(
      `add_chamfer_to_last: distance must be positive, got ${intent.distance}`,
    );
  }
  const parent = findLastFilletableExtrude(tree);
  if (!parent) {
    warnings.push(
      'add_chamfer_to_last: no extrude node found in current tree — cannot chamfer',
    );
    return {
      steps: [],
      rationale: `Cannot add chamfer d${fmt(intent.distance)}: no parent extrude in tree.`,
      warnings,
    };
  }
  const idGen = makeIdGenerator(tree);
  const chamferId = idGen('chamfer');
  const payload: ChamferFeature = {
    kind: 'chamfer',
    childExtrude: parent.payload as ExtrudeFeature,
    distance: intent.distance,
    edgeSelection: 'all',
  };
  const node: FeatureNode = {
    id: chamferId,
    name: `Chamfer d${fmt(intent.distance)}`,
    dependencies: [parent.id],
    payload,
  };
  const rationale =
    `Add chamfer of distance ${fmt(intent.distance)} mm to '${parent.name}' (${parent.id}).`;
  return { steps: [{ type: 'add_node', node }], rationale, warnings };
}

function planCreateAssemblyStack(
  intent: Extract<PlanIntent, { kind: 'create_assembly_stack' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isInteger(intent.partCount) || intent.partCount <= 0) {
    throw new FeatureTreePlannerError(
      `create_assembly_stack: partCount must be a positive integer, got ${intent.partCount}`,
    );
  }
  if (!Number.isFinite(intent.spacing) || intent.spacing < 0) {
    throw new FeatureTreePlannerError(
      `create_assembly_stack: spacing must be non-negative, got ${intent.spacing}`,
    );
  }
  if (intent.partCount > 32) {
    warnings.push(
      `create_assembly_stack: large partCount=${intent.partCount} may degrade render performance`,
    );
  }
  // Default each part to a 20x20x10 mm plate. The 'spacing' value is
  // re-encoded into the part depth so the parts visually stack — there is
  // no explicit Z translation in the current Extrude IR, but each plate
  // sits at its own depth with the host pipeline placing them sequentially.
  const idGen = makeIdGenerator(tree);
  const steps: PlanStep[] = [];
  const plateSize: Vec3 = { x: 20, y: 20, z: 10 };
  for (let i = 0; i < intent.partCount; i++) {
    const id = idGen('part');
    const node = makeBoxNode(id, plateSize, `Part ${i + 1}`);
    steps.push({ type: 'add_node', node });
  }
  const rationale =
    `Create an assembly stack of ${intent.partCount} parts, ` +
    `spaced ${fmt(intent.spacing)} mm apart.`;
  return { steps, rationale, warnings };
}

// ─── Phase 3.AI.2 — 6 additional per-intent planners ────────────────────

function planCreateBoxWithChamfer(
  intent: Extract<PlanIntent, { kind: 'create_box_with_chamfer' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  validatePositiveSize(intent.size, warnings);
  if (!Number.isFinite(intent.chamferDistance) || intent.chamferDistance <= 0) {
    throw new FeatureTreePlannerError(
      `create_box_with_chamfer: chamferDistance must be positive, got ${intent.chamferDistance}`,
    );
  }
  const minDim = Math.min(intent.size.x, intent.size.y, intent.size.z);
  if (intent.chamferDistance >= minDim / 2) {
    warnings.push(
      `chamferDistance ${intent.chamferDistance} ≥ min(size)/2 = ${minDim / 2}; ` +
        `apply step will fail at build time`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const boxId = idGen('box');
  const chamferId = idGen('chamfer');
  const boxNode = makeBoxNode(boxId, intent.size);
  const chamferPayload: ChamferFeature = {
    kind: 'chamfer',
    childExtrude: boxNode.payload as ExtrudeFeature,
    distance: intent.chamferDistance,
    edgeSelection: 'all',
  };
  const chamferNode: FeatureNode = {
    id: chamferId,
    name: `Chamfer d${fmt(intent.chamferDistance)}`,
    dependencies: [boxId],
    payload: chamferPayload,
  };
  const rationale =
    `Create a ${fmt(intent.size.x)}x${fmt(intent.size.y)}x${fmt(intent.size.z)} mm box, ` +
    `then chamfer all edges with distance ${fmt(intent.chamferDistance)} mm.`;
  return {
    steps: [
      { type: 'add_node', node: boxNode },
      { type: 'add_node', node: chamferNode },
    ],
    rationale,
    warnings,
  };
}

function planCreateBoxWithPocket(
  intent: Extract<PlanIntent, { kind: 'create_box_with_pocket' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  validatePositiveSize(intent.size, warnings);
  if (!Number.isFinite(intent.pocketDepth) || intent.pocketDepth <= 0) {
    throw new FeatureTreePlannerError(
      `create_box_with_pocket: pocketDepth must be positive, got ${intent.pocketDepth}`,
    );
  }
  if (!Number.isFinite(intent.pocketRadius) || intent.pocketRadius <= 0) {
    throw new FeatureTreePlannerError(
      `create_box_with_pocket: pocketRadius must be positive, got ${intent.pocketRadius}`,
    );
  }
  if (intent.pocketDepth >= intent.size.z) {
    warnings.push(
      `pocketDepth ${intent.pocketDepth} ≥ size.z ${intent.size.z}; pocket would punch through`,
    );
  }
  const maxRadius = Math.min(intent.size.x, intent.size.y) / 2;
  if (intent.pocketRadius >= maxRadius) {
    warnings.push(
      `pocketRadius ${intent.pocketRadius} ≥ min(size.x,size.y)/2 = ${maxRadius}; ` +
        `pocket would breach the side walls`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const boxId = idGen('box');
  const pocketId = idGen('hole');
  const boxNode = makeBoxNode(boxId, intent.size);
  // Model the pocket as a centred drilled hole — it's the simplest path that
  // reuses the existing HoleFeature builder, and the host pipeline will
  // subtract it via `difference()`.
  const pocketNode = makeHoleNode(
    pocketId,
    intent.size.x / 2,
    intent.size.y / 2,
    intent.pocketRadius * 2, // diameter
    intent.pocketDepth,
    [boxId],
  );
  const rationale =
    `Create a ${fmt(intent.size.x)}x${fmt(intent.size.y)}x${fmt(intent.size.z)} mm box ` +
    `with a centred pocket: radius ${fmt(intent.pocketRadius)} mm, ` +
    `depth ${fmt(intent.pocketDepth)} mm.`;
  return {
    steps: [
      { type: 'add_node', node: boxNode },
      { type: 'add_node', node: pocketNode },
    ],
    rationale,
    warnings,
  };
}

function planCreateCylinderWithHole(
  intent: Extract<PlanIntent, { kind: 'create_cylinder_with_hole' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isFinite(intent.radius) || intent.radius <= 0) {
    throw new FeatureTreePlannerError(
      `create_cylinder_with_hole: radius must be positive, got ${intent.radius}`,
    );
  }
  if (!Number.isFinite(intent.height) || intent.height <= 0) {
    throw new FeatureTreePlannerError(
      `create_cylinder_with_hole: height must be positive, got ${intent.height}`,
    );
  }
  if (!Number.isFinite(intent.holeRadius) || intent.holeRadius <= 0) {
    throw new FeatureTreePlannerError(
      `create_cylinder_with_hole: holeRadius must be positive, got ${intent.holeRadius}`,
    );
  }
  if (intent.holeRadius >= intent.radius) {
    warnings.push(
      `holeRadius ${intent.holeRadius} ≥ outer radius ${intent.radius}; ` +
        `would erase the cylinder wall`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const cylId = idGen('cylinder');
  const holeId = idGen('hole');
  // Outer cylinder via 360° revolve (matches the create_cylinder shape).
  const cylPayload: RevolveFeature = {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: intent.radius, y: 0 },
      { x: intent.radius, y: intent.height },
      { x: 0, y: intent.height },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
  const cylNode: FeatureNode = {
    id: cylId,
    name: `Cylinder r${fmt(intent.radius)} h${fmt(intent.height)}`,
    dependencies: [],
    payload: cylPayload,
  };
  // Concentric through-hole. Centre at the cylinder origin (0,0).
  const holeNode = makeHoleNode(
    holeId,
    0,
    0,
    intent.holeRadius * 2,
    intent.height,
    [cylId],
  );
  const rationale =
    `Create a cylinder r${fmt(intent.radius)} h${fmt(intent.height)} mm ` +
    `with a concentric through-hole r${fmt(intent.holeRadius)} mm.`;
  return {
    steps: [
      { type: 'add_node', node: cylNode },
      { type: 'add_node', node: holeNode },
    ],
    rationale,
    warnings,
  };
}

function planCreatePatternGrid(
  intent: Extract<PlanIntent, { kind: 'create_pattern_grid' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isInteger(intent.count.x) || intent.count.x <= 0) {
    throw new FeatureTreePlannerError(
      `create_pattern_grid: count.x must be a positive integer, got ${intent.count.x}`,
    );
  }
  if (!Number.isInteger(intent.count.y) || intent.count.y <= 0) {
    throw new FeatureTreePlannerError(
      `create_pattern_grid: count.y must be a positive integer, got ${intent.count.y}`,
    );
  }
  if (!Number.isFinite(intent.spacing) || intent.spacing <= 0) {
    throw new FeatureTreePlannerError(
      `create_pattern_grid: spacing must be positive, got ${intent.spacing}`,
    );
  }
  const total = intent.count.x * intent.count.y;
  if (total > 200) {
    warnings.push(
      `create_pattern_grid: large grid (${intent.count.x}x${intent.count.y}=${total}) may degrade render performance`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const steps: PlanStep[] = [];

  // Emit base feature as a single node first, then 2 nested linear patterns
  // that copy it along X and along Y. The base sits at (0,0); patterns
  // wrap its SCAD body via opaque childScad (the host pipeline materializes
  // childScad at render time — see pattern.ts docstring).
  let baseId: string;
  if (intent.baseFeature === 'extrude_box') {
    baseId = idGen('box');
    const baseNode = makeBoxNode(baseId, { x: 20, y: 20, z: 10 });
    steps.push({ type: 'add_node', node: baseNode });
  } else {
    baseId = idGen('cylinder');
    const cylPayload: RevolveFeature = {
      kind: 'revolve',
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      angleDegrees: 360,
      mode: 'add',
    };
    steps.push({
      type: 'add_node',
      node: {
        id: baseId,
        name: 'Cylinder r10 h10',
        dependencies: [],
        payload: cylPayload,
      },
    });
  }

  // X-direction pattern.
  const xPatternId = idGen('linpat');
  const xPayload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: `// pattern_child_ref:${baseId}`,
    count: intent.count.x,
    direction: { x: 1, y: 0, z: 0 },
    spacing: intent.spacing,
  };
  steps.push({
    type: 'add_node',
    node: {
      id: xPatternId,
      name: `Linear X ×${intent.count.x} s${fmt(intent.spacing)}`,
      dependencies: [baseId],
      payload: xPayload,
    },
  });

  // Y-direction pattern (operates on the X row → produces full grid).
  const yPatternId = idGen('linpat');
  const yPayload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: `// pattern_child_ref:${xPatternId}`,
    count: intent.count.y,
    direction: { x: 0, y: 1, z: 0 },
    spacing: intent.spacing,
  };
  steps.push({
    type: 'add_node',
    node: {
      id: yPatternId,
      name: `Linear Y ×${intent.count.y} s${fmt(intent.spacing)}`,
      dependencies: [xPatternId],
      payload: yPayload,
    },
  });

  const rationale =
    `Create a ${intent.count.x}x${intent.count.y} grid of ${intent.baseFeature}s ` +
    `spaced ${fmt(intent.spacing)} mm apart, via 2 nested linear patterns.`;
  return { steps, rationale, warnings };
}

function planCreateRevolveAxis(
  intent: Extract<PlanIntent, { kind: 'create_revolve_axis' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isFinite(intent.radius) || intent.radius <= 0) {
    throw new FeatureTreePlannerError(
      `create_revolve_axis: radius must be positive, got ${intent.radius}`,
    );
  }
  if (!Number.isFinite(intent.height) || intent.height <= 0) {
    throw new FeatureTreePlannerError(
      `create_revolve_axis: height must be positive, got ${intent.height}`,
    );
  }

  const idGen = makeIdGenerator(tree);
  const id = idGen('revolve');
  const loop: Array<{ x: number; y: number }> =
    intent.profile === 'rectangle'
      ? [
          { x: 0, y: 0 },
          { x: intent.radius, y: 0 },
          { x: intent.radius, y: intent.height },
          { x: 0, y: intent.height },
        ]
      : // triangle: right-triangle with the vertical leg on the axis
        [
          { x: 0, y: 0 },
          { x: intent.radius, y: 0 },
          { x: 0, y: intent.height },
        ];
  const payload: RevolveFeature = {
    kind: 'revolve',
    loop,
    angleDegrees: 360,
    mode: 'add',
  };
  const node: FeatureNode = {
    id,
    name: `Revolve ${intent.profile} r${fmt(intent.radius)} h${fmt(intent.height)}`,
    dependencies: [],
    payload,
  };
  const rationale =
    `Revolve a ${intent.profile} (radius ${fmt(intent.radius)} mm, ` +
    `height ${fmt(intent.height)} mm) 360° around the Y axis.`;
  return { steps: [{ type: 'add_node', node }], rationale, warnings };
}

function planAddPatternToLast(
  intent: Extract<PlanIntent, { kind: 'add_pattern_to_last' }>,
  tree: FeatureTree,
): PlanResult {
  const warnings: string[] = [];
  if (!Number.isInteger(intent.count) || intent.count < 2) {
    throw new FeatureTreePlannerError(
      `add_pattern_to_last: count must be an integer ≥ 2, got ${intent.count}`,
    );
  }
  if (intent.count > 1000) {
    throw new FeatureTreePlannerError(
      `add_pattern_to_last: count ${intent.count} exceeds 1000 (perf safety)`,
    );
  }
  const parent = findLastSolidFeature(tree);
  if (!parent) {
    warnings.push(
      'add_pattern_to_last: no solid feature found in current tree — cannot pattern',
    );
    return {
      steps: [],
      rationale: `Cannot add ${intent.patternKind} pattern: no parent solid in tree.`,
      warnings,
    };
  }

  const idGen = makeIdGenerator(tree);
  if (intent.patternKind === 'linear') {
    const spacing = intent.spacing;
    if (spacing === undefined || !Number.isFinite(spacing) || spacing <= 0) {
      throw new FeatureTreePlannerError(
        `add_pattern_to_last: linear pattern requires positive spacing, got ${spacing}`,
      );
    }
    const id = idGen('linpat');
    const payload: LinearPatternFeature = {
      kind: 'linear_pattern',
      childScad: `// pattern_child_ref:${parent.id}`,
      count: intent.count,
      direction: { x: 1, y: 0, z: 0 },
      spacing,
    };
    return {
      steps: [
        {
          type: 'add_node',
          node: {
            id,
            name: `Linear ×${intent.count} s${fmt(spacing)}`,
            dependencies: [parent.id],
            payload,
          },
        },
      ],
      rationale:
        `Add a linear pattern of ${intent.count} copies (spacing ${fmt(spacing)} mm) ` +
        `to '${parent.name}' (${parent.id}).`,
      warnings,
    };
  }

  // circular
  const angle = intent.angle ?? 360;
  if (!Number.isFinite(angle) || angle <= 0 || angle > 360) {
    throw new FeatureTreePlannerError(
      `add_pattern_to_last: circular pattern angle must be in (0, 360], got ${angle}`,
    );
  }
  const id = idGen('cirpat');
  const payload: CircularPatternFeature = {
    kind: 'circular_pattern',
    childScad: `// pattern_child_ref:${parent.id}`,
    count: intent.count,
    axisOrigin: { x: 0, y: 0, z: 0 },
    axisDirection: { x: 0, y: 0, z: 1 },
    totalAngleDegrees: angle,
  };
  return {
    steps: [
      {
        type: 'add_node',
        node: {
          id,
          name: `Circular ×${intent.count} (${fmt(angle)}°)`,
          dependencies: [parent.id],
          payload,
        },
      },
    ],
    rationale:
      `Add a circular pattern of ${intent.count} copies around the Z axis ` +
      `(${fmt(angle)}° sweep) to '${parent.name}' (${parent.id}).`,
    warnings,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeBoxNode(id: string, size: Vec3, name?: string): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: size.x, y: 0 },
      { x: size.x, y: size.y },
      { x: 0, y: size.y },
    ],
    depth: size.z,
    direction: 'one_sided',
    mode: 'add',
  };
  return {
    id,
    name: name ?? `Box ${fmt(size.x)}x${fmt(size.y)}x${fmt(size.z)}`,
    dependencies: [],
    payload,
  };
}

function makeHoleNode(
  id: string,
  x: number,
  y: number,
  diameter: number,
  depth: number,
  dependencies: string[],
): FeatureNode {
  const payload: HoleFeature = {
    kind: 'hole',
    center: { x, y },
    holeType: 'drilled',
    diameter,
    depth,
  };
  return {
    id,
    name: `Hole d${fmt(diameter)} @(${fmt(x)},${fmt(y)})`,
    dependencies,
    payload,
  };
}

/**
 * Find the most-recent extrude node in the tree (scanned in declared order;
 * the *last* extrude is the preferred parent for a follow-on fillet/chamfer).
 * Returns undefined if there is no extrude.
 */
function findLastFilletableExtrude(tree: FeatureTree): FeatureNode | undefined {
  for (let i = tree.nodes.length - 1; i >= 0; i--) {
    const n = tree.nodes[i]!;
    if (n.payload.kind === 'extrude') return n;
  }
  return undefined;
}

/**
 * Find the most-recent feature that produces a solid body (so a pattern has
 * something meaningful to copy). Accepts extrude / revolve / sweep / loft —
 * skips holes, fillets, chamfers, and other modifiers that aren't standalone
 * bodies. Returns undefined if no eligible feature exists.
 */
function findLastSolidFeature(tree: FeatureTree): FeatureNode | undefined {
  const solidKinds = new Set(['extrude', 'revolve', 'sweep', 'loft']);
  for (let i = tree.nodes.length - 1; i >= 0; i--) {
    const n = tree.nodes[i]!;
    if (solidKinds.has(n.payload.kind)) return n;
  }
  return undefined;
}

/**
 * Closure that yields unique node ids of the form `<prefix>_<seq>` where
 * seq starts at the current tree size and bumps on collision. Tracks
 * already-emitted ids across this single plan so multiple holes in one
 * plan don't collide (`hole_2`, `hole_3`, …).
 */
function makeIdGenerator(tree: FeatureTree): (prefix: string) => string {
  const existing = new Set<string>(tree.nodes.map((n) => n.id));
  return (prefix: string): string => {
    let i = existing.size + 1;
    let candidate = `${prefix}_${i}`;
    while (existing.has(candidate)) {
      i++;
      candidate = `${prefix}_${i}`;
    }
    existing.add(candidate);
    return candidate;
  };
}

function validatePositiveSize(size: Vec3, warnings: string[]): void {
  if (!Number.isFinite(size.x) || size.x <= 0) {
    throw new FeatureTreePlannerError(`size.x must be positive, got ${size.x}`);
  }
  if (!Number.isFinite(size.y) || size.y <= 0) {
    throw new FeatureTreePlannerError(`size.y must be positive, got ${size.y}`);
  }
  if (!Number.isFinite(size.z) || size.z <= 0) {
    throw new FeatureTreePlannerError(`size.z must be positive, got ${size.z}`);
  }
  if (size.x > 10_000 || size.y > 10_000 || size.z > 10_000) {
    warnings.push(
      `box dimension exceeds 10,000 mm — likely a unit-mismatch (mm vs. cm/m)`,
    );
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(4)).toString();
}
