/**
 * scadIntentFromTree tests — covers 9 FeatureKind descriptions, designIntent
 * composition, SCAD comment block format, en/ko parity, and edge cases.
 *
 * Sibling to featureTreePlanner.test.ts in structure (vitest, fixture-driven).
 */
import { describe, it, expect } from 'vitest';
import { explainFeatureTree } from './scadIntentFromTree';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { SweepFeature, LoftFeature } from '@/lib/cad/sweepLoft';
import type {
  LinearPatternFeature,
  CircularPatternFeature,
} from '@/lib/cad/pattern';
import type { HoleFeature } from '@/lib/cad/holeProfile';
import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { ChamferFeature } from '@/lib/cad/chamferProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function boxExtrude(w = 50, h = 50, d = 30): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
}

function boxNode(id = 'box_1', w = 50, h = 50, d = 30): FeatureNode {
  return {
    id,
    name: `Box ${w}x${h}x${d}`,
    dependencies: [],
    payload: boxExtrude(w, h, d),
  };
}

function holeNode(id = 'hole_1', parentId = 'box_1'): FeatureNode {
  const payload: HoleFeature = {
    kind: 'hole',
    center: { x: 20, y: 30 },
    holeType: 'drilled',
    diameter: 5,
    depth: 20,
  };
  return { id, name: 'Hole', dependencies: [parentId], payload };
}

function filletNode(id = 'fillet_1', parentId = 'box_1', r = 2): FeatureNode {
  const payload: FilletFeature = {
    kind: 'fillet',
    childExtrude: boxExtrude(),
    radius: r,
    edgeSelection: 'all',
  };
  return { id, name: `Fillet r${r}`, dependencies: [parentId], payload };
}

function chamferNode(id = 'chamfer_1', parentId = 'box_1', d = 1.5): FeatureNode {
  const payload: ChamferFeature = {
    kind: 'chamfer',
    childExtrude: boxExtrude(),
    distance: d,
    edgeSelection: 'top',
  };
  return { id, name: `Chamfer d${d}`, dependencies: [parentId], payload };
}

function revolveNode(id = 'rev_1'): FeatureNode {
  const payload: RevolveFeature = {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
  return { id, name: 'Revolve', dependencies: [], payload };
}

function sweepNode(id = 'sweep_1'): FeatureNode {
  const payload: SweepFeature = {
    kind: 'sweep',
    profile: {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
    },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
    ],
    mode: 'add',
  };
  return { id, name: 'Sweep', dependencies: [], payload };
}

function loftNode(id = 'loft_1'): FeatureNode {
  const payload: LoftFeature = {
    kind: 'loft',
    sections: [
      {
        profile: {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
        z: 0,
      },
      {
        profile: {
          points: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 },
          ],
        },
        z: 20,
      },
    ],
    mode: 'add',
  };
  return { id, name: 'Loft', dependencies: [], payload };
}

function linearPatternNode(id = 'lp_1', parentId = 'box_1'): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: `// pattern_child_ref:${parentId}`,
    count: 5,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 30,
  };
  return {
    id,
    name: 'Linear pattern',
    dependencies: [parentId],
    payload,
  };
}

function circularPatternNode(id = 'cp_1', parentId = 'box_1'): FeatureNode {
  const payload: CircularPatternFeature = {
    kind: 'circular_pattern',
    childScad: `// pattern_child_ref:${parentId}`,
    count: 6,
    axisOrigin: { x: 0, y: 0, z: 0 },
    axisDirection: { x: 0, y: 0, z: 1 },
    totalAngleDegrees: 360,
  };
  return {
    id,
    name: 'Circular pattern',
    dependencies: [parentId],
    payload,
  };
}

// ─── basics ───────────────────────────────────────────────────────────────

