/**
 * verifyChainCoverage.test.ts — Regression coverage for the 8-layer SCAD AI
 * self-check chain inside `verifyAgainstSpec`.
 *
 * Goal: prove that each layer (X1 bbox, X2/X4 hole count, X3 volume,
 * X5 surface area, X6/X7 hole position, X8 fillet, X9 thread,
 * X10 intent self-consistency) catches the failure mode it owns AND
 * does not falsely trip the OTHER layers ("cross-contamination" check).
 *
 * Each describe block tests one layer with two cases:
 *   1. happy path — clean intent + matching detections → ok=true, that layer's
 *      sub-field has no mismatch.
 *   2. trigger path — surgically crafted failure that ONLY that layer should
 *      catch. Asserts the relevant sub-field reports a mismatch and asserts
 *      every other sub-field is either skipped (absent) or present-with-no-
 *      mismatch.
 *
 * The chain-coordination block at the bottom verifies the layers also
 * compose properly (multi-failure surfacing, intent-only X10 pre-render,
 * success-line content).
 *
 * Note on omission strategy: the cleanest way to keep a layer quiet is to
 * not pass its detection input (e.g. omit `detectedGenus` and the X2 check
 * is skipped entirely). The triggers below pass ONLY the detection inputs
 * for the layer under test (plus the always-required bbox).
 */
import { describe, it, expect } from 'vitest';
import {
  verifyAgainstSpec,
  formatSpecCritique,
  type MeasuredBbox,
  type SpecVerificationResult,
} from '../specVerification';
import type { IntentInput } from '../../../openscad-render/intentToScad';

const bboxFromSize = (w: number, h: number, d: number, centered = true): MeasuredBbox => {
  if (centered) {
    return {
      min: [-w / 2, -h / 2, -d / 2],
      max: [w / 2, h / 2, d / 2],
    };
  }
  return { min: [0, 0, 0], max: [w, h, d] };
};

/**
 * Assert every layer OTHER than the one named is silent — either absent
 * from the result (its check was skipped) or present with no mismatch.
 * `r.mismatches` (bbox) is the only field that is always present; for it
 * "silent" means empty array.
 */
type LayerKey = 'bbox' | 'holeCount' | 'volume' | 'surfaceArea' | 'holePositions' | 'fillet' | 'threads' | 'intentIssues';

function assertOnlyLayerFires(r: SpecVerificationResult, fired: LayerKey): void {
  const checks: Record<LayerKey, () => void> = {
    bbox: () => {
      if (fired !== 'bbox') {
        expect(r.mismatches).toEqual([]);
      }
    },
    holeCount: () => {
      if (fired !== 'holeCount' && r.holeCount !== undefined) {
        expect(r.holeCount.mismatch).toBeNull();
      }
    },
    volume: () => {
      if (fired !== 'volume' && r.volume !== undefined) {
        expect(r.volume.mismatch).toBeNull();
      }
    },
    surfaceArea: () => {
      if (fired !== 'surfaceArea' && r.surfaceArea !== undefined) {
        expect(r.surfaceArea.mismatch).toBeNull();
      }
    },
    holePositions: () => {
      if (fired !== 'holePositions' && r.holePositions !== undefined) {
        expect(r.holePositions.allMatched).toBe(true);
      }
    },
    fillet: () => {
      if (fired !== 'fillet' && r.fillet !== undefined) {
        expect(r.fillet.applied).toBe(true);
      }
    },
    threads: () => {
      if (fired !== 'threads' && r.threads !== undefined) {
        expect(r.threads.allOk).toBe(true);
      }
    },
    intentIssues: () => {
      // intentIssues is only populated on the result when it has a problem;
      // when clean, it's stripped from the output object.
      if (fired !== 'intentIssues') {
        expect(r.intentIssues).toBeUndefined();
      }
    },
  };
  for (const key of Object.keys(checks) as LayerKey[]) {
    checks[key]();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// X1 — bbox
// ────────────────────────────────────────────────────────────────────────────

describe('X1 bbox layer', () => {
  it('happy path: clean 50³ box matches measured 50³ bbox', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
    assertOnlyLayerFires(r, 'bbox'); // nothing fired
  });

  it('trigger: dropped digit on depth (50³ intent vs 50×50×5 measured)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    // No other detections passed → other layers skipped or trivially silent.
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 5));
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]!.axis).toBe('depth');
    expect(r.mismatches[0]!.deltaMm).toBe(-45);
    assertOnlyLayerFires(r, 'bbox');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X2 / X4 — through-hole count (genus)
