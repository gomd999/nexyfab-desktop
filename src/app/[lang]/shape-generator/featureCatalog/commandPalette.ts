/**
 * commandPalette.ts — ⌘K command palette infrastructure.
 *
 * Powers the keyboard-driven "Search any feature" UX. Built on top
 * of the registry. Three layers:
 *
 *   1. **Fuzzy matcher** — characters-in-order tolerant substring
 *      matching (typo / wrong-order friendly). No deps; the user
 *      types "trclrng" and we still find "trochoidal clearing".
 *   2. **Recency + frecency ranking** — recent picks bubble up;
 *      frequency over time keeps daily-driver features near the top.
 *   3. **Keyboard navigation state** — focus index + filtered list
 *      with stable scrolling.
 */

import {
  FEATURE_REGISTRY,
  type FeatureRegistryEntry,
  type FeatureLicense,
} from './registry';

// ── Fuzzy matching ──────────────────────────────────────────────

/** Score how well a needle matches inside a haystack.
 *
 *  Returns a number where:
 *    - -1 = no match
 *    -  0 = exact substring (highest, contiguous)
 *    -  >0 = fuzzy match score (lower is better)
 *
 *  Algorithm: walk through haystack collecting needle chars in order.
 *  Penalize gaps + reward consecutive matches. */
export function fuzzyMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (n === '') return 0;
  if (h === n) return 0;
  if (h.includes(n)) return 0.1;

  let hIdx = 0;
  let consecutive = 0;
  let score = 0;
  for (const ch of n) {
    let found = -1;
    for (let i = hIdx; i < h.length; i++) {
      if (h[i] === ch) { found = i; break; }
    }
    if (found < 0) return -1;
    const gap = found - hIdx;
    if (gap === 0) consecutive++;
    else consecutive = 0;
    score += gap * 2;
    score -= consecutive * 0.5; // reward streaks
    hIdx = found + 1;
  }
  // Bias shorter haystacks higher (less noise around the match).
  score += h.length * 0.02;
  return Math.max(0.5, score);
}

// ── Frecency ranking ────────────────────────────────────────────

export interface FrecencyEvent {
  featureId: string;
  /** Unix ms. */
  at: number;
}

export class FrecencyTracker {
  private events: FrecencyEvent[] = [];
  private readonly windowMs: number;
  private readonly maxEvents: number;

  constructor(windowMs: number = 30 * 24 * 60 * 60 * 1000, maxEvents: number = 500) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
  }

  record(featureId: string, at: number = Date.now()): void {
    this.events.push({ featureId, at });
    this.gc(at);
  }

  /** Recency score (higher = more recent + more frequent). Decay over
   *  the window. */
  score(featureId: string, now: number = Date.now()): number {
    let score = 0;
    for (const e of this.events) {
      if (e.featureId !== featureId) continue;
      const ageMs = Math.max(0, now - e.at);
      const decay = Math.exp(-ageMs / this.windowMs);
      score += decay;
    }
    return score;
  }

  /** Drop events older than the window. */
  private gc(now: number): void {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter(e => e.at >= cutoff);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /** Top-N most recently/frequently used feature ids. */
  topN(n: number = 5, now: number = Date.now()): string[] {
    const seen = new Set<string>();
    const scored: Array<{ id: string; score: number }> = [];
    for (const e of this.events) {
      if (seen.has(e.featureId)) continue;
      seen.add(e.featureId);
      scored.push({ id: e.featureId, score: this.score(e.featureId, now) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n).map(s => s.id);
  }
}

// ── Palette search ──────────────────────────────────────────────

export interface PaletteHit {
  entry: FeatureRegistryEntry;
  /** Final ranking score; lower is better (because fuzzy match returns
   *  lower-is-better, frecency lifts it). */
  score: number;
  /** Reason / debug. */
  matchedField: 'name' | 'tag' | 'description' | 'id';
}

export interface PaletteSearchOptions {
  /** Frecency tracker — adds boost for recently-used items. */
  frecency?: FrecencyTracker;
  /** User's license tier — filters out higher-tier features. */
  userTier?: FeatureLicense;
  /** Limit results. */
  maxResults?: number;
}

const LICENSE_ORDER: Record<FeatureLicense, number> = {
  free: 0, pro: 1, 'pro-plus': 2, enterprise: 3,
};

export function searchPalette(query: string, options: PaletteSearchOptions = {}): PaletteHit[] {
  const max = options.maxResults ?? 10;
  // Empty query → return recent items if frecency available, else top-N.
  if (!query.trim() && options.frecency) {
    const recentIds = options.frecency.topN(max);
    return recentIds
      .map(id => FEATURE_REGISTRY.find(e => e.id === id))
      .filter((e): e is FeatureRegistryEntry => e != null)
      .map(entry => ({ entry, score: 0, matchedField: 'id' as const }));
  }
  if (!query.trim()) {
    return FEATURE_REGISTRY.slice(0, max).map(entry => ({ entry, score: 0, matchedField: 'name' as const }));
  }

  const hits: PaletteHit[] = [];
  for (const entry of FEATURE_REGISTRY) {
    // Filter by tier.
    if (options.userTier) {
      if (LICENSE_ORDER[entry.license] > LICENSE_ORDER[options.userTier]) continue;
    }
    const nameScore = fuzzyMatch(entry.name, query);
    const idScore = fuzzyMatch(entry.id, query);
    const tagScore = Math.min(...entry.tags.map(t => fuzzyMatch(t, query)).filter(s => s >= 0), Infinity);
    const descScore = fuzzyMatch(entry.description, query);

    let bestScore = Infinity;
    let bestField: PaletteHit['matchedField'] = 'name';
    if (nameScore >= 0 && nameScore < bestScore) { bestScore = nameScore; bestField = 'name'; }
    if (idScore >= 0 && idScore < bestScore + 0.5) { bestScore = idScore + 0.5; bestField = 'id'; }
    if (tagScore < bestScore + 0.3) { bestScore = tagScore + 0.3; bestField = 'tag'; }
    if (descScore >= 0 && descScore < bestScore + 1) { bestScore = descScore + 1; bestField = 'description'; }

    if (bestScore === Infinity) continue;

    // Frecency boost — subtract from score.
    if (options.frecency) {
      const boost = options.frecency.score(entry.id);
      bestScore -= boost * 5;
    }

    hits.push({ entry, score: bestScore, matchedField: bestField });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, max);
}

// ── Keyboard navigation state ───────────────────────────────────

export interface PaletteNavState {
  /** Current focused result index. */
  focusedIndex: number;
  /** Currently displayed hits. */
  hits: PaletteHit[];
}

export function initPaletteNav(hits: PaletteHit[]): PaletteNavState {
  return { focusedIndex: 0, hits };
}

export function navUp(state: PaletteNavState): PaletteNavState {
  if (state.hits.length === 0) return state;
  const newIdx = state.focusedIndex > 0 ? state.focusedIndex - 1 : state.hits.length - 1;
  return { ...state, focusedIndex: newIdx };
}

export function navDown(state: PaletteNavState): PaletteNavState {
  if (state.hits.length === 0) return state;
  const newIdx = state.focusedIndex < state.hits.length - 1 ? state.focusedIndex + 1 : 0;
  return { ...state, focusedIndex: newIdx };
}

export function getCurrentHit(state: PaletteNavState): PaletteHit | null {
  return state.hits[state.focusedIndex] ?? null;
}
