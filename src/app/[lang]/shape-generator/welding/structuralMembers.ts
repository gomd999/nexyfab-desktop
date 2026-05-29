/**
 * structuralMembers.ts — Structural member library + weldment cut list.
 *
 * SolidWorks "Weldments → Structural Member" inserts a length of W-
 * beam / C-channel / L-angle / square-tube / round-tube along a sketch
 * segment. The library covers the most common cross-sections, sized
 * per AISC (American), DIN (German), KS (Korean), JIS (Japanese)
 * catalog standards.
 *
 * Cut list extraction: walks the assembly + tallies the unique
 * (profile × length × material) combinations, with quantities and
 * total stock length per profile. Used for shop fabrication orders.
 */

export type ProfileFamily =
  | 'w-beam'           // wide-flange (I-beam)
  | 's-beam'           // S-shape
  | 'c-channel'        // C-shape
  | 'l-angle-equal'    // L-shape equal legs
  | 'l-angle-unequal'  // L-shape unequal legs
  | 'hss-square'       // hollow structural section, square
  | 'hss-rect'         // hollow structural section, rectangular
  | 'hss-round'        // round tube
  | 'solid-round'      // round bar
  | 'solid-square';    // square bar

export type StructuralStandard = 'AISC' | 'DIN' | 'KS' | 'JIS';

export interface StructuralProfile {
  /** Catalog id, e.g. "W8x31". */
  id: string;
  family: ProfileFamily;
  standard: StructuralStandard;
  /** Display name. */
  name: string;
  /** Cross-section dimensions (mm). */
  depthMm: number;
  widthMm: number;
  /** Web/wall thickness (mm). */
  webThicknessMm?: number;
  /** Flange thickness for I/C profiles (mm). */
  flangeThicknessMm?: number;
  /** Cross-section area (mm²). */
  areaMm2: number;
  /** Mass per length (kg/m). */
  massPerMeterKgM: number;
  /** Section modulus about strong axis (mm³) — for bending stress. */
  sectionModulusMm3?: number;
}

// Reference catalog (subset — production has 200+ entries).
export const PROFILE_CATALOG: StructuralProfile[] = [
  // AISC W-beams.
  {
    id: 'W8x31', family: 'w-beam', standard: 'AISC', name: 'W 8×31',
    depthMm: 203, widthMm: 203, webThicknessMm: 7.2, flangeThicknessMm: 11.0,
    areaMm2: 5870, massPerMeterKgM: 46.1, sectionModulusMm3: 470000,
  },
  {
    id: 'W10x49', family: 'w-beam', standard: 'AISC', name: 'W 10×49',
    depthMm: 254, widthMm: 254, webThicknessMm: 8.6, flangeThicknessMm: 14.2,
    areaMm2: 9290, massPerMeterKgM: 72.9, sectionModulusMm3: 900000,
  },
  // KS H-beams (Korean standard wide-flange).
  {
    id: 'H-200x200', family: 'w-beam', standard: 'KS', name: 'H형강 200×200',
    depthMm: 200, widthMm: 200, webThicknessMm: 8, flangeThicknessMm: 12,
    areaMm2: 6353, massPerMeterKgM: 49.9, sectionModulusMm3: 472000,
  },
  // C-channels.
  {
    id: 'C150x75x6.5', family: 'c-channel', standard: 'KS', name: 'C형강 150×75×6.5',
    depthMm: 150, widthMm: 75, webThicknessMm: 6.5, flangeThicknessMm: 10,
    areaMm2: 2399, massPerMeterKgM: 18.8, sectionModulusMm3: 95800,
  },
  // L-angles.
  {
    id: 'L50x50x5', family: 'l-angle-equal', standard: 'KS', name: 'L형강 50×50×5',
    depthMm: 50, widthMm: 50, webThicknessMm: 5,
    areaMm2: 480, massPerMeterKgM: 3.77, sectionModulusMm3: 7700,
  },
  {
    id: 'L100x100x10', family: 'l-angle-equal', standard: 'KS', name: 'L형강 100×100×10',
    depthMm: 100, widthMm: 100, webThicknessMm: 10,
    areaMm2: 1900, massPerMeterKgM: 14.9, sectionModulusMm3: 26700,
  },
  // HSS square tubes.
  {
    id: 'HSS50x50x3', family: 'hss-square', standard: 'AISC', name: '50×50×3 SQ',
    depthMm: 50, widthMm: 50, webThicknessMm: 3,
    areaMm2: 552, massPerMeterKgM: 4.33, sectionModulusMm3: 7720,
  },
  {
    id: 'HSS100x100x6', family: 'hss-square', standard: 'AISC', name: '100×100×6 SQ',
    depthMm: 100, widthMm: 100, webThicknessMm: 6,
    areaMm2: 2210, massPerMeterKgM: 17.3, sectionModulusMm3: 64000,
  },
  // Round tube.
  {
    id: 'TUBE50x3', family: 'hss-round', standard: 'KS', name: 'Ø50×3 tube',
    depthMm: 50, widthMm: 50, webThicknessMm: 3,
    areaMm2: 443, massPerMeterKgM: 3.48, sectionModulusMm3: 5000,
  },
  // Solid bars.
  {
    id: 'BAR-ROUND-25', family: 'solid-round', standard: 'KS', name: 'Ø25 round bar',
    depthMm: 25, widthMm: 25,
    areaMm2: 491, massPerMeterKgM: 3.85, sectionModulusMm3: 1530,
  },
];

