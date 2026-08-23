/**
 * assemblyStepHierarchy.ts — Phase D Assembly STEP v2.
 *
 * v2 vs v1 (assemblyStepExport.ts):
 *   v1: replicad.makeCompound([s1,s2,...]) → single PRODUCT 'Compound'
 *       with all bodies fused at geometry level. Simple, works for
 *       fabrication CAMs that consume multi-body STEP. But every body
 *       loses its identity — re-importing into SolidWorks / Onshape
 *       shows one part, not an assembly tree.
 *
 *   v2: per-part OCCT export → stitch into proper assembly hierarchy:
 *         - 1 root PRODUCT 'Assembly'
 *         - 1 PRODUCT per leaf part
 *         - NEXT_ASSEMBLY_USAGE_OCCURRENCE linking root → each part
 *         - ITEM_DEFINED_TRANSFORMATION per occurrence for the
 *           per-instance transform
 *       Importers (SolidWorks / Onshape / Fusion) reconstruct the
 *       assembly tree + per-part position from the NAUO entities.
 *
 * Approach — entity-renumbering stitcher:
 *   1. Per part: get individual STEP text (single-part v1 fast path,
 *      transforms NOT applied — transforms go into the wrapper instead).
 *   2. Find each part's PRODUCT_DEFINITION_SHAPE entity (the seam point
 *      where assembly hierarchy attaches to per-part geometry).
 *   3. Renumber the part's entity ids by a per-part offset so they don't
 *      collide in the merged DATA section.
 *   4. Emit a small wrapper with: root PRODUCT, NAUO per part,
 *      ITEM_DEFINED_TRANSFORMATION per occurrence.
 *
 * v2 NOT in scope (Phase D++ if customer asks):
 *   - Sub-assembly nesting (root → sub-asm → leaf part). v2 ships flat
 *     root → leaves only; sub-assembly is a recursive structure on top.
 *   - Configurations / suppressed states.
 *   - Per-occurrence color / material override (each part keeps its
 *     own appearance from its exported STEP).
 *   - AP242 named-feature transfer across the seam (per-part features
 *     stay on the part's PRODUCT, NOT promoted to the assembly).
 */

import * as THREE from 'three';
import type { AssemblyStepPart } from './assemblyStepExport';

export interface AssemblyStepHierarchyResult {
  /** Assembled STEP text (ISO-10303-21) with proper NAUO hierarchy. */
  readonly stepText: string;
  /** Number of leaf parts in the assembly. */
  readonly partCount: number;
  /** Per-part diagnostics — empty when everything succeeded. */
  readonly diagnostics: ReadonlyArray<{ partId: string; warning: string }>;
}

