/**
 * ecnDiffViewer.ts — Compute a diff between two revisions of a
 * drawing for ECN (Engineering Change Notice) review.
 *
 * Compares two drawing snapshots:
 *
 *   - Dimensions: added / removed / value-changed / tolerance-changed.
 *   - Notes: added / removed / edited.
 *   - GD&T callouts: added / removed / modified.
 *   - Views: added / removed.
 *   - Title block fields (drawn-by, date, scale, revision, etc).
 *
 * Each change is classified by severity:
 *
 *   - critical: tolerance loosened, dimension removed, GD&T removed.
 *   - major: dimension value changed.
 *   - minor: note text reformatted, view added.
 *
 * Used by ECN workflows to auto-fill the change description block.
 */

export interface DrawingSnapshot {
  drawingId: string;
  revision: string;
  dimensions: DimensionEntry[];
  notes: NoteEntry[];
  gdtCallouts: GdtEntry[];
  views: string[];
  titleBlock: Record<string, string>;
}

export interface DimensionEntry {
  id: string;
  featureId: string;
  nominal: number;
  plus: number;
  minus: number;
}

export interface NoteEntry {
  id: string;
  text: string;
}

export interface GdtEntry {
  id: string;
  symbol: string;
  toleranceMm: number;
  datumChain: string[];
}

export type ChangeKind =
  | 'dim-added' | 'dim-removed' | 'dim-value-changed' | 'dim-tol-changed'
  | 'note-added' | 'note-removed' | 'note-edited'
  | 'gdt-added' | 'gdt-removed' | 'gdt-changed'
  | 'view-added' | 'view-removed'
  | 'titleblock-changed';

export type Severity = 'critical' | 'major' | 'minor';

export interface ChangeEntry {
  kind: ChangeKind;
  severity: Severity;
  description: string;
  /** Per-entry payload for downstream rendering. */
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  changes: ChangeEntry[];
  /** Original revision label. */
  fromRevision: string;
  toRevision: string;
  totalChanges: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function diffDrawings(before: DrawingSnapshot, after: DrawingSnapshot): DiffResult {
  const changes: ChangeEntry[] = [];
  diffDimensions(before.dimensions, after.dimensions, changes);
  diffNotes(before.notes, after.notes, changes);
  diffGdt(before.gdtCallouts, after.gdtCallouts, changes);
  diffViews(before.views, after.views, changes);
  diffTitleBlock(before.titleBlock, after.titleBlock, changes);

  const critical = changes.filter(c => c.severity === 'critical').length;
  const major = changes.filter(c => c.severity === 'major').length;
  const minor = changes.filter(c => c.severity === 'minor').length;
  return {
    changes,
    fromRevision: before.revision,
    toRevision: after.revision,
    totalChanges: changes.length,
    criticalCount: critical,
    majorCount: major,
    minorCount: minor,
  };
}

// ── Per-section diff helpers ──────────────────────────────────

function diffDimensions(before: DimensionEntry[], after: DimensionEntry[], changes: ChangeEntry[]): void {
  const beforeMap = new Map(before.map(d => [d.id, d]));
  const afterMap = new Map(after.map(d => [d.id, d]));
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      changes.push({
        kind: 'dim-removed', severity: 'critical',
        description: `Dimension ${id} removed.`, before: beforeMap.get(id),
      });
    }
  }
  for (const [id, dim] of afterMap) {
    const old = beforeMap.get(id);
    if (!old) {
      changes.push({ kind: 'dim-added', severity: 'minor', description: `Dimension ${id} added.`, after: dim });
      continue;
    }
    if (old.nominal !== dim.nominal) {
      changes.push({
        kind: 'dim-value-changed', severity: 'major',
        description: `Dimension ${id} nominal ${old.nominal} → ${dim.nominal}.`,
        before: old, after: dim,
      });
    }
    if (old.plus !== dim.plus || old.minus !== dim.minus) {
      const looser = (dim.plus + dim.minus) > (old.plus + old.minus);
      changes.push({
        kind: 'dim-tol-changed', severity: looser ? 'critical' : 'major',
        description: `Dimension ${id} tolerance ${old.plus}/${old.minus} → ${dim.plus}/${dim.minus}.`,
        before: old, after: dim,
      });
    }
  }
}

