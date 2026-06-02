/**
 * stepAssemblyImport — Phase 5.2.3 STEP assembly reader.
 *
 * SCOPE
 * -----
 * Reads a STEP file that contains a multi-part assembly (one PRODUCT per
 * part + NEXT_ASSEMBLY_USAGE_OCCURRENCE relationships) and returns:
 *   - an `AssemblyState` (parts[] with computed world-frame placements)
 *   - one `FeatureTree` per part (extracted by re-using stepImport.ts'
 *     single-solid classifier)
 *   - warnings + unsupported channels (same convention as stepImport.ts)
 *
 * PHASE 1 LIMITS
 * --------------
 *   - NEXT_ASSEMBLY_USAGE_OCCURRENCE is treated as a PLACEMENT only — no
 *     mate constraints are inferred. NAUO answers "where does child sit
 *     relative to parent" but not "what mate keeps it there"; deriving the
 *     mate is a Phase 2 reverse-engineering problem (Phase 2 wishlist
 *     in the README at the bottom of this file).
 *   - Multi-level hierarchies (sub-assembly contains parts) are FLATTENED
 *     to a single AssemblyState. Each leaf part's world placement is the
 *     composition of every transform up the chain to the root assembly.
 *     The tree structure itself is not preserved (Phase 2 will keep the
 *     SubAssembly nodes).
 *   - Circular references (A includes B includes A) throw — not just
 *     skip; a cyclic NAUO graph cannot be flattened to a finite list.
 *   - Transforms missing an ITEM_DEFINED_TRANSFORMATION (or the writer
 *     style that omits it entirely, e.g. our own stepWrite.writeAssemblyAsStep)
 *     fall back to identity. The part still imports — just at world origin.
 *
 * ALGORITHM
 * ---------
 *   1. healStepSource → parseEntities (same path as importStep).
 *   2. Inventory every PRODUCT_DEFINITION + PRODUCT. Each PD becomes a
 *      "part candidate" keyed by PD entity id.
 *   3. For each PD: walk PRODUCT_DEFINITION_SHAPE → SHAPE_DEFINITION_REPRESENTATION
 *      → ADVANCED_BREP_SHAPE_REPRESENTATION → items array → MANIFOLD_SOLID_BREP(s).
 *      Run the single-solid classifier on the solids to build a FeatureTree.
 *      A PD with no geometry is treated as a sub-assembly container
 *      (zero feature nodes — placement only).
 *   4. Build the parent→[children] adjacency from every
 *      NEXT_ASSEMBLY_USAGE_OCCURRENCE entity. Optional CONTEXT_DEPENDENT_SHAPE_REPRESENTATION
 *      + ITEM_DEFINED_TRANSFORMATION yields a 4×4 transform per edge;
 *      missing = identity.
 *   5. Find roots (PDs that are not the `related` side of any NAUO).
 *      DFS each root, composing transforms, emitting one PartInstance
 *      per LEAF PD reached. Detect cycles via the recursion stack.
 *   6. If no NAUO entities exist at all → treat the file as a single
 *      flat part list (one PartInstance per PD with geometry, world
 *      placement). This matches the common "one-part STEP file" case.
 *
 * TRANSFORM MATH
 * --------------
 * STEP ITEM_DEFINED_TRANSFORMATION carries a source AXIS2_PLACEMENT_3D
 * (frame A in parent coords) and a target AXIS2_PLACEMENT_3D (frame B
 * in child's local coords). The child-to-parent transform is
 *
 *     T = M(A) · M(B)⁻¹
 *
 * where M(P) is the 4×4 transform that maps the local frame at P's origin
 * with P's axes into the parent frame. We then convert T's rotation
 * sub-matrix to a quaternion using the classic Shepperd/Shoemake algorithm
 * (largest-diagonal pivot, avoiding numerical loss when one of the
 * trace+1 candidates underflows).
 *
 * For NAUO entries that carry NO transform (our own writer's "structural
 * only" output, or any AP203 file without ITEM_DEFINED_TRANSFORMATION),
 * identity is used. The Phase 1 importer therefore round-trips
 * `writeAssemblyAsStep` output: every part lands at world origin, which
 * matches what the writer emitted.
 */

import {
  parseEntities,
  StepImportError,
  type StepEntity,
  type StepArg,
} from './stepImport';
import { healStepSource } from './stepRead';
import { importStep } from './stepImport';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AssemblyState, PartInstance, Quat } from '@/lib/assembly/assemblyState';

