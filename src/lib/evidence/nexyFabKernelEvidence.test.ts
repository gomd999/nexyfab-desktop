import { describe, expect, it } from 'vitest';
import { buildNexyFabKernelEvidence, type EvidenceReference } from './nexyFabKernelEvidence';

const gate = (generator: string, verifier: string): EvidenceReference => ({ schema: 'fixture.v1', sha256: 'b'.repeat(64), status: 'pass', generator, verifier });

describe('NexyFabKernelEvidence v1', () => {
  it('binds a revision and kernel identity to three isolated passing gates', () => {
    const evidence = buildNexyFabKernelEvidence({
      revisionManifestSha256: 'a'.repeat(64), kernelStackIdentitySha256: 'c'.repeat(64),
      gates: {
        partStepRoundtrip: gate('replicad-occt', 'occt-import-js'),
        xcafAssemblyRoundtrip: gate('stepcafcontrol', 'isolated-part21-parser'),
        exactDrawingProjection: gate('replicad-occt-hlr', 'analytic-curve-inspector'),
      },
    });
    expect(evidence.status).toBe('pass');
  });

  it('fails closed when a gate fails or verifies itself', () => {
    const bad = gate('same', 'same'); bad.status = 'fail';
    const evidence = buildNexyFabKernelEvidence({
      revisionManifestSha256: 'a'.repeat(64), kernelStackIdentitySha256: 'c'.repeat(64),
      gates: { partStepRoundtrip: bad, xcafAssemblyRoundtrip: bad, exactDrawingProjection: bad },
    });
    expect(evidence.status).toBe('fail');
    expect(evidence.blockers).toContain('partStepRoundtrip:verifier-not-isolated');
  });
});
