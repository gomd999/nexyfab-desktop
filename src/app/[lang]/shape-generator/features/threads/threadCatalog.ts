/**
 * threadCatalog.ts — Wave 2 Phase 2 Track D5 (W5) thread catalog.
 *
 * Five thread-standard tables (seven series codes — BSP splits into parallel
 * + tapered) backing the `ThreadFeature` data model in `threadFeature.ts`.
 *
 * **Single source of truth.** Where a row also exists in the hole-standards
 * catalog (`holeStandards.iso.ts`, `holeStandards.uts.ts`,
 * `holeStandards.pipe.ts`) the thread row is **derived from** the hole row so
 * that pitch / tpi / nominal-diameter / tap-drill numerics never drift.
 * Cross-check tests in `__tests__/threadCatalog.test.ts` enforce this for
 * every overlapping designation.
 *
 * The hole-standards tables cover the most common sizes; this thread catalog
 * extends them with the larger pipe sizes (NPT 3/4 through 2, BSP 3/4 through
 * 2) and the larger ISO M series (M22-M64) that hole-standards does not list.
 * Augmented rows carry a comment marker (`// augmented`) so future audits can
 * tell apart "extracted from holeStandards" vs "added for thread spec only".
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §2-§6 (taxonomy + numerics) and
 * §15 W5 (this PR's scope: catalog + ThreadFeature + cosmetic stub only).
 *
 * What this file does NOT do (out of scope for D5):
 * - Helix path generation — already in `features/helix.ts` / `sketch3d/helix.ts`
 * - Geometric thread sweep — Phase 2 W7 picks this up via `occtSweepHelix`
 * - Drawing-callout pipeline — Phase 3
 */

import {
  ISO_METRIC,
  KS_B_0201_METRIC,
  UNC_INCH,
  UNF_INCH,
  NPT_PIPE,
  BSP_PIPE,
  type HoleStandardSpec,
} from '../holeStandards';

// ─── Series identifiers ─────────────────────────────────────────────────────

/**
 * Catalog series. Seven values: the five physical tables (ISO M coarse, ISO
 * M fine, UTS UNC, UTS UNF, NPT, BSP) plus the BSP split into parallel
 * (`G` thread) and tapered (`Rc` thread) because their thread-classes and
 * pipe-taper flag differ.
 *
 * The "5 tables" framing in the spec collapses BSP parallel+tapered into
 * one source table; we keep them split in the *series* axis so callers can
 * filter by tightness behaviour (parallel = O-ring seal, tapered = thread
 * interference seal).
 */
export type ThreadSeries =
  | 'ISO_M_COARSE'
  | 'ISO_M_FINE'
  | 'UNC'
  | 'UNF'
  | 'NPT'
  | 'BSP_PARALLEL'
  | 'BSP_TAPERED';

// ─── Row schema ─────────────────────────────────────────────────────────────

/**
 * Single catalog row. All distances in mm, all angles in degrees. Inch-origin
 * thread designations (UTS, NPT, BSP) keep their imperial name in
 * `designation` and carry both `pitch` (mm) and `tpi` (threads per inch).
 */
