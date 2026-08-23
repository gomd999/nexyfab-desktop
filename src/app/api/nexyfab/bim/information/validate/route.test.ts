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

function request(body: BodyInit, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/nexyfab/bim/information/validate', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, ip: string, headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/nexyfab/bim/information/validate', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('BIM information validation bounded ingress', () => {
  it('validates a source-traceable registry', async () => {
    const response = await POST(request(JSON.stringify({ mode: 'registry', registry: registry() }), 'bim-valid-registry'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'valid', issues: [] });
  });

  it('returns 422 for an instance with registry drift and missing required data', async () => {
    const response = await POST(request(JSON.stringify({
      mode: 'instance', registry: registry(),
      instance: { registryId: 'site-v1', registryVersion: 'stale', stage: 'design', classifications: [{ scheme: 'OBS', code: '01' }], properties: [], bep: {} },
    }), 'bim-invalid-instance'));
    expect(response.status).toBe(422);
    expect((await response.json()).issues.map((value: { code: string }) => value.code)).toEqual(expect.arrayContaining(['REGISTRY_VERSION_INVALID', 'PROPERTY_REQUIRED', 'BEP_REQUIRED']));
  });

  it('rejects unbounded or malformed request structures before validation', async () => {
    const value = registry(); (value.classifications[0] as { level: number }).level = 8;
    const response = await POST(request(JSON.stringify({ mode: 'registry', registry: value }), 'bim-invalid-structure'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  it('preserves invalid JSON and invalid UTF-8 responses', async () => {
    for (const [body, ip] of [['{', 'bim-invalid-json'], [new Uint8Array([0xff]), 'bim-invalid-utf8']] as const) {
      const response = await POST(request(body, ip));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' });
    }
  });

  it('preserves the declared oversized response and cancels the source before rate limiting', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const response = await POST(streamedRequest(stream, 'bim-declared-large', { 'content-length': '10000001' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' });
    expect(cancelled).toBe(true);
  });

  it('does not trust Content-Length and cancels a measured oversized stream', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1_000_000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        for (let i = 0; i < 10; i++) controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, 'bim-measured-large', { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' });
    expect(cancelled).toBe(true);
  });
});
