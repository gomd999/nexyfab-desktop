/**
 * visionSketchDetector — real image→sketch inference backed by a vision LLM
 * (Claude / GPT-4V), pluggable into sketchInferenceFromImage's `realDetector`
 * slot (which until now only had the 4-point fallback).
 *
 * Phase 2 of image→sketch (ADR-013). The vision API call is abstracted behind
 * an injected `VisionComplete` so this module stays pure + deterministic and
 * unit-testable: the substantive logic is `parseSketchEntities` — tolerant
 * extraction + validation of the model's JSON into a `SketchEntities` shape
 * the solver / SVG overlays consume. The actual image→vision-API binding
 * (image content blocks; the text-only ProviderAdapter can't carry images
 * yet) is the injected adapter.
 */

import type {
  SketchEntities,
  SvgPoint,
  SvgLine,
  SvgCircle,
  SvgArc,
} from '../sketch/sketchSvgExport';

/** Injected vision call: image bytes + prompt → the model's raw text reply. */
export type VisionComplete = (image: Uint8Array, prompt: string) => Promise<string>;

export const VISION_SKETCH_PROMPT = [
  'You are a CAD vision assistant. Detect the 2D sketch primitives in this image',
  '(hand sketch, whiteboard, or screenshot). Return ONLY a JSON object, no prose:',
  '{"lines":[{"x1":,"y1":,"x2":,"y2":}],"circles":[{"cx":,"cy":,"r":}],',
  '"arcs":[{"cx":,"cy":,"r":,"startDeg":,"endDeg":}],"points":[{"x":,"y":}]}',
  'Coordinates in millimetres, origin bottom-left, Y up. Omit empty arrays.',
].join(' ');

const EPS = 1e-6;
const DEDUPE_DECIMALS = 4;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Pull the first balanced JSON object out of text (strips ``` fences / prose). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a vision model's reply into a validated SketchEntities. Tolerant of
 * markdown fences / surrounding prose. Invalid primitives are skipped (not
 * fatal); a completely unparseable reply throws.
 *
 * Line endpoints are deduped into shared points so coincident corners share
 * one point id (the solver wants a point registry, not loose coordinates).
 */
export function parseSketchEntities(text: string): SketchEntities {
  const json = extractJsonObject(text);
  if (json === null) throw new Error('visionSketchDetector: no JSON object in reply');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`visionSketchDetector: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('visionSketchDetector: reply is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const points: SvgPoint[] = [];
  const pointId = new Map<string, string>();
  let pSeq = 0;
  const internPoint = (x: number, y: number): string => {
    const key = `${x.toFixed(DEDUPE_DECIMALS)},${y.toFixed(DEDUPE_DECIMALS)}`;
    const existing = pointId.get(key);
    if (existing) return existing;
    const id = `p${++pSeq}`;
    pointId.set(key, id);
    points.push({ id, x, y });
    return id;
  };

  const lines: SvgLine[] = [];
  let lSeq = 0;
  if (Array.isArray(obj.lines)) {
    for (const l of obj.lines) {
      const o = l as Record<string, unknown>;
      if (!isFiniteNum(o.x1) || !isFiniteNum(o.y1) || !isFiniteNum(o.x2) || !isFiniteNum(o.y2)) continue;
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < EPS) continue; // zero-length
      const p1 = internPoint(o.x1, o.y1);
      const p2 = internPoint(o.x2, o.y2);
      lines.push({ id: `l${++lSeq}`, p1, p2, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
    }
  }

  const circles: SvgCircle[] = [];
  let cSeq = 0;
  if (Array.isArray(obj.circles)) {
    for (const c of obj.circles) {
      const o = c as Record<string, unknown>;
      const r = isFiniteNum(o.r) ? o.r : isFiniteNum(o.radius) ? o.radius : NaN;
      if (!isFiniteNum(o.cx) || !isFiniteNum(o.cy) || !isFiniteNum(r) || r <= 0) continue;
      circles.push({ id: `c${++cSeq}`, cx: o.cx, cy: o.cy, radius: r });
    }
  }

  const arcs: SvgArc[] = [];
  let aSeq = 0;
  if (Array.isArray(obj.arcs)) {
    for (const a of obj.arcs) {
      const o = a as Record<string, unknown>;
      const r = isFiniteNum(o.r) ? o.r : isFiniteNum(o.radius) ? o.radius : NaN;
      const sd = isFiniteNum(o.startDeg) ? o.startDeg : isFiniteNum(o.startAngle) ? (o.startAngle * 180) / Math.PI : NaN;
      const ed = isFiniteNum(o.endDeg) ? o.endDeg : isFiniteNum(o.endAngle) ? (o.endAngle * 180) / Math.PI : NaN;
      if (!isFiniteNum(o.cx) || !isFiniteNum(o.cy) || !isFiniteNum(r) || r <= 0 || !isFiniteNum(sd) || !isFiniteNum(ed)) continue;
      arcs.push({
        id: `a${++aSeq}`,
        cx: o.cx, cy: o.cy, radius: r,
        startAngle: (sd * Math.PI) / 180,
        endAngle: (ed * Math.PI) / 180,
      });
    }
  }

  // Explicit standalone points (in addition to line-endpoint points).
  if (Array.isArray(obj.points)) {
    for (const p of obj.points) {
      const o = p as Record<string, unknown>;
      if (!isFiniteNum(o.x) || !isFiniteNum(o.y)) continue;
      internPoint(o.x, o.y);
    }
  }

  return { points, lines, circles, arcs };
}

/**
 * Build a `realDetector` (sketchInferenceFromImage slot) backed by a vision
 * model. Sends the image + the structured prompt, then parses the reply.
 */
export function createVisionSketchDetector(
  visionComplete: VisionComplete,
): (image: Uint8Array) => Promise<SketchEntities> {
  return async (image: Uint8Array): Promise<SketchEntities> => {
    const reply = await visionComplete(image, VISION_SKETCH_PROMPT);
    return parseSketchEntities(reply);
  };
}
