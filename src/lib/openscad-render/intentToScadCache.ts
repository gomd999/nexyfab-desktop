/**
 * In-process LRU cache for `intentToScad` (Q10 — Stage 3 speed).
 *
 * The deterministic SCAD generator is fast (sub-ms for typical intents),
 * but the route handler that wraps it does plan-checking, JSON parse, and
 * upstream telemetry — all of which add up under load. A small LRU keyed
 * by canonical-intent hash short-circuits repeat requests (e.g. shape
 * gallery thumbnails, AI agent retries) without changing the contract.
 *
 * Determinism note: `intentToScad` is already pure given the same input,
 * so caching is safe. The cache is keyed by a canonicalized JSON hash
 * (sorted keys + omitted defaults) so semantically equal intents collapse.
 *
 * Memory bound: 256 entries × ~3KB SCAD ≈ <1MB. Set tight on purpose;
 * we'd rather miss-and-recompute than evict useful entries.
 */

import { intentToScad, type IntentInput, type IntentToScadResult } from './intentToScad';

const CACHE_SIZE = 256;

type CacheEntry = { value: IntentToScadResult; ts: number };
const cache = new Map<string, CacheEntry>();

let hits = 0;
let misses = 0;

/**
 * Canonical-key derivation. Sorts keys recursively so `{a:1,b:2}` and
 * `{b:2,a:1}` collapse, drops `undefined`, and rounds floats to 6 decimals
 * (we don't want 3.000001 vs 3 to miss a cache hit).
 */
function canonicalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 1e6) / 1e6;
  }
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const cv = canonicalize(obj[k]);
      if (cv !== undefined) out[k] = cv;
    }
    return out;
  }
  return v;
}

export function intentCacheKey(intent: IntentInput): string {
  return JSON.stringify(canonicalize(intent));
}

/**
 * Cached wrapper around `intentToScad`. Drop-in replacement for the
 * uncached version — same input, same output, just faster on repeats.
 */
export function intentToScadCached(intent: IntentInput): IntentToScadResult {
  const key = intentCacheKey(intent);
  const hit = cache.get(key);
  if (hit) {
    // LRU: re-insert to move to "newest" position.
    cache.delete(key);
    cache.set(key, hit);
    hits++;
    return hit.value;
  }
  const value = intentToScad(intent);
  misses++;
  cache.set(key, { value, ts: Date.now() });

  // Evict oldest when over capacity. Map iteration order is insertion
  // order so deleting the first key drops the least-recently-used entry.
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  return value;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export function getCacheStats(): CacheStats {
  const total = hits + misses;
  return {
    size: cache.size,
    hits,
    misses,
    hitRate: total === 0 ? 0 : hits / total,
  };
}

/** Test/ops helper — clear cache between calls. */
export function resetIntentCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}
