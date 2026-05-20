import { describe, it, expect } from 'vitest';
import {
  scanToolpathCollision,
  computeRetractZ,
  clearancePlanes,
  type AABB,
  type CapsuleTool,
  type ToolpathSample,
} from './toolpathCollision';

const tool: CapsuleTool = {
  tipDiameterMm: 6,
  shankDiameterMm: 6,
  fluteLengthMm: 20,
  holderDiameterMm: 30,
  holderLengthMm: 50,
  tipType: 'flat',
};

const verticalAxis: [number, number, number] = [0, 0, 1];

describe('scanToolpathCollision', () => {
  it('no events when toolpath clears all fixtures', () => {
    const toolpath: ToolpathSample[] = [
      { position: [50, 50, 0], axis: verticalAxis },
      { position: [60, 50, 0], axis: verticalAxis },
    ];
    const fixtures: AABB[] = [
      { id: 'vise', min: [-100, -100, -50], max: [-50, 100, 0] },
    ];
    const r = scanToolpathCollision(toolpath, tool, fixtures);
    expect(r.events).toHaveLength(0);
    expect(r.collidingSamples).toBe(0);
  });

  it('flags collision when tool tip enters fixture box', () => {
    const toolpath: ToolpathSample[] = [
      { position: [0, 0, 0], axis: verticalAxis },
    ];
    const fixtures: AABB[] = [
      { id: 'clamp', min: [-5, -5, -10], max: [5, 5, 0], label: 'Clamp 1' },
    ];
    const r = scanToolpathCollision(toolpath, tool, fixtures);
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events[0]!.fixtureId).toBe('clamp');
  });

  it('different regions hit different fixtures', () => {
    // Tool tip in free space, but holder hits an overhead obstacle.
    const toolpath: ToolpathSample[] = [
      { position: [0, 0, 0], axis: verticalAxis },
    ];
    const fixtures: AABB[] = [
      // Above the tool — only the holder reaches it.
      { id: 'gantry', min: [-50, -50, 60], max: [50, 50, 80] },
    ];
    const r = scanToolpathCollision(toolpath, tool, fixtures);
    const holderHits = r.events.filter(e => e.toolRegion === 'holder');
    expect(holderHits.length).toBeGreaterThan(0);
  });

  it('per-fixture event counts', () => {
    const toolpath: ToolpathSample[] = [
      { position: [0, 0, 0], axis: verticalAxis },
      { position: [0, 0, 0], axis: verticalAxis },
    ];
    const fixtures: AABB[] = [
      { id: 'F1', min: [-5, -5, -10], max: [5, 5, 0] },
    ];
    const r = scanToolpathCollision(toolpath, tool, fixtures);
    expect(r.perFixture['F1']).toBeGreaterThanOrEqual(2);
  });

  it('reports max penetration depth', () => {
    const toolpath: ToolpathSample[] = [
      { position: [0, 0, 0], axis: verticalAxis },
    ];
    const fixtures: AABB[] = [
      // Deep clamp — tool tip well inside.
      { id: 'deep', min: [-10, -10, -100], max: [10, 10, 10] },
    ];
    const r = scanToolpathCollision(toolpath, tool, fixtures);
    expect(r.maxDepthMm).toBeGreaterThan(0);
  });
});

describe('computeRetractZ', () => {
  it('returns safety only when no fixtures', () => {
    expect(computeRetractZ([], 15, 5)).toBe(5);
  });

  it('clears highest fixture top + holder radius + safety', () => {
    const r = computeRetractZ(
      [{ id: 'a', min: [0, 0, 0], max: [10, 10, 30] }],
      15,
      5,
    );
    expect(r).toBe(30 + 5 + 15);
  });

  it('picks the highest fixture top', () => {
    const r = computeRetractZ(
      [
        { id: 'a', min: [0, 0, 0], max: [10, 10, 20] },
        { id: 'b', min: [0, 0, 0], max: [10, 10, 50] },
      ],
      10,
      2,
    );
    expect(r).toBe(50 + 2 + 10);
  });
});

describe('clearancePlanes', () => {
  it('feed clearance Z = highest cut + 2', () => {
    const toolpath: ToolpathSample[] = [
      { position: [0, 0, -10], axis: verticalAxis },
      { position: [0, 0, -5], axis: verticalAxis },
    ];
    const r = clearancePlanes(toolpath, [], tool);
    expect(r.feedClearanceZ).toBe(-3);
  });

  it('rapid clearance above all fixtures', () => {
    const fixtures: AABB[] = [{ id: 'a', min: [0, 0, 0], max: [10, 10, 40] }];
    const r = clearancePlanes(
      [{ position: [0, 0, -10], axis: verticalAxis }],
      fixtures,
      tool,
    );
    expect(r.rapidClearanceZ).toBeGreaterThan(40);
  });
});
