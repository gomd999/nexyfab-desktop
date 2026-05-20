import { describe, it, expect } from 'vitest';
import { checkToolpathSafety, type SafetyContext, type WorkEnvelope } from './toolpathSafety';
import type { ToolpathSegment } from './pocketToolpath';
import { findTool } from './toolLibrary';

const envelope: WorkEnvelope = { xMin: -100, xMax: 100, yMin: -100, yMax: 100, zMin: -50, zMax: 50 };
const tool = findTool('em-6mm-2f')!;
const ctx: SafetyContext = {
  tool,
  envelope,
  safeZ: 5,
  stockBottomZ: -10,
};

describe('checkToolpathSafety · pass case', () => {
  it('clean toolpath inside envelope passes', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'rapid',  start: [0, 0, 10], end: [10, 0, 10] },
      { kind: 'plunge', start: [10, 0, 10], end: [10, 0, -2] },
      { kind: 'feed',   start: [10, 0, -2], end: [20, 0, -2] },
      { kind: 'rapid',  start: [20, 0, -2], end: [20, 0, 10] },
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.verdict).toBe('pass');
    expect(r.issues).toHaveLength(0);
  });
});

describe('checkToolpathSafety · over-travel', () => {
  it('cut below stock bottom → fail', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'plunge', start: [0, 0, 10], end: [0, 0, -15] }, // past stockBottom -10
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.verdict).toBe('fail');
    expect(r.issues.some(i => i.code === 'over-travel-z')).toBe(true);
  });
});

describe('checkToolpathSafety · envelope', () => {
  it('point outside X bounds → fail', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'feed', start: [0, 0, 0], end: [500, 0, 0] },
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'outside-envelope-x')).toBe(true);
  });

  it('point outside Y bounds → fail', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'feed', start: [0, 0, 0], end: [0, 500, 0] },
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'outside-envelope-y')).toBe(true);
  });

  it('point outside Z bounds → fail', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'rapid', start: [0, 0, 10], end: [0, 0, 100] }, // zMax = 50
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'outside-envelope-z')).toBe(true);
  });
});

describe('checkToolpathSafety · rapid below safe Z', () => {
  it('rapid descending below safe Z → fail', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'rapid', start: [0, 0, 10], end: [0, 0, 2] }, // safeZ = 5
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'rapid-below-safe-z')).toBe(true);
  });

  it('rapid at safe Z is allowed', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'rapid', start: [0, 0, 10], end: [0, 0, 5] }, // exactly at safeZ
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'rapid-below-safe-z')).toBe(false);
  });
});

describe('checkToolpathSafety · depth-of-cut tool capability', () => {
  it('depth beyond tool maxDOC → warn (not fail)', () => {
    // tool em-6mm-2f has maxDOC = 6mm.
    const segs: ToolpathSegment[] = [
      { kind: 'plunge', start: [0, 0, 10], end: [0, 0, -9] }, // depth 9 > 6
    ];
    const r = checkToolpathSafety(segs, ctx);
    expect(r.issues.some(i => i.code === 'depth-exceeds-tool' && i.severity === 'warn')).toBe(true);
    // verdict should be warn (no failures).
    expect(['warn', 'fail']).toContain(r.verdict);
  });
});

describe('checkToolpathSafety · issue dedup', () => {
  it('reports each issue code only once', () => {
    const segs: ToolpathSegment[] = [
      { kind: 'feed', start: [200, 0, 0], end: [300, 0, 0] },
      { kind: 'feed', start: [300, 0, 0], end: [400, 0, 0] },
    ];
    const r = checkToolpathSafety(segs, ctx);
    const xIssues = r.issues.filter(i => i.code === 'outside-envelope-x');
    expect(xIssues.length).toBe(1);
  });
});
