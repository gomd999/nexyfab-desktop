/**
 * dimensionExtractor — deterministic regex parser that pulls the hard NUMBERS
 * out of a natural-language part description and uses them to CONSTRAIN (not
 * replace) the LLM's intent.
 *
 * Why this exists:
 *   The NL→JSON→OpenSCAD pipeline is reliable at PICKING a shape (glossary) and
 *   at STRUCTURE, but the LLM is noisy on the exact numbers of secondary
 *   features — especially hole diameter, hole count, and bolt-circle diameter.
 *   Those show up in the "medium" fixtures (cube+hole, plate+4holes, flange,
 *   hex bolt) as `dimension-off` failures even though the prompt states the
 *   numbers explicitly ("a 10mm hole", "4 corner holes 8mm", "8 bolt holes on
 *   80mm circle").
 *
 *   A regex extracts those explicit numbers RELIABLY. We then reconcile the
 *   LLM's intent against them: on an EXPLICIT, unambiguous number the
 *   deterministic value wins; when the prompt is silent or ambiguous we leave
 *   the LLM's choice untouched. So this only ever fixes numbers a human would
 *   also read straight off the sentence — it never invents dimensions.
 *
 * Pure + side-effect-free: no I/O, no LLM. Unit-tested against the fixture
 * prompts and edge cases (no numbers → empty, ambiguous → conservative).
 */

import type { IntentInput, IntentFeature } from '../openscad-render/intentToScad';

/** A hole (or hole group) parsed from the prompt. `dia` is optional because a
 *  prompt may state a COUNT with no diameter ("8 bolt holes on 80mm circle"). */
export interface ExtractedHole {
  /** Explicit hole diameter in mm, when stated. */
  dia?: number;
  /** Explicit hole count, when stated ("4 corner holes" → 4). */
  count?: number;
  /** Arrangement, when the wording implies one. */
  pattern?: 'corner' | 'circular' | 'linear';
}