// ────────────────────────────────────────────────────────────────────────────

describe('X2/X4 hole count (genus) layer', () => {
  // Use staggered positions so X10 duplicate-detection does not also fire.
  const twoHoleIntent = (): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [
      { type: 'hole', params: { diameter: 5, x: -15, y: 0 } } as never,
      { type: 'hole', params: { diameter: 5, x: 15, y: 0 } } as never,
    ],
  });

  it('happy path: 2 declared holes, detectedGenus=2', () => {
    const r = verifyAgainstSpec(twoHoleIntent(), bboxFromSize(50, 50, 50), { detectedGenus: 2 });
    expect(r.ok).toBe(true);
    expect(r.holeCount).toEqual({ expected: 2, detected: 2, mismatch: null });
    assertOnlyLayerFires(r, 'holeCount'); // nothing fired
  });

  it('trigger: 2 declared holes, detectedGenus=1 (AI dropped a hole)', () => {
    const r = verifyAgainstSpec(twoHoleIntent(), bboxFromSize(50, 50, 50), { detectedGenus: 1 });
    expect(r.ok).toBe(false);
    expect(r.holeCount?.mismatch).toEqual({ delta: -1 });
    assertOnlyLayerFires(r, 'holeCount');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X3 — volume
// ────────────────────────────────────────────────────────────────────────────

describe('X3 volume layer', () => {
  it('happy path: 50³ + Ø20×40 blind hole, measured volume matches expected', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 20, depth: 40 } } as never],
    };
    const expectedVol = 125000 - Math.PI * 100 * 40; // 125000 - blind hole vol
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedVolumeMm3: expectedVol,
    });
    expect(r.ok).toBe(true);
    expect(r.volume?.mismatch).toBeNull();
    assertOnlyLayerFires(r, 'volume'); // nothing fired
  });

  it('trigger: AI forgot the Ø20×40 blind hole (volume = full 125000)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 20, depth: 40 } } as never],
    };
    // Bbox correct (the hole is blind so it doesn't shift bbox); detectedGenus
    // omitted to skip X2 (a blind hole should not change genus anyway, so even
    // if we passed 0 it'd match, but omission is cleaner).
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedVolumeMm3: 125000,
    });
    expect(r.ok).toBe(false);
    expect(r.volume?.mismatch).not.toBeNull();
    expect(r.volume?.mismatch?.deltaMm3).toBeGreaterThan(0); // more material than expected
    assertOnlyLayerFires(r, 'volume');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X5 — surface area
// ────────────────────────────────────────────────────────────────────────────

describe('X5 surface area layer', () => {
  it('happy path: 50³ box, measured area = 15000 mm²', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedSurfaceAreaMm2: 15000,
    });
    expect(r.ok).toBe(true);
    expect(r.surfaceArea?.mismatch).toBeNull();
    assertOnlyLayerFires(r, 'surfaceArea');
  });

  it('trigger: hollow-shell artifact (measured area ≈ 2× expected)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedSurfaceAreaMm2: 30000,
    });
    expect(r.ok).toBe(false);
    expect(r.surfaceArea?.mismatch).not.toBeNull();
    expect(r.surfaceArea?.mismatch?.deltaMm2).toBeCloseTo(15000, 0);
    assertOnlyLayerFires(r, 'surfaceArea');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X6 / X7 — hole position
// ────────────────────────────────────────────────────────────────────────────