// ─── public API ───────────────────────────────────────────────────────────

export interface StepAssemblyImportResult {
  /** Reconstructed assembly state. `mates` is always empty in Phase 1. */
  state: AssemblyState;
  /** One FeatureTree per part instance, keyed by PartInstance.id. Parts
   *  whose geometry could not be classified land here with an empty
   *  `nodes` array (the placement still imports). */
  featureTrees: Record<string, FeatureTree>;
  /** Non-fatal advisories: heal:* events, no_assembly_relationships, etc. */
  warnings: string[];
  /** Per-solid skips: forwarded from the inner single-solid classifier. */
  unsupported: string[];
}

export interface ImportStepAssemblyOptions {
  /** Override naming prefix for FeatureNode ids. Default 'imported'. */
  namePrefix?: string;
}

/**
 * Parse a STEP assembly file. Returns `{ state, featureTrees, warnings,
 * unsupported }`. Throws on hard structural failures (cyclic NAUO,
 * malformed entity table). Single-solid classification failures are
 * routed to `unsupported` (same convention as `importStep`).
 */
export function importStepAssembly(
  source: string,
  opts: ImportStepAssemblyOptions = {},
): StepAssemblyImportResult {
  if (typeof source !== 'string' || source.length === 0) {
    throw new StepImportError('empty_source: STEP source is empty');
  }
  const warnings: string[] = [];
  const unsupported: string[] = [];

  // ── 1. heal + parse ────────────────────────────────────────────────────
  const heal = healStepSource(source);
  for (const fix of heal.appliedFixes) warnings.push(`heal:${fix}`);
  const healed = heal.healed;

  const dataIdx = healed.search(/\bDATA\s*;/i);
  if (dataIdx < 0) {
    throw new StepImportError('no_data_section: missing DATA; section');
  }
  const endIdx = healed.indexOf('END-ISO-10303-21');
  const dataBlock = healed.slice(dataIdx, endIdx >= 0 ? endIdx : undefined);
  const entities = parseEntities(dataBlock);

  if (entities.size === 0) {
    warnings.push('parse:no_entities');
    return {
      state: { parts: [], mates: [] },
      featureTrees: {},
      warnings,
      unsupported,
    };
  }

  // ── 2. inventory PRODUCT_DEFINITIONs ───────────────────────────────────
  const productDefs: Array<{ id: number; ent: StepEntity }> = [];
  for (const [id, ent] of entities) {
    if (ent.name === 'PRODUCT_DEFINITION') productDefs.push({ id, ent });
  }
  if (productDefs.length === 0) {
    warnings.push('parse:no_product_definition, treating as single part');
    return fallbackSinglePartImport(source, opts, warnings, unsupported);
  }
  productDefs.sort((a, b) => a.id - b.id);

  // Map each PD entity id → human-readable PRODUCT name (walking
  // PD → FORMATION → PRODUCT chain). Falls back to "Part_<id>".
  const pdName = new Map<number, string>();
  for (const { id, ent } of productDefs) {
    pdName.set(id, productNameForDef(id, ent, entities) ?? `Part_${id}`);
  }

  // ── 3. for each PD: find its geometry → FeatureTree ────────────────────
  const pdGeometry = new Map<number, GeometryForPart>();
  for (const { id } of productDefs) {
    pdGeometry.set(id, findGeometryForProductDef(id, entities));
  }

  // ── 4. NAUO adjacency (parent PD → [{ child PD, transform }]) ──────────
  const children = new Map<number, Array<NauoEdge>>();
  const isChild = new Set<number>();
  for (const [id, ent] of entities) {
    if (ent.name !== 'NEXT_ASSEMBLY_USAGE_OCCURRENCE') continue;
    // NAUO(name, ref, desc, relating_pd, related_pd, ref_designator)
    const relatingArg = ent.args[3];
    const relatedArg = ent.args[4];
    if (
      !relatingArg || relatingArg.kind !== 'ref' ||
      !relatedArg  || relatedArg.kind  !== 'ref'
    ) {
      warnings.push(`parse:nauo_#${id}_missing_part_refs`);
      continue;
    }
    const parentPd = relatingArg.id;
    const childPd = relatedArg.id;
    if (!pdName.has(parentPd) || !pdName.has(childPd)) {
      warnings.push(`parse:nauo_#${id}_refs_unknown_pd`);
      continue;
    }
    const transform = findTransformForNauo(id, entities) ?? IDENTITY_MATRIX;
    const edge: NauoEdge = {
      nauoId: id,
      childPd,
      transform,
      designator: nauoDesignator(ent),
    };
    if (!children.has(parentPd)) children.set(parentPd, []);
    children.get(parentPd)!.push(edge);
    isChild.add(childPd);
  }

  // ── 5. find roots, DFS, emit flat PartInstance list ────────────────────
  const hasAnyNauo = Array.from(entities.values()).some(
    (e) => e.name === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE',
  );
  if (!hasAnyNauo) {
    warnings.push('parse:no_assembly_relationships, treating as flat parts');
  }

  const roots = productDefs
    .map((p) => p.id)
    .filter((id) => !isChild.has(id))
    .sort((a, b) => a - b);

  const parts: PartInstance[] = [];
  const featureTrees: Record<string, FeatureTree> = {};
  // Instance index is global so two NAUO edges that reference the same
  // PD (legitimate "2 bolts from one part definition") get distinct ids.
  let instanceIdx = 0;
  const usedIds = new Set<string>();

  function emitInstance(
    pdId: number,
    worldT: Matrix4,
    pathStack: ReadonlyArray<number>,
    designator: string | null,
  ): void {
    const childList = children.get(pdId);
    const geom = pdGeometry.get(pdId);
    const hasGeom = geom !== undefined && geom.solidIds.length > 0;

    // A PD with children is a sub-assembly container; recurse into its
    // children and DON'T emit it as a leaf part (avoids ghost instances).
    if (childList && childList.length > 0) {
      for (const edge of childList) {
        if (pathStack.includes(edge.childPd)) {
          const chain = [...pathStack, edge.childPd]
            .map((id) => `#${id}(${pdName.get(id) ?? '?'})`)
            .join(' → ');
          throw new StepImportError(
            `circular_assembly: NAUO cycle detected: ${chain}`,
          );
        }
        const composed = multiply(worldT, edge.transform);
        emitInstance(edge.childPd, composed, [...pathStack, edge.childPd], edge.designator);
      }
      return;
    }

    // Leaf: emit one PartInstance. PDs with no geometry still emit
    // (empty FeatureTree) so the AssemblyState shows the placement.
    const baseLabel = pdName.get(pdId) ?? `Part_${pdId}`;
    const id = uniqueId(usedIds, sanitizeId(designator ?? baseLabel), instanceIdx);
    usedIds.add(id);
    const { position, orientation } = decomposeMatrix(worldT);
    parts.push({
      id,
      name: baseLabel,
      partTemplateId: `pd_${pdId}`,
      position,
      orientation,
      // First emitted instance is always fixed so the AssemblyState
      // passes validateAssembly. Later instances are free (the solver
      // can move them — though Phase 1 has no mates anyway).
      fixed: parts.length === 0,
    });

    // Run the single-solid importer on every solid belonging to this PD.
    if (hasGeom) {
      const subset = buildSubsetForSolids(source, geom.solidIds);
      const trees = subset
        ? importStep(subset, { namePrefix: opts.namePrefix ?? `${id}` })
        : null;
      if (trees) {
        for (const w of trees.warnings) warnings.push(`part_${id}:${w}`);
        for (const u of trees.unsupported) unsupported.push(`part_${id}:${u}`);
        featureTrees[id] = trees.tree;
      } else {
        featureTrees[id] = { nodes: [] };
        warnings.push(`part_${id}:geometry_subset_build_failed`);
      }
    } else {
      featureTrees[id] = { nodes: [] };
    }
    instanceIdx += 1;
  }

  if (hasAnyNauo) {
    for (const rootPd of roots) {
      emitInstance(rootPd, IDENTITY_MATRIX, [rootPd], null);
    }
  } else {
    // No NAUO entries: emit one PartInstance per PD that has geometry.
    // PDs without geometry are skipped (they would just be empty
    // containers with no placement information).
    for (const { id: pdId } of productDefs) {
      const geom = pdGeometry.get(pdId);
      if (!geom || geom.solidIds.length === 0) continue;
      const baseLabel = pdName.get(pdId) ?? `Part_${pdId}`;
      const id = uniqueId(usedIds, sanitizeId(baseLabel), instanceIdx);
      usedIds.add(id);
      parts.push({
        id,
        name: baseLabel,
        partTemplateId: `pd_${pdId}`,
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        fixed: parts.length === 0,
      });
      const subset = buildSubsetForSolids(source, geom.solidIds);
      const trees = subset
        ? importStep(subset, { namePrefix: opts.namePrefix ?? `${id}` })
        : null;
      if (trees) {
        for (const w of trees.warnings) warnings.push(`part_${id}:${w}`);
        for (const u of trees.unsupported) unsupported.push(`part_${id}:${u}`);
        featureTrees[id] = trees.tree;
      } else {
        featureTrees[id] = { nodes: [] };
        warnings.push(`part_${id}:geometry_subset_build_failed`);
      }
      instanceIdx += 1;
    }
  }

  if (parts.length === 0) {
    warnings.push('parse:no_part_instances_emitted');
  }

  return {
    state: { parts, mates: [] },
    featureTrees,
    warnings,
    unsupported,
  };
}

