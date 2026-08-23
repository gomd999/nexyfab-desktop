import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  manufacturingInspectionSignaturePayload,
  validateManufacturingInspectionReceipt,
  type ManufacturingInspectionReceipt,
} from './manufacturingInspectionReceipt';

const pair = generateKeyPairSync('ed25519');
const trusted = {
  inspector: {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    roles: ['manufacturing-inspector'],
  },
};

function receipt(): ManufacturingInspectionReceipt {
  const unsigned = {
    schema: 'nexyfab.manufacturing-inspection-receipt.v1' as const,
    receiptId: 'inspection-1', orderId: 'order-1', lineageId: 'lineage-1', artifactId: 'artifact-1',
    artifactSha256: 'a'.repeat(64), documentVersionId: 'revision-1', releasePackageSha256: 'b'.repeat(64),
    inspectionReportSha256: 'c'.repeat(64), result: 'pass' as const, inspectorId: 'inspector',
    inspectedAt: '2026-08-11T10:00:00.000Z', measurements: { criticalCount: 3, passedCount: 3, failedCount: 0 },
  };
  return { ...unsigned, signature: sign(null, Buffer.from(manufacturingInspectionSignaturePayload(unsigned)), pair.privateKey).toString('base64') };
}

describe('manufacturing inspection receipt', () => {
  it('accepts a trusted signature bound to the exact order and release hashes', () => {
    expect(validateManufacturingInspectionReceipt(receipt(), trusted)).toMatchObject({ ok: true, errors: [], receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('fails closed on a changed artifact or contradictory pass counts', () => {
    const changed = receipt();
    changed.artifactSha256 = 'd'.repeat(64);
    expect(validateManufacturingInspectionReceipt(changed, trusted).errors).toContain('inspection_signature_invalid');
    const contradictory = receipt();
    contradictory.measurements = { criticalCount: 3, passedCount: 2, failedCount: 1 };
    expect(validateManufacturingInspectionReceipt(contradictory, trusted).errors).toContain('inspection_pass_contradicts_measurements');
  });

  it('rejects a signer outside the trusted manufacturing-inspector registry', () => {
    expect(validateManufacturingInspectionReceipt(receipt(), {})).toMatchObject({ ok: false, errors: expect.arrayContaining(['inspection_inspector_untrusted']) });
  });
});