export interface ThreadStandardRow {
  series: ThreadSeries;
  /**
   * Canonical designation string as the user / drawing engine sees it.
   * Examples:
   *   ISO_M_COARSE   "M8"
   *   ISO_M_FINE     "M10×1.25"        (NB: the `×` is U+00D7, not `x`)
   *   UNC            "1/4-20 UNC"
   *   UNF            "1/4-28 UNF"
   *   NPT            "NPT 1/2"
   *   BSP_PARALLEL   "G 1/4"
   *   BSP_TAPERED    "Rc 1/4"
   */
  designation: string;
  /** Major (nominal) diameter, mm. */
  nominalDia: number;
  /** Pitch in mm. Always populated; for inch threads computed from tpi. */
  pitch: number;
  /** Threads per inch. Populated for UTS/NPT/BSP; for ISO computed from pitch. */
  tpi: number;
  /** Basic thread height H = (√3/2)·P for 60° V (ISO/UTS/NPT) — mm. BSP uses 55° Whitworth (see §6.3). */
  threadHeight: number;
  /** Pitch (effective) diameter d2 = D − 0.6495·P for 60° V threads — mm. */
  pitchDiameter: number;
  /** Minor (root) diameter for internal thread = D − 1.0825·P (ISO/UTS) or tabulated (pipe). */
  minorDiameter: number;
  /** Allowed tolerance classes per the series default (first entry = default). */
  classCandidates: readonly string[];
  /**
   * Taper geometry — present iff `isTapered` is true. `ratio` is the
   * diameter-change-per-unit-length (NPT/BSPT = 1/16 = 0.0625). `angle` is
   * the half-angle in degrees (1.7833°).
   */
  taper?: { ratio: number; angle: number };
  /** True for pipe-thread rows (NPT + all BSP). Affects callout formatting + BOM grouping. */
  isPipe: boolean;
  /** True iff this row describes a tapered thread (NPT + BSP_TAPERED). */
  isTapered: boolean;
  /**
   * Recommended tap drill for internal thread, mm. Same value as the hole-
   * standards `tapDrill` field for cross-referenced rows.
   */
  tapDrill: number;
  /**
   * Optional engagement lengths for pipe threads (ANSI/ASME B1.20.1 L1/L2).
   *   L1 = hand-tight engagement (mm)
   *   L2 = effective engagement / wrench-tight (mm)
   */
  engagement?: { L1: number; L2: number };
}

// ─── Geometry helpers (60° V profile / Whitworth 55°) ───────────────────────

/** Basic thread height for 60° V (ISO M + UTS). H = (√3 / 2) · P. */
function threadHeight60(pitchMm: number): number {
  return +((Math.sqrt(3) / 2) * pitchMm).toFixed(4);
}

/** Basic thread height for 55° Whitworth (BSP / Whitworth threads). H = P · cos(27.5°) / 2 · 2. */
function threadHeight55(pitchMm: number): number {
  // Whitworth basic profile height = pitch · 0.96049 (cos 27.5° / tan 27.5° · etc.).
  // Standard reference value: H = 0.960491 · P.
  return +(0.960491 * pitchMm).toFixed(4);
}

/** Pitch diameter d2 for 60° V: d2 = D − 0.6495·P. */
function pitchDia60(nominalDia: number, pitchMm: number): number {
  return +(nominalDia - 0.6495 * pitchMm).toFixed(4);
}

/** Pitch diameter for 55° Whitworth: d2 = D − 0.640327·P. */
function pitchDia55(nominalDia: number, pitchMm: number): number {
  return +(nominalDia - 0.640327 * pitchMm).toFixed(4);
}

/** Internal minor diameter for 60° V (basic): D1 = D − 1.0825·P. */
function minorDia60(nominalDia: number, pitchMm: number): number {
  return +(nominalDia - 1.0825 * pitchMm).toFixed(4);
}

// Note: `minorDia55` (D1 = D − 1.280654·P) is intentionally NOT defined here.
// Pipe-thread minor diameters are tabulated from the recommended tap drill
// rather than computed from the Whitworth formula, because the spec ships
// the same minor diameter for parallel + tapered pipe threads.

// ─── Pitch ↔ TPI conversions ────────────────────────────────────────────────

/**
 * Convert thread pitch (mm) to threads per inch (TPI). `tpi = 25.4 / pitch_mm`.
 * Returns `Infinity` for pitch ≤ 0 — callers should guard, but we never throw
 * because catalog construction wraps every row in defensive helpers.
 */
export function pitchToTpi(pitchMm: number): number {
  if (pitchMm <= 0) return Infinity;
  return +(25.4 / pitchMm).toFixed(4);
}

/** Convert threads per inch (TPI) to thread pitch in mm. `pitch_mm = 25.4 / tpi`. */
export function tpiToPitch(tpi: number): number {
  if (tpi <= 0) return Infinity;
  return +(25.4 / tpi).toFixed(4);
}