// ─── internal types ───────────────────────────────────────────────────────

interface GeometryForPart {
  /** MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS entity ids attached to this PD. */
  solidIds: number[];
}

interface NauoEdge {
  nauoId: number;
  childPd: number;
  transform: Matrix4;
  designator: string | null;
}

/** Row-major 4×4 matrix, last row implicit [0 0 0 1]. Stored as 16 numbers
 *  so we don't allocate a typed-array per edge. */
type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

// ─── product-name resolution ──────────────────────────────────────────────

/** PD(' ','',formation,ctx) → walk formation → product → name. */
function productNameForDef(
  pdId: number,
  pd: StepEntity,
  entities: Map<number, StepEntity>,
): string | null {
  const formationArg = pd.args[2];
  if (!formationArg || formationArg.kind !== 'ref') return null;
  const formation = entities.get(formationArg.id);
  if (!formation) return null;
  // PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(id,desc,product,source)
  // or plain PRODUCT_DEFINITION_FORMATION(id,desc,product)
  const productArg = formation.args[2];
  if (!productArg || productArg.kind !== 'ref') return null;
  const product = entities.get(productArg.id);
  if (!product || product.name !== 'PRODUCT') return null;
  // PRODUCT(id, name, desc, (contexts))
  const nameArg = product.args[1] ?? product.args[0];
  if (nameArg && nameArg.kind === 'string' && nameArg.value.trim() !== '') {
    return nameArg.value;
  }
  return `Part_${pdId}`;
}

