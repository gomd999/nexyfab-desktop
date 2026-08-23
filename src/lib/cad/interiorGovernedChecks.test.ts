import { describe, expect, it } from 'vitest';
import { verifyDoorSwingClearance } from '@/lib/assembly/doorSwingClearance';
import { verifyEgressRoutes } from '@/lib/assembly/egressRouteVerification';
import { verifySpaceBoundaryClosure } from '@/lib/assembly/spaceBoundaryClosure';
import { buildInteriorSpatialAssembly, normalizeInteriorSpatialParameters } from './interiorSpatialModel';
import { buildInteriorBoundaryCheckInput, buildInteriorDoorSwingCheckInput, buildInteriorEgressCheckInput } from './interiorGovernedChecks';

const params = normalizeInteriorSpatialParameters({
  width: 8000,
  depth: 6000,
  ceilingHeight: 2700,
  doorWidth: 1000,
  exitCount: 1,
  rows: 2,
  cols: 3,
  furniture: null,
});

describe('interior governed-check inputs', () => {
  it('uses the canonical room dimensions for a closed boundary', () => {
    const result = verifySpaceBoundaryClosure(buildInteriorBoundaryCheckInput(params));
    expect(result).toMatchObject({ closed: true, openBoundaries: 0, loopCount: 1, conservative: true });
    expect(result.loopAreasMm2).toEqual([48_000_000]);
  });

  it('refuses to invent door-leaf thickness', () => {
    const assembly = buildInteriorSpatialAssembly(params);
    expect(buildInteriorDoorSwingCheckInput(params, assembly, 0, 0)).toBeNull();
  });

  it('checks the continuous door envelope against canonical furniture and counters', () => {
    const assembly = buildInteriorSpatialAssembly(params);
    const input = buildInteriorDoorSwingCheckInput(params, assembly, 40, 20);
    expect(input).not.toBeNull();
    expect(input!.pivot).toEqual({ x: 3500, y: 0 });
    expect(input!.obstacles.length).toBeGreaterThan(0);
    expect(verifyDoorSwingClearance(input!)).toMatchObject({ clear: true, conservative: true });
  });

  it('refuses to invent governed egress requirements', () => {
    const assembly = buildInteriorSpatialAssembly(params);
    expect(buildInteriorEgressCheckInput(params, assembly, 30_000, 0, 1)).toBeNull();
    expect(buildInteriorEgressCheckInput(params, assembly, 30_000, 900, 0)).toBeNull();
  });

  it('builds an obstacle-aware graph and checks every free lattice node', () => {
    const assembly = buildInteriorSpatialAssembly(params);
    const input = buildInteriorEgressCheckInput(params, assembly, 30_000, 900, 1);
    expect(input).not.toBeNull();
    expect(input!.originNodeIds.length).toBeGreaterThan(10);
    expect(input!.edges.every(edge => Number.isFinite(edge.clearWidthMm))).toBe(true);
    expect(verifyEgressRoutes(input!)).toMatchObject({ passed: true, requiredIndependentExits: 1, conservative: true });
  });

  it('fails when the governed rule requires more independent exits than modeled', () => {
    const assembly = buildInteriorSpatialAssembly(params);
    const input = buildInteriorEgressCheckInput(params, assembly, 30_000, 900, 2);
    expect(input).not.toBeNull();
    expect(verifyEgressRoutes(input!).failures).toContain('INSUFFICIENT_EXITS');
  });
});
