/**
 * kernelCorpus — OCCT kernel-failure corpus capture (roadmap Phase 4).
 *
 * When an OCCT feature op fails in the pipeline (fillet/shell/boolean/draft…
 * throwing, or falling back to the mesh approximator), capture a minimal
 * reproducible record: op, params, a base-shape signature (bbox + cheap
 * geometry hash + the feature stack up to that point), and the error.
 *
 * Storage model
 * ─────────────
 *   - In-memory ring buffer ALWAYS (works in the pipeline worker, where
 *     localStorage doesn't exist).
 *   - localStorage persistence best-effort on the main thread, size-capped
 *     (ring of MAX_RECORDS, payload cap enforced by dropping oldest).
 *   - Report path: reuses the EXISTING telemetry channel
 *     (`lib/telemetry.reportWarning` → POST /api/nexyfab/telemetry + Sentry
 *     forward) — same consent model as every other pipeline error, no new
 *     consent surface invented. Set `forward: false` at call sites that
 *     already reported the error themselves (avoids double-send).
 *   - `exportKernelCorpusJson()` gives a one-call JSON dump for diagnostics
 *     (also reachable in the browser via `window.__nfabKernelCorpus`).
 *
 * Capture is failure-path only — the success path never calls into this
 * module, so there is zero per-feature cost when the kernel is healthy.
 */

import type { BufferGeometry } from 'three';
import { reportWarning } from '../lib/telemetry';

export const KERNEL_CORPUS_VERSION = 1 as const;

/** What the auto-avoidance layer ended up doing about a captured failure. */
export interface KernelFailureResolution {
  /**
   * - 'reduced-radius'  — op succeeded after shrinking a parameter (fillet ladder)
   * - 'partial-edges'   — op succeeded on a subset of the selected edges
   * - 'mesh-fallback'   — every kernel attempt failed; mesh approximator ran
   * - 'none'            — no avoidance attempted / failure surfaced to the user
   */
  strategy: 'reduced-radius' | 'partial-edges' | 'mesh-fallback' | 'none';
  /** Requested parameter values (what the user asked for). */
  requested?: Record<string, number>;
  /** Applied parameter values (what actually built). */
  applied?: Record<string, number>;
  /** Human-readable summary, e.g. "radius 8 → 4 mm" or "edges 3/5". */
  detail?: string;
}

/** Cheap, capture-time signature of the solid the op ran against. */
export interface BaseShapeSignature {
  bbox: [number, number, number, number, number, number] | null;
  vertexCount: number;
  /** FNV-1a over sampled vertex positions — stable per geometry, O(64). */
  geoHash: string;
  /** Whether a real B-rep handle was attached (OCCT chain vs bbox host). */
  hasBrepHandle: boolean;
  /** Feature types applied up to this point (stamped by pipelineManager). */
  featureStack?: string[];
}

export interface KernelFailureRecord {
  v: typeof KERNEL_CORPUS_VERSION;
  id: string;
  ts: number;
  /** Feature/op that failed: 'fillet' | 'shell' | 'boolean' | 'draft' | … */
  op: string;
  /** Where in the pipeline it failed: 'occt-apply' | 'occt-retry' | 'pipeline'. */
  stage: string;
  /** Sanitized op params (numbers/strings/booleans only). */
  params: Record<string, number | string | boolean>;
  base: BaseShapeSignature;
  /** Error message (truncated). */
  error: string;
  resolution: KernelFailureResolution;
}

// ─── Ring buffer ─────────────────────────────────────────────────────────────

const MAX_RECORDS = 40;
const MAX_ERROR_LEN = 400;
const MAX_PARAM_KEYS = 24;
const STORAGE_KEY = 'nfabKernelCorpus_v1';
/** Persisted payload cap — drop oldest records until under this. */
const MAX_STORAGE_BYTES = 192 * 1024;

let ring: KernelFailureRecord[] = [];
let loadedFromStorage = false;
let seq = 0;

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false; // SecurityError in some embeds
  }
}

function loadPersisted(): void {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  if (!hasLocalStorage()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(
        (r): r is KernelFailureRecord =>
          !!r && typeof r === 'object' && (r as KernelFailureRecord).v === KERNEL_CORPUS_VERSION
          && typeof (r as KernelFailureRecord).op === 'string',
      );
      // Persisted records come FIRST (older), current session appends after.
      ring = [...valid, ...ring].slice(-MAX_RECORDS);
    }
  } catch {
    /* corrupt store — start fresh, never throw from capture infra */
  }
}

function persist(): void {
  if (!hasLocalStorage()) return;
  try {
    let toStore = ring.slice(-MAX_RECORDS);
    let json = JSON.stringify(toStore);
    while (json.length > MAX_STORAGE_BYTES && toStore.length > 1) {
      toStore = toStore.slice(1); // drop oldest
      json = JSON.stringify(toStore);
    }
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* quota / privacy mode — in-memory ring still has the data */
  }
}

// ─── Geometry signature ──────────────────────────────────────────────────────

