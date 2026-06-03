/**
 * scadIntentFromTree — Phase 3.AI explainer for a FeatureTree.
 *
 * Walks a FeatureTree and produces a human-readable "design intent" surface:
 *   1. `scadComments`    — multi-line `// ===` SCAD comment blocks that can
 *                          be spliced ahead of replayTree() output to make
 *                          the resulting SCAD source self-documenting.
 *   2. `designIntent`    — one-paragraph plain-English (or Korean) summary
 *                          of the whole part ("a box with rounded edges and
 *                          2 holes").
 *   3. `features[]`      — per-node plain-language descriptions + the raw
 *                          parameters the description was derived from, so
 *                          UI panels can render either form without re-walking
 *                          the IR.
 *   4. `warnings[]`      — soft warnings about empty trees, undersized
 *                          parameters, or unresolvable patterns (mirrors the
 *                          planner's warning surface).
 *
 * This is a pure read-only walker (no I/O, no LLM). The LLM-driven sibling
 * `featureTreeAssistantLlm` operates in the opposite direction (NL → ops).
 * This module is the "explain what already exists" surface that the AI panel
 * uses to narrate the current tree back to the user.
 *
 * Scope (Phase 3.AI.explainer.1):
 *   - All 9 FeatureKind values (extrude, revolve, sweep, loft, linear_pattern,
 *     circular_pattern, hole, fillet, chamfer).
 *   - 2 languages: English ('en' — default) and Korean ('ko').
 *   - Uses featureTreeStats for aggregate volume / mass / bbox.
 *   - Suppressed nodes are still narrated but tagged "(suppressed)".
 *
 * Out of scope (later phases):
 *   - Additional languages (zh / ja / es) — placeholder hook only.
 *   - SVG / 3D thumbnail generation alongside the text description.
 *   - Diff explanation ("what changed since last save") — separate module.
 *   - Voice / TTS narration of designIntent.
 *
 * Determinism: identical input → identical output. Used by the UI tooltip /
 * sidebar narration + by the "Explain this part" AI button which streams the
 * resulting paragraph back to the chat panel.
 */

import type {
  FeatureTree,
  FeatureNode,
  FeaturePayload,
  FeatureKind,
} from '@/lib/cad/featureTree';
import { computeStats } from '@/lib/cad/featureTreeStats';

// ─── public API ──────────────────────────────────────────────────────────

export type ExplainerLang = 'en' | 'ko';

export interface ExplainedFeature {
  /** Stable id echoed from FeatureNode.id. */
  readonly nodeId: string;
  /** Kind echoed from FeatureNode.payload.kind. */
  readonly kind: FeatureKind;
  /** Single-sentence plain-language description in the requested language. */
  readonly intentDescription: string;
  /** Snapshot of the parameters that the description was derived from.
   *  Shape matches the per-kind helpers below — see each `describe*` fn. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ScadExplanation {
  /** Multi-line `// === Step N: ... ===` SCAD comment block ready to splice
   *  in front of replayTree() output. Newline-terminated when non-empty. */
  readonly scadComments: string;
  /** One-paragraph human-readable design intent summary. */
  readonly designIntent: string;
  /** Per-non-suppressed-node descriptions in walk order. */
  readonly features: ReadonlyArray<ExplainedFeature>;
  /** Soft warnings (empty tree, unresolved pattern child, etc.). */
  readonly warnings: ReadonlyArray<string>;
}

export interface ExplainOptions {
  /** Description language. Default 'en'. */
  readonly lang?: ExplainerLang;
}

/**
 * Walk `tree` and produce a structured explanation. Pure: no validation, no
 * mutation, no I/O. Suppressed nodes are skipped (matches featureTreeStats
 * + replayTree semantics).
 */
