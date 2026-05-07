// ─── GD&T (Geometric Dimensioning & Tolerancing) Types ──────────────────────

export type GDTSymbol =
  | 'straightness'
  | 'flatness'
  | 'circularity'
  | 'cylindricity'
  | 'perpendicularity'
  | 'parallelism'
  | 'angularity'
  | 'position'
  | 'concentricity'
  | 'symmetry'
  | 'runout'
  | 'totalRunout'
  | 'profileLine'
  | 'profileSurface';

export interface GDTAnnotation {
  id: string;
  symbol: GDTSymbol;
  tolerance: number;      // mm
  datum?: string;          // e.g., "A", "B"  (legacy single-datum shorthand)
  position: [number, number, number]; // 3D anchor point
  label?: string;
  /** Optional full Feature Control Frame — when set, supersedes `datum` + simple tolerance. */
  fcf?: FeatureControlFrame;
}

// ─── Feature Control Frame (ASME Y14.5 / ISO 1101) ───────────────────────────

/** Material condition modifier */
export type MaterialCondition =
  | 'MMC'  // Ⓜ — Maximum Material Condition
  | 'LMC'  // Ⓛ — Least Material Condition
  | 'RFS'; // Regardless of Feature Size (no modifier)

export const MATERIAL_CONDITION_SYMBOL: Record<MaterialCondition, string> = {
  MMC: 'Ⓜ',
  LMC: 'Ⓛ',
  RFS: '',
};

/** Datum reference with optional material condition — one cell of an FCF */
export interface DatumReference {
  letter: string;            // "A", "B", "A-B", etc.
  modifier?: MaterialCondition;
}

/** Tolerance zone modifiers */
export type ZoneModifier =
  | 'diameter'        // Ø — cylindrical zone
  | 'spherical'       // SØ — spherical zone
  | 'projected'       // Ⓟ — projected tolerance zone
  | 'free';           // Ⓕ — free state (non-rigid parts)

export const ZONE_MODIFIER_SYMBOL: Record<ZoneModifier, string> = {
  diameter:  'Ø',
  spherical: 'SØ',
  projected: 'Ⓟ',
  free:      'Ⓕ',
};

/** Full Feature Control Frame — e.g. ⊕ | Ø0.05 Ⓜ | A | B Ⓜ | C */
export interface FeatureControlFrame {
  symbol: GDTSymbol;
  toleranceValue: number;          // mm
  zoneModifier?: ZoneModifier;
  materialCondition?: MaterialCondition;   // applies to the tolerance value
  primary?: DatumReference;
  secondary?: DatumReference;
  tertiary?: DatumReference;
  /** Composite FCF second row (e.g. pattern location tolerance) */
  composite?: {
    toleranceValue: number;
    zoneModifier?: ZoneModifier;
    primary?: DatumReference;
    secondary?: DatumReference;
    tertiary?: DatumReference;
  };
}

/** Format an FCF as ISO 1101 / ASME Y14.5 style string */
export function formatFCF(fcf: FeatureControlFrame): string {
  const cell = (z: ZoneModifier | undefined, t: number, m: MaterialCondition | undefined) => {
    const zs = z ? ZONE_MODIFIER_SYMBOL[z] + ' ' : '';
    const ms = m && m !== 'RFS' ? ' ' + MATERIAL_CONDITION_SYMBOL[m] : '';
    return `${zs}${t}${ms}`;
  };
  const datumCell = (d: DatumReference | undefined) => {
    if (!d) return '';
    const ms = d.modifier && d.modifier !== 'RFS' ? ' ' + MATERIAL_CONDITION_SYMBOL[d.modifier] : '';
    return `${d.letter}${ms}`;
  };
  const parts = [
    GDT_SYMBOLS[fcf.symbol],
    cell(fcf.zoneModifier, fcf.toleranceValue, fcf.materialCondition),
  ];
  if (fcf.primary) parts.push(datumCell(fcf.primary));
  if (fcf.secondary) parts.push(datumCell(fcf.secondary));
  if (fcf.tertiary) parts.push(datumCell(fcf.tertiary));
  const main = parts.filter(Boolean).map((s) => s).join(' | ');
  if (!fcf.composite) return `| ${main} |`;

  const compParts = [
    GDT_SYMBOLS[fcf.symbol],
    cell(fcf.composite.zoneModifier, fcf.composite.toleranceValue, undefined),
  ];
  if (fcf.composite.primary) compParts.push(datumCell(fcf.composite.primary));
  if (fcf.composite.secondary) compParts.push(datumCell(fcf.composite.secondary));
  if (fcf.composite.tertiary) compParts.push(datumCell(fcf.composite.tertiary));
  return `| ${main} |\n| ${compParts.filter(Boolean).join(' | ')} |`;
}

