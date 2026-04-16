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
  datum?: string;          // e.g., "A", "B"
  position: [number, number, number]; // 3D anchor point
  label?: string;
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

// ─── General Tolerance Block (ISO 2768) ───────────────────────────────────────

export type ISO2768Class = 'f' | 'm' | 'c' | 'v'; // fine, medium, coarse, very coarse

export interface GeneralToleranceBlock {
  linearClass: ISO2768Class;      // ISO 2768 linear tolerance class
  angularClass: ISO2768Class;     // ISO 2768 angular tolerance class
  geometricClass?: 'H' | 'K' | 'L'; // ISO 2768-2 geometric tolerance class
  note?: string;                  // e.g. "UNLESS OTHERWISE SPECIFIED"
}