export function explainFeatureTree(
  tree: FeatureTree,
  opts: ExplainOptions = {},
): ScadExplanation {
  const lang: ExplainerLang = opts.lang ?? 'en';
  const warnings: string[] = [];

  if (tree.nodes.length === 0) {
    return {
      scadComments: '',
      designIntent: tr(lang, 'empty_tree'),
      features: [],
      warnings: [tr(lang, 'warn_empty_tree')],
    };
  }

  const features: ExplainedFeature[] = [];
  const commentBlocks: string[] = [];
  let stepIdx = 0;

  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    stepIdx += 1;
    const desc = describeNode(node, lang, warnings);
    features.push({
      nodeId: node.id,
      kind: node.payload.kind,
      intentDescription: desc.text,
      parameters: desc.params,
    });
    commentBlocks.push(formatCommentBlock(stepIdx, node, desc.text, lang));
  }

  // Aggregate stats — give the UI a volume / mass figure even when the
  // intent paragraph is mostly about shape composition. Density is not
  // supplied (mass omitted) — bomExport owns the density catalogue.
  let aggregateLine = '';
  try {
    const stats = computeStats(tree);
    aggregateLine = formatAggregate(stats, lang);
  } catch {
    // computeStats is defensive but treat any failure as "stats unavailable"
    // rather than aborting the whole explanation.
    warnings.push(tr(lang, 'warn_stats_failed'));
  }

  const designIntent = composeDesignIntent(features, aggregateLine, lang);

  return {
    scadComments: commentBlocks.join('\n\n'),
    designIntent,
    features,
    warnings,
  };
}

// ─── per-kind description ────────────────────────────────────────────────

interface NodeDescription {
  readonly text: string;
  readonly params: Readonly<Record<string, unknown>>;
}

function describeNode(
  node: FeatureNode,
  lang: ExplainerLang,
  warnings: string[],
): NodeDescription {
  const p: FeaturePayload = node.payload;
  switch (p.kind) {
    case 'extrude':
      return describeExtrude(p, lang);
    case 'revolve':
      return describeRevolve(p, lang);
    case 'sweep':
      return describeSweep(p, lang);
    case 'loft':
      return describeLoft(p, lang);
    case 'linear_pattern':
      return describeLinearPattern(p, lang);
    case 'circular_pattern':
      return describeCircularPattern(p, lang);
    case 'hole':
      return describeHole(p, lang, warnings);
    case 'fillet':
      return describeFillet(p, lang);
    case 'chamfer':
      return describeChamfer(p, lang);
    case 'rib':
      return describeRib(p, lang);
    case 'sweep_path':
      return describeSweepPath(p, lang);
    case 'boolean':
      return describeBoolean(p, lang);
  }
}

function describeBoolean(
  p: Extract<FeaturePayload, { kind: 'boolean' }>,
  lang: ExplainerLang,
): NodeDescription {
  const opKo = p.op === 'union' ? '합집합' : p.op === 'difference' ? '차집합' : '교집합';
  const text =
    lang === 'ko'
      ? `불리언 ${opKo}: ${p.bodies.length}개 바디 결합`
      : `Boolean ${p.op}: combine ${p.bodies.length} bodies`;
  return { text, params: { op: p.op, bodyCount: p.bodies.length } };
}

function describeRib(
  p: Extract<FeaturePayload, { kind: 'rib' }>,
  lang: ExplainerLang,
): NodeDescription {
  const len = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  const text =
    lang === 'ko'
      ? `리브(보강대): 길이 ${fmt(len)}mm · 두께 ${fmt(p.thickness)}mm · 높이 ${fmt(p.height)}mm`
      : `Rib (stiffener): ${fmt(len)}mm long, ${fmt(p.thickness)}mm thick, ${fmt(p.height)}mm tall`;
  return { text, params: { length: len, thickness: p.thickness, height: p.height } };
}

function describeSweepPath(
  p: Extract<FeaturePayload, { kind: 'sweep_path' }>,
  lang: ExplainerLang,
): NodeDescription {
  const text =
    lang === 'ko'
      ? `경로 스윕: ${p.profile.length}점 프로파일을 ${p.path.length}점 경로를 따라 스윕`
      : `Path sweep: a ${p.profile.length}-pt profile swept along a ${p.path.length}-pt path`;
  return { text, params: { profilePoints: p.profile.length, pathPoints: p.path.length } };
}

