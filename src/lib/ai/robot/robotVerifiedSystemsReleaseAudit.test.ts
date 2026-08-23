import { describe, expect, it } from 'vitest';
import { buildRobotVerifiedSystemsReleaseAuditFixture } from './robotVerifiedSystemsReleaseAudit.testFixture';
import { auditRobotVerifiedSystemsRelease } from './robotVerifiedSystemsReleaseAudit';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot Verified Systems release audit', () => {
  it('creates one final-review target only from the complete CAD, manufacturing, engineering and physical chain', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report).toMatchObject({ status: 'ready_for_final_review', exactCadEvidenceValid: true, manufacturingEvidenceValid: true, engineeringCoverageValid: true, motionCoverageValid: true, cableLifeValid: true, safetyElectricalDesignValid: true, physicalValidationValid: true, errors: [], blockers: ['final_release_dual_signoff_required'], releaseReady: false, releaseExecuted: false, sideEffects: { persisted: false, cadModified: false, releasePublished: false } });
    expect(report.releaseTargetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report).toMatchObject({ schema: 'nexyfab.robot-verified-systems-release-audit.v2', auditIssuerId: 'verified-auditor-1', signature: expect.any(String) });
  });

  it('rejects a system binding replayed against another post-integration target', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const binding = JSON.parse(new TextDecoder().decode(fixture.files.systemBinding)) as { postIntegrationTargetHash: string };
    binding.postIntegrationTargetHash = '0'.repeat(64);
    fixture.files.systemBinding = encode(binding);
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.status).toBe('not_ready');
    expect(report.errors).toContain('verified-systems binding postIntegrationTargetHash mismatch');
  });

  it('rejects motion evidence that only claims endpoint/frame coverage', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const motion = JSON.parse(new TextDecoder().decode(fixture.files.motionCoverage)) as Record<string, unknown>;
    delete motion.continuousCollisionCoverageComplete;
    fixture.files.motionCoverage = encode(motion);
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.motionCoverageValid).toBe(false);
    expect(report.status).toBe('not_ready');
    expect(report.errors.some(error => error.includes('motion.continuousCollisionCoverageComplete'))).toBe(true);
  });

  it('rejects continuous coverage when its swept content binding is absent', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const motion = JSON.parse(new TextDecoder().decode(fixture.files.motionCoverage)) as Record<string, unknown>;
    delete motion.sweptEvidenceBindingSha256;
    fixture.files.motionCoverage = encode(motion);
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.motionCoverageValid).toBe(false);
    expect(report.status).toBe('not_ready');
    expect(report.errors.some(error => error.includes('motion.sweptEvidenceBindingSha256'))).toBe(true);
  });

  it('rejects a receipt that carries a binding but says its artifact bytes were not verified', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const motion = JSON.parse(new TextDecoder().decode(fixture.files.motionCoverage)) as Record<string, unknown>;
    motion.sweptEvidenceArtifactsVerified = false;
    fixture.files.motionCoverage = encode(motion);
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.motionCoverageValid).toBe(false);
    expect(report.status).toBe('not_ready');
    expect(report.errors.some(error => error.includes('motion.sweptEvidenceArtifactsVerified'))).toBe(true);
  });

  it('rejects physical raw-byte or trust failures', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    fixture.artifacts.set('joint_rig-raw.csv', encode({ tampered: true }));
    fixture.trusted.physical = {};
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.physicalValidationValid).toBe(false);
    expect(report.blockers).toContain('physical_validation_required');
  });

  it('rejects incomplete exact-CAD/manufacturing signatures and malformed upstream reports', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    fixture.trusted.exactCad = {};
    fixture.files.motionCoverage = encode({});
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted, fixture.auditSigner);
    expect(report.status).toBe('not_ready');
    expect(report.exactCadEvidenceValid).toBe(false);
    expect(report.motionCoverageValid).toBe(false);
  });

  it('fails closed when the server audit signer is absent', () => {
    const fixture = buildRobotVerifiedSystemsReleaseAuditFixture();
    const report = auditRobotVerifiedSystemsRelease(fixture.files, fixture.artifacts, fixture.trusted);
    expect(report.status).toBe('not_ready');
    expect(report.signature).toBeNull();
    expect(report.blockers).toContain('verified_audit_attestation_required');
  });
});