describe('explainFeatureTree — basics', () => {
  it('empty tree → empty features, warning, empty scadComments', () => {
    const tree: FeatureTree = { nodes: [] };
    const ex = explainFeatureTree(tree);
    expect(ex.features).toEqual([]);
    expect(ex.scadComments).toBe('');
    expect(ex.warnings.length).toBeGreaterThan(0);
    expect(ex.designIntent.toLowerCase()).toContain('empty');
  });

  it('single extrude → 1 feature + designIntent describes the box', () => {
    const tree: FeatureTree = { nodes: [boxNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.features).toHaveLength(1);
    expect(ex.features[0]!.kind).toBe('extrude');
    expect(ex.features[0]!.intentDescription).toMatch(/extrude/i);
    expect(ex.features[0]!.intentDescription).toMatch(/30/); // depth
    expect(ex.features[0]!.parameters.depth).toBe(30);
    expect(ex.designIntent).toMatch(/extrude/i);
  });

  it('extrude + fillet → 2 features, designIntent mentions modifiers', () => {
    const tree: FeatureTree = { nodes: [boxNode(), filletNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.features).toHaveLength(2);
    expect(ex.features[0]!.kind).toBe('extrude');
    expect(ex.features[1]!.kind).toBe('fillet');
    expect(ex.designIntent.toLowerCase()).toMatch(/fillet/);
    expect(ex.scadComments).toContain('Step 1');
    expect(ex.scadComments).toContain('Step 2');
  });

  it('parameters echo raw values', () => {
    const tree: FeatureTree = { nodes: [boxNode('box', 100, 80, 25)] };
    const ex = explainFeatureTree(tree);
    const params = ex.features[0]!.parameters;
    expect(params.profileWidth).toBe(100);
    expect(params.profileHeight).toBe(80);
    expect(params.depth).toBe(25);
    expect(params.mode).toBe('add');
  });
});

// ─── per-kind descriptions (covers all 9 FeatureKind values) ──────────────

describe('explainFeatureTree — per-kind descriptions', () => {
  it('extrude rect: width × height surface in description', () => {
    const tree: FeatureTree = { nodes: [boxNode('e', 50, 50, 30)] };
    const ex = explainFeatureTree(tree);
    expect(ex.features[0]!.intentDescription).toMatch(/50/);
    expect(ex.features[0]!.intentDescription).toMatch(/30/);
  });

  it('revolve: angle + radius in description', () => {
    const tree: FeatureTree = { nodes: [revolveNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.features[0]!.intentDescription).toMatch(/360/);
    expect(ex.features[0]!.intentDescription).toMatch(/10/); // radius
    expect(ex.features[0]!.parameters.angleDegrees).toBe(360);
  });

  it('sweep: profile vertex count + path length', () => {
    const tree: FeatureTree = { nodes: [sweepNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.features[0]!.intentDescription).toMatch(/sweep/i);
    expect(ex.features[0]!.parameters.pathPointCount).toBe(3);
    // Path = (0,0,0)→(10,0,0)=10 + (10,0,0)→(10,10,0)=10 = 20.
    expect(ex.features[0]!.parameters.pathLength).toBeCloseTo(20, 3);
  });

  it('loft: section count + z span', () => {
    const tree: FeatureTree = { nodes: [loftNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.features[0]!.intentDescription).toMatch(/loft/i);
    expect(ex.features[0]!.parameters.sectionCount).toBe(2);
    expect(ex.features[0]!.parameters.zSpan).toBe(20);
  });

  it('linear_pattern: count + spacing + dominant axis', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), linearPatternNode()],
    };
    const ex = explainFeatureTree(tree);
    const lp = ex.features.find((f) => f.kind === 'linear_pattern')!;
    expect(lp.intentDescription).toMatch(/5/);
    expect(lp.intentDescription).toMatch(/30/);
    expect(lp.intentDescription).toMatch(/\+X/);
    expect(lp.parameters.dominantAxis).toBe('+X');
  });

  it('circular_pattern: count + angle + axis', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), circularPatternNode()],
    };
    const ex = explainFeatureTree(tree);
    const cp = ex.features.find((f) => f.kind === 'circular_pattern')!;
    expect(cp.intentDescription).toMatch(/6/);
    expect(cp.intentDescription).toMatch(/360/);
    expect(cp.intentDescription).toMatch(/\+Z/);
  });

  it('hole (drilled): diameter + depth + position', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), holeNode()],
    };
    const ex = explainFeatureTree(tree);
    const h = ex.features.find((f) => f.kind === 'hole')!;
    expect(h.intentDescription).toMatch(/5/); // diameter
    expect(h.intentDescription).toMatch(/20/); // depth
    expect(h.intentDescription).toMatch(/\(20, 30\)/);
    expect(h.parameters.holeType).toBe('drilled');
  });

  it('hole (counterbore): description uses counterbore wording', () => {
    const counterbore: FeatureNode = {
      id: 'h_cb',
      name: 'CB',
      dependencies: ['box_1'],
      payload: {
        kind: 'hole',
        center: { x: 0, y: 0 },
        holeType: 'counterbore',
        diameter: 5,
        depth: 20,
        counterboreDiameter: 10,
        counterboreDepth: 4,
      },
    };
    const tree: FeatureTree = { nodes: [boxNode(), counterbore] };
    const ex = explainFeatureTree(tree);
    const h = ex.features.find((f) => f.kind === 'hole')!;
    expect(h.intentDescription.toLowerCase()).toMatch(/counterbore/);
  });

  it('fillet: radius + edgeSelection mentioned', () => {
    const tree: FeatureTree = { nodes: [boxNode(), filletNode('f', 'box_1', 3.5)] };
    const ex = explainFeatureTree(tree);
    const f = ex.features.find((x) => x.kind === 'fillet')!;
    expect(f.intentDescription).toMatch(/3\.5/);
    expect(f.intentDescription.toLowerCase()).toMatch(/all edges/);
  });

  it('chamfer: distance + edgeSelection mentioned', () => {
    const tree: FeatureTree = { nodes: [boxNode(), chamferNode('c', 'box_1', 1.5)] };
    const ex = explainFeatureTree(tree);
    const c = ex.features.find((x) => x.kind === 'chamfer')!;
    expect(c.intentDescription).toMatch(/1\.5/);
    expect(c.intentDescription.toLowerCase()).toMatch(/top edges/);
  });

  it('all 9 kinds described in a mixed tree', () => {
    const tree: FeatureTree = {
      nodes: [
        boxNode('e1'),
        revolveNode('r1'),
        sweepNode('s1'),
        loftNode('l1'),
        linearPatternNode('lp1', 'e1'),
        circularPatternNode('cp1', 'e1'),
        holeNode('h1', 'e1'),
        filletNode('f1', 'e1'),
        chamferNode('c1', 'e1'),
      ],
    };
    const ex = explainFeatureTree(tree);
    expect(ex.features).toHaveLength(9);
    const kinds = new Set(ex.features.map((f) => f.kind));
    expect(kinds.size).toBe(9);
  });
});