function describeExtrude(
  p: Extract<FeaturePayload, { kind: 'extrude' }>,
  lang: ExplainerLang,
): NodeDescription {
  const bb = loopBbox2D(p.loop);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const vertexCount = p.loop.length;
  const isRect = vertexCount === 4 && isAxisAlignedRect(p.loop);
  const profileShape = isRect
    ? tr(lang, 'shape_rectangle', { w: fmt(w), h: fmt(h) })
    : tr(lang, 'shape_polygon', { n: String(vertexCount) });
  const dirLabel = tr(lang, `dir_${p.direction}`);
  const modeLabel = p.mode === 'cut' ? tr(lang, 'mode_cut') : tr(lang, 'mode_add');
  const text = tr(lang, 'desc_extrude', {
    shape: profileShape,
    depth: fmt(p.depth),
    dir: dirLabel,
    mode: modeLabel,
  });
  return {
    text,
    params: {
      profileWidth: w,
      profileHeight: h,
      vertexCount,
      depth: p.depth,
      direction: p.direction,
      mode: p.mode,
      draftDegrees: p.draftDegrees ?? 0,
    },
  };
}

function describeRevolve(
  p: Extract<FeaturePayload, { kind: 'revolve' }>,
  lang: ExplainerLang,
): NodeDescription {
  const bb = loopBbox2D(p.loop);
  const maxRadius = Math.max(Math.abs(bb.maxX), Math.abs(bb.minX));
  const height = bb.maxY - bb.minY;
  const modeLabel = p.mode === 'cut' ? tr(lang, 'mode_cut') : tr(lang, 'mode_add');
  const text = tr(lang, 'desc_revolve', {
    angle: fmt(p.angleDegrees),
    radius: fmt(maxRadius),
    height: fmt(height),
    mode: modeLabel,
  });
  return {
    text,
    params: {
      angleDegrees: p.angleDegrees,
      maxRadius,
      profileHeight: height,
      vertexCount: p.loop.length,
      mode: p.mode,
    },
  };
}

function describeSweep(
  p: Extract<FeaturePayload, { kind: 'sweep' }>,
  lang: ExplainerLang,
): NodeDescription {
  let pathLen = 0;
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1]!;
    const b = p.path[i]!;
    pathLen += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const profileVerts = p.profile.points.length;
  const modeLabel = p.mode === 'cut' ? tr(lang, 'mode_cut') : tr(lang, 'mode_add');
  const text = tr(lang, 'desc_sweep', {
    n: String(profileVerts),
    segments: String(p.path.length - 1),
    length: fmt(pathLen),
    mode: modeLabel,
  });
  return {
    text,
    params: {
      profileVertexCount: profileVerts,
      pathPointCount: p.path.length,
      pathLength: pathLen,
      mode: p.mode,
    },
  };
}

function describeLoft(
  p: Extract<FeaturePayload, { kind: 'loft' }>,
  lang: ExplainerLang,
): NodeDescription {
  const n = p.sections.length;
  const zMin = p.sections[0]!.z;
  const zMax = p.sections[n - 1]!.z;
  const span = zMax - zMin;
  const profileVerts = p.sections[0]!.profile.points.length;
  const modeLabel = p.mode === 'cut' ? tr(lang, 'mode_cut') : tr(lang, 'mode_add');
  const text = tr(lang, 'desc_loft', {
    n: String(n),
    span: fmt(span),
    verts: String(profileVerts),
    mode: modeLabel,
  });
  return {
    text,
    params: {
      sectionCount: n,
      zMin,
      zMax,
      zSpan: span,
      profileVertexCount: profileVerts,
      mode: p.mode,
    },
  };
}

function describeLinearPattern(
  p: Extract<FeaturePayload, { kind: 'linear_pattern' }>,
  lang: ExplainerLang,
): NodeDescription {
  const axis = dominantAxisLabel(p.direction);
  const text = tr(lang, 'desc_linear_pattern', {
    count: String(p.count),
    spacing: fmt(p.spacing),
    axis,
  });
  return {
    text,
    params: {
      count: p.count,
      spacing: p.spacing,
      direction: { x: p.direction.x, y: p.direction.y, z: p.direction.z },
      dominantAxis: axis,
    },
  };
}

