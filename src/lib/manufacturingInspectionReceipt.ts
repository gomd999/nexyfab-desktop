import { createHash, createPublicKey, verify } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;

export interface ManufacturingInspectionReceiptUnsigned {
  schema: 'nexyfab.manufacturing-inspection-receipt.v1';
  receiptId: string;
  orderId: string;
  lineageId: string;
  artifactId: string;
  artifactSha256: string;
  documentVersionId: string;
  releasePackageSha256: string;
  inspectionReportSha256: string;
  result: 'pass' | 'fail';
  inspectorId: string;
  inspectedAt: string;
  measurements: {
    criticalCount: number;
    passedCount: number;
    failedCount: number;
  };
}

export interface ManufacturingInspectionReceipt extends ManufacturingInspectionReceiptUnsigned {
  signature: string;
}

export type TrustedManufacturingInspectorKeys = Record<string, { publicKey: string; roles: string[] }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function manufacturingInspectionSignaturePayload(receipt: ManufacturingInspectionReceiptUnsigned): string {
  return `nexyfab.manufacturing-inspection-receipt.v1\n${canonical(receipt)}`;
}

export function parseTrustedManufacturingInspectorKeys(raw = process.env.NEXYFAB_MANUFACTURING_INSPECTOR_KEYS): TrustedManufacturingInspectorKeys {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (!id.trim() || !value || typeof value !== 'object' || Array.isArray(value)) return [];
      const candidate = value as { publicKey?: unknown; roles?: unknown };
      if (typeof candidate.publicKey !== 'string' || !Array.isArray(candidate.roles)
        || !candidate.roles.every(role => typeof role === 'string')
        || !candidate.roles.includes('manufacturing-inspector')) return [];
      try {
        const publicKey = createPublicKey(candidate.publicKey).export({ type: 'spki', format: 'pem' }).toString();
        return [[id, { publicKey, roles: [...new Set(candidate.roles as string[])] }]];
      } catch { return []; }
    }));
  } catch { return {}; }
}

export function validateManufacturingInspectionReceipt(
  raw: unknown,
  trusted: TrustedManufacturingInspectorKeys,
): { ok: boolean; receipt: ManufacturingInspectionReceipt | null; receiptSha256: string | null; errors: string[] } {
  const receipt = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as ManufacturingInspectionReceipt
    : null;
  const errors: string[] = [];
  if (!receipt || receipt.schema !== 'nexyfab.manufacturing-inspection-receipt.v1') errors.push('inspection_schema_invalid');
  if (!receipt) return { ok: false, receipt: null, receiptSha256: null, errors };

  for (const [label, value] of Object.entries({
    receiptId: receipt.receiptId, orderId: receipt.orderId, lineageId: receipt.lineageId,
    artifactId: receipt.artifactId, documentVersionId: receipt.documentVersionId, inspectorId: receipt.inspectorId,
  })) if (typeof value !== 'string' || value.trim().length === 0 || value.length > 240) errors.push(`${label}_invalid`);
  for (const [label, value] of Object.entries({
    artifactSha256: receipt.artifactSha256,
    releasePackageSha256: receipt.releasePackageSha256,
    inspectionReportSha256: receipt.inspectionReportSha256,
  })) if (typeof value !== 'string' || !SHA256.test(value)) errors.push(`${label}_invalid`);
  if (!['pass', 'fail'].includes(receipt.result)) errors.push('inspection_result_invalid');
  if (!Number.isFinite(Date.parse(receipt.inspectedAt))) errors.push('inspection_time_invalid');
  const measurement = receipt.measurements;
  if (!measurement || !Number.isSafeInteger(measurement.criticalCount) || measurement.criticalCount < 3
    || !Number.isSafeInteger(measurement.passedCount) || measurement.passedCount < 0
    || !Number.isSafeInteger(measurement.failedCount) || measurement.failedCount < 0
    || measurement.passedCount + measurement.failedCount !== measurement.criticalCount) {
    errors.push('inspection_measurement_counts_invalid');
  } else if (receipt.result === 'pass' && (measurement.failedCount !== 0 || measurement.passedCount !== measurement.criticalCount)) {
    errors.push('inspection_pass_contradicts_measurements');
  } else if (receipt.result === 'fail' && measurement.failedCount === 0) {
    errors.push('inspection_fail_contradicts_measurements');
  }

  const registration = trusted[receipt.inspectorId];
  const { signature: _signature, ...unsigned } = receipt;
  if (!registration) errors.push('inspection_inspector_untrusted');
  else {
    try {
      if (typeof receipt.signature !== 'string' || !verify(
        null,
        Buffer.from(manufacturingInspectionSignaturePayload(unsigned)),
        registration.publicKey,
        Buffer.from(receipt.signature, 'base64'),
      )) errors.push('inspection_signature_invalid');
    } catch { errors.push('inspection_signature_invalid'); }
  }
  const receiptSha256 = createHash('sha256').update(canonical(receipt)).digest('hex');
  return { ok: errors.length === 0, receipt, receiptSha256, errors: [...new Set(errors)] };
}
