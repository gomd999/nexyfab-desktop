/**
 * featureTimelineScrubber.ts — Scrub through a feature tree's history.
 *
 * The feature tree is a sequence of operations (sketch, extrude, hole,
 * fillet, ...). Scrubbing means "what did the model look like after
 * feature index k?". This is *different* from undo:
 *   - Undo unwinds the current branch's recent ops.
 *   - Scrubbing inspects an arbitrary midpoint without losing the tail.
 *
 * Common UI: a slider above the timeline. Drag back to see only the
 * first 3 features; drag forward to restore the full model.
 *
 * The scrubber keeps a snapshot of every feature's *effect* (mesh
 * delta + face provenance) and replays them up to the target index.
 * Memory budget = O(n × delta size); for large trees we keep
 * sparsified key-frame snapshots.
 */

export interface FeatureRecord {
  id: string;
  /** Index in the feature tree (0-based). */
  index: number;
  /** Human-readable name. */
  name: string;
  /** Feature kind (extrude / fillet / hole / ...). */
  kind: string;
  /** Optional dependencies — features that must come first. */
  dependencyIds?: string[];
  /** Suppression flag — feature stays in the tree but doesn't apply. */
  suppressed?: boolean;
  /** Optional snapshot of the model state AFTER this feature. */
  snapshot?: ModelSnapshot;
}

export interface ModelSnapshot {
  /** Whatever opaque payload represents the model state. */
  data: unknown;
  /** Snapshot byte size (heuristic for memory budget). */
  approximateBytes: number;
}

export interface TimelineState {
  /** Current scrubber position (-1 = before any feature, n-1 = full model). */
  currentIndex: number;
  /** True if the user is actively dragging the scrubber. */
  scrubbing: boolean;
  /** Features that are "active" at the current scrub position. */
  activeFeatureIds: string[];
}

export class FeatureTimelineScrubber {
  private features: FeatureRecord[] = [];
  private state: TimelineState = { currentIndex: -1, scrubbing: false, activeFeatureIds: [] };
  /** Listeners notified on state change. */
  private listeners: Array<(state: TimelineState) => void> = [];

  // ── Feature management ──────────────────────────────────────

  setFeatures(features: FeatureRecord[]): void {
    this.features = [...features].sort((a, b) => a.index - b.index);
    this.state.currentIndex = this.features.length - 1;
    this.recomputeActive();
    this.notify();
  }

  appendFeature(feature: FeatureRecord): void {
    this.features.push(feature);
    this.state.currentIndex = this.features.length - 1;
    this.recomputeActive();
    this.notify();
  }

  removeFeature(featureId: string): void {
    this.features = this.features.filter(f => f.id !== featureId);
    // Re-index.
    this.features.forEach((f, i) => { f.index = i; });
    if (this.state.currentIndex >= this.features.length) {
      this.state.currentIndex = this.features.length - 1;
    }
    this.recomputeActive();
    this.notify();
  }

  /** Toggle suppression at the given index. Tree stays the same, the
   *  current snapshot at scrub position needs recomputing. */
  toggleSuppressed(featureId: string): void {
    const f = this.features.find(x => x.id === featureId);
    if (!f) return;
    f.suppressed = !f.suppressed;
    this.recomputeActive();
    this.notify();
  }

  // ── Scrubbing ───────────────────────────────────────────────

  scrubTo(index: number): void {
    const clamped = Math.max(-1, Math.min(this.features.length - 1, index));
    this.state.currentIndex = clamped;
    this.recomputeActive();
    this.notify();
  }

  step(direction: -1 | 1): void {
    this.scrubTo(this.state.currentIndex + direction);
  }

  setScrubbing(value: boolean): void {
    this.state.scrubbing = value;
    this.notify();
  }

  /** Skip suppressed features in active list. */
  private recomputeActive(): void {
    const active: string[] = [];
    for (let i = 0; i <= this.state.currentIndex; i++) {
      const f = this.features[i];
      if (!f) continue;
      if (f.suppressed) continue;
      // Skip if any dependency isn't active.
      if (f.dependencyIds?.some(dep => !active.includes(dep))) continue;
      active.push(f.id);
    }
    this.state.activeFeatureIds = active;
  }

  // ── Snapshot lookup ─────────────────────────────────────────

  /** Get the snapshot at the current scrub position. If no snapshot is
   *  stored for the exact position, returns the latest preceding one. */
  getCurrentSnapshot(): ModelSnapshot | null {
    for (let i = this.state.currentIndex; i >= 0; i--) {
      const f = this.features[i];
      if (f?.snapshot) return f.snapshot;
    }
    return null;
  }

  /** Store a snapshot for a given feature — usually called by the
   *  pipeline after applying that feature. */
  storeSnapshot(featureId: string, snapshot: ModelSnapshot): void {
    const f = this.features.find(x => x.id === featureId);
    if (f) f.snapshot = snapshot;
  }

  // ── Memory budget ───────────────────────────────────────────

  /** Total snapshot memory in bytes. */
  snapshotMemoryBytes(): number {
    return this.features.reduce((s, f) => s + (f.snapshot?.approximateBytes ?? 0), 0);
  }

  /** Sparsify: drop snapshots from "less important" features to fit
   *  memory budget. We keep snapshots every `stride` features plus the
   *  last `keepTail` ones for fast undo. */
  sparsifyTo(maxBytes: number, stride: number = 5, keepTail: number = 3): void {
    const tailStart = Math.max(0, this.features.length - keepTail);
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i]!;
      if (!f.snapshot) continue;
      // Always keep tail and every `stride`-th feature.
      const isKeyFrame = i % stride === 0 || i >= tailStart;
      if (!isKeyFrame && this.snapshotMemoryBytes() > maxBytes) {
        f.snapshot = undefined;
      }
    }
  }

  // ── Observers ───────────────────────────────────────────────

  onChange(listener: (state: TimelineState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state);
  }

  // ── Inspection ──────────────────────────────────────────────

  getState(): TimelineState {
    return { ...this.state, activeFeatureIds: [...this.state.activeFeatureIds] };
  }

  getFeatures(): FeatureRecord[] {
    return this.features.slice();
  }

  /** Feature at exact index, or null. */
  featureAt(index: number): FeatureRecord | null {
    return this.features[index] ?? null;
  }
}

// ── Diff between two scrub positions ────────────────────────────

export interface ScrubDiff {
  /** Features active at A but not B (rolled back). */
  removed: string[];
  /** Features active at B but not A (rolled forward). */
  added: string[];
}

export function diffScrubPositions(
  scrubber: FeatureTimelineScrubber,
  indexA: number,
  indexB: number,
): ScrubDiff {
  const features = scrubber.getFeatures();
  const activeAt = (idx: number): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i <= idx; i++) {
      const f = features[i];
      if (f && !f.suppressed) set.add(f.id);
    }
    return set;
  };
  const setA = activeAt(indexA);
  const setB = activeAt(indexB);
  return {
    removed: [...setA].filter(id => !setB.has(id)),
    added: [...setB].filter(id => !setA.has(id)),
  };
}