function describeCircularPattern(
  p: Extract<FeaturePayload, { kind: 'circular_pattern' }>,
  lang: ExplainerLang,
): NodeDescription {
  const axis = dominantAxisLabel(p.axisDirection);
  const text = tr(lang, 'desc_circular_pattern', {
    count: String(p.count),
    angle: fmt(p.totalAngleDegrees),
    axis,
  });
  return {
    text,
    params: {
      count: p.count,
      totalAngleDegrees: p.totalAngleDegrees,
      axisDirection: {
        x: p.axisDirection.x,
        y: p.axisDirection.y,
        z: p.axisDirection.z,
      },
      axisOrigin: { x: p.axisOrigin.x, y: p.axisOrigin.y, z: p.axisOrigin.z },
      dominantAxis: axis,
    },
  };
}

function describeHole(
  p: Extract<FeaturePayload, { kind: 'hole' }>,
  lang: ExplainerLang,
  warnings: string[],
): NodeDescription {
  if (p.diameter <= 0) {
    warnings.push(tr(lang, 'warn_zero_diameter'));
  }
  const text = tr(lang, `desc_hole_${p.holeType}`, {
    diameter: fmt(p.diameter),
    depth: fmt(p.depth),
    x: fmt(p.center.x),
    y: fmt(p.center.y),
  });
  return {
    text,
    params: {
      holeType: p.holeType,
      diameter: p.diameter,
      depth: p.depth,
      center: { x: p.center.x, y: p.center.y },
      counterboreDiameter: p.counterboreDiameter,
      counterboreDepth: p.counterboreDepth,
      countersinkAngleDegrees: p.countersinkAngleDegrees,
      countersinkDepth: p.countersinkDepth,
    },
  };
}

function describeFillet(
  p: Extract<FeaturePayload, { kind: 'fillet' }>,
  lang: ExplainerLang,
): NodeDescription {
  const variableRadii = p.vertexRadii && p.vertexRadii.length > 0;
  const edgeLabel = tr(lang, `edge_${p.edgeSelection}`);
  const text = variableRadii
    ? tr(lang, 'desc_fillet_variable', {
        count: String(p.vertexRadii!.length),
        edges: edgeLabel,
      })
    : tr(lang, 'desc_fillet', {
        radius: fmt(p.radius),
        edges: edgeLabel,
      });
  return {
    text,
    params: {
      radius: p.radius,
      edgeSelection: p.edgeSelection,
      vertexRadii: p.vertexRadii ? [...p.vertexRadii] : undefined,
      variableRadii: Boolean(variableRadii),
    },
  };
}

function describeChamfer(
  p: Extract<FeaturePayload, { kind: 'chamfer' }>,
  lang: ExplainerLang,
): NodeDescription {
  const variableDistances = p.vertexDistances && p.vertexDistances.length > 0;
  const edgeLabel = tr(lang, `edge_${p.edgeSelection}`);
  const text = variableDistances
    ? tr(lang, 'desc_chamfer_variable', {
        count: String(p.vertexDistances!.length),
        edges: edgeLabel,
      })
    : tr(lang, 'desc_chamfer', {
        distance: fmt(p.distance),
        edges: edgeLabel,
      });
  return {
    text,
    params: {
      distance: p.distance,
      edgeSelection: p.edgeSelection,
      vertexDistances: p.vertexDistances ? [...p.vertexDistances] : undefined,
      variableDistances: Boolean(variableDistances),
    },
  };
}

// ─── designIntent composition ────────────────────────────────────────────

/**
 * Synthesize the one-paragraph design intent summary.
 *
 * Algorithm:
 *   1. If there's only one feature → that feature's description is the
 *      intent.
 *   2. If 2+ features → "<first feature> with <list of modifiers/operations>".
 *      Solid-body features (extrude / revolve / sweep / loft) anchor the
 *      summary, modifier features (fillet / chamfer / hole / pattern) are
 *      grouped + counted.
 *   3. Aggregate volume / bbox is appended on its own clause when available.
 */
