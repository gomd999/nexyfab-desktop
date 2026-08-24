// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentCanonicalMechanicalXcaf, type XcafInspector } from './currentCanonicalMechanicalXcafService';

const mocked = vi.hoisted(() => ({
  buildBundle: vi.fn(), validateBundle: vi.fn(), buildOccurrence: vi.fn(),
}));
vi.mock('./currentCanonicalMechanicalBundle', () => ({
  buildCurrentCanonicalMechanicalArtifactBundle: mocked.buildBundle,
  validateCurrentCanonicalMechanicalArtifactBundle: mocked.validateBundle,
}));
vi.mock('@/lib/occt/currentCanonicalXcafOccurrence', () => ({
  buildCurrentCanonicalXcafOccurrence: mocked.buildOccurrence,
}));

const step = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
const digest = createHash('sha256').update(new TextEncoder().encode(step)).digest('hex');
const bundle = {
  schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1', status: 'EXACT_BUNDLE_PASS',
  artifacts: { stepSha256: digest }, handoff: { exactSinglePart: { step: { text: step, sha256: digest } } },
} as any;
const db = {} as any;

describe('server-only current canonical XCAF orchestration', () => {
  it('binds the generated server STEP to inspector input and keeps release HOLD (contract-only mock)', async () => {
    mocked.buildBundle.mockResolvedValue(bundle);
    mocked.validateBundle.mockResolvedValue({ ok: true, bundle });
    mocked.buildOccurrence.mockReturnValue({ schema: 'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1', status: 'PASS_NATIVE_INVOCATION_BOUND', release: 'HOLD' });
    const inspect = vi.fn(async ({ inputBytes, sha256 }: { inputBytes: Uint8Array; sha256: string }) => {
      expect(new TextDecoder().decode(inputBytes)).toBe(step);
      expect(sha256).toBe(digest);
      return { status: 'PASS_NATIVE' } as any;
    });
    const result = await readCurrentCanonicalMechanicalXcaf({ db, projectId: 'project-1', documentId: 'document-1', inspector: { inspect } });
    expect(result).toMatchObject({ status: 'PASS_NATIVE_INVOCATION_BOUND', release: 'HOLD' });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(mocked.buildOccurrence).toHaveBeenCalledWith({ bundle, inspection: expect.anything() });
  });

  it('rejects caller bundle/STEP/inspection extras and collapses failures to a generic HOLD', async () => {
    const inspector: XcafInspector = { inspect: vi.fn() };
    expect(await readCurrentCanonicalMechanicalXcaf({ db, projectId: 'project-1', documentId: 'document-1', inspector, bundle, step, inspection: {} })).toMatchObject({ status: 'HOLD', blockers: ['CURRENT_XCAF_SERVICE_HOLD'] });
    mocked.buildBundle.mockRejectedValue(new Error('sensitive db failure'));
    expect(await readCurrentCanonicalMechanicalXcaf({ db, projectId: 'project-1', documentId: 'document-1', inspector })).toMatchObject({ status: 'HOLD', blockers: ['CURRENT_XCAF_SERVICE_HOLD'] });
    expect(inspector.inspect).not.toHaveBeenCalled();
    const hidden = { db, projectId: 'project-1', documentId: 'document-1', inspector };
    Object.defineProperty(hidden, 'step', { value: step, enumerable: false });
    expect(await readCurrentCanonicalMechanicalXcaf(hidden)).toMatchObject({ status: 'HOLD' });
    expect(await readCurrentCanonicalMechanicalXcaf({
      db, projectId: 'project-1', documentId: 'document-1', inspector, [Symbol('inspection')]: {},
    })).toMatchObject({ status: 'HOLD' });
    const getter = { db, projectId: 'project-1', documentId: 'document-1', inspector };
    Object.defineProperty(getter, 'projectId', { enumerable: true, get() { throw new Error('hostile'); } });
    await expect(readCurrentCanonicalMechanicalXcaf(getter)).resolves.toMatchObject({ status: 'HOLD' });
    const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    await expect(readCurrentCanonicalMechanicalXcaf(proxy)).resolves.toMatchObject({ status: 'HOLD' });
  });
});