// ─── Default tolerance classes per series ───────────────────────────────────

/**
 * Default tolerance class for the **internal** thread of each series. Per the
 * spec §3.3 / `wave-2-phase-2-threads-spec.md`:
 *   ISO M (coarse + fine)  internal=6H  external=6g
 *   UTS UNC / UNF           internal=2B  external=2A
 *   NPT                     "A" (taper class — single class)
 *   BSP_PARALLEL            "B" (medium fit per ISO 228)
 *   BSP_TAPERED             "Rc" class — no separate fit class
 */
const DEFAULT_CLASS_BY_SERIES: Record<ThreadSeries, string> = {
  ISO_M_COARSE: '6H',
  ISO_M_FINE: '6H',
  UNC: '2B',
  UNF: '2B',
  NPT: 'A',
  BSP_PARALLEL: 'B',
  BSP_TAPERED: 'Rc',
};

/**
 * Class candidates per series — ordered so the **first entry is the default**.
 * The wizard dropdown surfaces this list filtered by internal/external.
 */
const CLASS_CANDIDATES_BY_SERIES: Record<ThreadSeries, readonly string[]> = {
  ISO_M_COARSE: ['6H', '7H', '5H', '4H', '6g', '6e', '6f'],
  ISO_M_FINE: ['6H', '7H', '5H', '4H', '6g', '6e', '6f'],
  UNC: ['2B', '3B', '1B', '2A', '3A', '1A'],
  UNF: ['2B', '3B', '1B', '2A', '3A', '1A'],
  NPT: ['A'],
  BSP_PARALLEL: ['B', 'A'],
  BSP_TAPERED: ['Rc'],
};

/** Public lookup — returns the recommended default class for the given series. */
export function defaultThreadClass(series: ThreadSeries): string {
  return DEFAULT_CLASS_BY_SERIES[series];
}

// ─── Derivation helpers (hole-standards row → thread row) ───────────────────

/**
 * Build an ISO M row from a hole-standards spec. Re-uses pitch + nominal so
 * the two catalogs stay in lock-step.
 */
function fromIsoHoleRow(
  spec: HoleStandardSpec,
  series: 'ISO_M_COARSE' | 'ISO_M_FINE',
): ThreadStandardRow {
  const pitch = spec.pitch!;
  return {
    series,
    designation: spec.name,
    nominalDia: spec.nominal,
    pitch,
    tpi: pitchToTpi(pitch),
    threadHeight: threadHeight60(pitch),
    pitchDiameter: pitchDia60(spec.nominal, pitch),
    minorDiameter: minorDia60(spec.nominal, pitch),
    classCandidates: CLASS_CANDIDATES_BY_SERIES[series],
    isPipe: false,
    isTapered: false,
    tapDrill: spec.tapDrill,
  };
}

/**
 * Build a UTS row (UNC / UNF) from a hole-standards spec. Inch threads:
 * pitch = 25.4 / tpi.
 */
function fromUtsHoleRow(spec: HoleStandardSpec, series: 'UNC' | 'UNF'): ThreadStandardRow {
  const tpi = spec.tpi!;
  const pitch = tpiToPitch(tpi);
  // Inch designations carry the trailing series tag for unambiguity in the
  // callout. The hole-standards `name` is e.g. "1/4-20"; we add " UNC".
  const designation = spec.name.includes('UNC') || spec.name.includes('UNF')
    ? spec.name
    : `${spec.name} ${series}`;
  return {
    series,
    designation,
    nominalDia: spec.nominal,
    pitch,
    tpi,
    threadHeight: threadHeight60(pitch),
    pitchDiameter: pitchDia60(spec.nominal, pitch),
    minorDiameter: minorDia60(spec.nominal, pitch),
    classCandidates: CLASS_CANDIDATES_BY_SERIES[series],
    isPipe: false,
    isTapered: false,
    tapDrill: spec.tapDrill,
  };
}