function composeDesignIntent(
  features: ReadonlyArray<ExplainedFeature>,
  aggregateLine: string,
  lang: ExplainerLang,
): string {
  if (features.length === 0) {
    return tr(lang, 'empty_tree');
  }
  if (features.length === 1) {
    const sole = features[0]!.intentDescription;
    return aggregateLine ? `${sole} ${aggregateLine}` : sole;
  }

  // Find the first solid-body anchor; fall back to the first feature.
  const SOLID_KINDS: ReadonlySet<FeatureKind> = new Set([
    'extrude',
    'revolve',
    'sweep',
    'loft',
  ]);
  const anchor = features.find((f) => SOLID_KINDS.has(f.kind)) ?? features[0]!;

  // Group every non-anchor feature by kind for the modifier clause.
  const modifierCounts = new Map<FeatureKind, number>();
  for (const f of features) {
    if (f === anchor) continue;
    modifierCounts.set(f.kind, (modifierCounts.get(f.kind) ?? 0) + 1);
  }

  const modifierClauses: string[] = [];
  for (const [kind, count] of modifierCounts) {
    modifierClauses.push(tr(lang, `mod_${kind}`, { count: String(count) }));
  }
  const modifiers = listJoin(modifierClauses, lang);

  const summary = modifiers
    ? tr(lang, 'intent_with_modifiers', {
        anchor: anchor.intentDescription,
        modifiers,
      })
    : anchor.intentDescription;

  return aggregateLine ? `${summary} ${aggregateLine}` : summary;
}

/** Format the aggregate volume / bbox suffix shown after the design intent. */
function formatAggregate(
  stats: ReturnType<typeof computeStats>,
  lang: ExplainerLang,
): string {
  if (stats.nodeCount === 0) return '';
  const vol = stats.volume;
  if (!Number.isFinite(vol)) return '';
  return tr(lang, 'aggregate_line', {
    volume: fmt(vol),
    nodes: String(stats.nodeCount),
  });
}

// ─── SCAD comment block formatting ───────────────────────────────────────

function formatCommentBlock(
  stepIdx: number,
  node: FeatureNode,
  description: string,
  lang: ExplainerLang,
): string {
  // Format: `// === Step <n>: <kind> (<id>) ===`
  //         `// Intent: <description>`
  //         `// Depends on: <id1>, <id2>` (only if non-empty)
  const header = `// === ${tr(lang, 'step_prefix', { n: String(stepIdx) })}: ${node.payload.kind} (${node.id}) ===`;
  const intent = `// ${tr(lang, 'comment_intent')}: ${description}`;
  const lines = [header, intent];
  if (node.dependencies.length > 0) {
    lines.push(
      `// ${tr(lang, 'comment_depends_on')}: ${node.dependencies.join(', ')}`,
    );
  }
  return lines.join('\n');
}

// ─── helpers ─────────────────────────────────────────────────────────────

/** 2D bbox of a polygon loop. */
function loopBbox2D(
  loop: ReadonlyArray<{ x: number; y: number }>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (loop.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX, maxX, minY, maxY };
}

/** True when a 4-vertex loop is an axis-aligned rectangle. */
function isAxisAlignedRect(loop: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (loop.length !== 4) return false;
  const xs = new Set(loop.map((p) => p.x));
  const ys = new Set(loop.map((p) => p.y));
  return xs.size === 2 && ys.size === 2;
}

/** Return a short axis label for a near-axis-aligned direction. */
function dominantAxisLabel(dir: { x: number; y: number; z: number }): string {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ax >= ay && ax >= az) return dir.x >= 0 ? '+X' : '-X';
  if (ay >= ax && ay >= az) return dir.y >= 0 ? '+Y' : '-Y';
  return dir.z >= 0 ? '+Z' : '-Z';
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.abs(n) < 1e-10 ? '0' : Number(n.toFixed(3)).toString();
}

/** Join a list of clauses with a language-appropriate separator. */
function listJoin(items: ReadonlyArray<string>, lang: ExplainerLang): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (lang === 'ko') {
    // 한국어: 쉼표 + 마지막 항목 사이 '및'
    return `${items.slice(0, -1).join(', ')} 및 ${items[items.length - 1]!}`;
  }
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ─── i18n dictionary ─────────────────────────────────────────────────────

