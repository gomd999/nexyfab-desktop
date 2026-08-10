import { describe, expect, it } from 'vitest';
import {
  holedPlatePlan,
  lBracketPlan,
  pinBlockAssemblyPlan,
  revolveBushingPlan,
  steppedShaftPlan,
} from './fixturePlanner';
import { buildEditableWorkspaceCandidate } from './workspaceCandidate';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';
import { iterativeSolve } from '@/lib/assembly/iterativeSolver';
import { deserializeAssembly, serializeAssembly } from '@/lib/assembly/assemblyPersist';

describe('editable workspace candidate', () => {
  it('maps an arbitrary single extrude to an editable polygon feature', () => {
    const candidate = buildEditableWorkspaceCandidate(lBracketPlan());
    expect(candidate).toMatchObject({ supported: true, reverificationRequired: true, inheritedVerification: false });
    expect(candidate.program?.features[0]).toMatchObject({ type: 'sketchExtrude', height: 20 });
    expect(candidate.program?.features[0]?.profile).toHaveLength(6);
  });

  it('recenters rectangular-base hole positions for the modeler coordinate frame', () => {
    const candidate = buildEditableWorkspaceCandidate(holedPlatePlan());
    expect(candidate.supported).toBe(true);
    expect(candidate.program?.features[0]).toMatchObject({ shape: 'rect', width: 120, depth: 80, height: 10 });
    expect(candidate.program?.features.slice(1).map(feature => [feature.posX, feature.posY])).toEqual([
      [-50, -30], [50, -30], [50, 30], [-50, 30],
    ]);
  });

  it('maps a contiguous coaxial multi-body shaft to one exact cylinder plus editable bosses', () => {
    const shaft = buildEditableWorkspaceCandidate(steppedShaftPlan());
    expect(shaft.supported).toBe(true);
    expect(shaft.program?.features).toEqual([
      expect.objectContaining({ type: 'sketchExtrude', shape: 'circle', width: 24, height: 30 }),
      expect.objectContaining({ type: 'boss', diameter: 16, height: 25, posX: 0, posY: 0 }),
    ]);
  });

  it('maps a full-turn rectangular radial revolve to an exact editable cylinder', () => {
    const candidate = buildEditableWorkspaceCandidate(revolveBushingPlan());
    expect(candidate.supported).toBe(true);
    expect(candidate.program?.features).toEqual([
      expect.objectContaining({ type: 'sketchExtrude', shape: 'circle', width: 50, height: 60 }),
    ]);
  });

  it('preserves semantic assembly refs and feeds the real named-reference solver', () => {
    const assembly = buildEditableWorkspaceCandidate(pinBlockAssemblyPlan());
    expect(assembly).toMatchObject({
      supported: true,
      target: 'assembly-browser',
      reverificationRequired: true,
      inheritedVerification: false,
    });
    expect(assembly.program).toBeUndefined();
    expect(assembly.assembly?.state.parts.find(part => part.id === 'block')?.refs?.boss_axis).toMatchObject({
      kind: 'axis',
      origin: { x: 20, y: 20, z: 0 },
    });
    expect(assembly.assembly?.state.mates.map(mate => [mate.kind, mate.a.refId, mate.b.refId])).toEqual([
      ['concentric', 'axis', 'boss_axis'],
      ['coincident', 'base_plane', 'top_plane'],
    ]);

    const persisted = deserializeAssembly(serializeAssembly(assembly.assembly!.state));
    expect(persisted.ok && persisted.state.parts[0]?.refs).toBeDefined();

    const seed = assembly.assembly!;
    const resolver = featureTreeGeometryResolver(new Map(Object.entries(seed.featureTrees)));
    const solved = iterativeSolve(seed.state, resolver, { tolerance: 1e-6, maxIterations: 100 });
    expect(solved.success).toBe(true);
    expect(solved.state.parts.find(part => part.id === 'pin')?.position).toMatchObject({ x: 20, y: 20, z: 20 });
  });
});
