import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildRobotReleaseWorkPacketV2 } from './robotReleaseWorkPacketV2';

const enc = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const key = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
const post = {
  schema: 'nexyfab.robot-post-integration-evidence.v1', postIntegrationStatus: 'passed',
  integrationAuthorized: true, selectedOccurrencesVerified: true, precisionStatus: 'passed',
  lineageId: 'robot-lineage', revision: 3, programHash: 'a'.repeat(64), preciseReportHash: 'b'.repeat(64),
  applicationReceiptHash: 'c'.repeat(64), applicationHash: 'd'.repeat(64), targetHash: 'e'.repeat(64),
  catalogManifestSha256: 'f'.repeat(64), housingSha256: '1'.repeat(64), releaseReady: false,
  blockers: ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'],
  errors: [],
  counts: { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 },
  sideEffects: { persisted: false, sourceModified: false, workspaceModified: false, quoteCreated: false, rfqSent: false },
};

describe('robot release work packet v2', () => {
  it('accepts only the complete 18 drive + 4 auxiliary post-integration target', () => {
    const packet = buildRobotReleaseWorkPacketV2(enc(post), { exact: { publicKey: key() } }, { manufacturing: { publicKey: key() } }, {});
    expect(packet.errors).toEqual([]);
    expect(packet).toMatchObject({ schema: 'nexyfab.robot-release-evidence-work-packet.v3', programHash: post.programHash, integrationTargetHash: post.targetHash, applicationHash: post.applicationHash, applicationReceiptHash: post.applicationReceiptHash, preciseReportHash: post.preciseReportHash, catalogManifestSha256: post.catalogManifestSha256, exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v3', requiredCounts: { partCount: 29 } }, manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v3', selectedComponentCount: 22, driveComponentCount: 18, auxiliaryComponentCount: 4 }, releaseReady: false });
  });

  it('fails closed before creating a usable packet when auxiliary or unresolved counts contradict the claim', () => {
    const incomplete = { ...post, counts: { ...post.counts, auxiliaryOccurrences: 3, appliedOccurrences: 21, catalogUnresolved: 1 } };
    const packet = buildRobotReleaseWorkPacketV2(enc(incomplete), {}, {}, {});
    expect(packet.errors.join(',')).toMatch(/auxiliaryOccurrences|appliedOccurrences|catalogUnresolved/);
    expect(packet.programHash).toBe('0'.repeat(64));
    expect(packet.releaseReady).toBe(false);
  });

  it('rejects duplicated release blockers even when the array length is three', () => {
    const contradictory = { ...post, blockers: Array(3).fill('nexyfab_exact_cad_evidence_required') };
    expect(buildRobotReleaseWorkPacketV2(enc(contradictory), {}, {}, {}).errors.join(',')).toContain('distinct release blockers');
  });
});
