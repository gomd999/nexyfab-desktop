// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  load: vi.fn(),
  bridge: { importSTEP: vi.fn(), release: vi.fn() },
}));

vi.mock('@/lib/reference/cadReferenceAnalyze', () => ({ analyzeCadReference: mocks.analyze }));
vi.mock('@/lib/occt/nodeOcctLoader', () => ({ loadOcctNode: mocks.load }));
vi.mock('@/lib/occt/nodeOcctBridge', () => ({ createNodeOcctBridge: () => mocks.bridge }));

import { POST } from './route';

function request(body: unknown, suffix: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cad/v1/reference/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `reference-api-${suffix}`, ...headers },
    body: JSON.stringify(body),
  });
}

describe('CAD reference analyze API', () => {
  beforeEach(() => {
    mocks.analyze.mockReset();
    mocks.load.mockReset();
    mocks.load.mockResolvedValue({ ok: true, oc: {} });
    mocks.analyze.mockResolvedValue({ evidence: { status: 'pass', sideEffects: { quoteCreated: false, rfqSent: false } }, tolerancePolicy: { version: 'cad-tolerance/v1' } });
  });

  it('decodes an inline STEP and delegates to the shared exact-analysis core', async () => {
    const step = 'ISO-10303-21;END-ISO-10303-21;';
    const response = await POST(request({
      step: Buffer.from(step).toString('base64'), encoding: 'base64', format: 'step',
      scenarioId: 'api-box', lengthUnit: { kind: 'mm' },
    }, 'success'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ source: step, scenarioId: 'api-box', lengthUnit: { kind: 'mm' } }), mocks.bridge);
    expect(json).toMatchObject({ ok: true, quoteOrRfqSideEffects: false, evidence: { status: 'pass' } });
  });

  it('accepts UTF-8 STEP and explicit scale/tolerance without accepting a locator', async () => {
    const response = await POST(request({
      step: 'ISO-10303-21;', encoding: 'utf8', format: 'stp', scenarioId: 'inch-part',
      lengthUnit: { kind: 'scale-to-mm', scaleToMm: 25.4, label: 'inch' },
      declaredSourceTolerance: { value: 0.001 },
    }, 'utf8'));
    expect(response.status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ format: 'stp', declaredSourceTolerance: { value: 0.001 } }), mocks.bridge);
  });

  it.each(['path', 'filePath', 'url', 'fixtureId'])('rejects forbidden external locator field %s', async field => {
    const response = await POST(request({
      step: 'ISO-10303-21;', encoding: 'utf8', scenarioId: 'no-path', lengthUnit: { kind: 'mm' }, [field]: 'C:/secret/model.step',
    }, `forbidden-${field}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('rejects an oversized request from content-length before parsing', async () => {
    const response = await POST(request({}, 'large', { 'content-length': String(29 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects malformed base64 and invalid unit declarations', async () => {
    const response = await POST(request({
      step: 'not-base64!', scenarioId: 'bad', lengthUnit: { kind: 'scale-to-mm', scaleToMm: 0 },
    }, 'invalid'));
    expect(response.status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('fails fast when the public request declares an unknown length unit', async () => {
    const response = await POST(request({
      step: 'ISO-10303-21;', encoding: 'utf8', scenarioId: 'unknown-unit',
      lengthUnit: { kind: 'unknown', label: 'source did not declare units' },
    }, 'unknown-unit'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('reports kernel unavailability and analysis failures without side effects', async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, reason: 'missing wasm' });
    const unavailable = await POST(request({ step: 'ISO;', encoding: 'utf8', scenarioId: 'unavailable', lengthUnit: { kind: 'mm' } }, 'unavailable'));
    expect(unavailable.status).toBe(503);

    mocks.analyze.mockRejectedValueOnce(new Error('invalid STEP'));
    const failed = await POST(request({ step: 'ISO;', encoding: 'utf8', scenarioId: 'failed', lengthUnit: { kind: 'mm' } }, 'failed'));
    expect(failed.status).toBe(422);
    expect(await failed.json()).toMatchObject({ code: 'REFERENCE_ANALYSIS_FAILED', quoteOrRfqSideEffects: false });
  });
});
