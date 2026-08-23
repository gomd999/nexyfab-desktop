import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildRobotMotionCoverageFixture } from './robotMotionCoverage.testFixture';
import { createRobotSweptEvidenceArtifactBytes, evaluateRobotMotionCoverageBytes, robotSweptEvidenceBindingSha256, type RobotSweptEvidenceArtifactV1 } from './robotMotionCoverage';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('robot motion coverage', () => {
  it('proves every frozen payload/path combination, continuous segment and required workspace cell', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts, fixture.trustedSigners);
    expect(report.motionCoverageReady).toBe(true);
    expect(report.counts).toEqual({ expectedCombinations: 3, submittedCombinations: 3, passedCombinations: 3, requiredWorkspaceCells: 2, visitedRequiredWorkspaceCells: 2 });
    expect(report).toMatchObject({ fullPayloadPathCoverageComplete: true, continuousCollisionCoverageComplete: true, workspaceCoverageComplete: true, physicalValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });

  it('requires adaptive refinement near contact or singularity', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    combination.frames[1]!.anglesDeg[0] = 2;
    combination.frames[1]!.endpointClearanceMm = 4;
    combination.segments[0]!.maximumJointDeltaDeg = 2;
    combination.segments[0]!.continuousMinimumClearanceMm = 4;
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts, fixture.trustedSigners);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.errors.join(' ')).toContain('joint step exceeds the adaptive maximum');
  });

  it('rejects a self-reported segment delta and impossible continuous clearance', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const segment = fixture.motionInput.combinations[0]!.segments[0]!;
    segment.maximumJointDeltaDeg = 0.5;
    segment.continuousMinimumClearanceMm = 11;
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts, fixture.trustedSigners);
    expect(report.errors.join(' ')).toContain('declared joint delta differs from frame bytes');
    expect(report.errors.join(' ')).toContain('continuous clearance cannot exceed both endpoint clearances');
  });

  it('rejects continuous coverage when swept interval evidence is not bound to path/frame bytes', () => {
    const fixture = buildRobotMotionCoverageFixture();
    fixture.motionInput.combinations[0]!.sweptEvidenceBindingSha256 = 'b'.repeat(64);
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts, fixture.trustedSigners);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.continuousCollisionCoverageComplete).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence binding hash differs');
  });

  it('fails closed when referenced swept evidence bytes are missing or tampered', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const missing = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), new Map());
    expect(missing.motionCoverageReady).toBe(false);
    expect(missing.sweptEvidenceArtifactsVerified).toBe(false);
    expect(missing.errors.join(' ')).toContain('swept evidence artifact bytes missing');
    const tampered = new Map(fixture.sweptEvidenceArtifacts);
    const evidenceHash = fixture.motionInput.combinations[0]!.segments[0]!.evidenceArtifactSha256;
    tampered.set(evidenceHash, new TextEncoder().encode('tampered'));
    const mismatch = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), tampered);
    expect(mismatch.motionCoverageReady).toBe(false);
    expect(mismatch.errors.join(' ')).toContain('swept evidence artifact bytes hash mismatch');
  });

  it('requires a trusted worker/kernel signer registry', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.sweptEvidenceArtifactsVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence signer untrusted');
  });

  it('rejects a canonical artifact with a bad Ed25519 signature', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    const originalHash = combination.segments[0]!.evidenceArtifactSha256;
    const originalBytes = fixture.sweptEvidenceArtifacts.get(originalHash)!;
    const originalText = new TextDecoder().decode(originalBytes);
    const artifact = JSON.parse(originalText) as { signatures: Array<{ signature: string }> };
    const originalSignature = artifact.signatures[0]!.signature;
    const replacement = `${originalSignature[0] === 'A' ? 'B' : 'A'}${originalSignature.slice(1)}`;
    const badBytes = new TextEncoder().encode(originalText.replace(originalSignature, replacement));
    const badHash = digest(badBytes);
    combination.segments[0]!.evidenceArtifactSha256 = badHash;
    combination.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(combination);
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), new Map([[badHash, badBytes]]), fixture.trustedSigners);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence signature invalid');
  });

  it('requires worker and kernel attestations to use distinct Ed25519 keys', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    const originalHash = combination.segments[0]!.evidenceArtifactSha256;
    const original = JSON.parse(new TextDecoder().decode(fixture.sweptEvidenceArtifacts.get(originalHash)!)) as RobotSweptEvidenceArtifactV1;
    const { contentSha256: _contentSha256, signatures: _signatures, ...unsigned } = original;
    const shared = generateKeyPairSync('ed25519');
    const privateKey = shared.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKey = shared.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bytes = createRobotSweptEvidenceArtifactBytes(unsigned, [
      { issuerId: 'shared-worker', role: 'worker', privateKey },
      { issuerId: 'shared-kernel', role: 'kernel', privateKey },
    ]);
    const hash = digest(bytes);
    combination.segments[0]!.evidenceArtifactSha256 = hash;
    combination.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(combination);
    const artifacts = new Map(fixture.sweptEvidenceArtifacts);
    artifacts.delete(originalHash);
    artifacts.set(hash, bytes);
    const trusted = new Map(fixture.trustedSigners);
    trusted.set('shared-worker', { publicKey, role: 'worker', identitySha256: original.workerIdentitySha256 });
    trusted.set('shared-kernel', { publicKey, role: 'kernel', identitySha256: original.kernelIdentitySha256 });
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), artifacts, trusted);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.sweptEvidenceArtifactsVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('worker and kernel signers must use distinct keys');
  });

  it('requires worker and kernel runtime identities to be distinct', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    const originalHash = combination.segments[0]!.evidenceArtifactSha256;
    const original = JSON.parse(new TextDecoder().decode(fixture.sweptEvidenceArtifacts.get(originalHash)!)) as RobotSweptEvidenceArtifactV1;
    const { contentSha256: _contentSha256, signatures: _signatures, ...unsigned } = original;
    const worker = generateKeyPairSync('ed25519');
    const kernel = generateKeyPairSync('ed25519');
    const sameIdentity = 'f'.repeat(64);
    const bytes = createRobotSweptEvidenceArtifactBytes({ ...unsigned, workerIdentitySha256: sameIdentity, kernelIdentitySha256: sameIdentity }, [
      { issuerId: 'same-identity-worker', role: 'worker', privateKey: worker.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
      { issuerId: 'same-identity-kernel', role: 'kernel', privateKey: kernel.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    ]);
    const hash = digest(bytes);
    combination.segments[0]!.evidenceArtifactSha256 = hash;
    combination.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(combination);
    const artifacts = new Map(fixture.sweptEvidenceArtifacts);
    artifacts.delete(originalHash);
    artifacts.set(hash, bytes);
    const trusted = new Map(fixture.trustedSigners);
    trusted.set('same-identity-worker', { publicKey: worker.publicKey.export({ type: 'spki', format: 'pem' }).toString(), role: 'worker', identitySha256: sameIdentity });
    trusted.set('same-identity-kernel', { publicKey: kernel.publicKey.export({ type: 'spki', format: 'pem' }).toString(), role: 'kernel', identitySha256: sameIdentity });
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), artifacts, trusted);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.sweptEvidenceArtifactsVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('worker and kernel identities must be distinct');
  });

  it('rejects hash-only arbitrary bytes even when the declared artifact hash matches', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    const bytes = encode({ arbitrary: true });
    const hash = digest(bytes);
    combination.segments[0]!.evidenceArtifactSha256 = hash;
    combination.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(combination);
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), new Map([[hash, bytes]]));
    expect(report.motionCoverageReady).toBe(false);
    expect(report.sweptEvidenceArtifactsVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence artifact schema invalid');
  });

  it('rejects evidence reuse/transplant across two distinct motion segments', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const first = fixture.motionInput.combinations[0]!;
    const transplanted = fixture.motionInput.combinations[1]!;
    transplanted.segments[0]!.evidenceArtifactSha256 = first.segments[0]!.evidenceArtifactSha256;
    transplanted.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(transplanted);
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts);
    expect(report.motionCoverageReady).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence artifact reused');
  });

  it('rejects malformed artifact JSON instead of accepting a matching byte hash', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    const bytes = new TextEncoder().encode('{not-json');
    const hash = digest(bytes);
    combination.segments[0]!.evidenceArtifactSha256 = hash;
    combination.sweptEvidenceBindingSha256 = robotSweptEvidenceBindingSha256(combination);
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), new Map([[hash, bytes]]));
    expect(report.motionCoverageReady).toBe(false);
    expect(report.sweptEvidenceArtifactsVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('swept evidence artifact JSON invalid');
  });

  it('does not infer a missing combination or required workspace cell', () => {
    const fixture = buildRobotMotionCoverageFixture();
    fixture.motionInput.combinations.pop();
    fixture.motionInput.requiredWorkspaceCellIds.push('cell-c');
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts);
    expect(report.fullPayloadPathCoverageComplete).toBe(false);
    expect(report.workspaceCoverageComplete).toBe(false);
    expect(report.errors.join(' ')).toContain('required motion combination payload-eccentric::path-cycle-a is missing');
    expect(report.uncoveredWorkspaceCellIds).toContain('cell-c');
  });

  it('rejects a clearance violation and a pose outside frozen joint ranges', () => {
    const fixture = buildRobotMotionCoverageFixture();
    const combination = fixture.motionInput.combinations[0]!;
    combination.frames[1]!.anglesDeg[0] = 121;
    combination.segments[0]!.maximumJointDeltaDeg = 121;
    combination.segments[0]!.continuousMinimumClearanceMm = 1;
    const report = evaluateRobotMotionCoverageBytes(fixture.requirementsBytes, encode(fixture.motionInput), fixture.sweptEvidenceArtifacts);
    expect(report.errors.join(' ')).toContain('lies outside the frozen range');
    expect(report.errors.join(' ')).toContain('continuous clearance violates the minimum');
  });

  it('fails closed on malformed input', () => {
    const report = evaluateRobotMotionCoverageBytes(encode({}), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', motionCoverageReady: false, releaseReady: false, combinations: [] });
  });
});
