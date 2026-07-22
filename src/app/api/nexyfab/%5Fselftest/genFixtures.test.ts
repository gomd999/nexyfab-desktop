/**
 * genFixtures — UNIT test for the GENERATION geometry judge (no live LLM, no
 * OpenSCAD). Pins the one property that makes the measurement honest:
 *
 *   pass == the BUILT geometry matches what the PROMPT asked for — NOT what the
 *   AI parsed. A misparse that builds a perfect-but-wrong part must FAIL, and its
 *   failure must be ATTRIBUTED to 'misparse' (not 'dimension-off').
 *
 * All inputs are inline BuiltSignatures — this test never calls a model or a
 * renderer, so it runs in the normal `vitest run` suite.
 */
import { describe, it, expect } from 'vitest';
import {
  GEN_FIXTURES,
  compareGenSignature,
  builtSignatureFromSession,
  type GenFixture,
  type BuiltSignature,
} from './genFixtures';

function fx(id: string): GenFixture {
  const f = GEN_FIXTURES.find((g) => g.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
}
function bboxOf(x: number, y: number, z: number): BuiltSignature['bbox'] {
  return { min: [0, 0, 0], max: [x, y, z] };
}

describe('compareGenSignature — the honest judge', () => {
  it('PASSES when the built bbox matches the prompt (order-independent)', () => {
    // plate expects [20,30,10]; feed the axes SHUFFLED — must still pass.
    const built: BuiltSignature = {
      bbox: bboxOf(10, 20, 30),
      volume_mm3: 20 * 30 * 10,
      holeCount: 0,
      intentShapeId: 'box',
      renderOk: true,
    };
    const r = compareGenSignature(fx('plate'), built);
    expect(r.built).toBe(true);
    expect(r.pass).toBe(true);
    expect(r.failReason).toBeNull();
    expect(r.builtBbox).toEqual([30, 20, 10]); // sorted desc
  });

  it('FAILS a misparse even when the built part is internally perfect, and labels it misparse', () => {
    // The classic hidden misparse: prompt says 50mm cube, AI built a flawless
    // 5mm cube. Right shape family (box) but 10x too small.
    const built: BuiltSignature = {
      bbox: bboxOf(5, 5, 5),
      volume_mm3: 125,
      holeCount: 0,
      intentShapeId: 'box',
      renderOk: true,
    };
    const r = compareGenSignature(fx('cube50'), built);
    expect(r.pass).toBe(false);
    // shape family was right, so this is a dimension misparse -> 'dimension-off'
    expect(r.failReason).toBe('dimension-off');
    expect(r.bboxErrPct).toBeGreaterThan(80);
  });

  it("labels a WRONG-SHAPE parse as 'misparse' (intent outside expected family)", () => {
    // Prompt: cube. AI parsed a sphere and built one of the wrong size.
    const built: BuiltSignature = {
      bbox: bboxOf(30, 30, 30),
      volume_mm3: 14137,
      holeCount: 0,
      intentShapeId: 'sphere',
      renderOk: true,
    };
    const r = compareGenSignature(fx('cube50'), built);
    expect(r.pass).toBe(false);
    expect(r.failReason).toBe('misparse');
    expect(r.notes).toContain('sphere');
  });

  it("reports 'no-geometry' when nothing was built (render never ran)", () => {
    const built: BuiltSignature = { holeCount: 0, intentShapeId: null, renderOk: null };
    const r = compareGenSignature(fx('cube50'), built);
    expect(r.built).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.failReason).toBe('no-geometry');
  });

  it("reports 'build-fail' when the render explicitly failed", () => {
    const built: BuiltSignature = { holeCount: 0, intentShapeId: 'box', renderOk: false };
    const r = compareGenSignature(fx('cube50'), built);
    expect(r.failReason).toBe('build-fail');
  });

  it('requires the hole to be present (right envelope, missing bore -> fail)', () => {
    const withHole: BuiltSignature = {
      bbox: bboxOf(50, 50, 50), volume_mm3: 120000, holeCount: 1, intentShapeId: 'box', renderOk: true,
    };
    const noHole: BuiltSignature = {
      bbox: bboxOf(50, 50, 50), volume_mm3: 125000, holeCount: 0, intentShapeId: 'box', renderOk: true,
    };
    expect(compareGenSignature(fx('cubeHole'), withHole).pass).toBe(true);
    const miss = compareGenSignature(fx('cubeHole'), noHole);
    expect(miss.pass).toBe(false);
    expect(miss.holesBuilt).toBe(0);
    expect(miss.holesExpected).toBe(1);
  });

  it('uses fill-ratio to reject a full block where an L-bracket (concavity) was asked', () => {
    // Right 40x40 footprint but a SOLID block: fillRatio ~1.0 > 0.6 -> fail.
    const block: BuiltSignature = {
      bbox: bboxOf(40, 40, 40), volume_mm3: 40 * 40 * 40, holeCount: 0, intentShapeId: 'box', renderOk: true,
    };
    const rBlock = compareGenSignature(fx('lbracket'), block);
    expect(rBlock.pass).toBe(false);
    expect(rBlock.notes).toContain('fillRatio');

    // A real L: same footprint, ~0.23 fill -> pass (depth unconstrained).
    const lshape: BuiltSignature = {
      bbox: bboxOf(40, 40, 20), volume_mm3: 0.23 * 40 * 40 * 20, holeCount: 0, intentShapeId: 'lbracket', renderOk: true,
    };
    expect(compareGenSignature(fx('lbracket'), lshape).pass).toBe(true);
  });

  it('counts >= expected holes as a pass for the flange (8 bolt holes)', () => {
    const built: BuiltSignature = {
      bbox: bboxOf(100, 100, 12), volume_mm3: 60000, holeCount: 9, intentShapeId: 'flange', renderOk: true,
    };
    expect(compareGenSignature(fx('flange'), built).pass).toBe(true);
  });

  it('honestly fails the organic mouse fixture when the blob is nowhere near', () => {
    const built: BuiltSignature = {
      bbox: bboxOf(20, 20, 20), volume_mm3: 8000, holeCount: 0, intentShapeId: 'box', renderOk: true,
    };
    const r = compareGenSignature(fx('mouse'), built);
    expect(r.pass).toBe(false);
  });
});

