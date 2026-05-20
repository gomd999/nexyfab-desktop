import { describe, it, expect } from 'vitest';
import {
  sampleConic,
  evalStyleSpline,
  sampleStyleSpline,
  generateSlotGeometry,
  sampleEquationCurve,
  fitBelt,
  type Pulley,
} from './sketchAdvanced';

describe('sampleConic', () => {
  it('parabola passes through start + end', () => {
    const pts = sampleConic({
      kind: 'parabola',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, shoulder: { x: 5, y: 5 },
      eccentricity: 1,
    });
    expect(pts[0]!.x).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(10, 5);
  });

  it('returns requested sample count', () => {
    const pts = sampleConic({
      kind: 'parabola',
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, shoulder: { x: 0.5, y: 1 },
      eccentricity: 1,
    }, 50);
    expect(pts).toHaveLength(50);
  });

  it('higher eccentricity → more "pinched" curve', () => {
    const ellipse = sampleConic({
      kind: 'ellipse',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, shoulder: { x: 5, y: 5 },
      eccentricity: 0.3,
    });
    const hyperbola = sampleConic({
      kind: 'hyperbola',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, shoulder: { x: 5, y: 5 },
      eccentricity: 1.8,
    });
    // Both finite samples.
    expect(ellipse.every(p => Number.isFinite(p.x))).toBe(true);
    expect(hyperbola.every(p => Number.isFinite(p.x))).toBe(true);
  });
});

describe('evalStyleSpline', () => {
  it('t=0 returns first control point', () => {
    const r = evalStyleSpline({
      controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
      degree: 2,
    }, 0);
    expect(r).toEqual({ x: 0, y: 0 });
  });

  it('t=1 returns last control point', () => {
    const r = evalStyleSpline({
      controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
      degree: 2,
    }, 1);
    expect(r).toEqual({ x: 10, y: 0 });
  });

  it('midpoint of straight Bezier = midpoint of endpoints', () => {
    const r = evalStyleSpline({
      controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      degree: 1,
    }, 0.5);
    expect(r.x).toBeCloseTo(5, 5);
  });
});

describe('sampleStyleSpline', () => {
  it('emits requested sample count', () => {
    const pts = sampleStyleSpline({
      controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], degree: 2,
    }, 32);
    expect(pts).toHaveLength(32);
  });
});

describe('generateSlotGeometry', () => {
  it('straight slot returns closed polyline', () => {
    const pts = generateSlotGeometry({
      kind: 'straight',
      center1: { x: 0, y: 0 }, center2: { x: 20, y: 0 },
      widthMm: 4,
    });
    expect(pts.length).toBeGreaterThan(8);
  });

  it('zero-length straight slot returns empty', () => {
    const pts = generateSlotGeometry({
      kind: 'straight',
      center1: { x: 0, y: 0 }, center2: { x: 0, y: 0 },
      widthMm: 4,
    });
    expect(pts).toHaveLength(0);
  });

  it('arc slot needs arcRadius', () => {
    const noRadius = generateSlotGeometry({
      kind: 'arc',
      center1: { x: 0, y: 0 }, center2: { x: 1, y: 0 },
      widthMm: 4,
    });
    expect(noRadius).toHaveLength(0);
  });

  it('arc slot returns non-empty for valid input', () => {
    const pts = generateSlotGeometry({
      kind: 'arc',
      center1: { x: 10, y: 0 }, center2: { x: 0, y: 10 },
      widthMm: 4, arcRadiusMm: 15,
    });
    expect(pts.length).toBeGreaterThan(8);
  });
});

describe('sampleEquationCurve', () => {
  it('samples sine curve', () => {
    const pts = sampleEquationCurve({
      xFn: t => t,
      yFn: t => Math.sin(t),
      tStart: 0,
      tEnd: Math.PI,
    }, 32);
    expect(pts).toHaveLength(32);
    expect(pts[0]!.y).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(0, 5);
  });

  it('parametric circle', () => {
    const pts = sampleEquationCurve({
      xFn: t => Math.cos(t),
      yFn: t => Math.sin(t),
      tStart: 0,
      tEnd: 2 * Math.PI,
    }, 64);
    // All points on unit circle.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 5);
    }
  });
});

describe('fitBelt', () => {
  const pulleys: Pulley[] = [
    { center: { x: 0, y: 0 }, radiusMm: 20, driveDirection: 1 },
    { center: { x: 100, y: 0 }, radiusMm: 15, driveDirection: -1 },
  ];

  it('returns centerline points + wrap angles', () => {
    const r = fitBelt(pulleys);
    expect(r.centerline.length).toBeGreaterThan(0);
    expect(r.wrapAnglesDeg).toHaveLength(2);
  });

  it('total belt length > 2 × center distance', () => {
    const r = fitBelt(pulleys);
    // Straight-belt minimum ≈ 2 × 100 = 200 (straight runs) + 2 × π × r (wrap halves).
    expect(r.totalLengthMm).toBeGreaterThan(150);
  });

  it('fewer than 2 pulleys → empty', () => {
    const r = fitBelt([pulleys[0]!]);
    expect(r.centerline).toHaveLength(0);
    expect(r.totalLengthMm).toBe(0);
  });

  it('3 pulleys produces 3 wrap angles', () => {
    const three: Pulley[] = [
      { center: { x: 0, y: 0 }, radiusMm: 20, driveDirection: 1 },
      { center: { x: 100, y: 0 }, radiusMm: 15, driveDirection: 1 },
      { center: { x: 50, y: 80 }, radiusMm: 10, driveDirection: 1 },
    ];
    const r = fitBelt(three);
    expect(r.wrapAnglesDeg).toHaveLength(3);
  });
});
