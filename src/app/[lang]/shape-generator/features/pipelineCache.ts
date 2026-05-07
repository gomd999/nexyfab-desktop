/**
 * Feature pipeline memoization cache.
 *
 * Keys each feature's output geometry by the fingerprint
 *
 *   (kernel + featureType + params + sketchData + upstreamGeoId)
 *
 * `kernel` separates mesh-only runs from OCCT-backed runs so toggling the
 * topology engine cannot reuse the wrong intermediate geometry. A parameter
 * slider tick on a late feature still does not force re-running every upstream
 * feature from scratch. Each BufferGeometry we hand out gets a
 * stable `__featureGeoId` stamped into `userData` — subsequent features use
 * that id as their "input" part of the key.
 *
 * The cache is module-scoped, LRU-bounded, and clones on hit so callers can
 * mutate freely without polluting the stored copy.
 */

import * as THREE from 'three';
import type { FeatureInstance } from './types';

/** Which geometry backend produced / will consume this cache entry */
export type PipelineCacheKernel = 'mesh' | 'occt';

// ─── Geometry identity ──────────────────────────────────────────────────────

/** Attach a stable id to a geometry so downstream features can key on it. */
export function stampGeoId(geo: THREE.BufferGeometry, id?: string): string {
  const existing = geo.userData?.__featureGeoId as string | undefined;
  if (existing && !id) return existing;
  const nextId = id ?? `geo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  geo.userData = { ...(geo.userData ?? {}), __featureGeoId: nextId };
  return nextId;
}

export function getGeoId(geo: THREE.BufferGeometry): string | null {
  return (geo.userData?.__featureGeoId as string | undefined) ?? null;
}

// ─── Key computation ────────────────────────────────────────────────────────

function hashParams(params: Record<string, number>): string {
  // Deterministic — sort keys for stable order across calls.
  const keys = Object.keys(params).sort();
  let out = '';
  for (const k of keys) {
    const v = params[k];
    // Round to 6 decimals so float jitter doesn't blow the cache.
    const rounded = Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;
    out += k + ':' + rounded + '|';
  }
  return out;
}

function hashSketchData(f: FeatureInstance): string {
  if (!f.sketchData) return '';
  const s = f.sketchData;
  // Profile fingerprint: segment count + last 10 point coords (sufficient —
  // any real edit bumps one of these).
  let segHash = `segs=${s.profile.segments.length}|closed=${s.profile.closed ? 1 : 0}|`;
  const pts: number[] = [];
  for (const seg of s.profile.segments) {
    for (const p of seg.points) {
      pts.push(p.x, p.y);
      if (pts.length >= 40) break;
    }
    if (pts.length >= 40) break;
  }
  segHash += pts.map(n => Math.round(n * 1e3) / 1e3).join(',');
  return `${segHash}|plane=${s.plane}|offset=${s.planeOffset}|op=${s.operation}|depth=${s.config.depth}|mode=${s.config.mode}|segc=${s.config.segments}`;
}

export function featureCacheKey(
  f: FeatureInstance,
  upstreamGeoId: string,
  kernel: PipelineCacheKernel = 'mesh',
): string {
  return `${kernel}::${upstreamGeoId}::${f.type}::${hashParams(f.params)}::${hashSketchData(f)}`;
}

// ─── LRU cache ──────────────────────────────────────────────────────────────

const CACHE_LIMIT = 128;
const cache = new Map<string, THREE.BufferGeometry>();

export function cacheGet(key: string): THREE.BufferGeometry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  cache.delete(key);
  cache.set(key, hit);
  // Clone so callers can safely mutate / compute normals without poisoning
  // the cached copy. Preserve the geo id so chaining still hits.
  const clone = hit.clone();
  const id = getGeoId(hit);
  if (id) stampGeoId(clone, id);
  return clone;
}

/** Remove one entry (e.g. after a failed feature so a retry does not reuse bad geometry). */
export function cacheDelete(key: string): void {
  cache.delete(key);
}

export function cachePut(key: string, geo: THREE.BufferGeometry): void {
  // Ensure the value we store carries an id, and that a clone lives in the
  // cache (so caller mutations don't corrupt it).
  stampGeoId(geo);
  const stored = geo.clone();
  const id = getGeoId(geo);
  if (id) stampGeoId(stored, id);
  cache.set(key, stored);
  if (cache.size > CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

export function cacheClear(): void {
  cache.clear();
}

export function cacheSize(): number {
  return cache.size;
}
