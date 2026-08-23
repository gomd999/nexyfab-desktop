import { describe, expect, it } from 'vitest';
import { buildRobotPhysicalValidationReceiptFixture } from './robotPhysicalValidationReceipt.testFixture';
import { verifyRobotPhysicalValidationReceipt } from './robotPhysicalValidationReceipt';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot physical validation receipt', () => {
  it('verifies exact raw/calibration/BOM bytes, recomputed measurements and independent signatures without releasing', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    const report = verifyRobotPhysicalValidationReceipt(fixture.upstream, fixture.receiptBytes, fixture.artifacts, fixture.trustedKeys);
    expect(report.physicalValidationReady).toBe(true);
    expect(report.counts).toEqual({ artifacts: 9, stages: 4, measurements: 27, applicationHashes: 3, signatures: 2 });
    expect(report).toMatchObject({ artifactBytesVerified: true, measurementAcceptanceVerified: true, dualSignatureVerified: true, finalReleaseReviewRequired: true, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });

  it('rejects changed artifact bytes and undeclared evidence', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    fixture.artifacts.set('joint_rig-raw.csv', encode({ tampered: true }));
    fixture.artifacts.set('undeclared.txt', encode({}));
    const report = verifyRobotPhysicalValidationReceipt(fixture.upstream, fixture.receiptBytes, fixture.artifacts, fixture.trustedKeys);
    expect(report.physicalValidationReady).toBe(false);
    expect(report.errors.join(' ')).toContain('bytes do not match SHA-256');
    expect(report.errors).toContain('undeclared artifact undeclared.txt was supplied');
  });

  it('recomputes acceptance instead of trusting passed=true', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    fixture.receipt.stages[0]!.measurements[0]!.value = 3;
    const report = verifyRobotPhysicalValidationReceipt(fixture.upstream, encode(fixture.receipt), fixture.artifacts, fixture.trustedKeys);
    expect(report.measurementAcceptanceVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('recomputed acceptance failed');
  });

  it('rejects one identity filling operator and independent-reviewer roles', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    fixture.receipt.signatures[1]!.signerId = fixture.receipt.signatures[0]!.signerId;
    fixture.receipt.signatures[1]!.signerIdentitySha256 = fixture.receipt.signatures[0]!.signerIdentitySha256;
    const report = verifyRobotPhysicalValidationReceipt(fixture.upstream, encode(fixture.receipt), fixture.artifacts, fixture.trustedKeys);
    expect(report.dualSignatureVerified).toBe(false);
    expect(report.errors.join(' ')).toContain('must be different people');
    expect(report.errors.join(' ')).toContain('must use different keys');
  });

  it('rejects stale upstream bindings and incomplete governed stages', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    fixture.receipt.engineeringCoverageHash = 'd'.repeat(64);
    fixture.receipt.stages[3]!.measurements.pop();
    const report = verifyRobotPhysicalValidationReceipt(fixture.upstream, encode(fixture.receipt), fixture.artifacts, fixture.trustedKeys);
    expect(report.physicalValidationReady).toBe(false);
    expect(report.errors).toContain('engineering coverage hash binding mismatch');
    expect(report.errors.join(' ')).toContain('endurance_teardown measurements must cover');
  });

  it('fails closed without trusted keys or valid JSON', () => {
    const fixture = buildRobotPhysicalValidationReceiptFixture();
    expect(verifyRobotPhysicalValidationReceipt(fixture.upstream, fixture.receiptBytes, fixture.artifacts, {}).physicalValidationReady).toBe(false);
    expect(verifyRobotPhysicalValidationReceipt(fixture.upstream, new Uint8Array([0xff]), fixture.artifacts, fixture.trustedKeys)).toMatchObject({ status: 'failed', physicalValidationReady: false, releaseReady: false });
  });
});
