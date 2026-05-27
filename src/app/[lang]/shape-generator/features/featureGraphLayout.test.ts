import { describe, it, expect } from 'vitest';
import {
  layoutFeatureGraph,
  findCriticalPath,
  renderGraphSvg,
} from './featureGraphLayout';
import type { FeatureNode } from './featureGraph';

const sample: FeatureNode[] = [
  { id: 'base', kind: 'box', parentIds: [] },
  { id: 'hole-1', kind: 'hole', parentIds: ['base'] },
  { id: 'hole-2', kind: 'hole', parentIds: ['base'] },
  { id: 'fillet', kind: 'fillet', parentIds: ['hole-1'] },
  { id: 'chamfer', kind: 'chamfer', parentIds: ['fillet'] },
];

describe('layoutFeatureGraph', () => {
  it('emits one layout node per feature', () => {
    const r = layoutFeatureGraph(sample);
    expect(r.nodes).toHaveLength(5);
  });

  it('node level 0 = root', () => {
    const r = layoutFeatureGraph(sample);
    const baseNode = r.nodes.find(n => n.id === 'base')!;
    expect(baseNode.level).toBe(0);
  });

  it('child levels increase', () => {
    const r = layoutFeatureGraph(sample);
    const lookup = new Map(r.nodes.map(n => [n.id, n]));
    expect(lookup.get('chamfer')!.level).toBeGreaterThan(lookup.get('fillet')!.level);
  });

  it('emits one edge per parent reference', () => {
    const r = layoutFeatureGraph(sample);
    // 5 nodes, 4 edges total (base→hole1, base→hole2, hole1→fillet, fillet→chamfer).
    expect(r.edges).toHaveLength(4);
  });

  it('every edge has 4 waypoints (right-angle routing)', () => {
    const r = layoutFeatureGraph(sample);
    for (const e of r.edges) {
      expect(e.waypoints).toHaveLength(4);
    }
  });

  it('custom spacing options applied', () => {
    const wide = layoutFeatureGraph(sample, { levelSpacing: 400 });
    const baseNode = wide.nodes.find(n => n.id === 'base')!;
    const filletNode = wide.nodes.find(n => n.id === 'fillet')!;
    // fillet is 2 levels right of base → x diff = 800.
    expect(filletNode.x - baseNode.x).toBe(800);
  });

  it('bbox encloses every node', () => {
    const r = layoutFeatureGraph(sample);
    for (const n of r.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(r.bbox.minX);
      expect(n.x + n.width).toBeLessThanOrEqual(r.bbox.maxX);
    }
  });
});

describe('findCriticalPath', () => {
  it('returns chain when timings make a clear winner', () => {
    const timings = new Map([
      ['base', 1], ['hole-1', 5], ['hole-2', 1],
      ['fillet', 10], ['chamfer', 3],
    ]);
    const path = findCriticalPath(sample, timings);
    expect(path).toEqual(['base', 'hole-1', 'fillet', 'chamfer']);
  });

  it('empty graph returns empty path', () => {
    expect(findCriticalPath([], new Map())).toHaveLength(0);
  });
});

describe('renderGraphSvg', () => {
  it('emits valid SVG envelope', () => {
    const layout = layoutFeatureGraph(sample);
    const svg = renderGraphSvg(layout);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('</svg>');
  });

  it('highlights critical path edges + nodes', () => {
    const layout = layoutFeatureGraph(sample);
    const svg = renderGraphSvg(layout, { highlightPath: ['base', 'hole-1', 'fillet'] });
    // Highlight color present in output.
    expect(svg).toContain('#ef4444');
  });

  it('labels appear in text elements', () => {
    const layout = layoutFeatureGraph(sample);
    const svg = renderGraphSvg(layout);
    expect(svg).toContain('chamfer');
    expect(svg).toContain('base');
  });

  it('custom colors honored', () => {
    const layout = layoutFeatureGraph(sample);
    const svg = renderGraphSvg(layout, { nodeColor: '#123456', edgeColor: '#abcdef' });
    expect(svg).toContain('#123456');
    expect(svg).toContain('#abcdef');
  });
});
