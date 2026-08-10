import { describe, expect, it } from 'vitest';
import { filletedBlockPlan, lBracketPlan, pinBlockAssemblyPlan, revolveBushingPlan } from './fixturePlanner';
import { buildExactCadArtifact, exactCadGate } from './exactCadGate';
import { buildCurvedArtifact } from './curvedGate';

describe('exact CAD gate (real OCCT + STEP round trip)', () => {
  it('builds a polygonal bracket as one valid exact solid and round-trips STEP', async () => {
    const part = lBracketPlan().parts[0]!;
    const artifact = await buildExactCadArtifact(part);
    expect(exactCadGate(part, artifact).pass).toBe(true);
    expect(artifact.bodies).toHaveLength(1);
    expect(artifact.bodies[0]).toMatchObject({ valid: true, solidCount: 1, source: 'direct-extrude' });
    expect(artifact.bodies[0]!.step).toMatch(/^ISO-10303-21;/);
    expect(artifact.bodies[0]!.roundTripVolumeRelError).toBeLessThanOrEqual(1e-9);
  });

  it('promotes the sampled pin loop to an analytic cylinder', async () => {
    const pin = pinBlockAssemblyPlan().parts.find(part => part.partId === 'pin')!;
    const artifact = await buildExactCadArtifact(pin);
    expect(exactCadGate(pin, artifact).pass).toBe(true);
    expect(artifact.bodies[0]!.analyticCylinder).toBe(true);
    expect(artifact.bodies[0]!.volumeMm3).toBeCloseTo(Math.PI * 5 ** 2 * 30, 8);
  });

  it('keeps a full revolve analytic through STEP round trip', async () => {
    const part = revolveBushingPlan().parts[0]!;
    const artifact = await buildExactCadArtifact(part);
    expect(exactCadGate(part, artifact).pass).toBe(true);
    expect(artifact.bodies[0]!.source).toBe('direct-revolve');
    expect(artifact.bodies[0]!.analyticCylinder).toBe(true);
  });

  it('accepts valid fillet pole edges without misclassifying them as free boundaries', async () => {
    const part = filletedBlockPlan().parts[0]!;
    const curved = await buildCurvedArtifact(part);
    expect(curved?.ok).toBe(true);
    const artifact = await buildExactCadArtifact(part, curved);
    expect(exactCadGate(part, artifact).pass).toBe(true);
    expect(artifact.bodies[0]!.degeneratedEdgeCount).toBeGreaterThan(0);
    expect(artifact.bodies[0]).toMatchObject({
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      roundTripBoundaryEdgeCount: 0,
      roundTripNonManifoldEdgeCount: 0,
    });
  });
});
