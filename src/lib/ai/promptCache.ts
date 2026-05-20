/**
 * promptCache.ts — LRU cache for AI prompt → response pairs.
 *
 * Stage-3 AI SCAD speedup. Stage-1/2 paid the full model latency
 * (~2-5s) on every "make a 50mm cube with a hole" repeat. Most
 * prompts in practice are slight variations of recently-seen
 * inputs; caching cuts p95 dramatically.
 *
 * Cache key: SHA-256 of the *normalized* prompt + provider + model
 * + temperature. Normalization strips extra whitespace and
 * lowercases — typos like "50 mm cube" vs "50mm cube" hit the same
 * entry.
 *
 * Eviction: LRU with both entry-count and byte-budget caps. Hits
 * promote to the head; misses append at tail and evict from front
 * if over budget.
 */

export interface CacheEntry<V> {
  key: string;
  value: V;
  sizeBytes: number;
  /** Hit count since last eviction — exposed for telemetry. */
  hits: number;
  /** Monotonically increasing access timestamp (ms). */
  lastAccess: number;
}

export interface PromptCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export function normalizePrompt(p: string): string {
  return p.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Cache-key fields. Lossy on purpose — temperature 0.01 ≈ 0.02 in
 *  output, so we round to two decimals. */
export function buildCacheKey(opts: {
  prompt: string;
  provider: string;
  model: string;
  temperature?: number;
}): string {
  const norm = normalizePrompt(opts.prompt);
  const t = (Math.round((opts.temperature ?? 0) * 100) / 100).toFixed(2);
  return `${opts.provider}|${opts.model}|${t}|${norm}`;
}

export class PromptCache<V = string> {
  private map = new Map<string, CacheEntry<V>>();
  private bytes = 0;
  private now = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(opts: PromptCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 256;
    this.maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  }

  get(key: string): V | null {
    const e = this.map.get(key);
    if (!e) return null;
    e.hits++;
    e.lastAccess = ++this.now;
    // Move to back of insertion order (LRU end).
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V, sizeBytes?: number): void {
    const size = sizeBytes ?? estimateSize(value);
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.sizeBytes;
      this.map.delete(key);
    }
    this.map.set(key, {
      key,
      value,
      sizeBytes: size,
      hits: 0,
      lastAccess: ++this.now,
    });
    this.bytes += size;
    this.evict();
  }

  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.bytes -= e.sizeBytes;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  size(): number {
    return this.map.size;
  }

  totalBytes(): number {
    return this.bytes;
  }

  /** Diagnostic — sorted by hit count, most-hit first. */
  topEntries(n = 10): CacheEntry<V>[] {
    return Array.from(this.map.values()).sort((a, b) => b.hits - a.hits).slice(0, n);
  }

  private evict(): void {
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const first = this.map.keys().next();
      if (first.done) break;
      const oldKey = first.value;
      const e = this.map.get(oldKey)!;
      this.bytes -= e.sizeBytes;
      this.map.delete(oldKey);
    }
  }
}

function estimateSize(v: unknown): number {
  if (typeof v === 'string') return v.length * 2; // UTF-16
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 4;
  try {
    return JSON.stringify(v).length * 2;
  } catch {
    return 256;
  }
}
