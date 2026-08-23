import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { manufacturingInspectionSignaturePayload } from '@/lib/manufacturingInspectionReceipt';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  checkOrigin: vi.fn(() => true),
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.checkOrigin }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ queryOne: mocks.queryOne, queryAll: mocks.queryAll, execute: mocks.execute }),
}));

import { POST } from './route';

const key = generateKeyPairSync('ed25519');
const hash = (char: string) => char.repeat(64);

function signedReceipt(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schema: 'nexyfab.manufacturing-inspection-receipt.v1' as const,
    receiptId: 'inspection-1', orderId: 'order-1', lineageId: 'lineage-1', artifactId: 'artifact-1',
    artifactSha256: hash('a'), documentVersionId: 'revision-1', releasePackageSha256: hash('b'),
    inspectionReportSha256: hash('c'), result: 'pass' as const, inspectorId: 'inspector-1',
    inspectedAt: new Date().toISOString(), measurements: { criticalCount: 3, passedCount: 3, failedCount: 0 },
    ...overrides,
  };
  return { ...unsigned, signature: sign(null, Buffer.from(manufacturingInspectionSignaturePayload(unsigned)), key.privateKey).toString('base64') };
}

function request(body: unknown) {
  return new NextRequest('https://nexyfab.com/api/nexyfab/orders/order-1/inspection', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://nexyfab.com' }, body: JSON.stringify(body),
  });
}

describe('manufacturing inspection receipt route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXYFAB_MANUFACTURING_INSPECTOR_KEYS = JSON.stringify({
      'inspector-1': { publicKey: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['manufacturing-inspector'] },
    });
    mocks.getAuthUser.mockResolvedValue({
      userId: 'buyer-1', orgIds: [], activeOrgId: null, orgContextStatus: 'personal', globalRole: 'user',
    });
    mocks.execute.mockImplementation(async (sql: string) => ({ changes: sql.includes('INSERT INTO nf_manufacturing_inspection_receipts') ? 1 : 0 }));
    mocks.queryAll.mockResolvedValue([]);
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nf_orders')) return {
        id: 'order-1', user_id: 'buyer-1', org_id: null, manufacturer_id: 'factory-1', status: 'qc', created_at: Date.now() - 60_000,
        lineage_id: 'lineage-1', artifact_id: 'artifact-1', artifact_sha256: hash('a'), document_version_id: 'revision-1',
      };
      if (sql.includes('FROM nf_manufacturing_lineage')) return {
        lineage_id: 'lineage-1', user_id: 'buyer-1', artifact_id: 'artifact-1', artifact_sha256: hash('a'),
        document_version_id: 'revision-1', release_status: 'authorized', authorized_at: 1, authorized_by: 'reviewer', invalidated_at: null,
      };
      return undefined;
    });
  });

  it('stores only a trusted receipt bound to the live order release', async () => {
    const response = await POST(request(signedReceipt()), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: 'pass', qualityReleaseEligible: true });
  });

  it('rejects a validly signed receipt for a different artifact', async () => {
    const response = await POST(request(signedReceipt({ artifactSha256: hash('d') })), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'INSPECTION_ARTIFACT_MISMATCH' });
  });

  it('rejects inspection after the release was revoked', async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nf_orders')) return {
        id: 'order-1', user_id: 'buyer-1', org_id: null, manufacturer_id: 'factory-1', status: 'qc', created_at: Date.now() - 60_000,
        lineage_id: 'lineage-1', artifact_id: 'artifact-1', artifact_sha256: hash('a'), document_version_id: 'revision-1',
      };
      if (sql.includes('FROM nf_manufacturing_lineage')) return {
        lineage_id: 'lineage-1', user_id: 'buyer-1', artifact_id: 'artifact-1', artifact_sha256: hash('a'),
        document_version_id: 'revision-1', release_status: 'revoked', authorized_at: 1, authorized_by: 'reviewer', invalidated_at: 2,
      };
      return undefined;
    });
    const response = await POST(request(signedReceipt()), { params: Promise.resolve({ id: 'order-1' }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'LINEAGE_NOT_AUTHORIZED' });
  });
});
