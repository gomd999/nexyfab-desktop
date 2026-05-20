import { describe, it, expect } from 'vitest';
import {
  scoreGates,
  rankGates,
  recommendGate,
  summarize,
  type GateCandidate,
  type PartProperties,
} from './gateSuitability';

const part: PartProperties = {
  wallThicknessMm: 2,
  longestFlowMm: 200,
  maxFlowLengthRatio: 200,
};

function gate(id: string, diameter: number, kind: GateCandidate['kind'], cosmetic: boolean = false): GateCandidate {
  return { id, position: { x: 0, y: 0, z: 0 }, diameterMm: diameter, kind, cosmetic };
}

describe('scoreGates', () => {
  it('empty → empty', () => {
    expect(scoreGates([], part)).toEqual([]);
  });

  it('ideal gate scores high', () => {
    // d/t = 1.4/2 = 0.7 (ideal range 0.5-0.9), good kind hot-tip.
    const scores = scoreGates([gate('g1', 1.4, 'hot-tip', false)], part);
    expect(scores[0]!.totalScore).toBeGreaterThan(80);
  });

  it('jetting risk when gate too small', () => {
    const scores = scoreGates([gate('g1', 0.2, 'edge', false)], part);
    expect(scores[0]!.thicknessScore).toBeLessThan(10);
    expect(scores[0]!.rationale.some(r => r.includes('jetting'))).toBe(true);
  });

  it('freeze-off warning when gate too large', () => {
    const scores = scoreGates([gate('g1', 5, 'edge', false)], part);
    expect(scores[0]!.rationale.some(r => r.includes('freeze-off') || r.includes('over-sized'))).toBe(true);
  });

  it('cosmetic visible penalty', () => {
    const visible = scoreGates([gate('g1', 1.4, 'edge', true)], part);
    const hidden = scoreGates([gate('g2', 1.4, 'edge', false)], part);
    expect(visible[0]!.cosmeticScore).toBeLessThan(hidden[0]!.cosmeticScore);
  });

  it('cosmetic with removable gate type → partial credit', () => {
    const scores = scoreGates([gate('g1', 1.4, 'submarine', true)], part);
    expect(scores[0]!.cosmeticScore).toBeGreaterThan(0);
    expect(scores[0]!.cosmeticScore).toBeLessThan(20);
  });

  it('flow length within budget → high flowLengthScore', () => {
    // L/T = 200/2 = 100 < 200*0.8 = 160 → full score.
    const scores = scoreGates([gate('g1', 1.4, 'edge', false)], part);
    expect(scores[0]!.flowLengthScore).toBe(30);
  });

  it('flow length exceeded → low flowLengthScore', () => {
    const farPart: PartProperties = { wallThicknessMm: 2, longestFlowMm: 500, maxFlowLengthRatio: 200 };
    const scores = scoreGates([gate('g1', 1.4, 'edge', false)], farPart);
    expect(scores[0]!.flowLengthScore).toBeLessThan(15);
    expect(scores[0]!.rationale.some(r => r.includes('short-shot') || r.includes('exceeds'))).toBe(true);
  });
});

describe('rankGates', () => {
  it('sorts by descending totalScore', () => {
    const candidates = [
      gate('low', 0.2, 'edge', true),
      gate('high', 1.4, 'hot-tip', false),
    ];
    const ranked = rankGates(candidates, part);
    expect(ranked[0]!.id).toBe('high');
  });
});

describe('recommendGate', () => {
  it('empty candidates → not acceptable', () => {
    expect(recommendGate([], part).acceptable).toBe(false);
  });

  it('good candidate → acceptable', () => {
    const result = recommendGate([gate('g1', 1.4, 'hot-tip', false)], part);
    expect(result.acceptable).toBe(true);
    expect(result.bestId).toBe('g1');
  });

  it('weak candidate → not acceptable', () => {
    const result = recommendGate([gate('g1', 0.1, 'sprue', true)], part);
    expect(result.acceptable).toBe(false);
  });
});

describe('summarize', () => {
  it('reports counts + stats', () => {
    const scores = scoreGates(
      [gate('g1', 1.4, 'hot-tip', false), gate('g2', 0.1, 'sprue', true)],
      part,
    );
    const s = summarize(scores);
    expect(s.candidateCount).toBe(2);
    expect(s.maxScore).toBeGreaterThan(s.meanScore);
  });

  it('empty → zeros', () => {
    const s = summarize([]);
    expect(s.candidateCount).toBe(0);
    expect(s.maxScore).toBe(0);
  });

  it('acceptableCount filters at 60', () => {
    const scores = scoreGates(
      [gate('g1', 1.4, 'hot-tip', false), gate('g2', 0.1, 'sprue', true)],
      part,
    );
    expect(summarize(scores).acceptableCount).toBe(1);
  });
});
