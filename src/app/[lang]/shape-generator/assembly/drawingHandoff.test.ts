import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  buildAssemblyDrawingHandoff,
  readAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
  writeAssemblyDrawingHandoff,
} from './drawingHandoff';

const state: AssemblyState = {
  parts: [{
    id: 'part-1',
    name: 'Bracket',
    partTemplateId: 'bracket',
    position: { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: true,
  }],
  mates: [],
};

const tree: FeatureTree = {
  nodes: [{
    id: 'extrude-1',
    name: 'Base extrude',
    dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ],
      depth: 5,
      direction: 'one_sided',
      mode: 'add',
    },
  }],
};

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: key => raw.get(key) ?? null,
    setItem: (key, value) => { raw.set(key, value); },
  };
}

describe('assembly drawing handoff', () => {
  it('binds the current assembly revision and keeps absent artifacts NOT_RUN/BLOCKED', async () => {
    const handoff = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: { 'part-1': tree },
      projectId: 'project-7',
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(handoff.source.revisionId).toMatch(/^project-7:[a-f0-9]{20}$/);
    expect(handoff.artifacts.canonicalAssemblyIr.status).toBe('PASS');
    expect(handoff.artifacts.editableFeatureTrees.status).toBe('PASS');
    expect(handoff.verification.solver.status).toBe('NOT_RUN');
    expect(handoff.artifacts.exactBrepStep.status).toBe('NOT_RUN');
    expect(handoff.artifacts.drawing.status).toBe('NOT_RUN');
    expect(handoff.artifacts.gdtPmi.status).toBe('NOT_RUN');
    expect(handoff.artifacts.manufacturingPackage.status).toBe('BLOCKED');
  });

  it('marks only a successful real solve as PASS', async () => {
    const real = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: { 'part-1': tree },
      solveResult: {
        phase: 'real',
        success: true,
        state,
        dof: 0,
        finalMaxResidual: 1e-8,
        residuals: [],
      },
    });
    const stub = await buildAssemblyDrawingHandoff({
      state,
      featureTrees: { 'part-1': tree },
      solveResult: { phase: 'stub', success: true, residuals: [] },
    });

    expect(real.verification.solver.status).toBe('PASS');
    expect(real.verification.solver.sha256).toBe(real.source.stateSha256);
    expect(stub.verification.solver.status).toBe('FAIL');
    expect(stub.verification.solver.reason).toMatch(/not authoritative/i);
  });

  it('preserves a server-loaded canonical revision triplet without deriving another revision id', async () => {
    const canonicalRevision = {
      schema: 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1' as const,
      documentId: 'document-1', revisionId: 'revision-7', sequence: 7, contentSha256: 'a'.repeat(64),
    };
    const handoff = await buildAssemblyDrawingHandoff({
      state, featureTrees: { 'part-1': tree }, projectId: 'project-1', canonicalRevision,
    });
    expect(handoff.source).toMatchObject({
      projectId: 'project-1', revisionId: 'revision-7', workspaceRevision: 7,
      workspaceContentSha256: 'a'.repeat(64), canonicalRevision,
    });
    expect(await validateAssemblyDrawingHandoff(handoff)).toEqual({ ok: true, handoff });
    const tampered = structuredClone(handoff);
    tampered.source.canonicalRevision!.sequence = 8;
    expect(await validateAssemblyDrawingHandoff(tampered)).toMatchObject({
      ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_SCHEMA_INVALID',
    });
  });

  it('rejects storage tampering instead of reopening a different revision', async () => {
    const storage = memoryStorage();
    const handoff = await buildAssemblyDrawingHandoff({ state, featureTrees: { 'part-1': tree } });
    writeAssemblyDrawingHandoff(handoff, storage);
    expect(await readAssemblyDrawingHandoff(handoff.handoffId, storage)).toEqual({
      ok: true,
      handoff,
    });

    const [key, raw] = [...storage.raw.entries()][0]!;
    const changed = JSON.parse(raw) as typeof handoff;
    changed.assembly.state.parts[0]!.name = 'Tampered';
    storage.raw.set(key, JSON.stringify(changed));

    expect(await readAssemblyDrawingHandoff(handoff.handoffId, storage)).toEqual({
      ok: false,
      reason: 'ASSEMBLY_DRAWING_HANDOFF_HASH_MISMATCH',
    });
  });

  it('blocks empty assemblies and identifies incomplete FeatureTrees', async () => {
    await expect(buildAssemblyDrawingHandoff({
      state: { parts: [], mates: [] },
      featureTrees: {},
    })).rejects.toThrow('ASSEMBLY_DRAWING_HANDOFF_EMPTY');

    const incomplete = await buildAssemblyDrawingHandoff({ state, featureTrees: {} });
    expect(incomplete.verification.missingFeatureTreePartIds).toEqual(['part-1']);
    expect(incomplete.artifacts.editableFeatureTrees.status).toBe('BLOCKED');
  });
});