describe('X6/X7 hole position layer', () => {
  const holeAtIntent = (x: number, y: number): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'hole', params: { diameter: 10, x, y } } as never],
  });

  it('happy path: Z-axis hole at (10,10) matches detected peak at (10,10)', () => {
    const r = verifyAgainstSpec(holeAtIntent(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ axis: 'z', cx: 10, cy: 10, diameter: 10 }],
    });
    expect(r.ok).toBe(true);
    expect(r.holePositions?.allMatched).toBe(true);
    assertOnlyLayerFires(r, 'holePositions');
  });

  it('trigger: intent (10,10) but detected at (-10,10)', () => {
    const r = verifyAgainstSpec(holeAtIntent(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ axis: 'z', cx: -10, cy: 10, diameter: 10 }],
    });
    expect(r.ok).toBe(false);
    expect(r.holePositions?.allMatched).toBe(false);
    expect(r.holePositions?.matches[0]!.withinTolerance).toBe(false);
    assertOnlyLayerFires(r, 'holePositions');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X8 — fillet
// ────────────────────────────────────────────────────────────────────────────

describe('X8 fillet layer', () => {
  const filletIntent = (): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'fillet', params: { radius: 2 } } as never],
  });

  it('happy path: filleted cube — 0 sharp edges, max dihedral 25°', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 25 },
    });
    expect(r.ok).toBe(true);
    expect(r.fillet?.applied).toBe(true);
    assertOnlyLayerFires(r, 'fillet');
  });

  it('trigger: cube NOT filleted (12 sharp edges, max dihedral 90°)', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 12, maxDihedralDeg: 90 },
    });
    expect(r.ok).toBe(false);
    expect(r.fillet?.applied).toBe(false);
    assertOnlyLayerFires(r, 'fillet');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X9 — thread (intent-side, no mesh)
// ────────────────────────────────────────────────────────────────────────────

