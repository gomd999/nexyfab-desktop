/**
 * surfaceFinishAutoPlace.ts — Auto-place surface finish symbols
 * (Ra Ø, ASME Y14.36) on drawing views.
 *
 * Per ASME Y14.36 / ISO 1302:
 *
 *   - Symbol points to the surface (apex on the line).
 *   - Text reads from bottom of sheet OR oriented along symbol arm.
 *   - Generic note "All surfaces machined to Ra 3.2 unless otherwise
 *     noted" handles default; only divergent surfaces need symbols.
 *
 * Module:
 *   - Reads measured surfaces with their Ra spec.
 *   - Determines the default (most common Ra) and emits a "unless
 *     otherwise noted" note.
 *   - Auto-places per-surface symbols ONLY for surfaces that differ
 *     from default.
 *   - Picks placement offset perpendicular to surface line.
 */

export interface SurfaceMeasurement {
  surfaceId: string;
  /** Surface line endpoints in drawing coords. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Specified Ra (μm). */
  raMicron: number;
  /** Optional Rz (μm). */
  rzMicron?: number;
  /** Material removal required (default machined). */
  machined: boolean;
}

export interface PlacementOptions {
  /** Distance from surface line to symbol apex (mm). */
  apexOffsetMm: number;
  /** Default Ra threshold: surfaces within ±% of mode go to the global note. */
  defaultGroupTolerance: number;
}

export const DEFAULT_OPTIONS: PlacementOptions = {
  apexOffsetMm: 1.5,
  defaultGroupTolerance: 0.1,
};

export interface SurfaceFinishPlacement {
  surfaceId: string;
  /** Apex position (touches surface line). */
  apex: { x: number; y: number };
  /** Symbol text placement (above the V). */
  textPosition: { x: number; y: number };
  /** Symbol orientation in degrees. */
  rotationDeg: number;
  /** Text content (e.g. "Ra 3.2"). */
  text: string;
  /** Surface is using the default note → suppressed (no symbol drawn). */
  useDefaultNote: boolean;
}

export interface PlacementResult {
  defaultRaMicron: number;
  defaultNote: string;
  symbols: SurfaceFinishPlacement[];
}

// ── Top-level entry ────────────────────────────────────────────

export function placeSurfaceFinish(
  surfaces: SurfaceMeasurement[],
  options: Partial<PlacementOptions> = {},
): PlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (surfaces.length === 0) {
    return { defaultRaMicron: 0, defaultNote: '', symbols: [] };
  }

  // Find the modal Ra (most common value).
  const counts = new Map<number, number>();
  for (const s of surfaces) {
    counts.set(s.raMicron, (counts.get(s.raMicron) ?? 0) + 1);
  }
  let modeRa = 0;
  let modeCount = 0;
  for (const [ra, c] of counts) {
    if (c > modeCount) { modeRa = ra; modeCount = c; }
  }

  const defaultNote = `All surfaces Ra ${modeRa.toFixed(2)} μm unless otherwise noted.`;

  const symbols: SurfaceFinishPlacement[] = surfaces.map(s => {
    const useDefault = Math.abs(s.raMicron - modeRa) / Math.max(0.001, modeRa) <= opts.defaultGroupTolerance;
    const placement = computePlacement(s, opts.apexOffsetMm);
    return {
      surfaceId: s.surfaceId,
      apex: placement.apex,
      textPosition: placement.textPosition,
      rotationDeg: placement.rotationDeg,
      text: buildText(s),
      useDefaultNote: useDefault,
    };
  });

  return { defaultRaMicron: modeRa, defaultNote, symbols };
}

function computePlacement(s: SurfaceMeasurement, offset: number): { apex: { x: number; y: number }; textPosition: { x: number; y: number }; rotationDeg: number } {
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  const len = Math.hypot(dx, dy);
  const apex = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 };
  if (len === 0) return { apex, textPosition: apex, rotationDeg: 0 };
  const nx = -dy / len;
  const ny = dx / len;
  const textPosition = {
    x: apex.x + nx * (offset + 4),
    y: apex.y + ny * (offset + 4),
  };
  const rotationDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  return { apex, textPosition, rotationDeg };
}

function buildText(s: SurfaceMeasurement): string {
  const ra = `Ra ${s.raMicron.toFixed(2)}`;
  const parts = [ra];
  if (s.rzMicron !== undefined) parts.push(`Rz ${s.rzMicron.toFixed(2)}`);
  if (!s.machined) parts.push('NMR'); // No material removal
  return parts.join(' ');
}

// ── Group counts ──────────────────────────────────────────────

export interface RaGroupReport {
  ra: number;
  count: number;
  fraction: number;
}

export function groupByRa(surfaces: SurfaceMeasurement[]): RaGroupReport[] {
  const counts = new Map<number, number>();
  for (const s of surfaces) counts.set(s.raMicron, (counts.get(s.raMicron) ?? 0) + 1);
  const out: RaGroupReport[] = [];
  const total = surfaces.length || 1;
  for (const [ra, c] of counts) {
    out.push({ ra, count: c, fraction: c / total });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface PlacementSummary {
  surfaceCount: number;
  defaultRaMicron: number;
  symbolsDrawnCount: number;
  symbolsSuppressedCount: number;
}

export function summarize(result: PlacementResult): PlacementSummary {
  let drawn = 0, suppressed = 0;
  for (const s of result.symbols) {
    if (s.useDefaultNote) suppressed++;
    else drawn++;
  }
  return {
    surfaceCount: result.symbols.length,
    defaultRaMicron: result.defaultRaMicron,
    symbolsDrawnCount: drawn,
    symbolsSuppressedCount: suppressed,
  };
}
