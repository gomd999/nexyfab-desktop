import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  AUTHENTICATED_E2E_REQUIRED_CHECKS,
  buildAuthenticatedCommercialE2EReceipt,
  verifyAuthenticatedCommercialE2EReceipt,
  writeAuthenticatedE2ESource,
} from './authenticated-commercial-e2e-receipt';

const now = Date.parse('2026-08-23T12:00:00.000Z');
const release = { buildId: 'build-e2e-v2', productionDeploymentId: 'prod-e2e-v2', evidenceDeploymentId: 'staging-e2e-v2', gitHead: 'b'.repeat(40) };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-e2e-receipt-v2-'));
  const requestById: Record<string, { method: string; pathname: string }> = {
    login: { method: 'POST', pathname: '/api/auth/login' },
    session: { method: 'GET', pathname: '/api/auth/session' },
    project_create: { method: 'POST', pathname: '/api/nexyfab/projects' },
    project_read: { method: 'GET', pathname: '/api/nexyfab/projects/project-1' },
    cad_verify: { method: 'POST', pathname: '/api/cad/v1/project/verify' },
    storage_state_reconnect: { method: 'GET', pathname: '/api/nexyfab/projects/project-1' },
    expert_workspace_visible: { method: 'GET', pathname: '/en/shape-generator/?expert=1&mode=expert' },
    project_cleanup: { method: 'DELETE', pathname: '/api/nexyfab/projects/project-1' },
    logout: { method: 'POST', pathname: '/api/auth/logout' },
  };
  const observations = AUTHENTICATED_E2E_REQUIRED_CHECKS.map((id, index) => ({
    id,
    request: requestById[id],
    httpStatus: id === 'project_create' ? 201 : 200, bodyBytes: index + 10, bodySha256: `${String(index + 1).repeat(64).slice(0, 64)}`, contentType: 'application/json',
    ...(id === 'expert_workspace_visible' ? { marker: 'shape-generator-workspace', markerSha256: createHash('sha256').update('shape-generator-workspace').digest('hex') } : {}),
  }));
  const generatedAt = new Date(now).toISOString();
  const source = writeAuthenticatedE2ESource({ root, artifactPath: 'observations/e2e.json', generatedAt, target: 'https://staging.nexyfab.com', observations });
  const receipt = buildAuthenticatedCommercialE2EReceipt({ generatedAt, target: 'https://staging.nexyfab.com', release, observations, ready: { status: 'ok', db: { status: 'ok', required: true, backend: 'postgres' }, redis: { status: 'ok', required: true }, commercialBoundary: { status: 'ok', required: true } }, sourceBindings: [source.binding], now });
  return { root, receipt };
}

describe('authenticated E2E receipt v2', () => {
  beforeEach(() => {});

  it('verifies exact observations, source binding, freshness, and isolated release identity', () => {
    const { root, receipt } = fixture();
    expect(verifyAuthenticatedCommercialE2EReceipt(receipt, release, { root, now })).toBe(true);
    expect(verifyAuthenticatedCommercialE2EReceipt(receipt, { ...release, evidenceDeploymentId: release.productionDeploymentId }, { root, now })).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects label-only or tampered source observations even when rehashed', () => {
    const { root, receipt } = fixture();
    const fake = structuredClone(receipt);
    fake.observations[0].bodySha256 = 'f'.repeat(64);
    delete fake.sha256;
    fake.sha256 = createHash('sha256').update(JSON.stringify(fake)).digest('hex');
    expect(verifyAuthenticatedCommercialE2EReceipt(fake, release, { root, now })).toBe(false);
    fs.appendFileSync(path.join(root, 'observations/e2e.json'), 'tamper');
    expect(verifyAuthenticatedCommercialE2EReceipt(receipt, release, { root, now })).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects the right status captured from the wrong authenticated endpoint', () => {
    const { root, receipt } = fixture();
    const forged = structuredClone(receipt);
    forged.observations[0].request.pathname = '/api/auth/logout';
    delete forged.sha256;
    forged.sha256 = createHash('sha256').update(JSON.stringify(forged)).digest('hex');
    expect(verifyAuthenticatedCommercialE2EReceipt(forged, release, { root, now })).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