type DictKey =
  | 'empty_tree'
  | 'warn_empty_tree'
  | 'warn_zero_diameter'
  | 'warn_stats_failed'
  | 'shape_rectangle'
  | 'shape_polygon'
  | 'dir_one_sided'
  | 'dir_two_sided'
  | 'dir_midplane'
  | 'mode_add'
  | 'mode_cut'
  | 'edge_all'
  | 'edge_top'
  | 'edge_bottom'
  | 'edge_vertical'
  | 'desc_extrude'
  | 'desc_revolve'
  | 'desc_sweep'
  | 'desc_loft'
  | 'desc_linear_pattern'
  | 'desc_circular_pattern'
  | 'desc_hole_drilled'
  | 'desc_hole_counterbore'
  | 'desc_hole_countersink'
  | 'desc_fillet'
  | 'desc_fillet_variable'
  | 'desc_chamfer'
  | 'desc_chamfer_variable'
  | 'mod_fillet'
  | 'mod_chamfer'
  | 'mod_hole'
  | 'mod_linear_pattern'
  | 'mod_circular_pattern'
  | 'mod_extrude'
  | 'mod_revolve'
  | 'mod_sweep'
  | 'mod_loft'
  | 'intent_with_modifiers'
  | 'aggregate_line'
  | 'step_prefix'
  | 'comment_intent'
  | 'comment_depends_on';

type Dict = Record<DictKey, string>;

const EN: Dict = {
  empty_tree: 'Empty feature tree (no operations).',
  warn_empty_tree: 'tree has no nodes',
  warn_zero_diameter: 'hole has non-positive diameter',
  warn_stats_failed: 'aggregate stats unavailable',
  shape_rectangle: '{w}x{h}mm rectangle',
  shape_polygon: '{n}-vertex polygon',
  dir_one_sided: 'along +Z',
  dir_two_sided: 'symmetric along Z',
  dir_midplane: 'centered on the sketch plane',
  mode_add: 'add',
  mode_cut: 'cut',
  edge_all: 'all edges',
  edge_top: 'top edges',
  edge_bottom: 'bottom edges',
  edge_vertical: 'vertical edges',
  desc_extrude: 'Extrude a {shape} by {depth}mm {dir} ({mode}).',
  desc_revolve:
    'Revolve a profile (max radius {radius}mm, height {height}mm) {angle}° around the Y axis ({mode}).',
  desc_sweep:
    'Sweep a {n}-vertex profile along a {segments}-segment path of length {length}mm ({mode}).',
  desc_loft:
    'Loft between {n} sections ({verts}-vertex profile, z span {span}mm) ({mode}).',
  desc_linear_pattern:
    'Linear pattern of {count} instances, {spacing}mm spacing along {axis}.',
  desc_circular_pattern:
    'Circular pattern of {count} instances around the {axis} axis ({angle}° sweep).',
  desc_hole_drilled:
    'Drill a {diameter}mm hole, {depth}mm deep, at ({x}, {y}).',
  desc_hole_counterbore:
    'Counterbore hole (bore {diameter}mm × {depth}mm) at ({x}, {y}).',
  desc_hole_countersink:
    'Countersink hole (bore {diameter}mm × {depth}mm) at ({x}, {y}).',
  desc_fillet: 'Apply a {radius}mm fillet to {edges}.',
  desc_fillet_variable: 'Apply a variable-radius fillet ({count} vertices) to {edges}.',
  desc_chamfer: 'Apply a {distance}mm chamfer to {edges}.',
  desc_chamfer_variable:
    'Apply a variable-distance chamfer ({count} vertices) to {edges}.',
  mod_fillet: '{count} fillet(s)',
  mod_chamfer: '{count} chamfer(s)',
  mod_hole: '{count} hole(s)',
  mod_linear_pattern: '{count} linear pattern(s)',
  mod_circular_pattern: '{count} circular pattern(s)',
  mod_extrude: '{count} additional extrude(s)',
  mod_revolve: '{count} additional revolve(s)',
  mod_sweep: '{count} additional sweep(s)',
  mod_loft: '{count} additional loft(s)',
  intent_with_modifiers: '{anchor} with {modifiers}.',
  aggregate_line: 'Total volume ~{volume}mm^3 across {nodes} feature(s).',
  step_prefix: 'Step {n}',
  comment_intent: 'Intent',
  comment_depends_on: 'Depends on',
};

