/**
 * booleanFeature — 3D boolean combine feature for the feature tree. Combines
 * two or more solid bodies (referenced by feature-node id) via union,
 * difference, or intersection, and serializes the combination to OpenSCAD.
 *
 * Phase 2.1.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Why both an IR and a SCAD string?
 *   - The IR (BooleanFeature) is the canonical, language-agnostic feature
 *     description that downstream OCCT/Parasolid integrations will consume
 *     (Phase 2.x+). It references the operand bodies by feature-node id so the
 *     feature tree owns the body geometry; this module only owns the combine.
 *   - SCAD is the present-day execution backend (existing NexyFab
 *     openscad-render pipeline). `booleanToScad` renders the combine to a
 *     `union()/difference()/intersection()` wrapper around the already-rendered
 *     child SCAD blocks, ready for that pipeline.
 *
 * Scope (Phase 2.1.3 — minimal):
 *   - N-ary union / intersection (order-insensitive, but preserved for diffs).
 *   - difference: bodies[0] is the base, bodies[1..] are subtracted.
 *
 * Out of scope (Phase 2.x+):
 *   - Selective face/edge boolean (local operations)
 *   - Boolean fragmentation / non-manifold result repair (needs OCCT)
 *   - Coplanar-face merge cleanup
 */

// ─── IR ───────────────────────────────────────────────────────────────────

export type BooleanOp = 'union' | 'difference' | 'intersection';

export interface BooleanFeature {
  kind: 'boolean';
  op: BooleanOp;
  /**
   * Feature-node ids of the operand bodies. Must contain >= 2 ids with no
   * duplicates. For 'difference', bodies[0] is the base and the remaining ids
   * are subtracted from it (order significant).
   */
  bodies: string[];
}

const KNOWN_OPS: ReadonlySet<BooleanOp> = new Set<BooleanOp>([
  'union',
  'difference',
  'intersection',
]);

// ─── validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a BooleanFeature IR. Collects all problems (does not throw) so a UI
 * can surface every issue at once. Deterministic: identical input → identical
 * errors in a stable order.
 */
export function validateBooleanFeature(f: BooleanFeature): ValidationResult {
  const errors: string[] = [];

  if (!f || f.kind !== 'boolean') {
    errors.push(`expected kind 'boolean', got: ${f ? String(f.kind) : 'null'}`);
  }

  if (!KNOWN_OPS.has(f?.op)) {
    errors.push(`unknown op: ${f ? JSON.stringify(f.op) : 'null'}`);
  }

  const bodies = f?.bodies;
  if (!Array.isArray(bodies)) {
    errors.push('bodies must be an array');
  } else {
    if (bodies.length < 2) {
      errors.push(`boolean requires >= 2 bodies, got: ${bodies.length}`);
    }
    const seen = new Set<string>();
    for (let i = 0; i < bodies.length; i++) {
      const id = bodies[i];
      if (typeof id !== 'string' || id.length === 0) {
        errors.push(`bodies[${i}] must be a non-empty id`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`duplicate body id: ${JSON.stringify(id)}`);
      }
      seen.add(id);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── SCAD serializer ──────────────────────────────────────────────────────

/**
 * Wrap the already-rendered child SCAD blocks in the matching OpenSCAD boolean
 * operator. `childScads` must align 1:1 with `feature.bodies` (same length and
 * order) — childScads[i] is the rendered geometry of bodies[i]. For
 * 'difference' that means childScads[0] is the base and the rest are cut.
 *
 * Output is deterministic for identical input (caching/diffing): each child is
 * indented 2 spaces, in body order.
 *
 * @throws if the feature is invalid or childScads.length !== bodies.length.
 */
export function booleanToScad(
  feature: BooleanFeature,
  childScads: ReadonlyArray<string>,
): string {
  const result = validateBooleanFeature(feature);
  if (!result.ok) {
    throw new Error(`booleanToScad: invalid feature — ${result.errors.join('; ')}`);
  }
  if (childScads.length !== feature.bodies.length) {
    throw new Error(
      `booleanToScad: childScads count (${childScads.length}) must equal bodies count (${feature.bodies.length})`,
    );
  }

  const body = childScads.map((scad) => indent(scad, 2)).join('\n');
  return `${feature.op}() {\n${body}\n}`;
}

function indent(block: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}
