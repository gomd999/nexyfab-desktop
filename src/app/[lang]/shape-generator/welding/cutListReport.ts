/**
 * cutListReport.ts — Generate a fabrication cut list from weldment
 * structural members.
 *
 * A cut list is the shop's BOM for a welded structure: every piece
 * of pipe / angle / tube that needs to be cut, with its length,
 * profile, material, and quantity. Aggregation rules:
 *
 *   - Members with same profile + material + length (within length
 *     tolerance) → group as one line with quantity N.
 *   - Per-profile waste from standard stock lengths (6 m / 12 m).
 *   - Per-material total weight estimate.
 *
 * Used at the end of a weldment design to print the cutting plan
 * for the shop floor. Optional 1D bin-packing optimizes how to cut
 * the pieces from standard stock to minimize waste.
 */

export interface StructuralMember {
  /** Member id. */
  id: string;
  /** Profile designation (e.g. "HSS 50x50x3", "L 50x50x5", "Pipe 1in Sch40"). */
  profile: string;
  /** Material (e.g. "A36", "S275"). */
  material: string;
  /** Member length, mm. */
  lengthMm: number;
  /** Linear density (kg/m) — used for weight estimate. */
  linearDensityKgPerM: number;
  /** Optional miter angles at each end (degrees). */
  endMiterDeg?: { start: number; end: number };
}

export interface CutListEntry {
  /** Profile designation. */
  profile: string;
  /** Material. */
  material: string;
  /** Cut length, mm. */
  lengthMm: number;
  /** Quantity required. */
  quantity: number;
  /** Total mass (kg). */
  totalMassKg: number;
  /** Original member ids contributing to this line. */
  memberIds: string[];
  /** End miters present, sorted unique. */
  endMiters: number[];
}

export interface BinPackResult {
  /** Stock-length used (mm). */
  stockLengthMm: number;
  /** Number of stock pieces consumed. */
  stockPiecesUsed: number;
  /** Bins (each bin = list of member lengths). */
  bins: number[][];
  /** Total waste from all bins, mm. */
  wasteMm: number;
}

export interface CutListResult {
  entries: CutListEntry[];
  /** Total mass for the whole weldment, kg. */
  totalMassKg: number;
  /** Total raw stock needed (sum of lengths) before nesting, mm. */
  rawLengthMm: number;
  /** Per-profile bin-packing reports (optional). */
  binPacks?: Map<string, BinPackResult>;
}

export interface CutListOptions {
  /** Length tolerance to merge members into same cut-list line (mm). */
  lengthGroupingToleranceMm: number;
  /** If set, run 1D first-fit decreasing bin packing against this stock length. */
  stockLengthMm: number | null;
  /** Saw kerf width (lost material per cut), mm. */
  kerfMm: number;
}

export const DEFAULT_OPTIONS: CutListOptions = {
  lengthGroupingToleranceMm: 1.0,
  stockLengthMm: null,
  kerfMm: 2.0,
};

// ── Top-level entry ────────────────────────────────────────────