export interface DimensionAnnotation {
  id: string;
  type: 'linear' | 'angular' | 'radial' | 'diameter';
  value: number;
  tolerance?: { upper: number; lower: number }; // ±tolerance
  position: [number, number, number];
  direction: [number, number, number]; // measurement direction
  label?: string;
}

// GD&T symbol unicode characters (ISO 1101 style)
export const GDT_SYMBOLS: Record<GDTSymbol, string> = {
  straightness: '⏤',
  flatness: '⏥',
  circularity: '○',
  cylindricity: '⌭',
  perpendicularity: '⊥',
  parallelism: '∥',
  angularity: '∠',
  position: '⊕',
  concentricity: '◎',
  symmetry: '⌯',
  runout: '↗',
  totalRunout: '↗↗',
  profileLine: '⌒',
  profileSurface: '⌓',
};

// Human-readable names for each symbol (en / ko)
export const GDT_SYMBOL_NAMES: Record<GDTSymbol, { en: string; ko: string }> = {
  straightness:     { en: 'Straightness',      ko: '직진도' },
  flatness:         { en: 'Flatness',          ko: '평면도' },
  circularity:      { en: 'Circularity',       ko: '진원도' },
  cylindricity:     { en: 'Cylindricity',      ko: '원통도' },
  perpendicularity: { en: 'Perpendicularity',  ko: '직각도' },
  parallelism:      { en: 'Parallelism',       ko: '평행도' },
  angularity:       { en: 'Angularity',        ko: '경사도' },
  position:         { en: 'Position',          ko: '위치도' },
  concentricity:    { en: 'Concentricity',     ko: '동심도' },
  symmetry:         { en: 'Symmetry',          ko: '대칭도' },
  runout:           { en: 'Runout',            ko: '흔들림' },
  totalRunout:      { en: 'Total Runout',      ko: '온흔들림' },
  profileLine:      { en: 'Profile of a Line', ko: '선의 윤곽도' },
  profileSurface:   { en: 'Profile of a Surface', ko: '면의 윤곽도' },
};

// GD&T symbol category groupings
export const GDT_CATEGORIES = {
  form:        ['straightness', 'flatness', 'circularity', 'cylindricity'] as GDTSymbol[],
  orientation: ['perpendicularity', 'parallelism', 'angularity'] as GDTSymbol[],
  location:    ['position', 'concentricity', 'symmetry'] as GDTSymbol[],
  runout:      ['runout', 'totalRunout'] as GDTSymbol[],
  profile:     ['profileLine', 'profileSurface'] as GDTSymbol[],
};

// ─── Surface Roughness (ISO 1302) ────────────────────────────────────────────

/** ISO roughness grade: N1 (Ra 0.025 µm, mirror) → N12 (Ra 50 µm, rough cast) */
export type SurfaceRoughnessGrade =
  'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6' |
  'N7' | 'N8' | 'N9' | 'N10' | 'N11' | 'N12';

/** Ra value (µm) for each roughness grade */
export const ROUGHNESS_RA: Record<SurfaceRoughnessGrade, number> = {
  N1: 0.025, N2: 0.05, N3: 0.1,  N4: 0.2,  N5: 0.4,  N6: 0.8,
  N7: 1.6,   N8: 3.2,  N9: 6.3, N10: 12.5, N11: 25,  N12: 50,
};

