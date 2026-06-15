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

/** Find the entity id of the part's primary PRODUCT_DEFINITION_SHAPE
 *  (or its precursor PRODUCT_DEFINITION when PDS isn't emitted by the
 *  writer). Returns null if neither is present. */
function findPartDefinitionId(stepText: string): number | null {
  const pds = stepText.match(/^#(\d+)\s*=\s*PRODUCT_DEFINITION_SHAPE/m);
  if (pds) return Number(pds[1]);
  const pd = stepText.match(/^#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\(/m);
  if (pd) return Number(pd[1]);
  return null;
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
    if (localPartDefId == null) {
      diagnostics.push({ partId: part.id, warning: 'no PRODUCT_DEFINITION found in part STEP' });
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
      transform: part.transform ?? new THREE.Matrix4().identity(),
    });
    runningOffset += partMax + 100;
  }

  if (prepared.length === 0) {
    throw new Error('stitchAssemblyHierarchy: no parts had a parseable PRODUCT_DEFINITION');
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
    lines.push(`#${idtId}=ITEM_DEFINED_TRANSFORMATION('${occurrenceTag}_xfm','',#${srcFrameId},#${dstFrameId});`);
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
  transform: THREE.Matrix4;
}

interface NodePlan {
  /** Sub-assembly's own renumbered PRODUCT_DEFINITION id (assigned in wrapper range). */
  defId: number;
  label: string;
  transform: THREE.Matrix4;
  /** Refs to children's defIds (interior + leaf). */
  childDefIds: number[];
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
    depth: { max: number };
  },
  currentDepth: number,
): { defId: number } | null {
  ctx.depth.max = Math.max(ctx.depth.max, currentDepth);

  if (isPartNode(node)) {
    const localPartDefId = findPartDefinitionId(node.stepText);
    if (localPartDefId == null) {
      ctx.diagnostics.push({ partId: node.partId, warning: 'no PRODUCT_DEFINITION found in part STEP' });
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
      transform: node.transform ?? new THREE.Matrix4().identity(),
    });

    return { defId: localPartDefId + offset };
  }

  // Sub-assembly node — recurse into children, then allocate wrapper defId.
  const childDefIds: number[] = [];
  const childTransforms: THREE.Matrix4[] = [];
  const childOccNames: string[] = [];
  let i = 0;
  for (const child of node.children) {
    const result = planNode(child, ctx, currentDepth + 1);
    if (result) {
      childDefIds.push(result.defId);
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
  ctx.nodes.push({
    defId: myDefId,
    label: (node.label ?? node.subAsmId).replace(/'/g, ''),
    transform: node.transform ?? new THREE.Matrix4().identity(),
    childDefIds,
    childTransforms,
    childOccNames,
  });

  return { defId: myDefId };
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

  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('NexyFab Assembly v2.1 (nested) - ${safeName}'),'2;1');`);
  lines.push(`FILE_NAME('${safeName}.step','${timestamp}',('NexyFab'),('nexyfab.com'),'NexyFab Assembly v2.1 1.0','','');`);
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  // Shared application context entities
  const appCtxId = id++;
  lines.push(`#${appCtxId}=APPLICATION_CONTEXT('mechanical design');`);
  const appProtoId = id++;
  lines.push(`#${appProtoId}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2003,#${appCtxId});`);
  const prodCtxId = id++;
  lines.push(`#${prodCtxId}=PRODUCT_CONTEXT('',#${appCtxId},'mechanical');`);
  const prodDefCtxId = id++;
  lines.push(`#${prodDefCtxId}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design');`);

  // One PRODUCT + FORMATION + DEFINITION per sub-asm node (ctx.nodes ordered
  // bottom-up by the recursive walk → emit in reverse so the root appears
  // last and is easy to spot in the file).
  for (const sub of ctx.nodes) {
    const prodId = id++;
    lines.push(`#${prodId}=PRODUCT('${sub.label}','${sub.label}','',(#${prodCtxId}));`);
    const formId = id++;
    lines.push(`#${formId}=PRODUCT_DEFINITION_FORMATION('','',#${prodId});`);
    // The sub-asm's defId was allocated by planNode in the wrapper range;
    // we emit the entity here using that id (we trust no collision because
    // the wrapper range [100..999] is reserved and id counter starts at 1).
    lines.push(`#${sub.defId}=PRODUCT_DEFINITION('design','',#${formId},#${prodDefCtxId});`);
  }

  // Per sub-asm, emit NAUO + ITEM_DEFINED_TRANSFORMATION for each child.
  for (const sub of ctx.nodes) {
    for (let cIdx = 0; cIdx < sub.childDefIds.length; cIdx++) {
      const childDef = sub.childDefIds[cIdx];
      const childXfm = sub.childTransforms[cIdx];
      const occName = sub.childOccNames[cIdx];

      const nauoId = id++;
      lines.push(
        `#${nauoId}=NEXT_ASSEMBLY_USAGE_OCCURRENCE(` +
        `'${occName}','${occName}','',` +
        `#${sub.defId},#${childDef},$);`,
      );

      const { origin, zAxis, xAxis } = decomposeForAxisPlacement(childXfm);
      const srcPtId = id++; lines.push(`#${srcPtId}=CARTESIAN_POINT('',(0.0,0.0,0.0));`);
      const srcZId = id++; lines.push(`#${srcZId}=DIRECTION('',(0.0,0.0,1.0));`);
      const srcXId = id++; lines.push(`#${srcXId}=DIRECTION('',(1.0,0.0,0.0));`);
      const srcFrame = id++; lines.push(`#${srcFrame}=AXIS2_PLACEMENT_3D('',#${srcPtId},#${srcZId},#${srcXId});`);
      const dstPtId = id++; lines.push(`#${dstPtId}=CARTESIAN_POINT('',(${fmt(origin[0])},${fmt(origin[1])},${fmt(origin[2])}));`);
      const dstZId = id++; lines.push(`#${dstZId}=DIRECTION('',(${fmt(zAxis[0])},${fmt(zAxis[1])},${fmt(zAxis[2])}));`);
      const dstXId = id++; lines.push(`#${dstXId}=DIRECTION('',(${fmt(xAxis[0])},${fmt(xAxis[1])},${fmt(xAxis[2])}));`);
      const dstFrame = id++; lines.push(`#${dstFrame}=AXIS2_PLACEMENT_3D('',#${dstPtId},#${dstZId},#${dstXId});`);
      const idtId = id++; lines.push(`#${idtId}=ITEM_DEFINED_TRANSFORMATION('${occName}_xfm','',#${srcFrame},#${dstFrame});`);
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