// ─── designIntent composition ─────────────────────────────────────────────

describe('explainFeatureTree — designIntent composition', () => {
  it('single feature → its description is the intent', () => {
    const tree: FeatureTree = { nodes: [boxNode()] };
    const ex = explainFeatureTree(tree);
    expect(ex.designIntent).toContain(ex.features[0]!.intentDescription);
  });

  it('box + 2 holes → modifier clause includes "2 hole(s)"', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), holeNode('h1'), holeNode('h2')],
    };
    const ex = explainFeatureTree(tree);
    expect(ex.designIntent).toMatch(/2 hole/);
  });

  it('box + fillet + chamfer → both modifier kinds appear', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), filletNode('f'), chamferNode('c')],
    };
    const ex = explainFeatureTree(tree);
    expect(ex.designIntent.toLowerCase()).toMatch(/fillet/);
    expect(ex.designIntent.toLowerCase()).toMatch(/chamfer/);
  });

  it('aggregate volume appended to designIntent', () => {
    const tree: FeatureTree = { nodes: [boxNode('e', 50, 50, 30)] };
    const ex = explainFeatureTree(tree);
    // 50*50*30 = 75000mm^3
    expect(ex.designIntent).toMatch(/75000/);
  });
});

// ─── SCAD comments ────────────────────────────────────────────────────────

