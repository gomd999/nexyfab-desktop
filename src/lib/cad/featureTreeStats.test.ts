/**
 * featureTreeStats — Phase 1 statistics extraction tests.
 *
 * Coverage targets the documented Phase 1 contract:
 *   - per-feature kind volumes (extrude / revolve / hole / pattern)
 *   - bbox aggregation and pass-through
 *   - perFeature map fidelity
 *   - density → mass conversion
 *   - suppression + empty-tree edge cases
 *   - fillet / chamfer volume-skip policy
 */
import { describe, it, expect } from 'vitest';
import {
  computeStats,
  unionBbox,
  isEmptyBbox,
  type Bbox,
} from './featureTreeStats';
import type { FeatureTree, FeatureNode } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import type { SweepFeature, LoftFeature } from './sweepLoft';
import type {
  LinearPatternFeature,
  CircularPatternFeature,
} from './pattern';
import type { HoleFeature } from './holeProfile';
import type { FilletFeature } from './filletProfile';
import type { ChamferFeature } from './chamferProfile';

// ─── builders (test fixtures) ────────────────────────────────────────────

function boxLoop(w: number, h: number): { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function extrudeBox(
  id: string,
  w: number,
  h: number,
  d: number,
  opts: { mode?: 'add' | 'cut'; direction?: ExtrudeFeature['direction'] } = {},
): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: boxLoop(w, h),
    depth: d,
    direction: opts.direction ?? 'one_sided',
    mode: opts.mode ?? 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

function revolveCylinder(
  id: string,
  r: number,
  h: number,
  angle: number = 360,
): FeatureNode {
  // Profile in canonical axis frame: x = radial (≥0), y = axial.
  // Rectangle width=r height=h gives cylinder radius r height h via Pappus.
  // Pappus volume = area × 2π × centroidX × (angle/360) = r·h × 2π × (r/2) × (angle/360)
  //               = π r² h × (angle/360). ✓
  const payload: RevolveFeature = {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: r, y: 0 },
      { x: r, y: h },
      { x: 0, y: h },
    ],
    angleDegrees: angle,
    mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

function holeNode(
  id: string,
  diameter: number,
  depth: number,
  cx: number = 0,
  cy: number = 0,
): FeatureNode {
  const payload: HoleFeature = {
    kind: 'hole',
    center: { x: cx, y: cy },
    holeType: 'drilled',
    diameter,
    depth,
  };
  return { id, name: id, dependencies: [], payload };
}

function linearPatternNode(
  id: string,
  childId: string,
  count: number,
  spacing: number,
  direction: { x: number; y: number; z: number } = { x: 1, y: 0, z: 0 },
): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: '/* opaque */',
    count,
    direction,
    spacing,
  };
  return { id, name: id, dependencies: [childId], payload };
}

function circularPatternNode(
  id: string,
  childId: string,
  count: number,
  angle: number = 360,
): FeatureNode {
  const payload: CircularPatternFeature = {
    kind: 'circular_pattern',
    childScad: '/* opaque */',
    count,
    axisOrigin: { x: 0, y: 0, z: 0 },
    axisDirection: { x: 0, y: 0, z: 1 },
    totalAngleDegrees: angle,
  };
  return { id, name: id, dependencies: [childId], payload };
}

function filletNode(id: string, child: ExtrudeFeature, radius: number): FeatureNode {
  const payload: FilletFeature = {
    kind: 'fillet',
    childExtrude: child,
    radius,
    edgeSelection: 'all',
  };
  return { id, name: id, dependencies: [], payload };
}

function chamferNode(id: string, child: ExtrudeFeature, distance: number): FeatureNode {
  const payload: ChamferFeature = {
    kind: 'chamfer',
    childExtrude: child,
    distance,
    edgeSelection: 'all',
  };
  return { id, name: id, dependencies: [], payload };
}

function sweepNode(id: string, w: number, h: number, len: number): FeatureNode {
  const payload: SweepFeature = {
    kind: 'sweep',
    profile: { points: boxLoop(w, h) },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: len, y: 0, z: 0 },
    ],
    mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

