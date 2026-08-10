import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-auth', () => ({ verifyAdmin: vi.fn() }));
import { verifyAdmin } from '@/lib/admin-auth';
import { GET } from './route';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-native-readiness-test-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('admin native CAD worker readiness API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXYFAB_NATIVE_WORKER_HEALTH_EVIDENCE', '');
    vi.stubEnv('NEXYFAB_NATIVE_WORKER_CANARY_EVIDENCE', '');
    for (const name of ['SOLIDWORKS', 'INVENTOR', 'CATIA', 'CREO', 'PARASOLID', 'DWG', 'REVIT']) {
      vi.stubEnv(`NEXYFAB_${name}_WORKER_COMMAND`, '');
    }
  });

  it('does not disclose readiness to non-admin callers', async () => {
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const response = await GET(new NextRequest('http://localhost/api/admin/native-cad-workers'));
    expect(response.status).toBe(403);
  });

  it('reports unconfigured workers without exposing command paths or secrets', async () => {
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const response = await GET(new NextRequest('http://localhost/api/admin/native-cad-workers'));
    const json = await response.json();
    expect(json).toMatchObject({ ok: true, releaseReady: false, summary: { workers: 7, configured: 0, canaryPassed: 0 } });
    expect(JSON.stringify(json)).not.toMatch(/WORKER_COMMAND|AUTH_TOKEN|executable|commandPath/);
  });

  it('uses the artifact generatedAt timestamp and rejects timestamp-free evidence', async () => {
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.stubEnv('NEXYFAB_SOLIDWORKS_WORKER_COMMAND', 'secret-worker-path.exe');
    const healthPath = path.join(tempRoot, 'health.json');
    fs.writeFileSync(healthPath, JSON.stringify({
      schema: 'nexyfab.native-worker-health-probe-batch.v1',
      results: [{ workerKind: 'solidworks-native', status: 'pass' }],
    }));
    vi.stubEnv('NEXYFAB_NATIVE_WORKER_HEALTH_EVIDENCE', healthPath);
    let json = await (await GET(new NextRequest('http://localhost/api/admin/native-cad-workers'))).json();
    expect(json.evidence.healthLoaded).toBe(false);
    expect(json.workers[0]).toMatchObject({ status: 'configured_unprobed' });

    fs.writeFileSync(healthPath, JSON.stringify({
      schema: 'nexyfab.native-worker-health-probe-batch.v1', generatedAt: new Date().toISOString(),
      results: [{ workerKind: 'solidworks-native', status: 'pass', health: {
        schema: 'nexyfab.native-worker-health.v1', workerKind: 'solidworks-native',
        worker: { name: 'worker', version: '1', cadSystem: 'SOLIDWORKS' },
        protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' },
        host: { os: 'windows', architecture: 'x64' }, license: { status: 'valid' },
        capabilities: { exactGeometry: true, nativeHierarchy: true, nativeConstraints: true, nativeParameters: true }, ready: true,
      } }],
    }));
    json = await (await GET(new NextRequest('http://localhost/api/admin/native-cad-workers'))).json();
    expect(json.evidence.healthLoaded).toBe(true);
    expect(json.workers[0]).toMatchObject({ status: 'ready_for_canary' });
    expect(JSON.stringify(json)).not.toContain('secret-worker-path.exe');
  });

  it('does not trust pass labels or expired/unbound canary evidence', async () => {
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.stubEnv('NEXYFAB_SOLIDWORKS_WORKER_COMMAND', 'secret-worker-path.exe');
    const healthPath = path.join(tempRoot, 'health-spoofed.json');
    const canaryPath = path.join(tempRoot, 'canary-expired.json');
    fs.writeFileSync(healthPath, JSON.stringify({
      schema: 'nexyfab.native-worker-health-probe-batch.v1', generatedAt: new Date().toISOString(),
      results: [{ workerKind: 'solidworks-native', status: 'pass', health: {
        schema: 'nexyfab.native-worker-health.v1', workerKind: 'solidworks-native',
        worker: { name: 'worker', version: '1', cadSystem: 'SOLIDWORKS' },
        protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' },
        host: { os: 'windows', architecture: 'x64' }, license: { status: 'expired' },
        capabilities: { exactGeometry: true, nativeHierarchy: true, nativeConstraints: true, nativeParameters: true }, ready: true,
      } }],
    }));
    fs.writeFileSync(canaryPath, JSON.stringify({
      schema: 'nexyfab.native-worker-canary-gate.v1', generatedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() - 1000).toISOString(), manifestSha256: 'a'.repeat(64),
      gates: [{ workerKind: 'solidworks-native', status: 'pass', workerIdentitySha256: null }],
    }));
    vi.stubEnv('NEXYFAB_NATIVE_WORKER_HEALTH_EVIDENCE', healthPath);
    vi.stubEnv('NEXYFAB_NATIVE_WORKER_CANARY_EVIDENCE', canaryPath);
    const json = await (await GET(new NextRequest('http://localhost/api/admin/native-cad-workers'))).json();
    expect(json.workers[0]).toMatchObject({ status: 'health_failed', batchEligible: false, canaryStatus: 'blocked_health' });
    expect(json.evidenceStatus).toEqual({ health: 'fresh', canary: 'expired' });
    expect(json.releaseReady).toBe(false);
  });
});
