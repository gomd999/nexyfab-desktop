/**
 * K6 — Smart fastener auto-insertion.
 *
 * Detects aligned hole pairs across two parts and emits a list of fastener
 * recommendations (bolt + washer + nut) sized from the holeStandards (B2)
 * library. The host then inserts the fasteners into the assembly via the
 * existing PartPlacement / BOM path.
 *
 * Algorithm:
 *  1. Each part exposes a list of "hole entries" — centre point + axis +
 *     diameter — derived from the hole feature params or face extraction.
 *  2. For each pair (hostHole, partnerHole) on different parts: compute
 *     axis alignment (dot of unit vectors > 0.95) and centre-distance along
 *     the shared axis.
 *  3. If aligned and the diameters match a known standard (within ±5%),
 *     emit a FastenerSuggestion with the matching ISO/ANSI spec.
 *
 * The actual insertion (BOM line + 3D placement) is done by the caller —
 * this module only suggests.
 */

import type { HoleStandardSpec } from '../features/holeStandards';
import { ISO_METRIC, ANSI_IMPERIAL } from '../features/holeStandards';

export interface HoleEntry {
  /** Owning part identifier (BOM name). */
  partId: string;
  /** Hole centre in world space (mm). */
  center: [number, number, number];
  /** Unit axis vector (direction of the hole's bore). */
  axis: [number, number, number];
  /** Through-hole diameter (mm). */
  diameter: number;
  /** Optional length / depth — used to suggest bolt length. */
  depth?: number;
}

export interface FastenerSuggestion {
  /** The two part IDs the fastener connects. */
  hostPart: string;
  partnerPart: string;
  /** The matched hole standard (M5, 1/4-20, etc.). */
  spec: HoleStandardSpec;
  /** Fastener kit components — caller turns into BOM rows. */
  components: Array<{ kind: 'bolt' | 'nut' | 'washer'; spec: HoleStandardSpec; quantity: number }>;
  /** Bolt length suggestion (mm). Sum of part stack-up + 2× thread engagement. */
  boltLength: number;
  /** Score 0-1 indicating alignment confidence. */
  score: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distAlongAxis(
  centerA: [number, number, number],
  centerB: [number, number, number],
  axis: [number, number, number],
): number {
  const dx = centerB[0] - centerA[0];
  const dy = centerB[1] - centerA[1];
  const dz = centerB[2] - centerA[2];
  return Math.abs(dx * axis[0] + dy * axis[1] + dz * axis[2]);
}

function perpendicularDistance(
  centerA: [number, number, number],
  centerB: [number, number, number],
  axis: [number, number, number],
): number {
  const dx = centerB[0] - centerA[0];
  const dy = centerB[1] - centerA[1];
  const dz = centerB[2] - centerA[2];
  const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
  const px = dx - along * axis[0];
  const py = dy - along * axis[1];
  const pz = dz - along * axis[2];
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * Find the closest matching hole standard for a given diameter. Searches
 * both ISO_METRIC and ANSI_IMPERIAL by clearance value (the through-hole
 * sized to fit the named fastener).
 */
function matchStandard(diameter: number, tolerancePct = 8): HoleStandardSpec | null {
  let best: { spec: HoleStandardSpec; err: number } | null = null;
  const all = [...ISO_METRIC, ...ANSI_IMPERIAL];
  for (const spec of all) {
    const err = Math.abs(spec.clearance - diameter) / spec.clearance;
    if (err > tolerancePct / 100) continue;
    if (!best || err < best.err) best = { spec, err };
  }
  return best ? best.spec : null;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export interface SuggestOptions {
  /** Max angle (deg) between two hole axes to count as "aligned". Default 18°. */
  alignmentToleranceDeg?: number;
  /** Max perpendicular offset (mm) between hole centres along the shared
   *  axis. Default 1mm — typical drill stack-up. */
  centerOffsetTolerance?: number;
  /** Min thread engagement length added on both sides of the bolt. */
  threadEngagement?: number;
}

export function suggestFasteners(
  holes: HoleEntry[],
  options: SuggestOptions = {},
): FastenerSuggestion[] {
  const cosThresh = Math.cos(((options.alignmentToleranceDeg ?? 18) * Math.PI) / 180);
  const offsetTol = options.centerOffsetTolerance ?? 1.0;
  const engagement = options.threadEngagement ?? 1.5;

  const out: FastenerSuggestion[] = [];

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i];
      const b = holes[j];
      // Skip same-part pairs — fastener bridges two distinct parts.
      if (a.partId === b.partId) continue;

      // Axis alignment — anti-parallel also counts (one part faces in,
      // the other faces out).
      const d = Math.abs(dot(a.axis, b.axis));
      if (d < cosThresh) continue;

      // Centre offset perpendicular to axis (hole-to-hole offset).
      const perp = perpendicularDistance(a.center, b.center, a.axis);
      if (perp > offsetTol) continue;

      // Diameter compatibility — pick the larger as the bolt size; both
      // holes must accept it.
      const d1 = Math.max(a.diameter, b.diameter);
      const spec = matchStandard(d1);
      if (!spec) continue;

      // Bolt length = stack-up along shared axis + engagement on both sides.
      const stackup = distAlongAxis(a.center, b.center, a.axis);
      const boltLength = Math.ceil(stackup + engagement * spec.nominal * 2);

      // Score combines alignment and offset (perfect = 1.0).
      const alignScore = (d - cosThresh) / (1 - cosThresh);
      const offsetScore = 1 - perp / offsetTol;
      const score = Math.max(0, Math.min(1, (alignScore + offsetScore) / 2));

      out.push({
        hostPart: a.partId,
        partnerPart: b.partId,
        spec,
        components: [
          { kind: 'bolt',   spec, quantity: 1 },
          { kind: 'washer', spec, quantity: 2 }, // one each side
          { kind: 'nut',    spec, quantity: 1 },
        ],
        boltLength,
        score,
      });
    }
  }

  // Sort by score descending so the UI presents best matches first.
  out.sort((p, q) => q.score - p.score);
  return out;
}

/**
 * Convert a fastener suggestion to BOM rows — one row per component kind.
 * The caller appends these to the project's BOM via the existing PLM
 * connector (F9) or assembly state.
 */
export function suggestionToBomRows(
  s: FastenerSuggestion,
): Array<{ partNumber: string; description: string; quantity: number }> {
  return s.components.map(c => ({
    partNumber: `${c.kind.toUpperCase()}-${s.spec.name}`,
    description: `${c.kind} ${s.spec.name} (${s.spec.unit})`,
    quantity: c.quantity,
  }));
}