function loftNode(
  id: string,
  bottomSide: number,
  topSide: number,
  height: number,
): FeatureNode {
  const payload: LoftFeature = {
    kind: 'loft',
    sections: [
      { profile: { points: boxLoop(bottomSide, bottomSide) }, z: 0 },
      { profile: { points: boxLoop(topSide, topSide) }, z: height },
    ],
    mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('computeStats — empty tree', () => {
  it('returns zero aggregate stats with empty bbox', () => {
    const stats = computeStats({ nodes: [] });
    expect(stats.volume).toBe(0);
    expect(stats.surfaceArea).toBe(0);
    expect(stats.nodeCount).toBe(0);
    expect(stats.perFeature.size).toBe(0);
    expect(isEmptyBbox(stats.bbox)).toBe(true);
    expect(stats.centerOfMass).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('computeStats — extrude', () => {
  it('computes 1000 mm³ for a 10×10×10 box', () => {
    const tree: FeatureTree = { nodes: [extrudeBox('a', 10, 10, 10)] };
    const stats = computeStats(tree);
    expect(stats.volume).toBeCloseTo(1000, 6);
    expect(stats.nodeCount).toBe(1);
    expect(stats.perFeature.get('a')?.volume).toBeCloseTo(1000, 6);
  });

  it('computes surface area 600 mm² for a 10×10×10 box', () => {
    const tree: FeatureTree = { nodes: [extrudeBox('a', 10, 10, 10)] };
    const stats = computeStats(tree);
    // SA = 2·100 + 40·10 = 200 + 400 = 600 mm² (matches a cube).
    expect(stats.surfaceArea).toBeCloseTo(600, 6);
  });

  it('reports bbox spanning the polygon × depth', () => {
    const tree: FeatureTree = { nodes: [extrudeBox('a', 10, 5, 3)] };
    const bb = computeStats(tree).bbox;
    expect(bb.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bb.max).toEqual({ x: 10, y: 5, z: 3 });
  });

  it('doubles Z extent for two_sided direction', () => {
    const tree: FeatureTree = {
      nodes: [extrudeBox('a', 10, 10, 5, { direction: 'two_sided' })],
    };
    const stats = computeStats(tree);
    // two_sided spans [-depth, +depth] = 10 mm of Z.
    expect(stats.volume).toBeCloseTo(1000, 6);
    expect(stats.bbox.min.z).toBe(-5);
    expect(stats.bbox.max.z).toBe(5);
  });

  it('uses [-d/2, +d/2] for midplane direction', () => {
    const tree: FeatureTree = {
      nodes: [extrudeBox('a', 10, 10, 4, { direction: 'midplane' })],
    };
    const bb = computeStats(tree).bbox;
    expect(bb.min.z).toBe(-2);
    expect(bb.max.z).toBe(2);
  });

  it('sums two additive extrudes', () => {
    const tree: FeatureTree = {
      nodes: [extrudeBox('a', 10, 10, 10), extrudeBox('b', 5, 5, 5)],
    };
    const stats = computeStats(tree);
    expect(stats.volume).toBeCloseTo(1000 + 125, 6);
    expect(stats.nodeCount).toBe(2);
  });
});

describe('computeStats — revolve', () => {
  it('computes πr²h for a full cylinder', () => {
    const tree: FeatureTree = { nodes: [revolveCylinder('a', 5, 10)] };
    const stats = computeStats(tree);
    const expected = Math.PI * 25 * 10;
    expect(stats.volume).toBeCloseTo(expected, 4);
  });

  it('scales linearly with sweep angle', () => {
    const full = computeStats({ nodes: [revolveCylinder('f', 5, 10, 360)] });
    const half = computeStats({ nodes: [revolveCylinder('h', 5, 10, 180)] });
    expect(half.volume).toBeCloseTo(full.volume / 2, 4);
  });

  it('reports a ring bbox spanning ±r in X/Z and profile Y', () => {
    const stats = computeStats({ nodes: [revolveCylinder('a', 5, 10)] });
    expect(stats.bbox.min.x).toBeCloseTo(-5, 6);
    expect(stats.bbox.max.x).toBeCloseTo(5, 6);
    expect(stats.bbox.min.y).toBeCloseTo(0, 6);
    expect(stats.bbox.max.y).toBeCloseTo(10, 6);
    expect(stats.bbox.min.z).toBeCloseTo(-5, 6);
    expect(stats.bbox.max.z).toBeCloseTo(5, 6);
  });
});

describe('computeStats — hole (subtractive)', () => {
  it('returns negative volume for a drilled hole', () => {
    const tree: FeatureTree = { nodes: [holeNode('h', 4, 5)] };
    const stats = computeStats(tree);
    const expected = -(Math.PI * 4 * 5); // -π·r²·h with r=2
    expect(stats.volume).toBeCloseTo(expected, 4);
    expect(stats.volume).toBeLessThan(0);
  });

  it('extrude + hole produces net positive when bore is small', () => {
    const tree: FeatureTree = {
      nodes: [extrudeBox('plate', 20, 20, 5), holeNode('h', 4, 5, 10, 10)],
    };
    const stats = computeStats(tree);
    const plateV = 20 * 20 * 5;
    const holeV = Math.PI * 4 * 5;
    expect(stats.volume).toBeCloseTo(plateV - holeV, 3);
  });
});

describe('computeStats — patterns', () => {
  it('linear_pattern multiplies child volume by count', () => {
    const base = extrudeBox('base', 10, 10, 10);
    const pattern = linearPatternNode('pat', 'base', 5, 30);
    const tree: FeatureTree = { nodes: [base, pattern] };
    const stats = computeStats(tree);
    // base contributes 1000, pattern contributes 5 × 1000 = 5000.
    // Phase 1 aggregate sums both (does not detect duplication).
    expect(stats.perFeature.get('pat')?.volume).toBeCloseTo(5000, 4);
    expect(stats.perFeature.get('base')?.volume).toBeCloseTo(1000, 4);
  });

  it('linear_pattern expands bbox along direction × spacing × count', () => {
    const base = extrudeBox('base', 10, 10, 10);
    const pattern = linearPatternNode('pat', 'base', 3, 20);
    const tree: FeatureTree = { nodes: [base, pattern] };
    const stats = computeStats(tree);
    const patBbox = stats.perFeature.get('pat')!.bbox!;
    // 3 instances at offsets 0, 20, 40 → x span [0, 50] (base width 10).
    expect(patBbox.min.x).toBeCloseTo(0, 4);
    expect(patBbox.max.x).toBeCloseTo(50, 4);
  });

  it('circular_pattern multiplies child volume by count', () => {
    const base = extrudeBox('base', 10, 10, 10);
    const pattern = circularPatternNode('pat', 'base', 4);
    const tree: FeatureTree = { nodes: [base, pattern] };
    const stats = computeStats(tree);
    expect(stats.perFeature.get('pat')?.volume).toBeCloseTo(4000, 4);
  });

  it('circular_pattern bbox is a ring around the axis', () => {
    const base = extrudeBox('base', 10, 10, 10);
    const pattern = circularPatternNode('pat', 'base', 6);
    const tree: FeatureTree = { nodes: [base, pattern] };
    const stats = computeStats(tree);
    const patBbox = stats.perFeature.get('pat')!.bbox!;
    // Ring around Z-axis: bbox should be symmetric in X and Y.
    expect(patBbox.max.x).toBeGreaterThan(0);
    expect(patBbox.min.x).toBeLessThan(0);
    expect(patBbox.max.y).toBeGreaterThan(0);
    expect(patBbox.min.y).toBeLessThan(0);
  });
});

describe('computeStats — fillet / chamfer ignore-volume policy', () => {
  it('fillet contributes no volume (child only counts)', () => {
    const child: ExtrudeFeature = {
      kind: 'extrude',
      loop: boxLoop(20, 20),
      depth: 20,
      direction: 'one_sided',
      mode: 'add',
    };
    const tree: FeatureTree = {
      nodes: [filletNode('f', child, 1)],
    };
    const stats = computeStats(tree);
    expect(stats.perFeature.get('f')?.volume).toBeUndefined();
    // Aggregate has no contribution from the fillet itself (the fillet
    // node is a wrapper; the child extrude is not in the tree here, so
    // aggregate volume stays 0).
    expect(stats.volume).toBe(0);
    // Bbox still passes through.
    expect(stats.bbox.max.x).toBe(20);
  });

  it('chamfer contributes no volume', () => {
    const child: ExtrudeFeature = {
      kind: 'extrude',
      loop: boxLoop(20, 20),
      depth: 20,
      direction: 'one_sided',
      mode: 'add',
    };
    const tree: FeatureTree = { nodes: [chamferNode('c', child, 1)] };
    const stats = computeStats(tree);
    expect(stats.perFeature.get('c')?.volume).toBeUndefined();
  });
});

describe('computeStats — sweep / loft (coarse Phase 1 estimates)', () => {
  it('sweep volume = profile area × spine length', () => {
    const tree: FeatureTree = { nodes: [sweepNode('s', 4, 4, 10)] };
    const stats = computeStats(tree);
    expect(stats.perFeature.get('s')?.volume).toBeCloseTo(160, 4);
  });

  it('loft volume = avg section area × height', () => {
    const tree: FeatureTree = { nodes: [loftNode('l', 4, 2, 10)] };
    const stats = computeStats(tree);
    // (16 + 4) / 2 × 10 = 100.
    expect(stats.perFeature.get('l')?.volume).toBeCloseTo(100, 4);
  });
});

describe('computeStats — suppression', () => {
  it('skips suppressed nodes from aggregates and perFeature', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeBox('a', 10, 10, 10),
        { ...extrudeBox('b', 5, 5, 5), suppressed: true },
      ],
    };
    const stats = computeStats(tree);
    expect(stats.volume).toBeCloseTo(1000, 6);
    expect(stats.nodeCount).toBe(1);
    expect(stats.perFeature.has('b')).toBe(false);
  });
});

describe('computeStats — perFeature map fidelity', () => {
  it('keys match every non-suppressed node id', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeBox('one', 5, 5, 5),
        extrudeBox('two', 3, 3, 3),
        revolveCylinder('three', 2, 4),
      ],
    };
    const stats = computeStats(tree);
    expect([...stats.perFeature.keys()].sort()).toEqual(['one', 'three', 'two']);
  });

  it('per-node kind is echoed from payload', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeBox('e', 1, 1, 1),
        revolveCylinder('r', 1, 1),
        holeNode('h', 1, 1),
      ],
    };
    const stats = computeStats(tree);
    expect(stats.perFeature.get('e')?.kind).toBe('extrude');
    expect(stats.perFeature.get('r')?.kind).toBe('revolve');
    expect(stats.perFeature.get('h')?.kind).toBe('hole');
  });
});