function diffNotes(before: NoteEntry[], after: NoteEntry[], changes: ChangeEntry[]): void {
  const beforeMap = new Map(before.map(n => [n.id, n]));
  const afterMap = new Map(after.map(n => [n.id, n]));
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      changes.push({ kind: 'note-removed', severity: 'minor', description: `Note ${id} removed.` });
    }
  }
  for (const [id, note] of afterMap) {
    const old = beforeMap.get(id);
    if (!old) {
      changes.push({ kind: 'note-added', severity: 'minor', description: `Note ${id} added.`, after: note });
    } else if (old.text !== note.text) {
      changes.push({ kind: 'note-edited', severity: 'minor', description: `Note ${id} edited.`, before: old, after: note });
    }
  }
}

function diffGdt(before: GdtEntry[], after: GdtEntry[], changes: ChangeEntry[]): void {
  const beforeMap = new Map(before.map(g => [g.id, g]));
  const afterMap = new Map(after.map(g => [g.id, g]));
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      changes.push({ kind: 'gdt-removed', severity: 'critical', description: `GD&T ${id} removed.` });
    }
  }
  for (const [id, g] of afterMap) {
    const old = beforeMap.get(id);
    if (!old) {
      changes.push({ kind: 'gdt-added', severity: 'major', description: `GD&T ${id} added.`, after: g });
    } else if (old.symbol !== g.symbol || old.toleranceMm !== g.toleranceMm || old.datumChain.join('|') !== g.datumChain.join('|')) {
      const looser = g.toleranceMm > old.toleranceMm;
      changes.push({
        kind: 'gdt-changed', severity: looser ? 'critical' : 'major',
        description: `GD&T ${id} modified.`, before: old, after: g,
      });
    }
  }
}

function diffViews(before: string[], after: string[], changes: ChangeEntry[]): void {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const v of beforeSet) if (!afterSet.has(v)) {
    changes.push({ kind: 'view-removed', severity: 'minor', description: `View ${v} removed.` });
  }
  for (const v of afterSet) if (!beforeSet.has(v)) {
    changes.push({ kind: 'view-added', severity: 'minor', description: `View ${v} added.` });
  }
}

function diffTitleBlock(before: Record<string, string>, after: Record<string, string>, changes: ChangeEntry[]): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] !== after[k]) {
      changes.push({
        kind: 'titleblock-changed', severity: 'minor',
        description: `Title-block field "${k}" changed.`,
        before: before[k],
        after: after[k],
      });
    }
  }
}

// ── Group by feature ──────────────────────────────────────────

export function groupByFeature(diff: DiffResult): Map<string, ChangeEntry[]> {
  const map = new Map<string, ChangeEntry[]>();
  for (const c of diff.changes) {
    // Use 'before' or 'after' object's featureId if available.
    let featureId = '__general__';
    const obj = (c.before ?? c.after) as { featureId?: string } | undefined;
    if (obj?.featureId) featureId = obj.featureId;
    if (!map.has(featureId)) map.set(featureId, []);
    map.get(featureId)!.push(c);
  }
  return map;
}

// ── Auto-generate ECN description ─────────────────────────────

export function autoDescribeECN(diff: DiffResult): string {
  const lines: string[] = [];
  lines.push(`Revision ${diff.fromRevision} → ${diff.toRevision}`);
  if (diff.criticalCount > 0) lines.push(`${diff.criticalCount} critical changes`);
  if (diff.majorCount > 0) lines.push(`${diff.majorCount} major changes`);
  if (diff.minorCount > 0) lines.push(`${diff.minorCount} minor changes`);
  for (const c of diff.changes.filter(x => x.severity === 'critical')) {
    lines.push(`  - ${c.description}`);
  }
  return lines.join('\n');
}

// ── Summary ────────────────────────────────────────────────────

export interface DiffSummary {
  totalChanges: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  hasBreakingChanges: boolean;
}

export function summarize(result: DiffResult): DiffSummary {
  return {
    totalChanges: result.totalChanges,
    criticalCount: result.criticalCount,
    majorCount: result.majorCount,
    minorCount: result.minorCount,
    hasBreakingChanges: result.criticalCount > 0,
  };
}