/** NPT taper geometry — 1:16 ratio, half-angle 1.7833°. */
const NPT_TAPER = Object.freeze({ ratio: 1 / 16, angle: 1.7833 });
/** BSPT (Rc/R) taper geometry — 1:16 ratio, half-angle 1.7833°. */
const BSPT_TAPER = NPT_TAPER;

/**
 * Build an NPT row from a hole-standards pipe spec. NPT minor diameter is
 * tabulated (not D − 1.0825·P) because the cone makes that formula misleading;
 * we use the recommended tap drill as the minor (≡ internal-thread root at L1).
 */
function fromNptHoleRow(spec: HoleStandardSpec, engagement: { L1: number; L2: number }): ThreadStandardRow {
  const tpi = spec.tpi!;
  const pitch = tpiToPitch(tpi);
  return {
    series: 'NPT',
    designation: spec.name,
    nominalDia: spec.nominal,
    pitch,
    tpi,
    threadHeight: threadHeight60(pitch),
    pitchDiameter: pitchDia60(spec.nominal, pitch),
    minorDiameter: spec.tapDrill,
    classCandidates: CLASS_CANDIDATES_BY_SERIES.NPT,
    taper: { ...NPT_TAPER },
    isPipe: true,
    isTapered: true,
    tapDrill: spec.tapDrill,
    engagement,
  };
}

/**
 * Build a BSP parallel (G-thread) row from the hole-standards pipe spec.
 * Whitworth 55° — uses `threadHeight55` / `pitchDia55` / `minorDia55`.
 */
function fromBspParallelHoleRow(spec: HoleStandardSpec): ThreadStandardRow {
  const pitch = spec.pitch!;
  return {
    series: 'BSP_PARALLEL',
    designation: spec.name, // e.g. "G 1/4"
    nominalDia: spec.nominal,
    pitch,
    tpi: pitchToTpi(pitch),
    threadHeight: threadHeight55(pitch),
    pitchDiameter: pitchDia55(spec.nominal, pitch),
    minorDiameter: spec.tapDrill,
    classCandidates: CLASS_CANDIDATES_BY_SERIES.BSP_PARALLEL,
    isPipe: true,
    isTapered: false,
    tapDrill: spec.tapDrill,
  };
}

// BSP tapered rows are built by mapping BSP_PARALLEL_TABLE rows (same numerics,
// flipped `isTapered` + `Rc`-prefixed designation) — see `BSP_TAPERED_TABLE`
// below. We do not derive directly from a hole-standards row because the
// hole-standards catalog only carries BSP_PARALLEL (G-thread) rows.

// ─── ISO M COARSE ───────────────────────────────────────────────────────────

/**
 * ISO M coarse-pitch series. Extended from hole-standards `ISO_METRIC` (M3-M20)
 * with augmented rows M2 through M64 per spec §4. Pitches per ISO 261.
 */