describe('X9 thread layer', () => {
  const threadIntent = (diameter: number, pitch: number): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'thread', params: { diameter, pitch } } as never],
  });

  it('happy path: M8 with ISO coarse pitch 1.25', () => {
    const r = verifyAgainstSpec(threadIntent(8, 1.25), bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(true);
    expect(r.threads?.allOk).toBe(true);
    expect(r.threads?.perThread[0]!.isoStandard).toBe('M8');
    assertOnlyLayerFires(r, 'threads');
  });

  it('trigger: M8 with wrong pitch 0.5 (ISO M8 needs 1.25)', () => {
    const r = verifyAgainstSpec(threadIntent(8, 0.5), bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(false);
    expect(r.threads?.allOk).toBe(false);
    expect(r.threads?.perThread[0]!.pitchOk).toBe(false);
    assertOnlyLayerFires(r, 'threads');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// X10 — intent self-consistency
// ────────────────────────────────────────────────────────────────────────────

describe('X10 intent self-consistency layer', () => {
  it('happy path: 2 holes at distinct positions → no duplicates, no overlaps', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: -15, y: 0 } } as never,
        { type: 'hole', params: { diameter: 5, x: 15, y: 0 } } as never,
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(true);
    // intentIssues only present when there's a problem — when clean, the
    // verifier omits it from the result object.
    expect(r.intentIssues).toBeUndefined();
    assertOnlyLayerFires(r, 'intentIssues');
  });

  it('trigger: 2 holes at identical (10,10) Ø5 — duplicate intent', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
      ],
    };
    // Do NOT pass detectedVolumeMm3 — duplicate holes at the same position
    // collapse to one cylinder in the mesh, so the expected volume the
    // verifier computes (subtracting BOTH holes) would not match a measured
    // volume that subtracts only ONE. Omitting it skips X3 entirely.
    // Same for detectedGenus (would be 1 not 2 → X2 would also fire).
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(false);
    expect(r.intentIssues).toBeDefined();
    expect(r.intentIssues?.duplicateHoles).toHaveLength(1);
    expect(r.intentIssues?.duplicateHoles[0]!.indices).toEqual([0, 1]);
    // Verify the overlap loop did NOT also fire — duplicates are removed
    // from the overlap candidate set in the implementation.
    expect(r.intentIssues?.overlappingHoles).toHaveLength(0);
    expect(r.intentIssues?.obliteratingHoles).toHaveLength(0);
    assertOnlyLayerFires(r, 'intentIssues');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Chain coordination — all layers wired together
// ────────────────────────────────────────────────────────────────────────────

describe('chain coordination', () => {
  it('verifyAgainstSpec runs all 8 layers on a complete input', () => {
    // Single 50³ box with 1 hole at (10,10), 1 fillet, 1 thread (M8 ISO).
    // Pass every detection input the chain can consume. Every sub-field
    // should be present with no mismatch.
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 10, x: 10, y: 10 } } as never,
        { type: 'fillet', params: { radius: 2 } } as never,
        { type: 'thread', params: { diameter: 8, pitch: 1.25 } } as never,
      ],
    };
    const expectedVol = 125000 - Math.PI * 25 * 50; // through-hole subtracts full depth
    const expectedArea = 15000 + (-2 * Math.PI * 25 + 2 * Math.PI * 5 * 50); // -2 caps + inner wall
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedGenus: 1,
      detectedVolumeMm3: expectedVol,
      detectedSurfaceAreaMm2: expectedArea,
      detectedHoles: [{ axis: 'z', cx: 10, cy: 10, diameter: 10 }],
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 25 },
    });
    expect(r.ok).toBe(true);
    // X1 bbox
    expect(r.mismatches).toEqual([]);
    // X2/X4 hole count
    expect(r.holeCount).toBeDefined();
    expect(r.holeCount?.mismatch).toBeNull();
    // X3 volume
    expect(r.volume).toBeDefined();
    expect(r.volume?.mismatch).toBeNull();
    // X5 surface area
    expect(r.surfaceArea).toBeDefined();
    expect(r.surfaceArea?.mismatch).toBeNull();
    // X6/X7 hole positions
    expect(r.holePositions).toBeDefined();
    expect(r.holePositions?.allMatched).toBe(true);
    // X8 fillet
    expect(r.fillet).toBeDefined();
    expect(r.fillet?.applied).toBe(true);
    // X9 threads
    expect(r.threads).toBeDefined();
    expect(r.threads?.allOk).toBe(true);
    // X10 intent self-consistency (clean → stripped from output)
    expect(r.intentIssues).toBeUndefined();
  });

  it('two simultaneous layer failures both surface in critique (X1 bbox + X9 thread)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'thread', params: { diameter: 8, pitch: 0.5 } } as never, // X9: wrong pitch
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 5)); // X1: dropped depth
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(1); // X1 fired
    expect(r.threads?.allOk).toBe(false); // X9 fired
    const text = formatSpecCritique(r);
    expect(text).toMatch(/depth.*expected 50/);
    expect(text).toMatch(/thread.*Ø8mm.*pitch 0\.5mm.*M8 is 1\.25mm/);
  });

  it('intent self-consistency (X10) runs pre-render even with no detection inputs', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never, // duplicate
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(false);
    expect(r.intentIssues).toBeDefined();
    expect(r.intentIssues?.duplicateHoles).toHaveLength(1);
    // All other sub-checks skipped (no detection inputs)
    expect(r.holeCount).toBeUndefined();
    expect(r.volume).toBeUndefined();
    expect(r.surfaceArea).toBeUndefined();
    expect(r.holePositions).toBeUndefined();
    expect(r.fillet).toBeUndefined();
    // X9 threads also absent — no thread feature in intent
    expect(r.threads).toBeUndefined();
    // Bbox is always evaluated, but matches.
    expect(r.mismatches).toEqual([]);
  });

  it('formatSpecCritique success line mentions every active sub-check', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 10, x: 10, y: 10 } } as never,
        { type: 'fillet', params: { radius: 2 } } as never,
        { type: 'thread', params: { diameter: 8, pitch: 1.25 } } as never,
      ],
    };
    const expectedVol = 125000 - Math.PI * 25 * 50;
    const expectedArea = 15000 + (-2 * Math.PI * 25 + 2 * Math.PI * 5 * 50);
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedGenus: 1,
      detectedVolumeMm3: expectedVol,
      detectedSurfaceAreaMm2: expectedArea,
      detectedHoles: [{ axis: 'z', cx: 10, cy: 10, diameter: 10 }],
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 25 },
    });
    expect(r.ok).toBe(true);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/spec ok/);
    expect(text).toContain('Through-holes:');
    expect(text).toContain('Volume:');
    expect(text).toContain('Surface area:');
    expect(text).toContain('Hole positions:');
    expect(text).toContain('Fillet:');
    expect(text).toContain('Threads:');
  });
});
