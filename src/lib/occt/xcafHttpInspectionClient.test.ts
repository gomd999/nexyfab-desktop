// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createXcafHttpInspector,
  loadXcafHttpInspectorFromEnvironment,
} from './xcafHttpInspectionClient';

const step = new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;\n');
const stepSha = createHash('sha256').update(step).digest('hex');
const sha = (letter: string) => letter.repeat(64);

function inspection() {
  return {
    schema: 'nexyfab.occt-xcaf.inspect-result.v1', status: 'PASS_NATIVE', inputSha256: stepSha,
    nativeBinarySha256: sha('b'), nativeInvocationSha256: sha('c'),
    native: {
      schema: 'nexyfab.occt-xcaf.inspect.v1', status: 'PASS_NATIVE', inputSha256: stepSha, unit: 'MM',
      programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'native-build' },
      kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'kernel-build' },
      productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool',
      products: [{
        entry: '0:1', role: 'product', occurrencePath: '0:1', referredEntry: null,
        name: 'Contract part', partNumber: null, partNumberStatus: 'NOT_EXPOSED_BY_BINDING', label: '0:1',
        transformScope: 'local_to_parent',
        transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] },
        color: null,
        shape: {
          solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12, nonManifoldEdgeCount: 0,
          brepValid: true, volumeMm3: 1, surfaceAreaMm2: 6, maxToleranceMm: 0.001,
          bboxMm: [0, 0, 0, 1, 1, 1], centroidMm: [0.5, 0.5, 0.5],
          massPropertiesBasis: 'volume', inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
        },
      }],
    },
  };
}

describe('server-only XCAF HTTP inspection client', () => {
  it('sends only hash-bound server STEP bytes with bearer auth and validates the native receipt', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toBe('https://xcaf.internal/v1/inspect');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${'t'.repeat(32)}`);
      const body = JSON.parse(String(init?.body));
      expect(Buffer.from(body.inputBase64, 'base64')).toEqual(Buffer.from(step));
      expect(body.sha256).toBe(stepSha);
      return Response.json(inspection());
    });
    const inspector = createXcafHttpInspector({
      serviceUrl: 'https://xcaf.internal/', serviceToken: 't'.repeat(32), fetchImpl,
    });
    await expect(inspector.inspect({ inputBytes: step, sha256: stepSha })).resolves.toMatchObject({
      status: 'PASS_NATIVE', inputSha256: stepSha,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed for bad configuration, request substitution, service failure, and invalid receipts', async () => {
    expect(loadXcafHttpInspectorFromEnvironment({ OCCT_XCAF_SERVICE_URL: 'file:///tmp/worker', OCCT_XCAF_SERVICE_TOKEN: 't'.repeat(32) })).toEqual({ ok: false, reason: 'XCAF_SERVICE_CONFIG_HOLD' });
    expect(loadXcafHttpInspectorFromEnvironment({ OCCT_XCAF_SERVICE_URL: 'https://xcaf.internal', OCCT_XCAF_SERVICE_TOKEN: 'short' })).toEqual({ ok: false, reason: 'XCAF_SERVICE_CONFIG_HOLD' });
    const rejected = createXcafHttpInspector({
      serviceUrl: 'https://xcaf.internal', serviceToken: 't'.repeat(32),
      fetchImpl: vi.fn(async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })),
    });
    await expect(rejected.inspect({ inputBytes: step, sha256: stepSha })).rejects.toThrow('XCAF_SERVICE_REJECTED');
    await expect(rejected.inspect({ inputBytes: step, sha256: sha('9') })).rejects.toThrow('XCAF_REQUEST_INVALID');
    const invalid = inspection();
    invalid.nativeInvocationSha256 = 'invalid';
    const malformed = createXcafHttpInspector({
      serviceUrl: 'https://xcaf.internal', serviceToken: 't'.repeat(32),
      fetchImpl: vi.fn(async () => Response.json(invalid)),
    });
    await expect(malformed.inspect({ inputBytes: step, sha256: stepSha })).rejects.toThrow('XCAF_INSPECTION_INVALID');
  });
});