/** Typical Rz ≈ 4×Ra */
export const ROUGHNESS_RZ: Record<SurfaceRoughnessGrade, number> = {
  N1: 0.1, N2: 0.2, N3: 0.4, N4: 0.8, N5: 1.6, N6: 3.2,
  N7: 6.3, N8: 12.5, N9: 25, N10: 50, N11: 100, N12: 200,
};

export type MachiningProcess =
  | 'turning' | 'milling' | 'grinding' | 'reaming'
  | 'drilling' | 'casting' | 'forging' | 'EDM' | 'lapping' | 'honing';

/** ISO 1302 material removal requirement symbol */
export type MaterialRemoval = 'required' | 'prohibited' | 'either';

export interface SurfaceRoughnessAnnotation {
  id: string;
  grade: SurfaceRoughnessGrade;
  ra?: number;                        // µm — overrides grade if set
  rz?: number;                        // µm — optional
  machiningProcess?: MachiningProcess;
  materialRemoval: MaterialRemoval;   // ISO 1302: required/prohibited/either
  position: [number, number, number]; // 3D anchor point
  normal?: [number, number, number];  // surface normal direction
  label?: string;
}

export const MATERIAL_REMOVAL_SYMBOL: Record<MaterialRemoval, string> = {
  required:   '√',   // triangle with bar — machining required
  prohibited: '○',   // circle — no machining (as-cast/forged)
  either:     '◇',   // diamond — any process
};

export const MACHINING_PROCESS_NAMES: Record<MachiningProcess, { en: string; ko: string }> = {
  turning:  { en: 'Turning',   ko: '선삭' },
  milling:  { en: 'Milling',   ko: '밀링' },
  grinding: { en: 'Grinding',  ko: '연삭' },
  reaming:  { en: 'Reaming',   ko: '리밍' },
  drilling: { en: 'Drilling',  ko: '드릴링' },
  casting:  { en: 'Casting',   ko: '주조' },
  forging:  { en: 'Forging',   ko: '단조' },
  EDM:      { en: 'EDM',       ko: '방전가공' },
  lapping:  { en: 'Lapping',   ko: '래핑' },
  honing:   { en: 'Honing',    ko: '호닝' },
};

/** Typical Ra grades achievable per process */
export const PROCESS_TYPICAL_GRADES: Record<MachiningProcess, SurfaceRoughnessGrade[]> = {
  lapping:   ['N1','N2','N3','N4'],
  honing:    ['N3','N4','N5'],
  grinding:  ['N4','N5','N6','N7'],
  reaming:   ['N5','N6','N7'],
  turning:   ['N6','N7','N8'],
  milling:   ['N6','N7','N8','N9'],
  drilling:  ['N8','N9','N10'],
  EDM:       ['N5','N6','N7','N8'],
  casting:   ['N10','N11','N12'],
  forging:   ['N9','N10','N11'],
};

// ─── Thread & Hole Callout (ISO 724, ISO 261) ────────────────────────────────

export type ThreadStandard = 'metric' | 'inch_unc' | 'inch_unf' | 'bsp' | 'npt';
export type ThreadType = 'external' | 'internal';
export type ThreadFit = '6g' | '6H' | '5g6g' | '4h' | '7H' | '6e' | '6f' | 'freefit';

export interface ThreadCallout {
  id: string;
  standard: ThreadStandard;
  type: ThreadType;
  nominalDiameter: number;  // mm for metric, inches for others
  pitch: number;             // mm for metric, TPI for inch
  depth?: number;            // threaded depth in mm
  fit?: ThreadFit;
  position: [number, number, number];
  normal?: [number, number, number];
  label?: string;            // auto-generated if not set
}

export type HoleType = 'thru' | 'blind' | 'counterbore' | 'countersink' | 'spotface';

