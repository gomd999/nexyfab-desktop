/**
 * sketchProfile — closed-loop extraction tests.
 */
import { describe, it, expect } from 'vitest';
import { extractClosedLoops, type ProfileInput } from './sketchProfile';

describe('extractClosedLoops', () => {
  it('triangle: 3 points + 3 lines → 1 closed loop', () => {
    const input: ProfileInput = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 5, y: 8 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' },
        { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'a' },
      ],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(1);
    expect(r.loops[0]!.points.length).toBe(3);
    expect(r.loops[0]!.lines.length).toBe(3);
    expect(r.danglingLines).toEqual([]);
    // Triangle area = (10 * 8) / 2 = 40. Sign depends on traversal.
    expect(Math.abs(r.loops[0]!.signedArea)).toBeCloseTo(40, 5);
  });

  it('rect: 4 points + 4 lines → 1 closed loop', () => {
    const input: ProfileInput = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 10, y: 5 },
        { id: 'p4', x: 0, y: 5 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
      ],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(1);
    expect(Math.abs(r.loops[0]!.signedArea)).toBeCloseTo(50, 5);
    expect(r.danglingLines).toEqual([]);
  });

  it('dangling line: 2 disconnected points + 1 line → no loops, 1 dangling', () => {
    const input: ProfileInput = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      lines: [{ id: 'l1', p1: 'a', p2: 'b' }],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(0);
    expect(r.danglingLines).toEqual(['l1']);
  });

  it('rect with one extra dangling line (T-shape variant)', () => {
    const input: ProfileInput = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 10, y: 5 },
        { id: 'p4', x: 0, y: 5 },
        { id: 'p5', x: 15, y: 5 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p1' },
        { id: 'lX', p1: 'p3', p2: 'p5' }, // dangling spur
      ],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(1);
    expect(r.danglingLines).toContain('lX');
    expect(r.danglingLines.length).toBe(1);
  });

  it('two separate rects → 2 loops', () => {
    const input: ProfileInput = {
      points: [
        { id: 'a1', x: 0, y: 0 },
        { id: 'a2', x: 5, y: 0 },
        { id: 'a3', x: 5, y: 5 },
        { id: 'a4', x: 0, y: 5 },
        { id: 'b1', x: 10, y: 0 },
        { id: 'b2', x: 15, y: 0 },
        { id: 'b3', x: 15, y: 5 },
        { id: 'b4', x: 10, y: 5 },
      ],
      lines: [
        { id: 'la1', p1: 'a1', p2: 'a2' },
        { id: 'la2', p1: 'a2', p2: 'a3' },
        { id: 'la3', p1: 'a3', p2: 'a4' },
        { id: 'la4', p1: 'a4', p2: 'a1' },
        { id: 'lb1', p1: 'b1', p2: 'b2' },
        { id: 'lb2', p1: 'b2', p2: 'b3' },
        { id: 'lb3', p1: 'b3', p2: 'b4' },
        { id: 'lb4', p1: 'b4', p2: 'b1' },
      ],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(2);
    expect(r.danglingLines).toEqual([]);
  });

  it('empty input → no loops, no dangling', () => {
    const r = extractClosedLoops({ points: [], lines: [] });
    expect(r.loops.length).toBe(0);
    expect(r.danglingLines.length).toBe(0);
  });

  it('canonical deduplication: same loop discovered twice from different seeds is reported once', () => {
    // A triangle has 3 edges; each could be a "seed". The dedup logic
    // should yield exactly 1 loop.
    const input: ProfileInput = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 4, y: 0 },
        { id: 'c', x: 0, y: 3 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' },
        { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'a' },
      ],
    };
    const r = extractClosedLoops(input);
    expect(r.loops.length).toBe(1);
  });
});
