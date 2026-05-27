import { describe, it, expect } from 'vitest';
import { parseGCode, summarize } from './gcodeReader';

describe('parseGCode', () => {
  it('empty input → zero blocks', () => {
    const r = parseGCode('');
    expect(r.blocks).toEqual([]);
    expect(r.motion.totalDistanceMm).toBe(0);
  });

  it('parses a single G0 line', () => {
    const r = parseGCode('G0 X10 Y20 Z5');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.command).toBe('G0');
    expect(r.blocks[0]!.params.X).toBe(10);
  });

  it('strips comments', () => {
    const r = parseGCode('G1 X5 (rapid to first cut) F100\nG1 X10 ; arbitrary comment');
    expect(r.blocks).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });

  it('handles N line labels', () => {
    const r = parseGCode('N10 G0 X5\nN20 G1 X10 F100');
    expect(r.blocks[0]!.command).toBe('G0');
    expect(r.blocks[1]!.command).toBe('G1');
  });

  it('computes XYZ travel distance', () => {
    const r = parseGCode('G0 X0\nG1 X10 Y0 F100\nG1 X10 Y10 F100');
    expect(r.motion.feedDistanceMm).toBeCloseTo(20, 5);
  });

  it('separates rapid vs feed distance', () => {
    const r = parseGCode('G0 X10\nG1 X20 F100');
    expect(r.motion.rapidDistanceMm).toBeCloseTo(10, 5);
    expect(r.motion.feedDistanceMm).toBeCloseTo(10, 5);
  });

  it('computes feed histogram', () => {
    const src = `
      G0 X0
      G1 X10 F100
      G1 Y10 F500
      G1 X20 F100
    `;
    const r = parseGCode(src);
    expect(r.feedHistogram.length).toBeGreaterThanOrEqual(2);
  });

  it('detects spindle on/off events', () => {
    const r = parseGCode('M3 S1500\nG1 X10 F100\nM5');
    expect(r.spindleEvents).toHaveLength(2);
    expect(r.spindleEvents[0]!.state).toBe('on');
    expect(r.spindleEvents[0]!.rpm).toBe(1500);
    expect(r.spindleEvents[1]!.state).toBe('off');
  });

  it('detects tool change with M6 T-arg', () => {
    const r = parseGCode('M6 T1\nM6 T3');
    expect(r.toolChanges).toHaveLength(2);
    expect(r.toolChanges[0]!.toolNumber).toBe(1);
    expect(r.toolChanges[1]!.toolNumber).toBe(3);
  });

  it('M3 = CW direction', () => {
    const r = parseGCode('M3 S1000');
    expect(r.spindleEvents[0]!.direction).toBe('CW');
  });

  it('M4 = CCW direction', () => {
    const r = parseGCode('M4 S1000');
    expect(r.spindleEvents[0]!.direction).toBe('CCW');
  });

  it('arc commands tracked', () => {
    const r = parseGCode('G2 X10 Y10 I5 J0 F100');
    expect(r.motion.arcDistanceMm).toBeGreaterThan(0);
  });

  it('bounding box covers visited extents', () => {
    const r = parseGCode('G0 X10 Y20 Z30\nG0 X-5 Y0 Z0');
    expect(r.motion.bbox.min[0]).toBe(-5);
    expect(r.motion.bbox.max[2]).toBe(30);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize(parseGCode(''));
    expect(s.blockCount).toBe(0);
    expect(s.toolChangeCount).toBe(0);
  });

  it('reports unique tool count', () => {
    const r = parseGCode('M6 T1\nM6 T3\nM6 T1');
    const s = summarize(r);
    expect(s.uniqueToolCount).toBe(2);
    expect(s.toolChangeCount).toBe(3);
  });

  it('hasArcs flag', () => {
    expect(summarize(parseGCode('G2 X10 I5 F100')).hasArcs).toBe(true);
    expect(summarize(parseGCode('G1 X10 F100')).hasArcs).toBe(false);
  });

  it('totalRunMinutes derived from feed histogram', () => {
    // 100 mm at 100 mm/min = 60 sec = 1 min.
    const r = parseGCode('G1 X100 F100');
    const s = summarize(r);
    expect(s.totalRunMinutes).toBeCloseTo(1, 1);
  });
});
