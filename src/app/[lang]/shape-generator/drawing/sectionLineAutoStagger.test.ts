import { describe, it, expect } from 'vitest';
import {
  staggerSectionLabels,
  findLabelOverlaps,
  summarize,
  DEFAULT_OPTIONS,
  type SectionLine,
  type ViewBox,
} from './sectionLineAutoStagger';

function section(id: string, label: string, x0: number, y0: number, x1: number, y1: number): SectionLine {
  return { id, label, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, direction: 1 };
}

describe('staggerSectionLabels', () => {
  it('empty input → empty output', () => {
    expect(staggerSectionLabels([], [])).toEqual([]);
  });

  it('section with no views → natural offset position', () => {
    const labels = staggerSectionLabels([section('s1', 'A', 0, 0, 10, 0)], []);
    expect(labels[0]!.flipped).toBe(false);
    expect(labels[0]!.displacementMm).toBeCloseTo(DEFAULT_OPTIONS.labelOffsetMm, 3);
  });

  it('label avoids view box when in default position', () => {
    const sec = section('s1', 'A', 0, 0, 10, 0);
    const view: ViewBox = { id: 'v1', min: { x: 5, y: 0 }, max: { x: 15, y: 10 } };
    const labels = staggerSectionLabels([sec], [view]);
    expect(labels[0]!.flipped).toBe(true);
  });

  it('degenerate (zero-length) section → label at start', () => {
    const sec = section('s1', 'A', 5, 5, 5, 5);
    const labels = staggerSectionLabels([sec], []);
    expect(labels[0]!.position).toEqual({ x: 5, y: 5 });
  });

  it('multiple sections produce one label each', () => {
    const labels = staggerSectionLabels([
      section('s1', 'A', 0, 0, 10, 0),
      section('s2', 'B', 0, 10, 10, 10),
    ], []);
    expect(labels).toHaveLength(2);
  });

  it('displacement is offset distance', () => {
    const labels = staggerSectionLabels([section('s1', 'A', 0, 0, 10, 0)], []);
    expect(labels[0]!.displacementMm).toBeGreaterThan(0);
  });

  it('label clears view when sufficient offset', () => {
    const sec = section('s1', 'A', 0, 0, 10, 0);
    const view: ViewBox = { id: 'v1', min: { x: -20, y: -20 }, max: { x: -10, y: -10 } };
    const labels = staggerSectionLabels([sec], [view]);
    expect(labels[0]!.flipped).toBe(false);
  });
});

describe('findLabelOverlaps', () => {
  it('non-overlapping labels → empty', () => {
    const labels = staggerSectionLabels([
      section('s1', 'A', 0, 0, 10, 0),
      section('s2', 'B', 0, 100, 10, 100),
    ], []);
    expect(findLabelOverlaps(labels)).toEqual([]);
  });

  it('two labels at same position → overlap', () => {
    const labels = [
      { sectionId: 's1', label: 'A', position: { x: 0, y: 0 }, flipped: false, displacementMm: 0 },
      { sectionId: 's2', label: 'B', position: { x: 1, y: 0 }, flipped: false, displacementMm: 0 },
    ];
    expect(findLabelOverlaps(labels)).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const sec = section('s1', 'A', 0, 0, 10, 0);
    const view: ViewBox = { id: 'v1', min: { x: 5, y: 0 }, max: { x: 15, y: 10 } };
    const labels = staggerSectionLabels([sec], [view]);
    const s = summarize(labels);
    expect(s.sectionCount).toBe(1);
    expect(s.flippedCount).toBeGreaterThanOrEqual(0);
  });

  it('maxDisplacement non-negative', () => {
    const labels = staggerSectionLabels([section('s1', 'A', 0, 0, 10, 0)], []);
    expect(summarize(labels).maxDisplacementMm).toBeGreaterThanOrEqual(0);
  });
});