// ─── geometry lookup ──────────────────────────────────────────────────────

/**
 * Walk PD → PRODUCT_DEFINITION_SHAPE → SHAPE_DEFINITION_REPRESENTATION
 * → SHAPE_REPRESENTATION (or any *_SHAPE_REPRESENTATION subtype) and
 * collect every MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS in `items`.
 */
function findGeometryForProductDef(
  pdId: number,
  entities: Map<number, StepEntity>,
): GeometryForPart {
  const out: GeometryForPart = { solidIds: [] };

  // Find PRODUCT_DEFINITION_SHAPE referencing this PD.
  const pdsIds: number[] = [];
  for (const [id, ent] of entities) {
    if (ent.name !== 'PRODUCT_DEFINITION_SHAPE') continue;
    // PDS('','', pd) — args[2] is the PD ref (in our writer); some writers
    // wrap it in CHARACTERIZED_DEFINITION which we accept transparently.
    const pdRef = ent.args[2];
    if (pdRef && pdRef.kind === 'ref' && pdRef.id === pdId) pdsIds.push(id);
  }
  if (pdsIds.length === 0) return out;

  // Find SHAPE_DEFINITION_REPRESENTATION pointing at our PDS.
  const repIds: number[] = [];
  for (const [, ent] of entities) {
    if (ent.name !== 'SHAPE_DEFINITION_REPRESENTATION') continue;
    // SDR(definition, representation)
    const defArg = ent.args[0];
    const repArg = ent.args[1];
    if (
      defArg && defArg.kind === 'ref' && pdsIds.includes(defArg.id) &&
      repArg && repArg.kind === 'ref'
    ) {
      repIds.push(repArg.id);
    }
  }

  // For each representation, walk its items list for solid bodies.
  for (const repId of repIds) {
    const rep = entities.get(repId);
    if (!rep) continue;
    // {ADVANCED_BREP_,SHAPE_,MANIFOLD_SURFACE_}*REPRESENTATION(name, items, context)
    const itemsArg = rep.args[1];
    if (!itemsArg || itemsArg.kind !== 'list') continue;
    for (const item of itemsArg.items) {
      if (item.kind !== 'ref') continue;
      const target = entities.get(item.id);
      if (!target) continue;
      if (
        target.name === 'MANIFOLD_SOLID_BREP' ||
        target.name === 'BREP_WITH_VOIDS'
      ) {
        out.solidIds.push(item.id);
      }
    }
  }
  return out;
}