describe('computeStats — bbox aggregation', () => {
  it('union spans every non-empty per-node bbox', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeBox('a', 10, 10, 10), // bbox [0..10]³
        // Shift extrude b 20mm in +X by translating the loop.
        {
          id: 'b',
          name: 'b',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 20, y: 0 },
              { x: 25, y: 0 },
              { x: 25, y: 5 },
              { x: 20, y: 5 },
            ],
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };
    const stats = computeStats(tree);
    expect(stats.bbox.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(stats.bbox.max).toEqual({ x: 25, y: 10, z: 10 });
  });

  it('centerOfMass = bbox center in Phase 1', () => {
    const tree: FeatureTree = { nodes: [extrudeBox('a', 10, 10, 10)] };
    const stats = computeStats(tree);
    expect(stats.centerOfMass).toEqual({ x: 5, y: 5, z: 5 });
  });
});

describe('computeStats — density / mass', () => {
  it('mass = volume × density when density is supplied', () => {
    const tree: FeatureTree = { nodes: [extrudeBox('a', 10, 10, 10)] };
    // steel: 0.00785 g/mm³.
    const stats = computeStats(tree, { density: 0.00785 });
    expect(stats.mass).toBeCloseTo(1000 * 0.00785, 6);
  });

  it('mass undefined when density is omitted', () => {
    const stats = computeStats({ nodes: [extrudeBox('a', 10, 10, 10)] });
    expect(stats.mass).toBeUndefined();
  });

  it('mass clamped to 0 for all-cut trees', () => {
    const tree: FeatureTree = { nodes: [holeNode('h', 4, 5)] };
    const stats = computeStats(tree, { density: 0.00785 });
    expect(stats.volume).toBeLessThan(0);
    expect(stats.mass).toBe(0);
  });
});

describe('unionBbox', () => {
  it('returns the non-empty bbox when one input is empty', () => {
    const a: Bbox = {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    };
    const b: Bbox = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };
    expect(unionBbox(a, b)).toEqual(a);
    expect(unionBbox(b, a)).toEqual(a);
  });

  it('takes axis-wise min/max of two non-empty bboxes', () => {
    const a: Bbox = {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 5, y: 5, z: 5 },
    };
    const b: Bbox = {
      min: { x: 3, y: 3, z: 3 },
      max: { x: 10, y: 10, z: 10 },
    };
    const u = unionBbox(a, b);
    expect(u.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(u.max).toEqual({ x: 10, y: 10, z: 10 });
  });
});
