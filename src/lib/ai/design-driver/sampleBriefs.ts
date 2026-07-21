/**
 * design-driver/sampleBriefs — Wave A · GA3 온보딩 재료.
 *
 * A curated set of machine-part briefs a design partner can try on the
 * design-brief surface. Two honest tiers, because "what a partner can try" and
 * "what the deterministic driver can verify TODAY" are different claims:
 *
 *   tier 'fixture'   — backed by a known FixtureKey (fixturePlanner). These run
 *                      end-to-end through runDesignDriver with NO LLM and every
 *                      gate green — the reproducible demo path. `fixtureKey` is
 *                      set and `brief.params.fixture` carries it.
 *   tier 'free-text' — extrude-family parts within the gates' coverage but with
 *                      NO fixture. Under the deterministic planner these are
 *                      REFUSED by design (계획 날조 금지) — they need the real
 *                      LLM planner (WA-D). They are shown so a partner sees the
 *                      shape of a real request, with the coverage we expect the
 *                      gates to enforce once a plan exists.
 *
 * This module consumes design-driver types only; it declares no geometry and no
 * gate logic of its own.
 */

import type { DesignBrief } from './types';
import type { FixtureKey } from './fixturePlanner';

export interface SampleBrief {
  /** Stable id for UI keys / test lookup. */
  id: string;
  /** Short human label for a menu row. */
  label: string;
  /** 'fixture' = deterministically verifiable now; 'free-text' = needs the LLM planner. */
  tier: 'fixture' | 'free-text';
  /** Set iff tier==='fixture' — the deterministic planner dispatch key. */
  fixtureKey?: FixtureKey;
  /** The brief handed to the driver. For fixture tier, params.fixture is set. */
  brief: DesignBrief;
  /**
   * What the gates are expected to enforce for this part — the honest coverage
   * statement (geometry volume basis, dimensions, DFM, assembly). Not a promise
   * the LLM will produce a passing plan; a statement of what verification means.
   */
  expectedCoverage: string;
}

/** A fixture-backed brief: params.fixture drives the deterministic planner. */
function fixtureBrief(
  id: string,
  fixtureKey: FixtureKey,
  label: string,
  text: string,
  expectedCoverage: string,
): SampleBrief {
  return {
    id,
    label,
    tier: 'fixture',
    fixtureKey,
    brief: { id, text, params: { fixture: fixtureKey } },
    expectedCoverage,
  };
}

/** A free-text brief: no fixture — the deterministic planner refuses it. */
function freeTextBrief(id: string, label: string, text: string, expectedCoverage: string): SampleBrief {
  return {
    id,
    label,
    tier: 'free-text',
    brief: { id, text },
    expectedCoverage,
  };
}

export const SAMPLE_BRIEFS: readonly SampleBrief[] = [
  // ── tier: fixture (deterministic, gates green end-to-end) ────────────────
  fixtureBrief(
    'sb-l-bracket',
    'l-bracket',
    'L-bracket (extrude)',
    'L-bracket, 60 × 40 mm legs, 8 mm thick, 20 mm deep. AL6061, CNC.',
    'geometry: exact L-profile prism volume (no tessellation); drawing: 5 measured dims (width/height/thickness/depth linear + 90° corner angular); DFM: CNC.',
  ),
  fixtureBrief(
    'sb-stepped-shaft',
    'stepped-shaft',
    'Stepped shaft (tessellated cylinders)',
    'Two-step round shaft, ⌀24 × 30 then ⌀16 × 25. S45C, turned.',
    'geometry: 24-gon tessellated-prism volume, deviation vs analytic πr²h stated (근사 명시); drawing: 2 diametric + 2 length dims measured off concyclic cap vertices; DFM: CNC.',
  ),
  fixtureBrief(
    'sb-pin-block',
    'pin-block-assembly',
    'Pin + block assembly (mates)',
    '40 mm cube block with a ⌀10 × 30 pin seated concentric on its top face.',
    'geometry: 2 parts (exact prism block + tessellated pin); assembly: concentric + coincident mates solved to residual ≤ tol; drawing: 4 dims; BOM: 2 rows.',
  ),

  // ── tier: free-text (extrude family; needs the LLM planner — WA-D) ───────
  freeTextBrief(
    'sb-mounting-plate',
    'Mounting plate',
    'Flat mounting plate 120 × 80 × 10 mm with four ⌀6.5 corner holes on a 100 × 60 pattern. AL6061.',
    'if a plan is produced: geometry gate checks the plate prism volume with a stated basis; drawing gate checks plate W/H/thickness and hole positions; DFM gate checks CNC. No fixture — deterministic planner refuses until the LLM plans it.',
  ),
  freeTextBrief(
    'sb-spacer-bushing',
    'Spacer bushing',
    'Cylindrical spacer bushing, ⌀20 outer, ⌀10 bore, 15 mm long. Brass.',
    'if a plan is produced: geometry gate checks a tessellated-annulus prism volume with the tessellation deviation stated; drawing gate checks outer ⌀, bore ⌀, length. Circular sections use polygon-tessellated extrudes (revolve has no topo-name builder yet — 한계). No fixture.',
  ),
  freeTextBrief(
    'sb-rib-bracket',
    'Ribbed angle bracket',
    'Right-angle bracket 50 × 50 mm, 6 mm wall, with a triangular gusset rib; two ⌀5 fixing holes per leg. Steel, laser-cut + bent.',
    'if a plan is produced: geometry gate on the extruded L + rib volume; drawing gate on leg lengths / wall / hole spacing; DFM gate on the sheet-metal process. Bend/forming limits are NOT modelled by the current gates (한계 고지). No fixture.',
  ),
] as const;

/** All fixture-backed sample briefs — the deterministic demo set. */
export const FIXTURE_SAMPLE_BRIEFS: readonly SampleBrief[] = SAMPLE_BRIEFS.filter(
  (s): s is SampleBrief & { fixtureKey: FixtureKey } => s.tier === 'fixture',
);

/** Lookup by id. */
export function getSampleBrief(id: string): SampleBrief | undefined {
  return SAMPLE_BRIEFS.find((s) => s.id === id);
}