export interface HoleCallout {
  id: string;
  holeType: HoleType;
  diameter: number;          // mm
  depth?: number;            // mm (blind holes)
  cbDiameter?: number;       // counterbore/spotface diameter
  cbDepth?: number;          // counterbore/spotface depth
  csDiameter?: number;       // countersink diameter
  csAngle?: number;          // countersink angle (usually 82° or 90°)
  thread?: Omit<ThreadCallout, 'id' | 'position' | 'normal'>; // optional threaded hole
  position: [number, number, number];
  normal?: [number, number, number];
  label?: string;
}

/** Standard metric thread pitches (M2–M100 coarse) */
export const METRIC_COARSE_PITCHES: Record<number, number> = {
  2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25,
  10: 1.5, 12: 1.75, 14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5,
  24: 3.0, 27: 3.0, 30: 3.5, 36: 4.0, 42: 4.5, 48: 5.0, 56: 5.5,
  64: 6.0, 72: 6.0, 80: 6.0, 90: 6.0, 100: 6.0,
};

/** Generate ISO thread callout string e.g. "M8×1.25-6H" */
export function formatThreadCallout(t: Pick<ThreadCallout, 'standard' | 'nominalDiameter' | 'pitch' | 'fit' | 'type' | 'depth'>): string {
  if (t.standard === 'metric') {
    const d = t.nominalDiameter;
    const p = t.pitch;
    const fit = t.fit ? `-${t.fit}` : '';
    const coarsePitch = METRIC_COARSE_PITCHES[d];
    const pitchStr = p === coarsePitch ? '' : `×${p}`;
    const depth = t.depth ? ` ${t.depth}↧` : '';
    return `M${d}${pitchStr}${fit}${depth}`;
  }
  if (t.standard === 'inch_unc' || t.standard === 'inch_unf') {
    return `${t.nominalDiameter}"-${t.pitch} ${t.standard === 'inch_unc' ? 'UNC' : 'UNF'}`;
  }
  if (t.standard === 'bsp') return `G${t.nominalDiameter}"`;
  if (t.standard === 'npt') return `${t.nominalDiameter}" NPT`;
  return `Ø${t.nominalDiameter}`;
}

/** Generate hole callout string e.g. "Ø10 THRU" or "⌴Ø14×8 / Ø8×20" */
export function formatHoleCallout(h: HoleCallout): string {
  const dia = `Ø${h.diameter}`;
  let result = dia;
  if (h.holeType === 'thru') result += ' THRU';
  else if (h.holeType === 'blind') result += h.depth ? ` ↧${h.depth}` : '';
  else if (h.holeType === 'counterbore') {
    result = `⌴Ø${h.cbDiameter ?? h.diameter * 1.5}↧${h.cbDepth ?? 5} / ${dia}${h.depth ? ` ↧${h.depth}` : ' THRU'}`;
  } else if (h.holeType === 'countersink') {
    result = `⌵Ø${h.csDiameter ?? h.diameter * 1.5}×${h.csAngle ?? 90}° / ${dia}${h.depth ? ` ↧${h.depth}` : ' THRU'}`;
  } else if (h.holeType === 'spotface') {
    result = `SF Ø${h.cbDiameter ?? h.diameter * 1.5}↧${h.cbDepth ?? 2} / ${dia}${h.depth ? ` ↧${h.depth}` : ' THRU'}`;
  }
  if (h.thread) result += ` ${formatThreadCallout(h.thread)}`;
  return result;
}

// ─── General Tolerance Block (ISO 2768) ───────────────────────────────────────

export type ISO2768Class = 'f' | 'm' | 'c' | 'v'; // fine, medium, coarse, very coarse

export interface GeneralToleranceBlock {
  linearClass: ISO2768Class;      // ISO 2768 linear tolerance class
  angularClass: ISO2768Class;     // ISO 2768 angular tolerance class
  geometricClass?: 'H' | 'K' | 'L'; // ISO 2768-2 geometric tolerance class
  note?: string;                  // e.g. "UNLESS OTHERWISE SPECIFIED"
}
