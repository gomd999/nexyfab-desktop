/**
 * STEP burn-in corpus — curated list of public CAD models for OCCT
 * regression detection. The 11-case feasibility suite catches synthetic
 * bugs; this corpus catches real-world failure modes (imported B-Reps
 * with self-intersections, ill-formed B-spline surfaces, large face
 * counts, OCCT-specific tolerance edge cases) that only show up on
 * customer files.
 *
 * **Seed list is intentionally small (10 entries).** Curation cost is
 * the bottleneck — each URL must be verified to be public-domain or
 * permissively-licensed, must stay stable (no CDN expiry), and must
 * have known expected metrics (so a regression can be detected against
 * a fixed baseline). Expand 50 / 100 / 500 in follow-up PRs as new
 * trustworthy sources are found.
 *
 * **Source criteria:**
 *  1. Publicly hosted, no auth required.
 *  2. Permissive license (CC0, MIT, Apache, public domain) — checked
 *     and noted in `license` field.
 *  3. Stable URL (GitHub raw, not gallery viewer pages that rewrap).
 *  4. Under 5 MB — keeps cron run time bounded.
 *  5. Known good baseline — when first added, must import cleanly so
 *     a future regression is unambiguous.
 */

export interface BurninCorpusEntry {
  /** Stable identifier — never reused even if URL changes. */
  id: string;
  /** Human-readable label for the alert message. */
  label: string;
  /** Direct download URL. Must be a plain STEP/STP/IGES file. */
  url: string;
  /** SPDX-style license string for audit trail. */
  license: string;
  /** Source-of-origin URL for credit + future verification. */
  source: string;
  /** Approximate bytes — sanity check against the actual download. */
  expectedBytes?: number;
  /** Expected triangle count after tessellation — gates against the
   *  OCCT meshing layer silently dropping faces. */
  expectedTrianglesMin?: number;
  /** Difficulty band — 'simple' (basic primitives), 'medium' (mechanical
   *  parts), 'hard' (assemblies, surfaces). Lets the cron prioritise
   *  simple models when CI time is constrained. */
  difficulty: 'simple' | 'medium' | 'hard';
}

/**
 * Phase 1 seed corpus. All entries below are placeholders pending
 * verification of stable URLs + license. Replace with real curated
 * entries before enabling cron in production — the cron route will
 * skip entries marked with `url: 'TBD:*'` so this list is safe to ship.
 *
 * Procurement plan:
 *  - 10 entries from FreeCAD's example part library (LGPL)
 *  - 10 entries from KiCad 3D models (CC-BY-SA)
 *  - 20 entries from public CC0 mechanical part archives
 *  - 20 entries hand-picked from GrabCAD public models with permissive
 *    license tags (license must be verified per-model)
 *  - 40 entries from Onshape public documents exported by us with
 *    explicit author permission
 */
export const STEP_BURNIN_CORPUS: BurninCorpusEntry[] = [
  {
    id: 'freecad-bracket-001',
    label: 'FreeCAD example: L-bracket',
    url: 'TBD:freecad-bracket-001',
    license: 'LGPL-2.1',
    source: 'https://github.com/FreeCAD/FreeCAD',
    expectedBytes: 12_000,
    expectedTrianglesMin: 100,
    difficulty: 'simple',
  },
  {
    id: 'freecad-flange-001',
    label: 'FreeCAD example: pipe flange',
    url: 'TBD:freecad-flange-001',
    license: 'LGPL-2.1',
    source: 'https://github.com/FreeCAD/FreeCAD',
    expectedBytes: 45_000,
    expectedTrianglesMin: 400,
    difficulty: 'simple',
  },
  {
    id: 'freecad-gear-spur',
    label: 'FreeCAD example: spur gear',
    url: 'TBD:freecad-gear-spur',
    license: 'LGPL-2.1',
    source: 'https://github.com/FreeCAD/FreeCAD',
    expectedBytes: 180_000,
    expectedTrianglesMin: 2_000,
    difficulty: 'medium',
  },
  {
    id: 'kicad-conn-jst',
    label: 'KiCad 3D model: JST connector',
    url: 'TBD:kicad-conn-jst',
    license: 'CC-BY-SA-4.0',
    source: 'https://gitlab.com/kicad/libraries/kicad-packages3D',
    expectedBytes: 90_000,
    expectedTrianglesMin: 1_000,
    difficulty: 'medium',
  },
  {
    id: 'kicad-mcu-tqfp',
    label: 'KiCad 3D model: TQFP-64 IC',
    url: 'TBD:kicad-mcu-tqfp',
    license: 'CC-BY-SA-4.0',
    source: 'https://gitlab.com/kicad/libraries/kicad-packages3D',
    expectedBytes: 220_000,
    expectedTrianglesMin: 3_000,
    difficulty: 'medium',
  },
  {
    id: 'cc0-mech-housing',
    label: 'CC0 mechanical: motor housing',
    url: 'TBD:cc0-mech-housing',
    license: 'CC0-1.0',
    source: 'https://example.com/cc0-mechanical-archive',
    expectedBytes: 800_000,
    expectedTrianglesMin: 8_000,
    difficulty: 'hard',
  },
  {
    id: 'cc0-mech-pump-body',
    label: 'CC0 mechanical: pump body',
    url: 'TBD:cc0-mech-pump-body',
    license: 'CC0-1.0',
    source: 'https://example.com/cc0-mechanical-archive',
    expectedBytes: 1_400_000,
    expectedTrianglesMin: 12_000,
    difficulty: 'hard',
  },
  {
    id: 'self-shaft-collar',
    label: 'Self-authored: shaft collar (calibration)',
    url: 'TBD:self-shaft-collar',
    license: 'MIT',
    source: 'NexyFab internal',
    expectedBytes: 30_000,
    expectedTrianglesMin: 300,
    difficulty: 'simple',
  },
  {
    id: 'self-cnc-jig',
    label: 'Self-authored: CNC fixture jig',
    url: 'TBD:self-cnc-jig',
    license: 'MIT',
    source: 'NexyFab internal',
    expectedBytes: 220_000,
    expectedTrianglesMin: 2_500,
    difficulty: 'medium',
  },
  {
    id: 'self-sheet-enclosure',
    label: 'Self-authored: sheet-metal enclosure',
    url: 'TBD:self-sheet-enclosure',
    license: 'MIT',
    source: 'NexyFab internal',
    expectedBytes: 95_000,
    expectedTrianglesMin: 1_200,
    difficulty: 'medium',
  },
];

/** Entries whose URL has been verified and is ready to fetch. The cron
 *  route uses this list, not the full corpus, so unverified entries
 *  don't break the run. */
export const READY_BURNIN_ENTRIES = STEP_BURNIN_CORPUS.filter(
  e => !e.url.startsWith('TBD:'),
);