export const ISO_M_COARSE_TABLE: readonly ThreadStandardRow[] = (() => {
  // Extracted rows from hole-standards (single source of truth for pitch/tapDrill)
  const fromHoleStandards = ISO_METRIC.filter((r) => r.pitch !== undefined).map((r) =>
    fromIsoHoleRow(r, 'ISO_M_COARSE'),
  );
  const extractedDesignations = new Set(fromHoleStandards.map((r) => r.designation));

  // Augmented rows for sizes outside the hole-standards range. Pitches verified
  // against KS B 0201 / ISO 261. Tap drills rounded up to nearest 0.05 mm.
  const augmented: Array<{ nominal: number; pitch: number; tapDrill: number }> = [
    { nominal: 2,    pitch: 0.40, tapDrill: 1.6  },
    { nominal: 2.5,  pitch: 0.45, tapDrill: 2.05 },
    { nominal: 7,    pitch: 1.00, tapDrill: 6.0  },
    { nominal: 14,   pitch: 2.00, tapDrill: 12.0 },
    { nominal: 18,   pitch: 2.50, tapDrill: 15.5 },
    { nominal: 22,   pitch: 2.50, tapDrill: 19.5 },
    { nominal: 24,   pitch: 3.00, tapDrill: 21.0 },
    { nominal: 27,   pitch: 3.00, tapDrill: 24.0 },
    { nominal: 30,   pitch: 3.50, tapDrill: 26.5 },
    { nominal: 33,   pitch: 3.50, tapDrill: 29.5 },
    { nominal: 36,   pitch: 4.00, tapDrill: 32.0 },
    { nominal: 39,   pitch: 4.00, tapDrill: 35.0 },
    { nominal: 42,   pitch: 4.50, tapDrill: 37.5 },
    { nominal: 45,   pitch: 4.50, tapDrill: 40.5 },
    { nominal: 48,   pitch: 5.00, tapDrill: 43.0 },
    { nominal: 52,   pitch: 5.00, tapDrill: 47.0 },
    { nominal: 56,   pitch: 5.50, tapDrill: 50.5 },
    { nominal: 60,   pitch: 5.50, tapDrill: 54.5 },
    { nominal: 64,   pitch: 6.00, tapDrill: 58.0 },
  ];
  const augmentedRows: ThreadStandardRow[] = augmented
    .map(({ nominal, pitch, tapDrill }): ThreadStandardRow => ({
      series: 'ISO_M_COARSE',
      designation: `M${nominal}`,
      nominalDia: nominal,
      pitch,
      tpi: pitchToTpi(pitch),
      threadHeight: threadHeight60(pitch),
      pitchDiameter: pitchDia60(nominal, pitch),
      minorDiameter: minorDia60(nominal, pitch),
      classCandidates: CLASS_CANDIDATES_BY_SERIES.ISO_M_COARSE,
      isPipe: false,
      isTapered: false,
      tapDrill,
    }))
    .filter((r) => !extractedDesignations.has(r.designation));

  return Object.freeze(
    [...fromHoleStandards, ...augmentedRows].sort((a, b) => a.nominalDia - b.nominalDia),
  );
})();

// ─── ISO M FINE ─────────────────────────────────────────────────────────────

/**
 * ISO M fine-pitch series. The fine-pitch rows in hole-standards
 * `KS_B_0201_METRIC` carry an `x` infix (e.g. `M8x1`). We rebuild their
 * designation with the canonical `×` (U+00D7) so the callout reads
 * "M8×1-6H" rather than "M8x1-6H".
 */
export const ISO_M_FINE_TABLE: readonly ThreadStandardRow[] = (() => {
  // Pull fine-pitch rows from KS_B_0201_METRIC.
  const fineRows = KS_B_0201_METRIC.filter((r) => r.name.includes('x'));
  return Object.freeze(
    fineRows.map((r): ThreadStandardRow => {
      const pitch = r.pitch!;
      // Rewrite "M8x1" → "M8×1"
      const designation = r.name.replace(/x/, '×');
      return {
        series: 'ISO_M_FINE',
        designation,
        nominalDia: r.nominal,
        pitch,
        tpi: pitchToTpi(pitch),
        threadHeight: threadHeight60(pitch),
        pitchDiameter: pitchDia60(r.nominal, pitch),
        minorDiameter: minorDia60(r.nominal, pitch),
        classCandidates: CLASS_CANDIDATES_BY_SERIES.ISO_M_FINE,
        isPipe: false,
        isTapered: false,
        tapDrill: r.tapDrill,
      };
    }),
  );
})();

// ─── UTS UNC ────────────────────────────────────────────────────────────────

/**
 * Unified Thread Standard — Coarse (UNC). Extracted directly from hole-
 * standards `UNC_INCH`.
 */
export const UNC_TABLE: readonly ThreadStandardRow[] = Object.freeze(
  UNC_INCH.map((r) => fromUtsHoleRow(r, 'UNC')),
);

// ─── UTS UNF ────────────────────────────────────────────────────────────────

/** Unified Thread Standard — Fine (UNF). Extracted from `UNF_INCH`. */
export const UNF_TABLE: readonly ThreadStandardRow[] = Object.freeze(
  UNF_INCH.map((r) => fromUtsHoleRow(r, 'UNF')),
);