export function generateCutList(members: StructuralMember[], options: Partial<CutListOptions> = {}): CutListResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (members.length === 0) {
    return { entries: [], totalMassKg: 0, rawLengthMm: 0 };
  }

  const grouped = new Map<string, StructuralMember[]>();
  for (const m of members) {
    const lengthKey = Math.round(m.lengthMm / opts.lengthGroupingToleranceMm);
    const key = `${m.profile}|${m.material}|${lengthKey}`;
    const list = grouped.get(key) ?? [];
    list.push(m);
    grouped.set(key, list);
  }

  const entries: CutListEntry[] = [];
  for (const [key, list] of grouped) {
    const first = list[0]!;
    const avgLength = list.reduce((s, m) => s + m.lengthMm, 0) / list.length;
    const totalMass = list.reduce((s, m) => s + (m.lengthMm / 1000) * m.linearDensityKgPerM, 0);
    const miters = new Set<number>();
    for (const m of list) {
      if (m.endMiterDeg) {
        miters.add(Math.round(m.endMiterDeg.start * 10) / 10);
        miters.add(Math.round(m.endMiterDeg.end * 10) / 10);
      }
    }
    entries.push({
      profile: first.profile,
      material: first.material,
      lengthMm: avgLength,
      quantity: list.length,
      totalMassKg: totalMass,
      memberIds: list.map(m => m.id),
      endMiters: [...miters].sort((a, b) => a - b),
    });
    void key;
  }

  entries.sort((a, b) => {
    if (a.profile !== b.profile) return a.profile.localeCompare(b.profile);
    return b.lengthMm - a.lengthMm;
  });

  const result: CutListResult = {
    entries,
    totalMassKg: entries.reduce((s, e) => s + e.totalMassKg, 0),
    rawLengthMm: entries.reduce((s, e) => s + e.lengthMm * e.quantity, 0),
  };

  if (opts.stockLengthMm !== null) {
    const packs = new Map<string, BinPackResult>();
    const byProfile = new Map<string, number[]>();
    for (const e of entries) {
      const profileKey = `${e.profile}|${e.material}`;
      const list = byProfile.get(profileKey) ?? [];
      for (let i = 0; i < e.quantity; i++) list.push(e.lengthMm);
      byProfile.set(profileKey, list);
    }
    for (const [profileKey, lengths] of byProfile) {
      packs.set(profileKey, packFirstFitDecreasing(lengths, opts.stockLengthMm, opts.kerfMm));
    }
    result.binPacks = packs;
  }
  return result;
}

// ── 1D Bin packing ─────────────────────────────────────────────

export function packFirstFitDecreasing(lengths: number[], stockLength: number, kerfMm: number): BinPackResult {
  const sorted = [...lengths].sort((a, b) => b - a);
  const bins: Array<{ contents: number[]; remaining: number }> = [];
  for (const len of sorted) {
    const consumed = len + kerfMm;
    let placed = false;
    for (const bin of bins) {
      if (bin.remaining >= consumed) {
        bin.contents.push(len);
        bin.remaining -= consumed;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ contents: [len], remaining: stockLength - consumed });
    }
  }
  const wasteMm = bins.reduce((s, b) => s + Math.max(0, b.remaining), 0);
  return {
    stockLengthMm: stockLength,
    stockPiecesUsed: bins.length,
    bins: bins.map(b => b.contents),
    wasteMm,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CutListSummary {
  lineCount: number;
  totalPieces: number;
  totalMassKg: number;
  uniqueProfileCount: number;
  uniqueMaterialCount: number;
  rawLengthMm: number;
  /** Utilization if bin packing was run (0..1). */
  averageUtilization?: number;
}

export function summarize(result: CutListResult): CutListSummary {
  const profiles = new Set<string>();
  const materials = new Set<string>();
  let totalPieces = 0;
  for (const e of result.entries) {
    profiles.add(e.profile);
    materials.add(e.material);
    totalPieces += e.quantity;
  }
  let avgUtil: number | undefined;
  if (result.binPacks) {
    let totalUsed = 0;
    let totalCapacity = 0;
    for (const pack of result.binPacks.values()) {
      totalCapacity += pack.stockPiecesUsed * pack.stockLengthMm;
      totalUsed += totalCapacity - pack.wasteMm;
    }
    if (totalCapacity > 0) avgUtil = totalUsed / totalCapacity;
  }
  const summary: CutListSummary = {
    lineCount: result.entries.length,
    totalPieces,
    totalMassKg: result.totalMassKg,
    uniqueProfileCount: profiles.size,
    uniqueMaterialCount: materials.size,
    rawLengthMm: result.rawLengthMm,
  };
  if (avgUtil !== undefined) summary.averageUtilization = avgUtil;
  return summary;
}
