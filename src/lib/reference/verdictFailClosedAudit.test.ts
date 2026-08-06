import { describe, expect, it } from 'vitest';
import { evaluateManufacturingGates } from '@/lib/ai/manufacturingGates';
import { evaluateAiGeneration } from '@/lib/ai/aiGenerationPipeline';
import { verifyAssemblyAnimationFrames } from '@/lib/assembly/assemblyAnimationVerification';
import { deriveEvidenceStatus } from './cadEvidenceIrV2';
import { evaluateCadCorpusFile } from './cadCorpusEvidence';

describe('cross-cutting verdict fail-closed audit', () => {
  it('does not turn absent evidence into pass', async () => {
    expect(deriveEvidenceStatus([])).toBe('not_run');
    const manufacturing = evaluateManufacturingGates({});
    expect(manufacturing.passed).toBe(false);
    expect(manufacturing.gates.every(gate => gate.status === 'not_run')).toBe(true);
    const unsupported = await evaluateCadCorpusFile({ scenarioId: 'audit', extension: 'unknown', bytes: new Uint8Array([1]), assertions: [] });
    expect(unsupported.status).toBe('not_run');
  });

  it('blocks incomplete AI generation instead of treating transport success as release', () => {
    const decision = evaluateAiGeneration({
      intent: { unresolved: [], conflicts: [] },
      decomposition: { valid: true, independentPartCount: 1, errors: [] },
      parts: [{ instanceId: 'p1', manufacturingPassed: true, errors: [] }],
    });
    expect(decision).toMatchObject({ stage: 'assembly_solve', status: 'blocked' });
  });

  it('does not certify animation collision freedom without collision geometry', () => {
    const result = verifyAssemblyAnimationFrames(
      { parts: [], mates: [] },
      { version: 1, name: 'audit', startFrame: 0, endFrame: 10, fps: 30, tracks: [] },
      null,
    );
    expect(result).toMatchObject({ verified: false, collisionFree: false });
  });
});