export function findProfile(id: string): StructuralProfile | null {
  return PROFILE_CATALOG.find(p => p.id === id) ?? null;
}

export function listProfilesByFamily(family: ProfileFamily): StructuralProfile[] {
  return PROFILE_CATALOG.filter(p => p.family === family);
}

export function listProfilesByStandard(std: StructuralStandard): StructuralProfile[] {
  return PROFILE_CATALOG.filter(p => p.standard === std);
}

// ── Member instance + assembly ───────────────────────────────────

export interface StructuralMember {
  id: string;
  profileId: string;
  /** Cut length (mm). */
  lengthMm: number;
  /** Material id (mild steel SS400 default). */
  materialId: string;
  /** Optional weld bead / end-cap notes. */
  notes?: string;
}

export interface CutListRow {
  profileId: string;
  profileName: string;
  materialId: string;
  /** Unique lengths in this row. */
  lengthMm: number;
  quantity: number;
  /** Mass per piece (kg). */
  massPerPieceKg: number;
  /** Total mass (kg). */
  totalMassKg: number;
}

export interface CutList {
  rows: CutListRow[];
  /** Total mass across all rows (kg). */
  totalMassKg: number;
  /** Total stock length needed per profile (mm). */
  stockLengthPerProfile: Record<string, number>;
  /** Number of distinct profile types used. */
  uniqueProfileCount: number;
}

export function generateCutList(members: StructuralMember[]): CutList {
  // Group by (profileId, materialId, lengthMm).
  const groupMap = new Map<string, CutListRow>();
  const stockByProfile: Record<string, number> = {};

  for (const m of members) {
    const profile = findProfile(m.profileId);
    if (!profile) continue;
    const key = `${m.profileId}|${m.materialId}|${m.lengthMm}`;
    const massPerPiece = (m.lengthMm / 1000) * profile.massPerMeterKgM;
    const existing = groupMap.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.totalMassKg = existing.massPerPieceKg * existing.quantity;
    } else {
      groupMap.set(key, {
        profileId: m.profileId,
        profileName: profile.name,
        materialId: m.materialId,
        lengthMm: m.lengthMm,
        quantity: 1,
        massPerPieceKg: massPerPiece,
        totalMassKg: massPerPiece,
      });
    }
    stockByProfile[m.profileId] = (stockByProfile[m.profileId] ?? 0) + m.lengthMm;
  }

  const rows = Array.from(groupMap.values())
    .sort((a, b) => a.profileId.localeCompare(b.profileId) || b.lengthMm - a.lengthMm);
  const totalMass = rows.reduce((s, r) => s + r.totalMassKg, 0);
  const uniqueProfiles = new Set(rows.map(r => r.profileId));

  return {
    rows,
    totalMassKg: totalMass,
    stockLengthPerProfile: stockByProfile,
    uniqueProfileCount: uniqueProfiles.size,
  };
}

// ── Stock optimization (1-D bin packing) ─────────────────────────

/** Pack required member lengths into standard stock lengths to
 *  minimize waste. Each profile is packed independently. */
export interface StockPackingResult {
  perProfile: Record<string, {
    sticksUsed: number;
    totalWasteMm: number;
    stickAssignments: Array<{ stockIndex: number; lengthMm: number; remainingMm: number }>;
  }>;
  totalStocksUsed: number;
  totalWasteMm: number;
}

/** First-fit decreasing packing — common in real cut-list software. */
export function packStockLengths(
  members: StructuralMember[],
  standardStockLengthMm: number = 6000,
  kerfMm: number = 3,
): StockPackingResult {
  const result: StockPackingResult = {
    perProfile: {},
    totalStocksUsed: 0,
    totalWasteMm: 0,
  };
  // Group by profile.
  const byProfile = new Map<string, number[]>();
  for (const m of members) {
    if (!byProfile.has(m.profileId)) byProfile.set(m.profileId, []);
    byProfile.get(m.profileId)!.push(m.lengthMm);
  }
  for (const [profileId, lengths] of byProfile) {
    lengths.sort((a, b) => b - a); // longest first
    const sticks: Array<{ remaining: number; pieces: number[] }> = [];
    for (const len of lengths) {
      const needed = len + kerfMm;
      let placed = false;
      for (const stick of sticks) {
        if (stick.remaining >= needed) {
          stick.pieces.push(len);
          stick.remaining -= needed;
          placed = true;
          break;
        }
      }
      if (!placed) {
        sticks.push({ remaining: standardStockLengthMm - needed, pieces: [len] });
      }
    }
    const assignments = sticks.flatMap((s, i) =>
      s.pieces.map(p => ({ stockIndex: i, lengthMm: p, remainingMm: s.remaining })),
    );
    const totalWaste = sticks.reduce((sum, s) => sum + s.remaining, 0);
    result.perProfile[profileId] = {
      sticksUsed: sticks.length,
      totalWasteMm: totalWaste,
      stickAssignments: assignments,
    };
    result.totalStocksUsed += sticks.length;
    result.totalWasteMm += totalWaste;
  }
  return result;
}
