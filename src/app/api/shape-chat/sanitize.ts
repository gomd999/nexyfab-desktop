/**
 * AI response sanitizer for /api/shape-chat.
 *
 * AI can return arbitrary numeric values (NaN, -Infinity, 1e9, negatives where
 * positives are required). The geometry engine assumes mm-scale finite values;
 * passing junk crashes the worker or generates nonsense parts.
 *
 * Hard bounds in mm:
 *   dimension     : 0.01  .. 10000   (10 m max — anything past this is hostile)
 *   force         : -1e7  .. 1e7     (N — covers heavy industrial loads)
 *   angle         : -360  .. 360
 *   ratio         : 0.01  .. 0.99    (volfrac etc.)
 *   count         : 1     .. 1000    (pattern instances etc.)
 */

import { clampFeatureParams, isBuildableFeatureType } from '@/app/[lang]/shape-generator/features/featureParamSchema';

const MAX_DIM_MM = 10_000;
const MIN_DIM_MM = 0.01;
const MAX_FORCE = 1e7;
const MAX_COUNT = 1000;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampDim(v: unknown, fallback = 50): number {
  if (!finite(v)) return fallback;
  return Math.max(MIN_DIM_MM, Math.min(MAX_DIM_MM, v));
}

function clampForce(v: unknown, fallback = 0): number {
  if (!finite(v)) return fallback;
  return Math.max(-MAX_FORCE, Math.min(MAX_FORCE, v));
}

function clampAngle(v: unknown, fallback = 0): number {
  if (!finite(v)) return fallback;
  return Math.max(-360, Math.min(360, v));
}

function clampCount(v: unknown, fallback = 1): number {
  if (!finite(v)) return fallback;
  return Math.max(1, Math.min(MAX_COUNT, Math.round(v)));
}

function clampRatio(v: unknown, fallback = 0.4): number {
  if (!finite(v)) return fallback;
  return Math.max(0.01, Math.min(0.99, v));
}

function sanitizeParams(params: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!finite(v)) continue;
    const lower = k.toLowerCase();
    if (lower.includes('angle')) out[k] = clampAngle(v);
    else if (lower.includes('count') || lower === 'teeth' || lower === 'sides' || lower === 'turns') out[k] = clampCount(v);
    else out[k] = clampDim(v);
  }
  return out;
}

function sanitizeFeatures(features: unknown[]): unknown[] {
  if (!Array.isArray(features)) return [];
  return features
    .filter((f: unknown): f is Record<string, unknown> =>
      Boolean(f && typeof f === 'object' && typeof (f as Record<string, unknown>).type === 'string'),
    )
    // Drop feature types the modeler can't build (AI hallucinations) so the
    // pipeline never gets a no-op or unknown op.
    .filter((f: Record<string, unknown>) => isBuildableFeatureType(f.type as string))
    .slice(0, 50)
    .map((f: Record<string, unknown>) => {
      const type = f.type as string;
      const rawParams = (f.params && typeof f.params === 'object' ? f.params : {}) as Record<string, unknown>;
      // Known feature types → clamp to the real param schema (in-range, integer
      // where required, defaults filled, stray params dropped). Otherwise fall
      // back to the generic magnitude clamp.
      const schemaParams = clampFeatureParams(type, rawParams);
      return { ...f, params: schemaParams ?? sanitizeParams(rawParams) };
    });
}

function sanitizeVec3(v: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return fallback;
  return [
    finite(v[0]) ? v[0] : fallback[0],
    finite(v[1]) ? v[1] : fallback[1],
    finite(v[2]) ? v[2] : fallback[2],
  ];
}

/**
 * Sanitize a parsed AI response in-place. Mutates the object to clamp/strip
 * non-finite numeric values per mode. Keeps existing structural filtering intact.
 */
export function sanitizeShapeChatResponse(parsed: Record<string, unknown> | null | undefined): void {
  if (!parsed || typeof parsed !== 'object') return;

  if (parsed.mode === 'bom') {
    const partsRaw = parsed.parts;
    if (Array.isArray(partsRaw)) {
      parsed.parts = partsRaw.slice(0, 100);
      for (const rawPart of parsed.parts as unknown[]) {
        if (!rawPart || typeof rawPart !== 'object') continue;
        const part = rawPart as Record<string, unknown>;
        if (part.params && typeof part.params === 'object') {
          part.params = sanitizeParams(part.params as Record<string, unknown>);
        }
        part.position = sanitizeVec3(part.position);
        part.rotation = sanitizeVec3(part.rotation);
        if (part.features) part.features = sanitizeFeatures(part.features as unknown[]);
        if (typeof part.qty === 'number') part.qty = clampCount(part.qty, 1);
      }
    }
  } else if (parsed.mode === 'sketch') {
    const profile = parsed.profile;
    if (profile && typeof profile === 'object' && Array.isArray((profile as Record<string, unknown>).segments)) {
      const segments = (profile as Record<string, unknown>).segments as Array<{
        points?: Array<{ x?: unknown; y?: unknown }>;
      }>;
      for (const seg of segments) {
        if (Array.isArray(seg.points)) {
          for (const p of seg.points) {
            if (!finite(p.x)) p.x = 0;
            if (!finite(p.y)) p.y = 0;
            p.x = Math.max(-MAX_DIM_MM, Math.min(MAX_DIM_MM, p.x as number));
            p.y = Math.max(-MAX_DIM_MM, Math.min(MAX_DIM_MM, p.y as number));
          }
        }
      }
    }
    const config = parsed.config;
    if (config && typeof config === 'object') {
      const c = config as Record<string, unknown>;
      if (typeof c.depth === 'number') c.depth = clampDim(c.depth, 30);
      if (typeof c.revolveAngle === 'number') c.revolveAngle = clampAngle(c.revolveAngle, 360);
    }
  } else if (parsed.mode === 'optimize') {
    parsed.dimX = clampDim(parsed.dimX, 200);
    parsed.dimY = clampDim(parsed.dimY, 100);
    parsed.dimZ = clampDim(parsed.dimZ, 200);
    parsed.volfrac = clampRatio(parsed.volfrac, 0.4);
    if (Array.isArray(parsed.loads)) {
      parsed.loads = (parsed.loads as unknown[]).slice(0, 20).map((l: unknown) => {
        const row = l as Record<string, unknown>;
        return {
          ...row,
          force: sanitizeVec3(row.force).map(clampForce) as [number, number, number],
        };
      });
    }
  } else if (parsed.mode === 'modify') {
    if (Array.isArray(parsed.actions)) {
      parsed.actions = (parsed.actions as unknown[]).slice(0, 50).map((a: unknown) => {
        const row = a as Record<string, unknown>;
        if (row.type === 'param' && finite(row.value)) {
          return { ...row, value: clampDim(row.value, 0) };
        }
        if (row.type === 'feature' && row.params && typeof row.params === 'object') {
          return { ...row, params: sanitizeParams(row.params as Record<string, unknown>) };
        }
        return row;
      });
    }
  } else {
    if (parsed.params && typeof parsed.params === 'object') {
      parsed.params = sanitizeParams(parsed.params as Record<string, unknown>);
    }
    if (parsed.features) parsed.features = sanitizeFeatures(parsed.features as unknown[]);
  }
}