describe('builtSignatureFromSession — extraction', () => {
  it('prefers detectedHoles length, falls back to genus, and reads bbox/volume/intent', () => {
    const s = builtSignatureFromSession({
      geometry: { bbox: bboxOf(50, 50, 50)!, volume_mm3: 120000, detectedHoles: [{}, {}] },
      lastIntent: { shapeId: 'box' },
      render: { ok: true },
    });
    expect(s.holeCount).toBe(2);
    expect(s.intentShapeId).toBe('box');
    expect(s.renderOk).toBe(true);
    expect(s.volume_mm3).toBe(120000);
  });

  it('falls back to genus when detectedHoles is absent', () => {
    const s = builtSignatureFromSession({
      geometry: { bbox: bboxOf(50, 50, 50)!, genus: 3 },
      lastIntent: { shapeId: 'box' },
      render: { ok: true },
    });
    expect(s.holeCount).toBe(3);
  });

  it('reports a composite intent and null render when nothing ran', () => {
    const s = builtSignatureFromSession({
      geometry: {},
      lastCompositeParts: [{}],
    });
    expect(s.intentShapeId).toBe('composite');
    expect(s.holeCount).toBe(0);
    expect(s.renderOk).toBeNull();
    expect(s.bbox).toBeUndefined();
  });
});

describe('GEN_FIXTURES — set integrity (honesty guard)', () => {
  it('spans difficulties and includes >= 2 prompts we expect to fail', () => {
    const diffs = new Set(GEN_FIXTURES.map((f) => f.difficulty));
    expect(diffs.has('easy')).toBe(true);
    expect(diffs.has('medium')).toBe(true);
    expect(diffs.has('hard')).toBe(true);
    expect(GEN_FIXTURES.filter((f) => f.expectFail).length).toBeGreaterThanOrEqual(2);
    expect(GEN_FIXTURES.length).toBeGreaterThanOrEqual(8);
  });
});
