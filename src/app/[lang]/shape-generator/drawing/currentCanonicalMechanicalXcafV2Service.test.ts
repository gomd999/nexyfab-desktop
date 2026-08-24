// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  readCurrentCanonicalMechanicalXcafV2,
  type XcafV2Inspector,
} from './currentCanonicalMechanicalXcafV2Service';

const mocked = vi.hoisted(() => ({
  buildBundle: vi.fn(), validateBundle: vi.fn(), buildOccurrence: vi.fn(),
}));
vi.mock('./currentCanonicalMechanicalBundleV2', () => ({
  buildCurrentCanonicalMechanicalArtifactBundleV2: mocked.buildBundle,
  validateCurrentCanonicalMechanicalArtifactBundleV2: mocked.validateBundle,
}));
vi.mock('@/lib/occt/currentCanonicalXcafOccurrence', () => ({
  buildCurrentCanonicalXcafOccurrenceV2: mocked.buildOccurrence,
}));

const step = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
const digest = createHash('sha256').update(new TextEncoder().encode(step)).digest('hex');
const bundle = {
  schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2',
  status: 'EXACT_BUNDLE_V2_PASS',
  artifacts: { stepSha256: digest },
  handoff: { exactSinglePart: { step: { text: step, sha256: digest } } },
} as any;
const db = {} as any;

describe('server-only current canonical XCAF v2 orchestration', () => {
  it('binds only the generated v2 STEP to the inspector and remains release HOLD', async () => {
    mocked.buildBundle.mockResolvedValue(bundle);
    mocked.validateBundle.mockResolvedValue({ ok: true, bundle });
    mocked.buildOccurrence.mockReturnValue({
      schema: 'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1',
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      release: 'HOLD',
    });
    const inspect = vi.fn(async ({ inputBytes, sha256 }: {
      inputBytes: Uint8Array; sha256: string;
    }) => {
      expect(new TextDecoder().decode(inputBytes)).toBe(step);
      expect(sha256).toBe(digest);
      return { status: 'PASS_NATIVE' } as any;
    });
    const result = await readCurrentCanonicalMechanicalXcafV2({
      db, projectId: 'project-1', documentId: 'document-1', inspector: { inspect },
    });
    expect(result).toMatchObject({ status: 'PASS_NATIVE_INVOCATION_BOUND', release: 'HOLD' });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(mocked.buildOccurrence).toHaveBeenCalledWith({ bundle, inspection: expect.anything() });
  });

  it('rejects caller artifacts, hostile inputs, and internal failures as one generic HOLD', async () => {
    const inspector: XcafV2Inspector = { inspect: vi.fn() };
    expect(await readCurrentCanonicalMechanicalXcafV2({
      db, projectId: 'project-1', documentId: 'document-1', inspector,
      bundle, step, inspection: {},
    })).toMatchObject({ status: 'HOLD', blockers: ['CURRENT_XCAF_V2_SERVICE_HOLD'] });

    mocked.buildBundle.mockRejectedValue(new Error('sensitive failure'));
    expect(await readCurrentCanonicalMechanicalXcafV2({
      db, projectId: 'project-1', documentId: 'document-1', inspector,
    })).toMatchObject({ status: 'HOLD', blockers: ['CURRENT_XCAF_V2_SERVICE_HOLD'] });
    expect(inspector.inspect).not.toHaveBeenCalled();

    const hidden = { db, projectId: 'project-1', documentId: 'document-1', inspector };
    Object.defineProperty(hidden, 'step', { value: step, enumerable: false });
    expect(await readCurrentCanonicalMechanicalXcafV2(hidden)).toMatchObject({ status: 'HOLD' });
    const getter = { db, projectId: 'project-1', documentId: 'document-1', inspector };
    Object.defineProperty(getter, 'projectId', {
      enumerable: true,
      get() { throw new Error('hostile'); },
    });
    await expect(readCurrentCanonicalMechanicalXcafV2(getter)).resolves.toMatchObject({ status: 'HOLD' });
    const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    await expect(readCurrentCanonicalMechanicalXcafV2(proxy)).resolves.toMatchObject({ status: 'HOLD' });
  });
});