export interface ExtractedDimensions {
  /** Ordered bounding-box dimensions in mm ("20 by 30 by 10" → [20,30,10],
   *  "50mm cube" → [50,50,50]). */
  dims?: number[];
  /** True when `dims` came from a "cube/정육면체" style equal-sided phrase. */
  isCube?: boolean;
  /** Outer diameter in mm ("OD100", "100mm OD"). */
  od?: number;
  /** Inner / bore diameter in mm ("bore60", "60mm bore"). */
  bore?: number;
  /** Bolt-circle / pitch-circle diameter in mm ("on 80mm circle", "PCD 80"). */
  boltCircle?: number;
  /** Metric fastener nominal, e.g. "M8" → 8. */
  metric?: number;
  /** Overall length in mm ("30mm long", "length 30"). */
  length?: number;
  /** Holes parsed from the prompt (usually one group). */
  holes?: ExtractedHole[];
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

function toNum(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** First capture group of the first match, as a number (or undefined). */
function firstNum(text: string, re: RegExp): number | undefined {
  const m = re.exec(text);
  return m ? toNum(m[1]) : undefined;
}

// ── bounding-box dimensions ─────────────────────────────────────────────────

/** "AxBxC", "A x B x C", "A by B by C", "A × B × C" (2 or 3 numbers). */
const BBOX_3 = new RegExp(`${NUM}\\s*(?:x|×|by)\\s*${NUM}\\s*(?:x|×|by)\\s*${NUM}`, 'i');
const BBOX_2 = new RegExp(`${NUM}\\s*(?:x|×|by)\\s*${NUM}`, 'i');
/** "50mm cube", "cube 50mm", "50 mm 정육면체", plain "cube of 50". */
const CUBE = new RegExp(`(?:${NUM}\\s*mm?\\s*(?:cube|정육면체|立方体)|(?:cube|정육면체|立方体)\\s*(?:of\\s*)?${NUM}\\s*mm)`, 'i');

function extractBbox(text: string): { dims?: number[]; isCube?: boolean } {
  const cube = CUBE.exec(text);
  if (cube) {
    const v = toNum(cube[1] ?? cube[2]);
    if (v !== undefined) return { dims: [v, v, v], isCube: true };
  }
  const m3 = BBOX_3.exec(text);
  if (m3) {
    const a = toNum(m3[1]), b = toNum(m3[2]), c = toNum(m3[3]);
    if (a !== undefined && b !== undefined && c !== undefined) return { dims: [a, b, c] };
  }
  const m2 = BBOX_2.exec(text);
  if (m2) {
    const a = toNum(m2[1]), b = toNum(m2[2]);
    if (a !== undefined && b !== undefined) return { dims: [a, b] };
  }
  return {};
}

// ── round-part diameters ────────────────────────────────────────────────────

const OD = new RegExp(`(?:\\bOD\\s*${NUM}|${NUM}\\s*mm?\\s*OD\\b|outer\\s*(?:dia(?:meter)?)?\\s*${NUM})`, 'i');
const BORE = new RegExp(`(?:\\bbore\\s*${NUM}|${NUM}\\s*mm?\\s*bore\\b|inner\\s*(?:dia(?:meter)?)?\\s*${NUM})`, 'i');
/** "on 80mm circle", "80mm bolt circle", "PCD 80", "BCD 80", "pitch circle 80". */
const PCD = new RegExp(
  `(?:\\b(?:PCD|BCD)\\s*(?:of\\s*)?${NUM}|(?:bolt|pitch)\\s*circle\\s*(?:dia(?:meter)?)?\\s*(?:of\\s*)?${NUM}|(?:on|of)\\s*(?:a\\s*)?${NUM}\\s*mm?\\s*(?:bolt\\s*)?circle|${NUM}\\s*mm?\\s*(?:bolt|pitch)\\s*circle)`,
  'i',
);
const METRIC = new RegExp(`\\bM${NUM}\\b`);
const LENGTH = new RegExp(`(?:${NUM}\\s*mm?\\s*long\\b|length\\s*(?:of\\s*)?${NUM}\\s*mm?|\\blong\\s*${NUM}\\s*mm?)`, 'i');

function firstDefined(m: RegExpExecArray | null): number | undefined {
  if (!m) return undefined;
  for (let i = 1; i < m.length; i++) {
    const v = toNum(m[i]);
    if (v !== undefined) return v;
  }
  return undefined;
}

// ── holes ───────────────────────────────────────────────────────────────────

/** Hole diameter phrasings (each ties a number to a hole):
 *   "10mm hole", "8mm holes", "8mm dia holes", "10 mm through hole",
 *   "holes 8mm", "hole of 10mm", "holes Ø8", "Ø8 hole", "dia 6 holes". */
const HOLE_DIA_BEFORE = new RegExp(
  `${NUM}\\s*mm?\\s*(?:dia(?:meter)?\\.?\\s*)?(?:wide\\s*)?(?:through\\s*)?holes?\\b`,
  'i',
);
const HOLE_DIA_AFTER = new RegExp(
  `holes?\\s+(?:are\\s+)?(?:of\\s+)?(?:Ø|⌀|φ|dia(?:meter)?\\.?\\s*)?${NUM}\\s*mm?\\b`,
  'i',
);
/** "Ø8", "⌀8", "φ8" — only trusted as a hole diameter when a hole word exists. */
const DIA_SYMBOL = new RegExp(`(?:Ø|⌀|φ)\\s*${NUM}`, 'i');

const HAS_HOLE_WORD = /\b(hole|holes|bore|drill)\b|구멍|穴|孔/i;

/** Count + pattern: "4 corner holes", "8 bolt holes", "6 mounting holes",
 *  "4 holes evenly spaced", "5 holes in a row". */
const HOLE_COUNT = new RegExp(
  `${NUM}\\s*(?:x\\s*)?(corner|mounting|bolt|through|counterbored?|clearance)?\\s*holes?`,
  'i',
);

function detectPattern(text: string, countKeyword?: string): ExtractedHole['pattern'] {
  const t = text.toLowerCase();
  if (countKeyword === 'corner' || /\bcorner|corners\b/.test(t)) return 'corner';
  if (
    countKeyword === 'bolt' ||
    /\b(bolt|pitch)\s*circle\b|\bpcd\b|\bbcd\b|\bradial|circular\s*(?:pattern|array)|on\s+a?\s*\d/.test(t)
  ) {
    // "on <n>mm circle" or explicit bolt/pitch circle → circular arrangement.
    if (/circle\b|\bpcd\b|\bbcd\b|radial|circular/.test(t)) return 'circular';
  }
  if (/\b(in\s*a\s*row|row of|evenly\s*spaced|linear\s*(?:pattern|array)|in\s*a\s*line)\b/.test(t)) return 'linear';
  return undefined;
}

function extractHoles(text: string): ExtractedHole[] | undefined {
  if (!HAS_HOLE_WORD.test(text)) return undefined;

  let dia: number | undefined;
  const before = HOLE_DIA_BEFORE.exec(text);
  if (before) dia = toNum(before[1]);
  if (dia === undefined) {
    const after = HOLE_DIA_AFTER.exec(text);
    if (after) dia = toNum(after[1]);
  }
  if (dia === undefined) {
    const sym = DIA_SYMBOL.exec(text);
    if (sym) dia = toNum(sym[1]);
  }

  let count: number | undefined;
  let countKeyword: string | undefined;
  const cm = HOLE_COUNT.exec(text);
  if (cm) {
    count = toNum(cm[1]);
    countKeyword = cm[2]?.toLowerCase();
    // A number in front of "hole" is only a TALLY when it's a plural "holes" or
    // a count keyword ("4 corner holes", "3 holes"). A singular "hole" with a
    // leading number is a DIAMETER ("10mm hole", "Ø6 hole"), never a count — so
    // reject those to avoid reading the diameter as the count. Also reject a
    // number immediately followed by "mm" (a dimension) in any case.
    const raw = cm[0].toLowerCase();
    const plural = /holes\b/.test(raw);
    if (/^\s*\d+(?:\.\d+)?\s*mm/.test(raw)) count = undefined;
    else if (!plural && !countKeyword) count = undefined;
  }

  const pattern = detectPattern(text, countKeyword);

  if (dia === undefined && count === undefined && pattern === undefined) return undefined;
  const hole: ExtractedHole = {};
  if (dia !== undefined) hole.dia = dia;
  if (count !== undefined) hole.count = count;
  if (pattern !== undefined) hole.pattern = pattern;
  return [hole];
}

/**
 * Parse the explicit numbers out of a natural-language part description.
 * Returns only what is UNAMBIGUOUSLY present — absent fields stay undefined so
 * the reconciler can tell "the prompt said X" from "the prompt was silent".
 */
export function extractDimensions(prompt: string): ExtractedDimensions {
  const text = (prompt ?? '').normalize('NFC');
  if (!text.trim()) return {};

  const out: ExtractedDimensions = {};

  const { dims, isCube } = extractBbox(text);
  if (dims) {
    out.dims = dims;
    if (isCube) out.isCube = true;
  }

  const od = firstDefined(OD.exec(text));
  if (od !== undefined) out.od = od;
  const bore = firstDefined(BORE.exec(text));
  if (bore !== undefined) out.bore = bore;
  const pcd = firstDefined(PCD.exec(text));
  if (pcd !== undefined) out.boltCircle = pcd;
  const metric = firstNum(text, METRIC);
  if (metric !== undefined) out.metric = metric;
  const length = firstDefined(LENGTH.exec(text));
  if (length !== undefined) out.length = length;

  const holes = extractHoles(text);
  if (holes) out.holes = holes;

  return out;
}

// ── reconciliation ──────────────────────────────────────────────────────────

/** A single deterministic override that was applied to the LLM intent. */
export interface ReconcileOverride {
  field: string;
  from: number | undefined;
  to: number;
  reason: string;
}

export interface ReconcileResult {
  intent: IntentInput;
  overrides: ReconcileOverride[];
}

function cloneIntent(intent: IntentInput): IntentInput {
  return {
    ...intent,
    params: { ...(intent.params ?? {}) },
    features: (intent.features ?? []).map(f => ({ ...f, params: { ...(f.params ?? {}) } })),
  };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Build N symmetric corner holes in the plane of a plate's two large axes,
 *  bored through the thin axis so they pierce the flat face. */
function buildCornerHoles(
  w: number,
  h: number,
  d: number,
  count: number,
  dia: number,
): IntentFeature[] {
  // Axis indices: 0=width(X), 1=height(Y), 2=depth(Z). The thinnest is the
  // bore axis; the other two carry the ± corner offsets.
  const axes = [w, h, d];
  let thin = 0;
  for (let i = 1; i < 3; i++) if (axes[i]! < axes[thin]!) thin = i;
  const plane = [0, 1, 2].filter(i => i !== thin);
  const [p, q] = plane as [number, number];
  const dimP = axes[p]!, dimQ = axes[q]!;
  // Edge inset: comfortably clear of the edge but always inside the plate.
  const insetP = Math.min(dimP / 2 - dia, Math.max(dia * 1.5, dimP * 0.12));
  const insetQ = Math.min(dimQ / 2 - dia, Math.max(dia * 1.5, dimQ * 0.12));
  const offP = Math.max(0, dimP / 2 - insetP);
  const offQ = Math.max(0, dimQ / 2 - insetQ);
  const signs = [
    [1, 1], [-1, 1], [-1, -1], [1, -1],
  ];
  const n = Math.max(1, Math.min(12, Math.round(count)));
  const coordKey = ['x', 'y', 'z'] as const;
  const features: IntentFeature[] = [];
  for (let i = 0; i < n; i++) {
    const [sp, sq] = signs[i % 4]!;
    const params: Record<string, number> = { diameter: dia, x: 0, y: 0, z: 0, axis: thin };
    params[coordKey[p]] = sp! * offP;
    params[coordKey[q]] = sq! * offQ;
    features.push({ type: 'hole', params });
  }
  return features;
}

/**
 * Reconcile an LLM-proposed intent against deterministically-extracted numbers.
 * Deterministic values win ONLY where the prompt was explicit; everything else
 * is left as the LLM produced it. Pure — returns a new intent + an audit list
 * of the overrides applied.
 *
 * Scope (high-confidence only):
 *   • hole diameter — override every hole feature to the stated Ø.
 *   • corner holes  — for a box, rebuild N symmetric corner holes at the stated
 *     count/diameter when the prompt says "N corner holes".
 *   • missing central hole — add one when the prompt clearly states a hole and
 *     the LLM produced none.
 *   • flange — outerDiameter / bore / PCD / boltCount / boltDiameter from
 *     OD/bore/circle/count numbers.
 *   • fastener — bolt shaftDiameter/shaftLength from "M8"/"30mm long".
 */
export function reconcileIntent(intent: IntentInput, ex: ExtractedDimensions): ReconcileResult {
  const overrides: ReconcileOverride[] = [];
  if (!intent || typeof intent !== 'object' || !intent.shapeId) {
    return { intent, overrides };
  }
  const next = cloneIntent(intent);
  const p = next.params;
  const shape = next.shapeId;

  // ── flange: holes live in the shape params, not in features ───────────────
  if (shape === 'flange') {
    if (ex.od !== undefined && num(p.outerDiameter) !== ex.od) {
      overrides.push({ field: 'outerDiameter', from: num(p.outerDiameter), to: ex.od, reason: 'prompt OD' });
      p.outerDiameter = ex.od;
    }
    if (ex.bore !== undefined) {
      const cur = num(p.innerDiameter) ?? num(p.boreDiameter);
      if (cur !== ex.bore) {
        overrides.push({ field: 'innerDiameter', from: cur, to: ex.bore, reason: 'prompt bore' });
        p.innerDiameter = ex.bore;
      }
    }
    if (ex.boltCircle !== undefined) {
      const cur = num(p.pcd) ?? num(p.boltCircleDiameter);
      if (cur !== ex.boltCircle) {
        overrides.push({ field: 'pcd', from: cur, to: ex.boltCircle, reason: 'prompt bolt circle' });
        p.pcd = ex.boltCircle;
      }
    }
    const hole = ex.holes?.[0];
    if (hole?.count !== undefined && num(p.boltCount) !== hole.count) {
      overrides.push({ field: 'boltCount', from: num(p.boltCount), to: hole.count, reason: 'prompt hole count' });
      p.boltCount = hole.count;
    }
    if (hole?.dia !== undefined) {
      const cur = num(p.boltDiameter) ?? num(p.boltHoleDiameter);
      if (cur !== hole.dia) {
        overrides.push({ field: 'boltDiameter', from: cur, to: hole.dia, reason: 'prompt hole Ø' });
        p.boltDiameter = hole.dia;
      }
    }
    return { intent: next, overrides };
  }

  // ── fastener: map "M8" + "30mm long" onto the bolt's shaft params ─────────
  if (shape === 'bolt') {
    if (ex.metric !== undefined) {
      const cur = num(p.shaftDiameter) ?? num(p.diameter);
      if (cur !== ex.metric) {
        overrides.push({ field: 'shaftDiameter', from: cur, to: ex.metric, reason: 'prompt metric size' });
        p.shaftDiameter = ex.metric;
      }
    }
    if (ex.length !== undefined) {
      const cur = num(p.shaftLength) ?? num(p.length);
      if (cur !== ex.length) {
        overrides.push({ field: 'shaftLength', from: cur, to: ex.length, reason: 'prompt length' });
        p.shaftLength = ex.length;
      }
    }
    return { intent: next, overrides };
  }

  // ── feature-hole shapes (box / cylinder / disk / …) ───────────────────────
  const hole = ex.holes?.[0];
  if (!hole) return { intent: next, overrides };

  const holeFeatures = (next.features ?? []).filter(f => f.type === 'hole' && f.enabled !== false);

  // Corner-hole rebuild — highest-value fix: the LLM routinely mis-places these.
  if (shape === 'box' && hole.pattern === 'corner' && hole.count !== undefined && hole.count >= 2) {
    const w = num(p.width) ?? ex.dims?.[0] ?? 50;
    const hgt = num(p.height) ?? ex.dims?.[1] ?? 50;
    const d = num(p.depth) ?? ex.dims?.[2] ?? 50;
    const dia = hole.dia ?? num(holeFeatures[0]?.params?.diameter) ?? 5;
    const built = buildCornerHoles(w, hgt, d, hole.count, dia);
    // Replace any existing hole features with the deterministic corner set.
    const others = (next.features ?? []).filter(f => !(f.type === 'hole' && f.enabled !== false));
    next.features = [...others, ...built];
    overrides.push({ field: 'holes.corner', from: holeFeatures.length, to: built.length, reason: `prompt ${hole.count} corner holes` });
    if (hole.dia !== undefined) {
      overrides.push({ field: 'hole.diameter', from: undefined, to: hole.dia, reason: 'prompt hole Ø' });
    }
    return { intent: next, overrides };
  }

  // Single / central hole: override diameter (or add one if the LLM missed it).
  if (hole.dia !== undefined) {
    if (holeFeatures.length > 0) {
      for (const f of holeFeatures) {
        const cur = num(f.params?.diameter) ?? num(f.params?.holeDiameter);
        if (cur !== hole.dia) {
          f.params = { ...(f.params ?? {}), diameter: hole.dia };
          overrides.push({ field: 'hole.diameter', from: cur, to: hole.dia, reason: 'prompt hole Ø' });
        }
      }
    } else {
      // LLM omitted the hole the prompt clearly asked for — add a centred one.
      next.features = [...(next.features ?? []), { type: 'hole', params: { diameter: hole.dia } }];
      overrides.push({ field: 'hole.add', from: undefined, to: hole.dia, reason: 'prompt states a hole; LLM omitted it' });
    }
  }

  return { intent: next, overrides };
}