// ─── NAUO transform lookup ────────────────────────────────────────────────

/**
 * For a given NAUO entity id, find its associated ITEM_DEFINED_TRANSFORMATION
 * via the CONTEXT_DEPENDENT_SHAPE_REPRESENTATION → REPRESENTATION_RELATIONSHIP
 * chain. Returns null when none is wired (our own writer's output) — the
 * caller falls back to identity.
 *
 * STEP chain:
 *   NAUO  ← PRODUCT_DEFINITION_SHAPE (definition = NAUO)
 *         ← CONTEXT_DEPENDENT_SHAPE_REPRESENTATION (rep + relating PDS)
 *         → REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION
 *         → ITEM_DEFINED_TRANSFORMATION(name, desc, axis1, axis2)
 */
function findTransformForNauo(
  nauoId: number,
  entities: Map<number, StepEntity>,
): Matrix4 | null {
  // Find PDS whose 'definition' (args[2]) points at this NAUO.
  const pdsIds: number[] = [];
  for (const [id, ent] of entities) {
    if (ent.name !== 'PRODUCT_DEFINITION_SHAPE') continue;
    const defArg = ent.args[2];
    if (defArg && defArg.kind === 'ref' && defArg.id === nauoId) {
      pdsIds.push(id);
    }
  }
  // Find CDSR referencing one of those PDS entries.
  const cdsrIds: number[] = [];
  for (const [id, ent] of entities) {
    if (ent.name !== 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') continue;
    // CDSR(rep_relationship, represented_product_relation)
    const pdsArg = ent.args[1];
    if (pdsArg && pdsArg.kind === 'ref' && pdsIds.includes(pdsArg.id)) {
      cdsrIds.push(id);
    }
  }
  // CDSR.args[0] = REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION ref.
  for (const cdsrId of cdsrIds) {
    const cdsr = entities.get(cdsrId);
    if (!cdsr) continue;
    const relArg = cdsr.args[0];
    if (!relArg || relArg.kind !== 'ref') continue;
    const rel = entities.get(relArg.id);
    if (!rel) continue;
    // The transformation can live in:
    //   - rel.args directly (RRWT as a plain entity)
    //   - rel.subEntities[i].args (composite entity:
    //       `( REPRESENTATION_RELATIONSHIP(...) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#idt) ... )`)
    //   - a typed wrapper (REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(...) inline)
    const allArgGroups: ReadonlyArray<StepArg>[] = [rel.args];
    if (rel.subEntities) {
      for (const se of rel.subEntities) allArgGroups.push(se.args);
    }
    for (const group of allArgGroups) {
      for (const a of group) {
        if (a.kind === 'ref') {
          const target = entities.get(a.id);
          if (target && target.name === 'ITEM_DEFINED_TRANSFORMATION') {
            return matrixFromItemDefinedTransformation(target, entities);
          }
        } else if (a.kind === 'typed') {
          for (const inner of a.args) {
            if (inner.kind !== 'ref') continue;
            const target = entities.get(inner.id);
            if (target && target.name === 'ITEM_DEFINED_TRANSFORMATION') {
              return matrixFromItemDefinedTransformation(target, entities);
            }
          }
        }
      }
    }
  }
  return null;
}

/** ITEM_DEFINED_TRANSFORMATION(name, desc, axis_src, axis_tgt) → 4×4. */
function matrixFromItemDefinedTransformation(
  idt: StepEntity,
  entities: Map<number, StepEntity>,
): Matrix4 | null {
  const srcArg = idt.args[2];
  const tgtArg = idt.args[3];
  if (!srcArg || srcArg.kind !== 'ref') return null;
  if (!tgtArg || tgtArg.kind !== 'ref') return null;
  const src = readPlacementMatrix(srcArg.id, entities);
  const tgt = readPlacementMatrix(tgtArg.id, entities);
  if (!src || !tgt) return null;
  return multiply(src, invertOrthonormal(tgt));
}

/**
 * AXIS2_PLACEMENT_3D → 4×4 matrix that maps the local frame into the
 * parent frame. Local +Z = axis arg, local +X = refdir arg, local +Y =
 * Z × X (right-handed cross product).
 *
 * Missing refdir defaults to "any orthogonal vector to Z"; we pick the
 * world +X unless Z is parallel to ±X, in which case we use world +Y.
 */
function readPlacementMatrix(
  id: number,
  entities: Map<number, StepEntity>,
): Matrix4 | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'AXIS2_PLACEMENT_3D') return null;
  const originRef = ent.args[1];
  const zRef = ent.args[2];
  const xRef = ent.args[3];
  if (!originRef || originRef.kind !== 'ref') return null;
  const origin = readCartesianPoint(originRef.id, entities);
  if (!origin) return null;
  let zAxis: [number, number, number] = [0, 0, 1];
  if (zRef && zRef.kind === 'ref') {
    const z = readDirection(zRef.id, entities);
    if (z) zAxis = z;
  }
  let xAxis: [number, number, number];
  if (xRef && xRef.kind === 'ref') {
    const x = readDirection(xRef.id, entities);
    if (x) {
      xAxis = orthogonalize(x, zAxis);
    } else {
      xAxis = defaultXAxisFor(zAxis);
    }
  } else {
    xAxis = defaultXAxisFor(zAxis);
  }
  // Renormalize.
  const z = normalize(zAxis);
  const x = normalize(xAxis);
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const yN = normalize(y);
  return [
    x[0], yN[0], z[0], origin[0],
    x[1], yN[1], z[1], origin[1],
    x[2], yN[2], z[2], origin[2],
    0,    0,     0,    1,
  ];
}

