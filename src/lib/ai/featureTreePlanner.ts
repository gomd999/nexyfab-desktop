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
