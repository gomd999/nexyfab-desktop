import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyRobotEvidenceBundle } from './robotEvidenceBundle';
import { generateRobot6Axis } from './robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robotDemonstrator';
import type { HingeMate } from '../../assembly/mate';

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const generatedProgram = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program;
const program = bytes(generatedProgram);
const interferencePairs = Array.from({ length: 22 }, (_, index) => ({
  partA: generatedProgram.assembly.parts[index % generatedProgram.assembly.parts.length]!.id,
  partB: generatedProgram.assembly.parts[(index + 1) % generatedProgram.assembly.parts.length]!.id,
  penetrationMm: index + 1,
  category: index === 0 ? 'structural-structural' : index % 2 ? 'drive-structural' : 'drive-drive',
}));
const report = (overrides: Record<string, unknown> = {}) => ({
  schema: 'nexyfab.ai-complex-product-demonstrator.v1', releaseReady: false,
  policy: { expertApprovalGranted: false, referenceCorpusModified: false },
  product: { lineageId: 'robot-test-lineage', revision: 1, programSha256: digest(program), programArtifact: `editable-program-${digest(program)}.json`, editableParts: 25, mates: 60, classification: 'concept_only', unresolvedCatalogComponents: 22 },
  catalogSelection: { actualArtifactBytesVerified: false, selectionStatus: 'not_run' },
  housingFit: { status: 'not_run' },
  assembly: { releaseReady: false, preciseInterferenceStatus: 'completed', flaggedInterferences: 22, certificate: { rankDoF: 6, allowedDoF: 6 } },
  interferenceAnalysis: { pairs: interferencePairs },
  motionStudy: { releaseEvidence: false, allConverged: true, checkedFrames: 13, collisionFrameCount: 13, frameCount: 13 },
  blockers: ['expert_review_not_run'],
  ...overrides,
});