/** Maximum entity id present in a part's STEP text (decimal). 0 if empty. */
function maxEntityId(stepText: string): number {
  let max = 0;
  const rx = /^#(\d+)\s*=/gm;
  for (const m of stepText.matchAll(rx)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

/** Find the entity id of the part's PRODUCT_DEFINITION.
 *
 * NEXT_ASSEMBLY_USAGE_OCCURRENCE formally references PRODUCT_DEFINITION on
 * both sides. Older code preferred PRODUCT_DEFINITION_SHAPE when it existed,
 * leaving an apparently populated tree whose child reference had the wrong
 * entity type. Keep the PDS fallback only for legacy/non-conforming sources;
 * all NexyFab and OCCT exports take the standards-compliant PD path. */
function findPartDefinitionId(stepText: string): number | null {
  const pd = stepText.match(/^#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\(/m);
  if (pd) return Number(pd[1]);
  return null;
}

/** Find the shape representation bound to the part definition through
 * PRODUCT_DEFINITION_SHAPE -> SHAPE_DEFINITION_REPRESENTATION. */
function findPartRepresentationId(stepText: string, partDefinitionId: number): number | null {
  const pdsPattern = new RegExp(
    `^#(\\d+)\\s*=\\s*PRODUCT_DEFINITION_SHAPE\\s*\\([^;]*#${partDefinitionId}\\s*\\)`,
    'm',
  );
  const pds = stepText.match(pdsPattern);
  if (!pds) return null;
  const sdrPattern = new RegExp(
    `^#\\d+\\s*=\\s*SHAPE_DEFINITION_REPRESENTATION\\s*\\(\\s*#${pds[1]}\\s*,\\s*#(\\d+)\\s*\\)`,
    'm',
  );
  const sdr = stepText.match(sdrPattern);
  return sdr ? Number(sdr[1]) : null;
}

/** Extract just the entity lines from a part's STEP DATA section. */
function extractDataLines(stepText: string): string[] {
  const dataStart = stepText.indexOf('DATA;');
  const dataEnd = stepText.indexOf('ENDSEC;', dataStart);
  if (dataStart < 0 || dataEnd < 0) return [];
  const block = stepText.slice(dataStart + 'DATA;'.length, dataEnd);
  return block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Shift every `#NNN` reference in a STEP entity line by `offset`. */
function shiftEntityIds(line: string, offset: number): string {
  if (offset === 0) return line;
  return line.replace(/#(\d+)/g, (_, num) => `#${Number(num) + offset}`);
}

/** Decompose Matrix4 into translation (mm) + rotation matrix columns.
 *  STEP AXIS2_PLACEMENT_3D needs origin + Z-axis + X-axis direction. */
function decomposeForAxisPlacement(m: THREE.Matrix4): {
  origin: [number, number, number];
  zAxis: [number, number, number];
  xAxis: [number, number, number];
} {
  const e = m.elements;
  // Column-major: e[0..3] = col0 (X axis), e[4..7] = col1 (Y), e[8..11] = col2 (Z), e[12..14] = translation
  return {
    origin: [e[12], e[13], e[14]],
    zAxis: [e[8], e[9], e[10]],
    xAxis: [e[0], e[1], e[2]],
  };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  return n.toFixed(6);
}

interface PreparedPart {
  partId: string;
  label: string;
  offset: number;
  dataLines: string[];
  partDefId: number; // post-offset id of part's PRODUCT_DEFINITION
  partRepId: number; // post-offset id of part's bound SHAPE_REPRESENTATION
  transform: THREE.Matrix4;
}

/**
 * Stitch per-part STEP texts into a single assembly STEP with proper
 * NEXT_ASSEMBLY_USAGE_OCCURRENCE hierarchy.
 *
 * @param parts          AssemblyStepPart metadata (label + transform)
 * @param perPartStepText Per-part STEP text, same length / order as parts.
 *                       Each text MUST be a self-contained ISO-10303-21
 *                       file from OCCT's blobSTEP (or equivalent).
 * @param assemblyName   Root PRODUCT name. Quote chars are stripped.
 *
 * Throws when parts.length !== perPartStepText.length OR when any part's
 * STEP text has no parseable PRODUCT_DEFINITION (incompatible writer).
 */
export function stitchAssemblyHierarchy(
  parts: readonly AssemblyStepPart[],
  perPartStepText: readonly string[],
  assemblyName = 'NexyFab_Assembly',
): AssemblyStepHierarchyResult {
  if (parts.length === 0) {
    throw new Error('stitchAssemblyHierarchy: parts list is empty');
  }
  if (parts.length !== perPartStepText.length) {
    throw new Error('stitchAssemblyHierarchy: parts.length !== perPartStepText.length');
  }

  const diagnostics: { partId: string; warning: string }[] = [];

  // Compute per-part offsets so renumbered ids don't collide.
  const prepared: PreparedPart[] = [];
  let runningOffset = 1000; // start above the wrapper's own entity range
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const stepText = perPartStepText[i];
    const localPartDefId = findPartDefinitionId(stepText);
    const localPartRepId = localPartDefId === null
      ? null
      : findPartRepresentationId(stepText, localPartDefId);
    if (localPartDefId == null) {
      diagnostics.push({ partId: part.id, warning: 'no PRODUCT_DEFINITION found in part STEP' });
      continue;
    }
    if (localPartRepId == null) {
      diagnostics.push({ partId: part.id, warning: 'no SHAPE_DEFINITION_REPRESENTATION found in part STEP' });
      continue;
    }
    const dataLines = extractDataLines(stepText);
    if (dataLines.length === 0) {
      diagnostics.push({ partId: part.id, warning: 'empty DATA section' });
      continue;
    }
    const partMax = maxEntityId(stepText);
    prepared.push({
      partId: part.id,
      label: (part.label ?? part.id).replace(/'/g, ''),
      offset: runningOffset,
      dataLines: dataLines.map((l) => shiftEntityIds(l, runningOffset)),
      partDefId: localPartDefId + runningOffset,
      partRepId: localPartRepId + runningOffset,
      transform: part.transform ?? new THREE.Matrix4().identity(),
    });
    runningOffset += partMax + 100;
  }

  if (prepared.length === 0) {
    throw new Error('stitchAssemblyHierarchy: no parts had a parseable product and shape representation');
  }

  const safeName = assemblyName.replace(/'/g, '');
  const timestamp = new Date().toISOString().slice(0, 19);

  // Build wrapper entities (id range: 1..999, well below the per-part
  // offset start of 1000).
  const lines: string[] = [];
  let id = 1;

  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('NexyFab Assembly v2 - ${safeName}'),'2;1');`);
  lines.push(`FILE_NAME('${safeName}.step','${timestamp}',('NexyFab'),('nexyfab.com'),'NexyFab Assembly v2 1.0','','');`);
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  // ── Root assembly entities ────────────────────────────────────────────
  const appCtxId = id++;
  lines.push(`#${appCtxId}=APPLICATION_CONTEXT('mechanical design');`);
  const appProtoId = id++;
  lines.push(`#${appProtoId}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2003,#${appCtxId});`);
  const prodCtxId = id++;
  lines.push(`#${prodCtxId}=PRODUCT_CONTEXT('',#${appCtxId},'mechanical');`);
  const prodDefCtxId = id++;
  lines.push(`#${prodDefCtxId}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design');`);

  // Root PRODUCT
  const rootProdId = id++;
  lines.push(`#${rootProdId}=PRODUCT('${safeName}','${safeName}','',(#${prodCtxId}));`);
  const rootProdFormId = id++;
  lines.push(`#${rootProdFormId}=PRODUCT_DEFINITION_FORMATION('','',#${rootProdId});`);
  const rootProdDefId = id++;
  lines.push(`#${rootProdDefId}=PRODUCT_DEFINITION('design','',#${rootProdFormId},#${prodDefCtxId});`);

  // Assembly-side representation context used by every occurrence
  // relationship. A standards-compliant placement needs more than a bare
  // ITEM_DEFINED_TRANSFORMATION: the transform must be reachable from the
  // occurrence PDS through CDSR/RRWT. Several desktop importers ignore an
  // orphan IDT even though the entity itself parses successfully.
  const asmOriginId = id++;
  lines.push(`#${asmOriginId}=CARTESIAN_POINT('',(0.0,0.0,0.0));`);
  const asmZId = id++;
  lines.push(`#${asmZId}=DIRECTION('',(0.0,0.0,1.0));`);
  const asmXId = id++;
  lines.push(`#${asmXId}=DIRECTION('',(1.0,0.0,0.0));`);
  const asmAxisId = id++;
  lines.push(`#${asmAxisId}=AXIS2_PLACEMENT_3D('',#${asmOriginId},#${asmZId},#${asmXId});`);
  const asmLengthUnitId = id++;
  lines.push(`#${asmLengthUnitId}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
  const asmAngleUnitId = id++;
  lines.push(`#${asmAngleUnitId}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));`);
  const asmSolidAngleUnitId = id++;
  lines.push(`#${asmSolidAngleUnitId}=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());`);
  const asmUncertaintyId = id++;
  lines.push(`#${asmUncertaintyId}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${asmLengthUnitId},'distance_accuracy_value','confusion accuracy');`);
  const asmContextId = id++;
  lines.push(
    `#${asmContextId}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) ` +
    `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${asmUncertaintyId})) ` +
    `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${asmLengthUnitId},#${asmAngleUnitId},#${asmSolidAngleUnitId})) ` +
    `REPRESENTATION_CONTEXT('Assembly Context','3D'));`,
  );
  const asmRepId = id++;
  lines.push(`#${asmRepId}=SHAPE_REPRESENTATION('${safeName}',(#${asmAxisId}),#${asmContextId});`);
  const rootPdsId = id++;
  lines.push(`#${rootPdsId}=PRODUCT_DEFINITION_SHAPE('','',#${rootProdDefId});`);
  const rootSdrId = id++;
  lines.push(`#${rootSdrId}=SHAPE_DEFINITION_REPRESENTATION(#${rootPdsId},#${asmRepId});`);

  // Per-part NAUO + transform
  for (let i = 0; i < prepared.length; i++) {
    const part = prepared[i];
    const occurrenceTag = `${safeName}_${i + 1}`;

    // NEXT_ASSEMBLY_USAGE_OCCURRENCE links root_def → part_def.
    const nauoId = id++;
    lines.push(
      `#${nauoId}=NEXT_ASSEMBLY_USAGE_OCCURRENCE(` +
      `'${occurrenceTag}','${part.label}','',` +
      `#${rootProdDefId},#${part.partDefId},$);`,
    );

    // Per-occurrence transform: AXIS2_PLACEMENT_3D + AXIS2_PLACEMENT_3D
    // wrapped in ITEM_DEFINED_TRANSFORMATION + CONTEXT_DEPENDENT_SHAPE_REPRESENTATION.
    const { origin, zAxis, xAxis } = decomposeForAxisPlacement(part.transform);

    // Source frame (assembly origin)
    const srcPtId = id++;
    lines.push(`#${srcPtId}=CARTESIAN_POINT('',(0.0,0.0,0.0));`);
    const srcZId = id++;
    lines.push(`#${srcZId}=DIRECTION('',(0.0,0.0,1.0));`);
    const srcXId = id++;
    lines.push(`#${srcXId}=DIRECTION('',(1.0,0.0,0.0));`);
    const srcFrameId = id++;
    lines.push(`#${srcFrameId}=AXIS2_PLACEMENT_3D('',#${srcPtId},#${srcZId},#${srcXId});`);

    // Target frame (part placement)
    const dstPtId = id++;
    lines.push(`#${dstPtId}=CARTESIAN_POINT('',(${fmt(origin[0])},${fmt(origin[1])},${fmt(origin[2])}));`);
    const dstZId = id++;
    lines.push(`#${dstZId}=DIRECTION('',(${fmt(zAxis[0])},${fmt(zAxis[1])},${fmt(zAxis[2])}));`);
    const dstXId = id++;
    lines.push(`#${dstXId}=DIRECTION('',(${fmt(xAxis[0])},${fmt(xAxis[1])},${fmt(xAxis[2])}));`);
    const dstFrameId = id++;
    lines.push(`#${dstFrameId}=AXIS2_PLACEMENT_3D('',#${dstPtId},#${dstZId},#${dstXId});`);

    // Transformation entity binding source → target.
    const idtId = id++;
    lines.push(`#${idtId}=ITEM_DEFINED_TRANSFORMATION('${occurrenceTag}_xfm','',#${dstFrameId},#${srcFrameId});`);

    // Bind the transform to this NAUO. This is the formal AP214/AP242 chain
    // consumed by `readStepNauoTransform` and native CAD importers.
    const occurrenceRelationshipId = id++;
    lines.push(
      `#${occurrenceRelationshipId}=( REPRESENTATION_RELATIONSHIP('','',#${asmRepId},#${part.partRepId}) ` +
      `REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idtId}) SHAPE_REPRESENTATION_RELATIONSHIP() );`,
    );
    const occurrencePdsId = id++;
    lines.push(`#${occurrencePdsId}=PRODUCT_DEFINITION_SHAPE('','',#${nauoId});`);
    const occurrenceCdsrId = id++;
    lines.push(`#${occurrenceCdsrId}=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${occurrenceRelationshipId},#${occurrencePdsId});`);
  }

  // ── Per-part renumbered entities ──────────────────────────────────────
  lines.push(`/* === Per-part bodies (renumbered) === */`);
  for (const part of prepared) {
    lines.push(`/* part: ${part.partId} (${part.label}) offset=${part.offset} */`);
    for (const ln of part.dataLines) {
      lines.push(ln);
    }
  }

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return {
    stepText: lines.join('\n'),
    partCount: prepared.length,
    diagnostics,
  };
}

// ─── v2.1 Nested sub-assemblies ─────────────────────────────────────────────
//
// Extends v2 from flat root→leaves to arbitrary depth: root → sub-asm →
// (sub-asm | leaf), recursively. Internally still calls the same
// renumber-stitch helpers; the new wrapper emits one PRODUCT per
// sub-assembly node + NAUO linking each parent_def → child_def.
//
// API shape: a recursive node tree. Leaves carry per-part STEP text;
// interior nodes carry a label + transform + children.

export type AssemblySubNode =
  | {
      readonly kind: 'part';
      readonly partId: string;
      readonly label?: string;
      readonly transform?: THREE.Matrix4;
      /** Self-contained ISO-10303-21 STEP for this leaf. */
      readonly stepText: string;
    }
  | {
      readonly kind: 'subAssembly';
      /** Stable id used in NAUO `name` field + diagnostics. */
      readonly subAsmId: string;
      readonly label?: string;
      readonly transform?: THREE.Matrix4;
      readonly children: readonly AssemblySubNode[];
    };

export interface NestedAssemblyResult {
  readonly stepText: string;
  /** Total leaf part count across all sub-assemblies. */
  readonly partCount: number;
  /** Total interior sub-assembly node count (excludes root). */
  readonly subAssemblyCount: number;
  /** Max depth from root to deepest leaf (root depth = 0, direct leaf = 1). */
  readonly maxDepth: number;
  readonly diagnostics: ReadonlyArray<{ partId: string; warning: string }>;
}

interface LeafPlan {
  partId: string;
  label: string;
  offset: number;
  dataLines: string[];
  /** Per-leaf renumbered PRODUCT_DEFINITION id. */
  partDefId: number;
  /** Per-leaf renumbered shape representation id. */
  partRepId: number;
  transform: THREE.Matrix4;
}

interface NodePlan {
  /** Sub-assembly's own renumbered PRODUCT_DEFINITION id (assigned in wrapper range). */
  defId: number;
  /** Sub-assembly shape representation id in the reserved wrapper range. */
  repId: number;
  label: string;
  transform: THREE.Matrix4;
  /** Refs to children's defIds (interior + leaf). */
  childDefIds: number[];
  /** Representation paired with each child definition. */
  childRepIds: number[];
  /** Per-child transform for the occurrence (matches childDefIds index). */
  childTransforms: THREE.Matrix4[];
  /** Per-child occurrence name (NAUO 'name' field). */
  childOccNames: string[];
}

function isPartNode(n: AssemblySubNode): n is Extract<AssemblySubNode, { kind: 'part' }> {
  return n.kind === 'part';
}

/** Recursive plan walk: assigns per-leaf offsets and per-sub-asm defIds.
 *  Wrapper defIds live in [10..999]; leaves get renumbered from 1000+. */
function planNode(
  node: AssemblySubNode,
  ctx: {
    diagnostics: { partId: string; warning: string }[];
    leaves: LeafPlan[];
    nodes: NodePlan[];
    nextLeafOffset: { value: number };
    nextWrapperDefId: { value: number };
    nextWrapperRepId: { value: number };
    depth: { max: number };
  },
  currentDepth: number,
): { defId: number; repId: number } | null {
  ctx.depth.max = Math.max(ctx.depth.max, currentDepth);

  if (isPartNode(node)) {
    const localPartDefId = findPartDefinitionId(node.stepText);
    const localPartRepId = localPartDefId === null
      ? null
      : findPartRepresentationId(node.stepText, localPartDefId);
    if (localPartDefId == null) {
      ctx.diagnostics.push({ partId: node.partId, warning: 'no PRODUCT_DEFINITION found in part STEP' });
      return null;
    }
    if (localPartRepId == null) {
      ctx.diagnostics.push({ partId: node.partId, warning: 'no SHAPE_DEFINITION_REPRESENTATION found in part STEP' });
      return null;
    }
    const dataLines = extractDataLines(node.stepText);
    if (dataLines.length === 0) {
      ctx.diagnostics.push({ partId: node.partId, warning: 'empty DATA section' });
      return null;
    }
    const partMax = maxEntityId(node.stepText);
    const offset = ctx.nextLeafOffset.value;
    ctx.nextLeafOffset.value = offset + partMax + 100;

    ctx.leaves.push({
      partId: node.partId,
      label: (node.label ?? node.partId).replace(/'/g, ''),
      offset,
      dataLines: dataLines.map((l) => shiftEntityIds(l, offset)),
      partDefId: localPartDefId + offset,
      partRepId: localPartRepId + offset,
      transform: node.transform ?? new THREE.Matrix4().identity(),
    });

    return { defId: localPartDefId + offset, repId: localPartRepId + offset };
  }

  // Sub-assembly node — recurse into children, then allocate wrapper defId.
  const childDefIds: number[] = [];
  const childRepIds: number[] = [];
  const childTransforms: THREE.Matrix4[] = [];
  const childOccNames: string[] = [];
  let i = 0;
  for (const child of node.children) {
    const result = planNode(child, ctx, currentDepth + 1);
    if (result) {
      childDefIds.push(result.defId);
      childRepIds.push(result.repId);
      const childTx = isPartNode(child)
        ? (child.transform ?? new THREE.Matrix4().identity())
        : (child.transform ?? new THREE.Matrix4().identity());
      childTransforms.push(childTx);
      const childTag = isPartNode(child) ? child.partId : child.subAsmId;
      childOccNames.push(`${node.subAsmId}__${childTag}_${i + 1}`);
    }
    i++;
  }

  if (childDefIds.length === 0) {
    ctx.diagnostics.push({ partId: node.subAsmId, warning: 'sub-assembly has no usable children' });
    return null;
  }

  const myDefId = ctx.nextWrapperDefId.value++;
  const myRepId = ctx.nextWrapperRepId.value++;
  ctx.nodes.push({
    defId: myDefId,
    repId: myRepId,
    label: (node.label ?? node.subAsmId).replace(/'/g, ''),
    transform: node.transform ?? new THREE.Matrix4().identity(),
    childDefIds,
    childRepIds,
    childTransforms,
    childOccNames,
  });

  return { defId: myDefId, repId: myRepId };
}

/**
 * Compose a nested assembly tree into a single STEP file.
 *
 * @param root  Tree root. Must be a sub-assembly node (a single leaf has
 *              no parent → use stitchAssemblyHierarchy instead).
 * @param asmName  File header + root PRODUCT name override.
 *                 Defaults to root.label ?? root.subAsmId.
 *
 * Throws on empty tree, no parseable leaves, or root being a leaf
 * (use the flat stitcher for single-part / flat cases).
 */
export function stitchNestedAssemblyHierarchy(
  root: AssemblySubNode,
  asmName?: string,
): NestedAssemblyResult {
  if (isPartNode(root)) {
    throw new Error('stitchNestedAssemblyHierarchy: root must be a sub-assembly node (use stitchAssemblyHierarchy for single parts)');
  }
  if (root.children.length === 0) {
    throw new Error('stitchNestedAssemblyHierarchy: root sub-assembly has no children');
  }

  const ctx = {
    diagnostics: [] as { partId: string; warning: string }[],
    leaves: [] as LeafPlan[],
    nodes: [] as NodePlan[],
    nextLeafOffset: { value: 1000 },
    nextWrapperDefId: { value: 100 }, // sub-asm PRODUCT_DEFINITION ids live in 100..999
    nextWrapperRepId: { value: 500 }, // sub-asm representations use a disjoint reserved range
    depth: { max: 0 },
  };

  const rootPlan = planNode(root, ctx, 0);
  if (!rootPlan) {
    throw new Error('stitchNestedAssemblyHierarchy: root sub-assembly could not be planned (all children failed)');
  }

  const safeName = (asmName ?? root.label ?? root.subAsmId).replace(/'/g, '');
  const timestamp = new Date().toISOString().slice(0, 19);

  // ── Wrapper emission ────────────────────────────────────────────────────
  const lines: string[] = [];
  let id = 1;
  const reservedValues = ctx.nodes.flatMap((node) => [node.defId, node.repId]);
  const reservedWrapperIds = new Set(reservedValues);
  if (reservedWrapperIds.size !== reservedValues.length
    || reservedValues.some((value) => value < 1 || value >= 1000)) {
    throw new Error('stitchNestedAssemblyHierarchy: wrapper entity capacity exceeded');
  }
  const nextId = (): number => {
    while (reservedWrapperIds.has(id)) id++;
    if (id >= 1000) {
      throw new Error('stitchNestedAssemblyHierarchy: wrapper entity capacity exceeded');
    }
    return id++;
  };

  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('NexyFab Assembly v2.1 (nested) - ${safeName}'),'2;1');`);
  lines.push(`FILE_NAME('${safeName}.step','${timestamp}',('NexyFab'),('nexyfab.com'),'NexyFab Assembly v2.1 1.0','','');`);
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  // Shared application context entities
  const appCtxId = nextId();
  lines.push(`#${appCtxId}=APPLICATION_CONTEXT('mechanical design');`);
  const appProtoId = nextId();
  lines.push(`#${appProtoId}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2003,#${appCtxId});`);
  const prodCtxId = nextId();
  lines.push(`#${prodCtxId}=PRODUCT_CONTEXT('',#${appCtxId},'mechanical');`);
  const prodDefCtxId = nextId();
  lines.push(`#${prodDefCtxId}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design');`);

  const asmOriginId = nextId();
  lines.push(`#${asmOriginId}=CARTESIAN_POINT('',(0.0,0.0,0.0));`);
  const asmZId = nextId();
  lines.push(`#${asmZId}=DIRECTION('',(0.0,0.0,1.0));`);
  const asmXId = nextId();
  lines.push(`#${asmXId}=DIRECTION('',(1.0,0.0,0.0));`);
  const asmAxisId = nextId();
  lines.push(`#${asmAxisId}=AXIS2_PLACEMENT_3D('',#${asmOriginId},#${asmZId},#${asmXId});`);
  const asmLengthUnitId = nextId();
  lines.push(`#${asmLengthUnitId}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
  const asmAngleUnitId = nextId();
  lines.push(`#${asmAngleUnitId}=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));`);
  const asmSolidAngleUnitId = nextId();
  lines.push(`#${asmSolidAngleUnitId}=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());`);
  const asmUncertaintyId = nextId();
  lines.push(`#${asmUncertaintyId}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${asmLengthUnitId},'distance_accuracy_value','confusion accuracy');`);
  const asmContextId = nextId();
  lines.push(
    `#${asmContextId}=(GEOMETRIC_REPRESENTATION_CONTEXT(3) ` +
    `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${asmUncertaintyId})) ` +
    `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${asmLengthUnitId},#${asmAngleUnitId},#${asmSolidAngleUnitId})) ` +
    `REPRESENTATION_CONTEXT('Assembly Context','3D'));`,
  );

  // One PRODUCT + FORMATION + DEFINITION per sub-asm node (ctx.nodes ordered
  // bottom-up by the recursive walk → emit in reverse so the root appears
  // last and is easy to spot in the file).
  for (const sub of ctx.nodes) {
    const prodId = nextId();
    lines.push(`#${prodId}=PRODUCT('${sub.label}','${sub.label}','',(#${prodCtxId}));`);
    const formId = nextId();
    lines.push(`#${formId}=PRODUCT_DEFINITION_FORMATION('','',#${prodId});`);
    // The sub-asm's defId was allocated by planNode in the wrapper range;
    // we emit the entity here using that id (we trust no collision because
    // the wrapper range [100..999] is reserved and id counter starts at 1).
    lines.push(`#${sub.defId}=PRODUCT_DEFINITION('design','',#${formId},#${prodDefCtxId});`);
    lines.push(`#${sub.repId}=SHAPE_REPRESENTATION('${sub.label}',(#${asmAxisId}),#${asmContextId});`);
    const subPdsId = nextId();
    lines.push(`#${subPdsId}=PRODUCT_DEFINITION_SHAPE('','',#${sub.defId});`);
    const subSdrId = nextId();
    lines.push(`#${subSdrId}=SHAPE_DEFINITION_REPRESENTATION(#${subPdsId},#${sub.repId});`);
  }

  // Per sub-asm, emit NAUO + ITEM_DEFINED_TRANSFORMATION for each child.
  for (const sub of ctx.nodes) {
    for (let cIdx = 0; cIdx < sub.childDefIds.length; cIdx++) {
      const childDef = sub.childDefIds[cIdx];
      const childRep = sub.childRepIds[cIdx];
      const childXfm = sub.childTransforms[cIdx];
      const occName = sub.childOccNames[cIdx];

      const nauoId = nextId();
      lines.push(
        `#${nauoId}=NEXT_ASSEMBLY_USAGE_OCCURRENCE(` +
        `'${occName}','${occName}','',` +
        `#${sub.defId},#${childDef},$);`,
      );

      const { origin, zAxis, xAxis } = decomposeForAxisPlacement(childXfm);
      const srcPtId = nextId(); lines.push(`#${srcPtId}=CARTESIAN_POINT('',(0.0,0.0,0.0));`);
      const srcZId = nextId(); lines.push(`#${srcZId}=DIRECTION('',(0.0,0.0,1.0));`);
      const srcXId = nextId(); lines.push(`#${srcXId}=DIRECTION('',(1.0,0.0,0.0));`);
      const srcFrame = nextId(); lines.push(`#${srcFrame}=AXIS2_PLACEMENT_3D('',#${srcPtId},#${srcZId},#${srcXId});`);
      const dstPtId = nextId(); lines.push(`#${dstPtId}=CARTESIAN_POINT('',(${fmt(origin[0])},${fmt(origin[1])},${fmt(origin[2])}));`);
      const dstZId = nextId(); lines.push(`#${dstZId}=DIRECTION('',(${fmt(zAxis[0])},${fmt(zAxis[1])},${fmt(zAxis[2])}));`);
      const dstXId = nextId(); lines.push(`#${dstXId}=DIRECTION('',(${fmt(xAxis[0])},${fmt(xAxis[1])},${fmt(xAxis[2])}));`);
      const dstFrame = nextId(); lines.push(`#${dstFrame}=AXIS2_PLACEMENT_3D('',#${dstPtId},#${dstZId},#${dstXId});`);
      const idtId = nextId();
      lines.push(`#${idtId}=ITEM_DEFINED_TRANSFORMATION('${occName}_xfm','',#${dstFrame},#${srcFrame});`);
      const relationshipId = nextId();
      lines.push(
        `#${relationshipId}=( REPRESENTATION_RELATIONSHIP('','',#${sub.repId},#${childRep}) ` +
        `REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idtId}) SHAPE_REPRESENTATION_RELATIONSHIP() );`,
      );
      const occurrencePdsId = nextId();
      lines.push(`#${occurrencePdsId}=PRODUCT_DEFINITION_SHAPE('','',#${nauoId});`);
      const occurrenceCdsrId = nextId();
      lines.push(`#${occurrenceCdsrId}=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${relationshipId},#${occurrencePdsId});`);
    }
  }

  // ── Per-leaf renumbered entities ────────────────────────────────────────
  lines.push('/* === Per-leaf bodies (renumbered) === */');
  for (const leaf of ctx.leaves) {
    lines.push(`/* leaf: ${leaf.partId} (${leaf.label}) offset=${leaf.offset} */`);
    for (const ln of leaf.dataLines) lines.push(ln);
  }

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return {
    stepText: lines.join('\n'),
    partCount: ctx.leaves.length,
    subAssemblyCount: ctx.nodes.length - 1, // exclude root from count (root is the asm itself)
    maxDepth: ctx.depth.max,
    diagnostics: ctx.diagnostics,
  };
}