/** FNV-1a 32-bit over a Float32Array view of sampled positions. */
function fnv1a(values: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  const f32 = new Float32Array(1);
  const u8 = new Uint8Array(f32.buffer);
  for (let i = 0; i < values.length; i++) {
    f32[0] = values[i]!;
    for (let b = 0; b < 4; b++) {
      h ^= u8[b]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Cheap signature of a geometry: bbox + vertex count + a hash over ≤64 sampled
 * vertices. O(1)-ish — safe to run on the failure path of any solid.
 */
export function geometrySignature(geometry: BufferGeometry | null | undefined): BaseShapeSignature {
  if (!geometry || !geometry.attributes?.position) {
    return { bbox: null, vertexCount: 0, geoHash: 'empty', hasBrepHandle: false };
  }
  const pos = geometry.attributes.position;
  const count = pos.count;
  let bbox: BaseShapeSignature['bbox'] = null;
  try {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (bb) {
      const r = (v: number) => Math.round(v * 1000) / 1000;
      bbox = [r(bb.min.x), r(bb.min.y), r(bb.min.z), r(bb.max.x), r(bb.max.y), r(bb.max.z)];
    }
  } catch { /* signature stays partial */ }

  const samples: number[] = [count];
  const stride = Math.max(1, Math.floor(count / 64));
  for (let i = 0; i < count; i += stride) {
    samples.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const stack = (geometry.userData as { nfabFeatureStack?: string[] } | undefined)?.nfabFeatureStack;
  return {
    bbox,
    vertexCount: count,
    geoHash: fnv1a(samples),
    hasBrepHandle: typeof geometry.userData?.occtHandle === 'string',
    ...(Array.isArray(stack) && stack.length > 0 ? { featureStack: stack.slice(-16) } : {}),
  };
}

// ─── Capture API ─────────────────────────────────────────────────────────────

function sanitizeParams(params: Record<string, unknown> | undefined): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (!params) return out;
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n >= MAX_PARAM_KEYS) break;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; n++; }
    else if (typeof v === 'string') { out[k] = v.slice(0, 80); n++; }
  }
  return out;
}

export interface CaptureArgs {
  op: string;
  /** Default 'occt-apply'. */
  stage?: string;
  params?: Record<string, unknown>;
  /** Geometry the op ran against (signature only — never stored whole). */
  geometry?: BufferGeometry | null;
  error: unknown;
  resolution?: KernelFailureResolution;
  /**
   * Forward through the existing telemetry channel (default true). Pass false
   * at call sites that already reportError'd the same failure themselves.
   */
  forward?: boolean;
}

/**
 * Capture one kernel failure into the corpus ring. Never throws — capture
 * infrastructure must not become a failure mode itself.
 */
export function captureKernelFailure(args: CaptureArgs): KernelFailureRecord {
  loadPersisted();
  let message = args.error instanceof Error ? args.error.message : String(args.error);
  // Raw OCCT/emscripten exceptions surface as a bare pointer number — label
  // them so a corpus reader knows it was a WASM-level abort, not a JS error.
  if (/^\d+$/.test(message)) message = `wasm-exception ${message}`;
  const record: KernelFailureRecord = {
    v: KERNEL_CORPUS_VERSION,
    id: `kc_${Date.now().toString(36)}_${(++seq).toString(36)}`,
    ts: Date.now(),
    op: args.op,
    stage: args.stage ?? 'occt-apply',
    params: sanitizeParams(args.params),
    base: geometrySignature(args.geometry),
    error: message.slice(0, MAX_ERROR_LEN),
    resolution: args.resolution ?? { strategy: 'none' },
  };
  try {
    ring.push(record);
    if (ring.length > MAX_RECORDS) ring.splice(0, ring.length - MAX_RECORDS);
    persist();
    if (args.forward !== false) {
      // Reuse the existing, already-consented telemetry pipe (it dedupes,
      // scrubs PII and no-ops when the endpoint is absent).
      reportWarning('feature_pipeline', `kernel op failed: ${args.op}`, {
        stage: 'kernel_corpus',
        kernelCorpus: record as unknown as Record<string, unknown>,
      });
    }
  } catch {
    /* never throw from capture */
  }
  return record;
}

/**
 * Update a captured record's resolution after auto-avoidance ran (e.g. the
 * fillet ladder succeeded at a smaller radius). No-op for unknown ids.
 */
export function resolveKernelFailure(id: string, resolution: KernelFailureResolution): void {
  try {
    const rec = ring.find(r => r.id === id);
    if (!rec) return;
    rec.resolution = resolution;
    persist();
  } catch {
    /* never throw */
  }
}

/** Current corpus (persisted + this session), oldest first. */
export function getKernelCorpus(): readonly KernelFailureRecord[] {
  loadPersisted();
  return ring.slice();
}

export function clearKernelCorpus(): void {
  ring = [];
  loadedFromStorage = true; // don't resurrect what we just cleared
  if (hasLocalStorage()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

/** JSON dump for the diagnostics/export path (and fixture authoring). */
export function exportKernelCorpusJson(): string {
  return JSON.stringify(getKernelCorpus(), null, 2);
}

// Dev access without UI plumbing: `window.__nfabKernelCorpus.export()` in the
// console dumps the corpus for attaching to a bug report / fixture authoring.
declare global {
  interface Window {
    __nfabKernelCorpus?: {
      get: typeof getKernelCorpus;
      export: typeof exportKernelCorpusJson;
      clear: typeof clearKernelCorpus;
    };
  }
}
if (typeof window !== 'undefined') {
  try {
    window.__nfabKernelCorpus = {
      get: getKernelCorpus,
      export: exportKernelCorpusJson,
      clear: clearKernelCorpus,
    };
  } catch { /* read-only window in exotic embeds */ }
}
