import { describe, it, expect } from 'vitest';
import {
  generateFrame,
  generateLadderFrame,
  generateTubeFrame,
  generateMonocoqueFrame,
  computeFrameStats,
  CHASSIS_PRESETS,
} from './parametricChassis';

describe('ladder frame', () => {
  it('produces expected node + member count', () => {
    const f = generateLadderFrame({
      kind: 'ladder', lengthMm: 1000, widthMm: 500, crossMemberCount: 4,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    // 5 cross positions × 2 sides = 10 nodes.
    expect(f.nodes).toHaveLength(10);
    // 8 rail members + 5 cross = 13.
    expect(f.members).toHaveLength(13);
  });

  it('bbox covers full length and width', () => {
    const f = generateLadderFrame({
      kind: 'ladder', lengthMm: 1200, widthMm: 600, crossMemberCount: 2,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    expect(f.bbox.max[0]).toBe(1200);
    expect(f.bbox.max[1]).toBe(300);
  });
});

describe('tube frame', () => {
  it('8 corners + 12 box edges', () => {
    const f = generateTubeFrame({
      kind: 'tube', lengthMm: 1000, widthMm: 500, heightMm: 600,
      bracing: 'none', tubeDiameterMm: 30, wallThicknessMm: 2,
    });
    expect(f.nodes).toHaveLength(8);
    expect(f.members).toHaveLength(12);
  });

  it('x-brace adds diagonals', () => {
    const f = generateTubeFrame({
      kind: 'tube', lengthMm: 1000, widthMm: 500, heightMm: 600,
      bracing: 'x-brace', tubeDiameterMm: 30, wallThicknessMm: 2,
    });
    expect(f.members.length).toBeGreaterThan(12);
  });

  it('k-brace adds 2 diagonals', () => {
    const f = generateTubeFrame({
      kind: 'tube', lengthMm: 1000, widthMm: 500, heightMm: 600,
      bracing: 'k-brace', tubeDiameterMm: 30, wallThicknessMm: 2,
    });
    expect(f.members.length).toBe(14);
  });
});

describe('monocoque frame', () => {
  it('4 outline edges + stiffeners', () => {
    const f = generateMonocoqueFrame({
      kind: 'monocoque', lengthMm: 400, widthMm: 400, heightMm: 80,
      panelThicknessMm: 3, stiffenerCount: 2,
    });
    expect(f.members.length).toBe(6); // 4 outline + 2 stiffeners
  });

  it('no stiffeners → just outline', () => {
    const f = generateMonocoqueFrame({
      kind: 'monocoque', lengthMm: 400, widthMm: 400, heightMm: 80,
      panelThicknessMm: 3, stiffenerCount: 0,
    });
    expect(f.members.length).toBe(4);
  });
});

describe('generateFrame dispatcher', () => {
  it('routes by kind', () => {
    const ladder = generateFrame({
      kind: 'ladder', lengthMm: 1000, widthMm: 500, crossMemberCount: 2,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    expect(ladder.nodes.length).toBeGreaterThan(0);
  });
});

describe('computeFrameStats', () => {
  it('reports node + member counts', () => {
    const f = generateLadderFrame({
      kind: 'ladder', lengthMm: 1000, widthMm: 500, crossMemberCount: 3,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    const s = computeFrameStats(f);
    expect(s.nodeCount).toBe(f.nodes.length);
    expect(s.memberCount).toBe(f.members.length);
  });

  it('totalLength > 0', () => {
    const f = generateLadderFrame({
      kind: 'ladder', lengthMm: 1000, widthMm: 500, crossMemberCount: 2,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    expect(computeFrameStats(f).totalLengthMm).toBeGreaterThan(0);
  });

  it('mass scales with member count', () => {
    const small = generateLadderFrame({
      kind: 'ladder', lengthMm: 500, widthMm: 300, crossMemberCount: 1,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    const big = generateLadderFrame({
      kind: 'ladder', lengthMm: 2000, widthMm: 1000, crossMemberCount: 4,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    expect(computeFrameStats(big).estimatedMassKg).toBeGreaterThan(computeFrameStats(small).estimatedMassKg);
  });

  it('membersByRole counts each role', () => {
    const f = generateLadderFrame({
      kind: 'ladder', lengthMm: 1000, widthMm: 500, crossMemberCount: 3,
      railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
    });
    const s = computeFrameStats(f);
    expect(s.membersByRole['main-rail']).toBeGreaterThan(0);
    expect(s.membersByRole['cross-member']).toBeGreaterThan(0);
  });
});

describe('CHASSIS_PRESETS', () => {
  it('presets generate without error', () => {
    for (const preset of Object.values(CHASSIS_PRESETS)) {
      const f = generateFrame(preset);
      expect(f.nodes.length).toBeGreaterThan(0);
      expect(f.members.length).toBeGreaterThan(0);
    }
  });
});
