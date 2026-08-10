import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { BIM_REGISTRY_SCHEMA } from '@/lib/bim/informationRegistry';
import { POST } from './route';

function registry() {
  return {
    schema: BIM_REGISTRY_SCHEMA, registryId: 'site-v1', version: '1',
    sourceReferences: [{ id: 'source', path: 'read-only.xlsx', revision: '1', access: 'read_only' as const }],
    units: [{ code: 'none', symbol: '-', dimension: 'none' as const }, { code: 'm', symbol: 'm', dimension: 'length' as const }],
    classifications: [{ scheme: 'OBS' as const, code: '01', name: 'facility', level: 1, sourceRef: 'source' }],
    properties: [{ pset: 'Pset_Object', key: 'length', name: 'Length', type: 'number' as const, unit: 'm', requiredAt: ['design' as const], sourceRef: 'source' }],
    bepRequirements: [{ key: 'qualityPlan', type: 'object' as const, requiredAt: ['design' as const], sourceRef: 'source' }],
  };
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/nexyfab/bim/information/validate', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}` }, body: JSON.stringify(body),
  });
}

describe('BIM information validation route', () => {
  it('validates a source-traceable registry', async () => {
    const response = await POST(request({ mode: 'registry', registry: registry() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'valid', issues: [] });
  });

  it('returns 422 for an instance with registry drift and missing required data', async () => {
    const response = await POST(request({
      mode: 'instance', registry: registry(),
      instance: { registryId: 'site-v1', registryVersion: 'stale', stage: 'design', classifications: [{ scheme: 'OBS', code: '01' }], properties: [], bep: {} },
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).issues.map((value: { code: string }) => value.code)).toEqual(expect.arrayContaining(['REGISTRY_VERSION_INVALID', 'PROPERTY_REQUIRED', 'BEP_REQUIRED']));
  });

  it('rejects unbounded or malformed request structures before validation', async () => {
    const value = registry(); (value.classifications[0] as { level: number }).level = 8;
    const response = await POST(request({ mode: 'registry', registry: value }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_request' });
  });
});