const KO: Dict = {
  empty_tree: '비어 있는 피처 트리입니다(작업 없음).',
  warn_empty_tree: '트리에 노드가 없습니다',
  warn_zero_diameter: '구멍 직경이 0 이하입니다',
  warn_stats_failed: '집계 통계를 가져올 수 없습니다',
  shape_rectangle: '{w}x{h}mm 사각형',
  shape_polygon: '{n}각형',
  dir_one_sided: '+Z 방향',
  dir_two_sided: 'Z축 양방향 대칭',
  dir_midplane: '스케치 평면 중심',
  mode_add: '추가',
  mode_cut: '제거',
  edge_all: '전체 에지',
  edge_top: '윗면 에지',
  edge_bottom: '아랫면 에지',
  edge_vertical: '수직 에지',
  desc_extrude: '{shape}을(를) {depth}mm 만큼 {dir}으로 돌출({mode}).',
  desc_revolve:
    '프로파일(최대 반지름 {radius}mm, 높이 {height}mm)을 Y축 기준 {angle}° 회전({mode}).',
  desc_sweep:
    '{n}각형 프로파일을 {segments}분할 경로(길이 {length}mm)를 따라 스윕({mode}).',
  desc_loft: '{n}개 단면({verts}각형, z 범위 {span}mm) 사이를 로프트({mode}).',
  desc_linear_pattern: '{axis} 방향으로 {count}개 선형 패턴, 간격 {spacing}mm.',
  desc_circular_pattern: '{axis}축 기준 원형 패턴 {count}개, {angle}° 회전.',
  desc_hole_drilled: '({x}, {y})에 직경 {diameter}mm, 깊이 {depth}mm 구멍.',
  desc_hole_counterbore:
    '({x}, {y})에 카운터보어 구멍(보어 {diameter}mm × {depth}mm).',
  desc_hole_countersink:
    '({x}, {y})에 카운터싱크 구멍(보어 {diameter}mm × {depth}mm).',
  desc_fillet: '{edges}에 반경 {radius}mm 필렛 적용.',
  desc_fillet_variable: '{edges}에 가변 반경 필렛({count}개 꼭짓점) 적용.',
  desc_chamfer: '{edges}에 거리 {distance}mm 챔퍼 적용.',
  desc_chamfer_variable: '{edges}에 가변 거리 챔퍼({count}개 꼭짓점) 적용.',
  mod_fillet: '필렛 {count}개',
  mod_chamfer: '챔퍼 {count}개',
  mod_hole: '구멍 {count}개',
  mod_linear_pattern: '선형 패턴 {count}개',
  mod_circular_pattern: '원형 패턴 {count}개',
  mod_extrude: '추가 돌출 {count}개',
  mod_revolve: '추가 회전 {count}개',
  mod_sweep: '추가 스윕 {count}개',
  mod_loft: '추가 로프트 {count}개',
  intent_with_modifiers: '{anchor} (포함: {modifiers}).',
  aggregate_line: '총 부피 약 {volume}mm^3 / 피처 {nodes}개.',
  step_prefix: '단계 {n}',
  comment_intent: '의도',
  comment_depends_on: '의존',
};

const DICTS: Record<ExplainerLang, Dict> = { en: EN, ko: KO };

/**
 * Lookup + interpolate a localized template. Missing keys fall back to the
 * key name (defensive — keeps the UI from crashing on a typoed call).
 */
function tr(
  lang: ExplainerLang,
  key: DictKey | string,
  vars?: Readonly<Record<string, string>>,
): string {
  const dict = DICTS[lang] ?? EN;
  const tpl = (dict as Record<string, string>)[key] ?? (EN as Record<string, string>)[key] ?? key;
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : `{${name}}`,
  );
}