describe('robot evidence bundle trust boundary', () => {
  it('accepts the current immutable demonstrator report/program pair without promoting it', async () => {
    const root = path.resolve('docs/evidence/ai-robot6axis-demonstrator-260809');
    const reportBytes = new Uint8Array(readFileSync(path.join(root, 'report.json')));
    const parsed = JSON.parse(new TextDecoder().decode(reportBytes)) as { product: { programArtifact: string } };
    const programBytes = new Uint8Array(readFileSync(path.join(root, parsed.product.programArtifact)));
    const result = await verifyRobotEvidenceBundle(reportBytes, programBytes);
    expect(result).toMatchObject({ editableParts: 25, mates: 60, rankDoF: 6, allowedDoF: 6, flaggedInterferences: 0, collisionFrames: 0, motionFrames: 13, effectiveReleaseReady: false });
    expect(result.interferenceQueue).toHaveLength(0);
  });

  it('binds exact program bytes but keeps unapproved evidence out of release', async () => {
    const result = await verifyRobotEvidenceBundle(bytes(report()), program);
    expect(result.programHash).toBe(digest(program));
    expect(result).toMatchObject({ editableParts: 25, mates: 60, rankDoF: 6, flaggedInterferences: 22, collisionFrames: 13, effectiveReleaseReady: false });
    expect(result.blockers).toContain('expert_approval_not_granted');
    expect(result.blockers).toContain('precise_interferences_present');
    expect(result.interferenceQueue[0]).toMatchObject({ category: 'structural-structural', priority: 'critical', recommendedAction: 'redesign_structure' });
  });

  it('rejects a program whose bytes do not match the report', async () => {
    await expect(verifyRobotEvidenceBundle(bytes(report()), bytes({ version: 'tampered' }))).rejects.toThrow('hash does not match');
  });

  it('rejects report counts that contradict the hash-bound program', async () => {
    const inconsistent = report({ product: { lineageId: 'robot-test-lineage', revision: 1, programSha256: digest(program), programArtifact: `editable-program-${digest(program)}.json`, editableParts: 24, mates: 60, classification: 'concept_only', unresolvedCatalogComponents: 22 } });
    await expect(verifyRobotEvidenceBundle(bytes(inconsistent), program)).rejects.toThrow('part count does not match');
  });

  it('does not accept a forged release claim when underlying gates fail', async () => {
    const forged = report({ releaseReady: true });
    const result = await verifyRobotEvidenceBundle(bytes(forged), program);
    expect(result.claimedReleaseReady).toBe(true);
    expect(result.effectiveReleaseReady).toBe(false);
  });

  it('rejects internally impossible motion evidence', async () => {
    const invalid = report({ motionStudy: { releaseEvidence: false, collisionFrameCount: 14, frameCount: 13 } });
    await expect(verifyRobotEvidenceBundle(bytes(invalid), program)).rejects.toThrow('exceeds motion frame count');
  });

  it('rejects a checked-frame claim beyond the motion frame count', async () => {
    const invalid = report({ motionStudy: { releaseEvidence: false, allConverged: true, checkedFrames: 14, collisionFrameCount: 0, frameCount: 13 } });
    await expect(verifyRobotEvidenceBundle(bytes(invalid), program)).rejects.toThrow('checked motion frame count exceeds');
  });

  it('accepts only an exact J1..J6 motion aggregate', async () => {
    const axes = Array.from({ length: 6 }, (_, index) => {
      const mate = generatedProgram.assembly.mates.find((item): item is HingeMate => item.id === `J${index + 1}` && item.kind === 'hinge')!;
      const segments = [
        { direction: 'toward-min', apiOk: true, allConverged: true, frameCount: 13, checkedFrames: 13, collisionFrameCount: index === 0 ? 13 : 0, firstFailureFrame: null, firstCollisionFrame: index === 0 ? 0 : null, maxPenetrationMm: index === 0 ? 1 : 0 },
        { direction: 'toward-max', apiOk: true, allConverged: true, frameCount: 13, checkedFrames: 13, collisionFrameCount: 0, firstFailureFrame: null, firstCollisionFrame: null, maxPenetrationMm: 0 },
      ];
      return { mateId: mate.id, rangeDeg: [mate.limit!.minAngleDeg, mate.limit!.maxAngleDeg], allConverged: true, frameCount: 26, checkedFrames: 26, collisionFrameCount: index === 0 ? 13 : 0, segments };
    });
    const valid = report({ motionStudy: { releaseEvidence: false, axisCount: 6, allConverged: true, checkedFrames: 156, collisionFrameCount: 13, frameCount: 156, axes } });
    const result = await verifyRobotEvidenceBundle(bytes(valid), program);
    expect(result.motionAxes?.map(axis => axis.mateId)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
    const forged = report({ motionStudy: { releaseEvidence: false, axisCount: 6, allConverged: true, checkedFrames: 155, collisionFrameCount: 13, frameCount: 156, axes } });
    await expect(verifyRobotEvidenceBundle(bytes(forged), program)).rejects.toThrow('aggregates do not match');
    const wrongRange = structuredClone(valid) as unknown as { motionStudy: { axes: Array<{ rangeDeg: number[]; segments: Array<{ firstCollisionFrame: number | null }> }> } };
    wrongRange.motionStudy.axes[0]!.rangeDeg = [-45, 45];
    await expect(verifyRobotEvidenceBundle(bytes(wrongRange), program)).rejects.toThrow('governed hinge limit');
    const impossibleDiagnostic = structuredClone(valid) as unknown as typeof wrongRange;
    impossibleDiagnostic.motionStudy.axes[0]!.segments[0]!.firstCollisionFrame = 13;
    await expect(verifyRobotEvidenceBundle(bytes(impossibleDiagnostic), program)).rejects.toThrow('outside the segment');
  });

  it('rejects an interference pair that does not reference program parts', async () => {
    const badPairs = [...interferencePairs];
    badPairs[0] = { ...badPairs[0]!, partA: 'invented-part' };
    const invalid = report({ interferenceAnalysis: { pairs: badPairs } });
    await expect(verifyRobotEvidenceBundle(bytes(invalid), program)).rejects.toThrow('invalid program parts');
  });

  it('rejects a report that has not completed precise interference verification', async () => {
    const invalid = report({ assembly: { releaseReady: false, preciseInterferenceStatus: 'not_run', flaggedInterferences: 22, certificate: { rankDoF: 6, allowedDoF: 6 } } });
    await expect(verifyRobotEvidenceBundle(bytes(invalid), program)).rejects.toThrow('must be completed');
  });
});