function readCartesianPoint(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const cp = entities.get(id);
  if (!cp || cp.name !== 'CARTESIAN_POINT') return null;
  const coords = cp.args[1];
  if (!coords || coords.kind !== 'list') return null;
  const xs: number[] = [];
  for (const it of coords.items) {
    if (it.kind !== 'number') return null;
    xs.push(it.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

function readDirection(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'DIRECTION') return null;
  const listArg = ent.args[1];
  if (!listArg || listArg.kind !== 'list') return null;
  const xs: number[] = [];
  for (const it of listArg.items) {
    if (it.kind !== 'number') return null;
    xs.push(it.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

// ─── matrix utilities ─────────────────────────────────────────────────────

function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[i * 4 + k]! * b[k * 4 + j]!;
      }
      r[i * 4 + j] = sum;
    }
  }
  return r as unknown as Matrix4;
}

/**
 * Inverse of an orthonormal (rotation + translation) 4×4.
 *   - rotation R: inverse is R-transpose.
 *   - translation t: inverse translation = -Rᵀ · t.
 *
 * Cheaper and numerically stabler than a general inversion. We never
 * import non-orthonormal transforms in Phase 1 (scaling / skew is out of
 * spec for STEP placements), so this is sufficient.
 */
function invertOrthonormal(m: Matrix4): Matrix4 {
  const r00 = m[0]!, r01 = m[1]!, r02 = m[2]!,  tx = m[3]!;
  const r10 = m[4]!, r11 = m[5]!, r12 = m[6]!,  ty = m[7]!;
  const r20 = m[8]!, r21 = m[9]!, r22 = m[10]!, tz = m[11]!;
  // Rᵀ
  const i00 = r00, i01 = r10, i02 = r20;
  const i10 = r01, i11 = r11, i12 = r21;
  const i20 = r02, i21 = r12, i22 = r22;
  // -Rᵀ·t
  const itx = -(i00 * tx + i01 * ty + i02 * tz);
  const ity = -(i10 * tx + i11 * ty + i12 * tz);
  const itz = -(i20 * tx + i21 * ty + i22 * tz);
  return [
    i00, i01, i02, itx,
    i10, i11, i12, ity,
    i20, i21, i22, itz,
    0,   0,   0,   1,
  ];
}

/**
 * Decompose a 4×4 (rotation + translation) into { position, orientation }.
 * Quaternion conversion uses the Shepperd algorithm: pick the largest of
 * `trace`, `m00`, `m11`, `m22` as the pivot to avoid divide-by-near-zero.
 */
function decomposeMatrix(m: Matrix4): { position: { x: number; y: number; z: number }; orientation: Quat } {
  const m00 = m[0]!, m01 = m[1]!, m02 = m[2]!,  tx = m[3]!;
  const m10 = m[4]!, m11 = m[5]!, m12 = m[6]!,  ty = m[7]!;
  const m20 = m[8]!, m21 = m[9]!, m22 = m[10]!, tz = m[11]!;

  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  // Renormalize (defensive — feed-back from numerical drift in long chains).
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  return {
    position: { x: tx, y: ty, z: tz },
    orientation: { x: qx / ql, y: qy / ql, z: qz / ql, w: qw / ql },
  };
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Project x onto the plane perpendicular to z, then renormalize.
 *  Required because some writers emit a refdir not exactly perpendicular
 *  to the Z axis (small numerical noise). */
function orthogonalize(
  x: [number, number, number],
  z: [number, number, number],
): [number, number, number] {
  const zn = normalize(z);
  const d = x[0] * zn[0] + x[1] * zn[1] + x[2] * zn[2];
  const ox = x[0] - d * zn[0];
  const oy = x[1] - d * zn[1];
  const oz = x[2] - d * zn[2];
  const len = Math.hypot(ox, oy, oz);
  if (len < 1e-9) return defaultXAxisFor(zn);
  return [ox / len, oy / len, oz / len];
}

function defaultXAxisFor(z: [number, number, number]): [number, number, number] {
  // Pick the world basis vector least aligned with z to avoid singularity.
  const az = [Math.abs(z[0]), Math.abs(z[1]), Math.abs(z[2])];
  const seed: [number, number, number] =
    az[0]! <= az[1]! && az[0]! <= az[2]! ? [1, 0, 0]
    : az[1]! <= az[2]! ? [0, 1, 0]
    : [0, 0, 1];
  return orthogonalize(seed, z);
}

// ─── helpers ─────────────────────────────────────────────────────────────

function sanitizeId(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'part';
}

function uniqueId(used: ReadonlySet<string>, base: string, fallbackIdx: number): string {
  if (!used.has(base)) return base;
  let i = 1;
  while (used.has(`${base}_${i}`)) i++;
  // fallbackIdx is referenced so callers that pre-compute it for logs
  // can rely on monotonic ordering even when names collide.
  return `${base}_${i || fallbackIdx}`;
}

function nauoDesignator(ent: StepEntity): string | null {
  // NAUO(id, ref, name, ...) — args[0] often carries the instance id
  // (matches part.id from writeAssemblyAsStep). Prefer args[2] (the
  // human description) when non-empty, fall back to args[0].
  const candidates: StepArg[] = [];
  if (ent.args[2]) candidates.push(ent.args[2]);
  if (ent.args[0]) candidates.push(ent.args[0]);
  for (const c of candidates) {
    if (c.kind === 'string' && c.value.trim() !== '') return c.value;
  }
  return null;
}

// ─── fallback: file with no PRODUCT_DEFINITION ────────────────────────────

/**
 * When the file is "headless" (no PRODUCT_DEFINITION wiring), re-run the
 * single-solid importer over the whole source and pack each MANIFOLD_SOLID_BREP
 * into a PartInstance at world origin. Covers the case where a CAD tool
 * exported only raw geometry (no product structure).
 */
function fallbackSinglePartImport(
  source: string,
  opts: ImportStepAssemblyOptions,
  warnings: string[],
  unsupported: string[],
): StepAssemblyImportResult {
  const result = importStep(source, { namePrefix: opts.namePrefix ?? 'imported' });
  for (const w of result.warnings) warnings.push(w);
  for (const u of result.unsupported) unsupported.push(u);
  if (result.tree.nodes.length === 0) {
    return {
      state: { parts: [], mates: [] },
      featureTrees: {},
      warnings,
      unsupported,
    };
  }
  const partId = 'imported';
  return {
    state: {
      parts: [{
        id: partId,
        name: 'Imported Part',
        partTemplateId: 'pd_anon',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        fixed: true,
      }],
      mates: [],
    },
    featureTrees: { [partId]: result.tree },
    warnings,
    unsupported,
  };
}

// ─── geometry subset extractor ────────────────────────────────────────────

/**
 * Build a sub-STEP source containing the entities reachable from the given
 * MANIFOLD_SOLID_BREP ids. We re-emit a fresh HEADER + DATA section so the
 * inner `importStep` can run unmodified.
 *
 * Implementation: BFS over the entity graph collecting every referenced id,
 * then serialise each entity's original body text (preserved by re-parsing
 * the heal pass result).
 *
 * This is a cheap shortcut to avoid copy-pasting `solidToFeature` here —
 * it costs an extra parse round but keeps the per-part FeatureTree code
 * in exactly one place. For Phase 1 sizes (a handful of parts at most)
 * the overhead is negligible.
 *
 * Returns null when the source can't be subset-extracted (very rare —
 * only when the original was hand-mangled).
 */
function buildSubsetForSolids(source: string, solidIds: number[]): string | null {
  if (solidIds.length === 0) return null;
  const heal = healStepSource(source);
  const healed = heal.healed;
  const dataIdx = healed.search(/\bDATA\s*;/i);
  if (dataIdx < 0) return null;
  const endIdx = healed.indexOf('END-ISO-10303-21');
  const dataBlock = healed.slice(dataIdx, endIdx >= 0 ? endIdx : undefined);
  // Re-parse, but ALSO capture each entity's raw body text so we can
  // copy it verbatim into the subset DATA section.
  const bodyMap = extractEntityBodies(dataBlock);
  const entities = parseEntities(dataBlock);

  // BFS from each solid id, collecting reachable entity ids.
  const keep = new Set<number>();
  const queue: number[] = [...solidIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (keep.has(id)) continue;
    keep.add(id);
    const ent = entities.get(id);
    if (!ent) continue;
    collectRefs(ent.args, keep, queue);
    if (ent.subEntities) {
      for (const se of ent.subEntities) collectRefs(se.args, keep, queue);
    }
  }
  const ids = Array.from(keep).sort((a, b) => a - b);
  const lines: string[] = [];
  for (const id of ids) {
    const body = bodyMap.get(id);
    if (!body) continue;
    lines.push(`#${id}=${body};`);
  }
  // Minimal viable STEP header — importStep will hit healStepSource which
  // tolerates a stub HEADER block.
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('subset'),'2;1');",
    "FILE_NAME('subset','',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

function collectRefs(args: ReadonlyArray<StepArg>, keep: Set<number>, queue: number[]): void {
  for (const a of args) {
    if (a.kind === 'ref') {
      if (!keep.has(a.id)) queue.push(a.id);
    } else if (a.kind === 'list') {
      collectRefs(a.items, keep, queue);
    } else if (a.kind === 'typed') {
      collectRefs(a.args, keep, queue);
    }
  }
}

/**
 * Lightweight body extractor: re-scan the DATA block and capture, for each
 * `#N=BODY;`, the raw BODY text (so we can re-emit verbatim). Mirrors the
 * scanner in `parseEntities` but yields the raw substring instead of a
 * parsed AST.
 */
function extractEntityBodies(dataBlock: string): Map<number, string> {
  const out = new Map<number, string>();
  const n = dataBlock.length;
  let i = 0;
  while (i < n) {
    while (i < n) {
      const ch = dataBlock[i]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '/' && dataBlock[i + 1] === '*') {
        const close = dataBlock.indexOf('*/', i + 2);
        if (close < 0) { i = n; break; }
        i = close + 2; continue;
      }
      break;
    }
    if (i >= n) break;
    if (dataBlock[i] !== '#') { i++; continue; }
    const idStart = i + 1;
    let idEnd = idStart;
    while (idEnd < n && dataBlock[idEnd]! >= '0' && dataBlock[idEnd]! <= '9') idEnd++;
    if (idEnd === idStart) { i++; continue; }
    const id = Number.parseInt(dataBlock.slice(idStart, idEnd), 10);
    let j = idEnd;
    while (j < n && (dataBlock[j] === ' ' || dataBlock[j] === '\t')) j++;
    if (dataBlock[j] !== '=') { i = j; continue; }
    j++;
    while (j < n && (dataBlock[j] === ' ' || dataBlock[j] === '\t' || dataBlock[j] === '\n' || dataBlock[j] === '\r')) j++;
    const bodyStart = j;
    let depth = 0, inString = false, semiPos = -1;
    while (j < n) {
      const ch = dataBlock[j]!;
      if (ch === "'") {
        if (inString && dataBlock[j + 1] === "'") { j += 2; continue; }
        inString = !inString; j++; continue;
      }
      if (inString) { j++; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ';' && depth === 0) { semiPos = j; break; }
      j++;
    }
    if (semiPos < 0) break;
    out.set(id, dataBlock.slice(bodyStart, semiPos).trim());
    i = semiPos + 1;
  }
  return out;
}
