import { describe, it, expect } from 'vitest';
import { buildDrf, type DatumFeature } from './datumReferenceFrame';
import { directionalStackup3D, type Tol3DLink } from './toleranceStackup3D';

// ── DRF builders ──────────────────────────────────────────────────────────
const planeA = (dir: [number, number, number], formTol?: number): DatumFeature => ({
  label: 'A', kind: 'plane', position: [0, 0, 0], direction: dir, formToleranceMm: formTol,
});
const planeB = (dir: [number, number, number]): DatumFeature => ({
  label: 'B', kind: 'plane', position: [0, 0, 0], direction: dir,
});

/** Identity DRF: primary normal +Z, secondary normal +X → rotation = I. */
const identityDrf = (formTol?: number) => buildDrf(planeA([0, 0, 1], formTol), planeB([1, 0, 0]));
/** Rotated DRF: primary +Z, secondary +Y → local X maps to global Y. */
const rotatedDrf = () => buildDrf(planeA([0, 0, 1]), planeB([0, 1, 0]));

describe('directionalStackup3D', () => {
  it('identity DRFs reproduce the 1D answer (3 links × ±0.1 isotropic)', () => {
    const chain: Tol3DLink[] = [0, 1, 2].map(() => ({
      drf: identityDrf(),
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0.2 }, // → half 0.1
    }));
    const r = directionalStackup3D(chain);
    // Worst case: 3 × 0.1 = 0.3 on each global axis.
    expect(r.worstCaseAxisMm[0]).toBeCloseTo(0.3, 6);
    expect(r.worstCaseAxisMm[1]).toBeCloseTo(0.3, 6);
    expect(r.worstCaseAxisMm[2]).toBeCloseTo(0.3, 6);
    // RSS per axis: 3σ = 3·√(3·(0.1/3)²) = √3·0.1 ≈ 0.17320.
    expect(r.rssAxisMm[0]).toBeCloseTo(Math.sqrt(3) * 0.1, 6);
    // RSS magnitude < worst-case magnitude (the whole point of RSS).
    expect(r.rssMagMm).toBeLessThan(r.worstCaseMagMm);
    expect(r.worstCaseMagMm).toBeCloseTo(0.3 * Math.sqrt(3), 6);
  });

  it('an anisotropic local zone lands on the matching global axis under identity', () => {
    const chain: Tol3DLink[] = [{
      drf: identityDrf(),
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0 },
      localHalfWidthsMm: [0.2, 0, 0], // only local-X
    }];
    const r = directionalStackup3D(chain);
    expect(r.worstCaseAxisMm[0]).toBeCloseTo(0.2, 6);
    expect(r.worstCaseAxisMm[1]).toBeCloseTo(0, 6);
    expect(r.worstCaseAxisMm[2]).toBeCloseTo(0, 6);
  });

  it('a 90°-rotated DRF routes a local-X zone to the global-Y axis (rotation honored)', () => {
    const chain: Tol3DLink[] = [{
      drf: rotatedDrf(),
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0 },
      localHalfWidthsMm: [0.2, 0, 0], // only local-X
    }];
    const r = directionalStackup3D(chain);
    // local X → global Y (the gap the old scalar stackup3D ignored).
    expect(r.worstCaseAxisMm[0]).toBeCloseTo(0, 6);
    expect(r.worstCaseAxisMm[1]).toBeCloseTo(0.2, 6);
    expect(r.worstCaseAxisMm[2]).toBeCloseTo(0, 6);
  });

  it('datum FORM error enlarges the zone (datumReferenceFrame fed in)', () => {
    const base: Tol3DLink = {
      drf: identityDrf(),
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0.2 },
    };
    const withForm: Tol3DLink = {
      drf: identityDrf(0.05), // primary plane flatness 0.05
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0.2 },
    };
    const r0 = directionalStackup3D([base]);
    const r1 = directionalStackup3D([withForm]);
    expect(r1.perLink[0]!.datumFormMm).toBeCloseTo(0.05, 6);
    // local half = √(0.1² + 0.05²) ≈ 0.1118 > 0.1.
    expect(r1.worstCaseAxisMm[0]).toBeGreaterThan(r0.worstCaseAxisMm[0]);
    expect(r1.worstCaseAxisMm[0]).toBeCloseTo(Math.sqrt(0.1 * 0.1 + 0.05 * 0.05), 6);
  });

  it('worst-case ≥ RSS on every axis, and the chain is order-independent for the magnitude', () => {
    const mk = (drf: ReturnType<typeof identityDrf>, hw: [number, number, number]): Tol3DLink => ({
      drf, feature: { centerPart: [0, 0, 0], positionToleranceMm: 0 }, localHalfWidthsMm: hw,
    });
    const a = mk(identityDrf(), [0.1, 0.05, 0.2]);
    const b = mk(rotatedDrf(), [0.15, 0, 0.1]);
    const r = directionalStackup3D([a, b]);
    const rRev = directionalStackup3D([b, a]);
    for (let i = 0; i < 3; i++) expect(r.worstCaseAxisMm[i]).toBeGreaterThanOrEqual(r.rssAxisMm[i] - 1e-9);
    expect(rRev.worstCaseMagMm).toBeCloseTo(r.worstCaseMagMm, 9);
    expect(rRev.rssMagMm).toBeCloseTo(r.rssMagMm, 9);
  });
});
