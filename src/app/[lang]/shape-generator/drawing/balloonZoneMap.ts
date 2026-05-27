/**
 * balloonZoneMap.ts — Map balloon callouts to drawing grid zones
 * (e.g., "Balloon #3 in zone B-2").
 *
 * Builds on the coordinate-grid overlay: every balloon is assigned
 * a zone label based on its position. The BOM list can then say
 * "see balloon 3 in B-2" for easier readability on large drawings.
 *
 * Module also supports:
 *
 *   - Reverse lookup (zone → all balloons in that zone).
 *   - Adjacent zone walk (find balloons near a target zone).
 */

export interface Vec2 { x: number; y: number }

export interface BalloonPlacement {
  /** Balloon id (e.g., the number "3"). */
  balloonId: string;
  /** Balloon center on the drawing sheet. */
  position: Vec2;
}

export interface GridConfig {
  origin: Vec2;
  widthMm: number;
  heightMm: number;
  cols: number;
  rows: number;
  columnLabelMode: 'alpha-upper' | 'alpha-lower' | 'numeric';
  rowLabelMode: 'numeric' | 'alpha-upper' | 'alpha-lower';
}

export const DEFAULT_GRID: GridConfig = {
  origin: { x: 0, y: 0 },
  widthMm: 297,
  heightMm: 210,
  cols: 8,
  rows: 6,
  columnLabelMode: 'alpha-upper',
  rowLabelMode: 'numeric',
};

export interface ZoneAssignment {
  balloonId: string;
  zone: string;
  column: number;
  row: number;
  /** True if the balloon falls outside the grid. */
  outOfGrid: boolean;
}

export interface ZoneMapResult {
  assignments: ZoneAssignment[];
  /** zone → balloon ids inside. */
  byZone: Map<string, string[]>;
  outOfGridCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function buildZoneMap(balloons: BalloonPlacement[], grid: Partial<GridConfig> = {}): ZoneMapResult {
  const cfg = { ...DEFAULT_GRID, ...grid };
  const cellW = cfg.widthMm / cfg.cols;
  const cellH = cfg.heightMm / cfg.rows;
  const assignments: ZoneAssignment[] = [];
  const byZone = new Map<string, string[]>();
  let outOfGrid = 0;

  for (const b of balloons) {
    const dx = b.position.x - cfg.origin.x;
    const dy = b.position.y - cfg.origin.y;
    const inside = dx >= 0 && dy >= 0 && dx <= cfg.widthMm && dy <= cfg.heightMm;
    let col = 0;
    let row = 0;
    if (inside) {
      col = Math.min(cfg.cols - 1, Math.floor(dx / cellW));
      row = Math.min(cfg.rows - 1, Math.floor(dy / cellH));
    } else {
      outOfGrid++;
    }
    const colLabel = makeLabel(col + 1, cfg.columnLabelMode);
    const rowLabel = makeLabel(row + 1, cfg.rowLabelMode);
    const zone = `${colLabel}${rowLabel}`;
    const a: ZoneAssignment = { balloonId: b.balloonId, zone, column: col, row, outOfGrid: !inside };
    assignments.push(a);
    if (inside) {
      const list = byZone.get(zone) ?? [];
      list.push(b.balloonId);
      byZone.set(zone, list);
    }
  }
  return { assignments, byZone, outOfGridCount: outOfGrid };
}

// ── Lookup helpers ────────────────────────────────────────────

export function balloonsInZone(result: ZoneMapResult, zone: string): string[] {
  return result.byZone.get(zone) ?? [];
}

export function findZoneOfBalloon(result: ZoneMapResult, balloonId: string): string | null {
  for (const a of result.assignments) {
    if (a.balloonId === balloonId) return a.outOfGrid ? null : a.zone;
  }
  return null;
}

/** Get all balloons in zones adjacent to a target zone (8-neighborhood). */
export function balloonsNearZone(result: ZoneMapResult, targetZone: string, cfg: Partial<GridConfig> = {}): string[] {
  const config = { ...DEFAULT_GRID, ...cfg };
  // Parse target.
  const target = parseZone(targetZone, config);
  if (!target) return [];
  const out = new Set<string>();
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const col = target.column + dc;
      const row = target.row + dr;
      if (col < 0 || row < 0 || col >= config.cols || row >= config.rows) continue;
      const colLabel = makeLabel(col + 1, config.columnLabelMode);
      const rowLabel = makeLabel(row + 1, config.rowLabelMode);
      const zone = `${colLabel}${rowLabel}`;
      for (const id of result.byZone.get(zone) ?? []) out.add(id);
    }
  }
  return [...out];
}

function parseZone(zone: string, cfg: GridConfig): { column: number; row: number } | null {
  // Attempt to split alpha + numeric.
  const m = zone.match(/^([A-Za-z]+|\d+)([A-Za-z]+|\d+)$/);
  if (!m) return null;
  const colLabel = m[1]!;
  const rowLabel = m[2]!;
  const col = parseLabel(colLabel, cfg.columnLabelMode);
  const row = parseLabel(rowLabel, cfg.rowLabelMode);
  if (col === -1 || row === -1) return null;
  return { column: col - 1, row: row - 1 };
}

function parseLabel(label: string, mode: GridConfig['columnLabelMode']): number {
  if (mode === 'numeric') {
    const n = Number(label);
    return Number.isFinite(n) ? n : -1;
  }
  // alpha modes: A=1, B=2, ..., Z=26, AA=27.
  let n = 0;
  for (const ch of label.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n;
}

function makeLabel(n: number, mode: GridConfig['columnLabelMode']): string {
  if (mode === 'numeric') return String(n);
  if (mode === 'alpha-upper') return toAlpha(n).toUpperCase();
  return toAlpha(n).toLowerCase();
}

function toAlpha(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ── Summary ────────────────────────────────────────────────────

export interface ZoneMapSummary {
  balloonCount: number;
  zonesUsed: number;
  averageBalloonsPerZone: number;
  outOfGridCount: number;
  maxBalloonsInOneZone: number;
}

export function summarize(result: ZoneMapResult): ZoneMapSummary {
  const zonesUsed = result.byZone.size;
  let maxPer = 0;
  for (const list of result.byZone.values()) if (list.length > maxPer) maxPer = list.length;
  const total = result.assignments.length - result.outOfGridCount;
  return {
    balloonCount: result.assignments.length,
    zonesUsed,
    averageBalloonsPerZone: zonesUsed > 0 ? total / zonesUsed : 0,
    outOfGridCount: result.outOfGridCount,
    maxBalloonsInOneZone: maxPer,
  };
}