describe('explainFeatureTree — scadComments', () => {
  it('comments include step header, intent line, and depends-on when present', () => {
    const tree: FeatureTree = { nodes: [boxNode('b'), holeNode('h', 'b')] };
    const ex = explainFeatureTree(tree);
    expect(ex.scadComments).toMatch(/Step 1/);
    expect(ex.scadComments).toMatch(/Step 2/);
    expect(ex.scadComments).toMatch(/Intent/);
    expect(ex.scadComments).toMatch(/Depends on: b/);
  });

  it('suppressed nodes are excluded from comments + features', () => {
    const supp: FeatureNode = { ...boxNode('a'), suppressed: true };
    const tree: FeatureTree = { nodes: [supp, boxNode('b', 10, 10, 10)] };
    const ex = explainFeatureTree(tree);
    expect(ex.features).toHaveLength(1);
    expect(ex.features[0]!.nodeId).toBe('b');
    expect(ex.scadComments).not.toMatch(/\(a\)/);
  });

  it('every comment line starts with `//`', () => {
    const tree: FeatureTree = { nodes: [boxNode(), filletNode()] };
    const ex = explainFeatureTree(tree);
    for (const line of ex.scadComments.split('\n')) {
      if (line.trim() === '') continue;
      expect(line.startsWith('//')).toBe(true);
    }
  });
});

// ─── i18n: ko vs en ───────────────────────────────────────────────────────

describe('explainFeatureTree — i18n', () => {
  it('lang=ko switches the description to Korean', () => {
    const tree: FeatureTree = { nodes: [boxNode()] };
    const ex = explainFeatureTree(tree, { lang: 'ko' });
    expect(ex.features[0]!.intentDescription).toMatch(/돌출/);
  });

  it('lang=ko renders the empty-tree message in Korean', () => {
    const tree: FeatureTree = { nodes: [] };
    const ex = explainFeatureTree(tree, { lang: 'ko' });
    expect(ex.designIntent).toMatch(/비어/);
  });

  it('lang=ko renders the fillet description with Korean edge label', () => {
    const tree: FeatureTree = { nodes: [boxNode(), filletNode()] };
    const ex = explainFeatureTree(tree, { lang: 'ko' });
    const f = ex.features.find((x) => x.kind === 'fillet')!;
    expect(f.intentDescription).toMatch(/필렛/);
    expect(f.intentDescription).toMatch(/전체 에지/);
  });

  it('lang=ko comments use Korean step prefix + intent label', () => {
    const tree: FeatureTree = { nodes: [boxNode()] };
    const ex = explainFeatureTree(tree, { lang: 'ko' });
    expect(ex.scadComments).toMatch(/단계 1/);
    expect(ex.scadComments).toMatch(/의도/);
  });

  it('ko + en produce structurally identical feature counts + kinds', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), filletNode(), holeNode()],
    };
    const en = explainFeatureTree(tree, { lang: 'en' });
    const ko = explainFeatureTree(tree, { lang: 'ko' });
    expect(en.features.length).toBe(ko.features.length);
    expect(en.features.map((f) => f.kind)).toEqual(
      ko.features.map((f) => f.kind),
    );
    expect(en.features.map((f) => f.nodeId)).toEqual(
      ko.features.map((f) => f.nodeId),
    );
  });
});

// ─── warnings ─────────────────────────────────────────────────────────────

describe('explainFeatureTree — warnings', () => {
  it('warns on zero-diameter hole', () => {
    const bad: FeatureNode = {
      id: 'h',
      name: 'bad hole',
      dependencies: ['box_1'],
      payload: {
        kind: 'hole',
        center: { x: 0, y: 0 },
        holeType: 'drilled',
        diameter: 0,
        depth: 10,
      },
    };
    const tree: FeatureTree = { nodes: [boxNode(), bad] };
    const ex = explainFeatureTree(tree);
    expect(ex.warnings.some((w) => /diameter/i.test(w))).toBe(true);
  });
});

// ─── determinism ──────────────────────────────────────────────────────────

describe('explainFeatureTree — determinism', () => {
  it('identical input → identical output', () => {
    const tree: FeatureTree = {
      nodes: [boxNode(), filletNode(), holeNode()],
    };
    const a = explainFeatureTree(tree);
    const b = explainFeatureTree(tree);
    expect(a.scadComments).toBe(b.scadComments);
    expect(a.designIntent).toBe(b.designIntent);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
  });
});