// ─── NPT ────────────────────────────────────────────────────────────────────

/**
 * NPT — National Pipe Taper (ANSI/ASME B1.20.1). Engagement lengths (L1 / L2)
 * are from the printed standard and used by Phase 2 W7 to set the default
 * thread length for geometric mode (= L1 + 3 turns wrench-tight).
 */
const NPT_ENGAGEMENT: Record<string, { L1: number; L2: number }> = {
  'NPT 1/16': { L1: 4.10, L2: 6.86 },
  'NPT 1/8':  { L1: 4.10, L2: 6.86 },
  'NPT 1/4':  { L1: 5.79, L2: 10.21 },
  'NPT 3/8':  { L1: 6.10, L2: 10.36 },
  'NPT 1/2':  { L1: 8.13, L2: 13.56 },
  'NPT 3/4':  { L1: 8.61, L2: 13.86 },
  'NPT 1':    { L1: 10.16, L2: 17.34 },
  'NPT 1-1/4':{ L1: 10.67, L2: 17.95 },
  'NPT 1-1/2':{ L1: 10.67, L2: 18.38 },
  'NPT 2':    { L1: 11.07, L2: 19.22 },
};

export const NPT_TABLE: readonly ThreadStandardRow[] = (() => {
  const fromHoleStandards = NPT_PIPE.map((r) => fromNptHoleRow(r, NPT_ENGAGEMENT[r.name]!));
  const extractedDesignations = new Set(fromHoleStandards.map((r) => r.designation));

  // Augmented rows — sizes beyond hole-standards (NPT 3/4 through 2). Tap
  // drills from Machinery's Handbook / ASME B1.20.1 standard pipe-tap chart.
  const augmented: Array<{ name: string; nominal: number; tpi: number; tapDrill: number }> = [
    { name: 'NPT 3/4',   nominal: 26.670, tpi: 14,   tapDrill: 23.10 },
    { name: 'NPT 1',     nominal: 33.401, tpi: 11.5, tapDrill: 28.95 },
    { name: 'NPT 1-1/4', nominal: 42.164, tpi: 11.5, tapDrill: 37.30 },
    { name: 'NPT 1-1/2', nominal: 48.260, tpi: 11.5, tapDrill: 43.30 },
    { name: 'NPT 2',     nominal: 60.325, tpi: 11.5, tapDrill: 55.10 },
  ];
  const augmentedRows: ThreadStandardRow[] = augmented
    .filter((r) => !extractedDesignations.has(r.name))
    .map(({ name, nominal, tpi, tapDrill }): ThreadStandardRow => {
      const pitch = tpiToPitch(tpi);
      return {
        series: 'NPT',
        designation: name,
        nominalDia: nominal,
        pitch,
        tpi,
        threadHeight: threadHeight60(pitch),
        pitchDiameter: pitchDia60(nominal, pitch),
        minorDiameter: tapDrill,
        classCandidates: CLASS_CANDIDATES_BY_SERIES.NPT,
        taper: { ...NPT_TAPER },
        isPipe: true,
        isTapered: true,
        tapDrill,
        engagement: NPT_ENGAGEMENT[name]!,
      };
    });

  return Object.freeze([...fromHoleStandards, ...augmentedRows]);
})();

// ─── BSP PARALLEL (G-thread) ────────────────────────────────────────────────

/**
 * BSP parallel (G-thread, ISO 228). Augmented rows G 3/4 through G 2 use
 * the published Whitworth 55° pitches.
 */
export const BSP_PARALLEL_TABLE: readonly ThreadStandardRow[] = (() => {
  const fromHoleStandards = BSP_PIPE.map(fromBspParallelHoleRow);
  const extractedDesignations = new Set(fromHoleStandards.map((r) => r.designation));

  const augmented: Array<{ name: string; nominal: number; pitch: number; tapDrill: number }> = [
    { name: 'G 3/4', nominal: 26.441, pitch: 1.814, tapDrill: 24.50 },
    { name: 'G 1',   nominal: 33.249, pitch: 2.309, tapDrill: 30.75 },
    { name: 'G 1-1/4', nominal: 41.910, pitch: 2.309, tapDrill: 39.50 },
    { name: 'G 1-1/2', nominal: 47.803, pitch: 2.309, tapDrill: 45.25 },
    { name: 'G 2',   nominal: 59.614, pitch: 2.309, tapDrill: 57.25 },
  ];
  const augmentedRows: ThreadStandardRow[] = augmented
    .filter((r) => !extractedDesignations.has(r.name))
    .map(({ name, nominal, pitch, tapDrill }): ThreadStandardRow => ({
      series: 'BSP_PARALLEL',
      designation: name,
      nominalDia: nominal,
      pitch,
      tpi: pitchToTpi(pitch),
      threadHeight: threadHeight55(pitch),
      pitchDiameter: pitchDia55(nominal, pitch),
      minorDiameter: tapDrill,
      classCandidates: CLASS_CANDIDATES_BY_SERIES.BSP_PARALLEL,
      isPipe: true,
      isTapered: false,
      tapDrill,
    }));

  return Object.freeze([...fromHoleStandards, ...augmentedRows]);
})();

// ─── BSP TAPERED (Rc-thread) ────────────────────────────────────────────────

/**
 * BSP tapered (Rc-thread internal / R-thread external, ISO 7). Same nominal
 * sizes + pitches as parallel BSP, with the 1:16 taper added.
 */
export const BSP_TAPERED_TABLE: readonly ThreadStandardRow[] = Object.freeze(
  BSP_PARALLEL_TABLE.map((r) => ({
    ...r,
    series: 'BSP_TAPERED' as const,
    designation: r.designation.replace(/^G /, 'Rc '),
    classCandidates: CLASS_CANDIDATES_BY_SERIES.BSP_TAPERED,
    taper: { ...BSPT_TAPER },
    isTapered: true,
  })),
);

// ─── Top-level catalog ──────────────────────────────────────────────────────

/** All-series lookup, keyed by series identifier. */
export const THREAD_CATALOG: Readonly<Record<ThreadSeries, readonly ThreadStandardRow[]>> =
  Object.freeze({
    ISO_M_COARSE: ISO_M_COARSE_TABLE,
    ISO_M_FINE: ISO_M_FINE_TABLE,
    UNC: UNC_TABLE,
    UNF: UNF_TABLE,
    NPT: NPT_TABLE,
    BSP_PARALLEL: BSP_PARALLEL_TABLE,
    BSP_TAPERED: BSP_TAPERED_TABLE,
  });

/** Flat list of every row across every series (for full-text lookup / smoke tests). */
export const ALL_THREAD_ROWS: readonly ThreadStandardRow[] = Object.freeze([
  ...ISO_M_COARSE_TABLE,
  ...ISO_M_FINE_TABLE,
  ...UNC_TABLE,
  ...UNF_TABLE,
  ...NPT_TABLE,
  ...BSP_PARALLEL_TABLE,
  ...BSP_TAPERED_TABLE,
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Find a single row by (series, designation). Returns `null` (not undefined)
 * so call sites can safely `??`-fallback to a UI-friendly default.
 */
export function findThreadRow(
  series: ThreadSeries,
  designation: string,
): ThreadStandardRow | null {
  const table = THREAD_CATALOG[series];
  return table.find((r) => r.designation === designation) ?? null;
}

/** All rows in a given series. Returns the frozen array directly — do not mutate. */
export function allRowsInSeries(series: ThreadSeries): readonly ThreadStandardRow[] {
  return THREAD_CATALOG[series];
}

/**
 * Cross-series fuzzy lookup — tries every series in order until a row matches.
 * Useful for callout parsing where the series isn't known up front (e.g. the
 * user types "M8" into a free-form field).
 */
export function findThreadRowAnySeries(designation: string): ThreadStandardRow | null {
  for (const series of Object.keys(THREAD_CATALOG) as ThreadSeries[]) {
    const row = findThreadRow(series, designation);
    if (row) return row;
  }
  return null;
}
