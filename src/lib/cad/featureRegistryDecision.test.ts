import { describe, expect, it } from 'vitest';
import { decideFeatureExecution, type FeatureExecutionRequest } from './featureRegistryDecision';

const sha = 'a'.repeat(64);

function request(
  featureId: string,
  overrides: Partial<FeatureExecutionRequest> = {},
): FeatureExecutionRequest {
  return {
    featureId,
    intent: 'AUTHORITATIVE',
    runtime: {
      executor: 'REAL_OCCT',
      identitySha256: sha,
      stubFallback: false,
      handlerIds: ['occt.sketchExtrude', 'occt.shell.open'],
      verifierIds: ['part-exact-brep', 'part-step-roundtrip'],
    },
    ...overrides,
  };
}

describe('GP-05 commercial feature execution decision', () => {
  it('allows a bounded exact feature only with live handler, kernel identity and verifiers', () => {
    expect(decideFeatureExecution(request('tree:extrude'))).toMatchObject({
      status: 'ALLOW_EXACT',
      featureId: 'cad.mechanical.sketch-extrude',
      fidelity: 'EXACT',
      reason: 'exact_ready',
      messageKey: null,
    });

    const missingHandler = request('tree:extrude');
    missingHandler.runtime = { ...missingHandler.runtime, handlerIds: [] };
    expect(decideFeatureExecution(missingHandler)).toMatchObject({
      status: 'BLOCK',
      reason: 'handler_unavailable',
      missing: ['handler:occt.sketchExtrude'],
    });

    const missingVerifier = request('tree:extrude');
    missingVerifier.runtime = { ...missingVerifier.runtime, verifierIds: ['part-exact-brep'] };
    expect(decideFeatureExecution(missingVerifier)).toMatchObject({
      status: 'BLOCK',
      reason: 'verification_unavailable',
      missing: ['verifier:part-step-roundtrip'],
    });
  });

  it('never silently downgrades an exact or authoritative request', () => {
    const meshForExact = request('tree:extrude', { intent: 'PREVIEW' });
    meshForExact.runtime = {
      executor: 'MESH_PREVIEW',
      identitySha256: sha,
      stubFallback: false,
      handlerIds: [],
      verifierIds: [],
    };
    expect(decideFeatureExecution(meshForExact)).toMatchObject({
      status: 'BLOCK',
      reason: 'runtime_executor_mismatch',
    });

    expect(decideFeatureExecution(request('native:boundarySurface'))).toMatchObject({
      status: 'BLOCK',
      reason: 'preview_not_authoritative',
    });
  });

  it('allows an explicitly requested preview only through a real preview runtime', () => {
    const preview = request('native:boundarySurface', {
      intent: 'PREVIEW',
      runtime: {
        executor: 'MESH_PREVIEW',
        identitySha256: sha,
        stubFallback: false,
        handlerIds: [],
        verifierIds: [],
      },
    });
    expect(decideFeatureExecution(preview)).toMatchObject({
      status: 'ALLOW_PREVIEW',
      fidelity: 'PREVIEW',
      reason: 'preview_ready',
    });

    preview.runtime = { ...preview.runtime, executor: 'STUB', stubFallback: true };
    expect(decideFeatureExecution(preview)).toMatchObject({
      status: 'BLOCK',
      reason: 'stub_fallback_forbidden',
    });
  });

  it('requires the explicit open-shell variant for exact execution', () => {
    expect(decideFeatureExecution(request('tree:shell'))).toMatchObject({
      status: 'BLOCK',
      reason: 'preview_not_authoritative',
    });
    expect(decideFeatureExecution(request('cad.mechanical.shell-open'))).toMatchObject({
      status: 'ALLOW_EXACT',
      featureId: 'cad.mechanical.shell-open',
    });
  });

  it('allows graduated native exact features only with their exact runtime handlers', () => {
    const runtime = {
      executor: 'REAL_OCCT' as const,
      identitySha256: sha,
      stubFallback: false,
      handlerIds: ['occt.variableFillet', 'occt.draft', 'occt.thread.cylindrical', 'occt.scale.uniform', 'occt.move-copy.translation', 'occt.mirror.plane', 'occt.rib.single', 'occt.offset-face.top', 'occt.cut.through-rect'],
      verifierIds: ['part-exact-brep', 'part-step-roundtrip'],
    };
    for (const featureId of ['cad.mechanical.variable-fillet', 'cad.mechanical.draft', 'cad.mechanical.thread', 'cad.mechanical.scale', 'cad.mechanical.move-copy', 'cad.mechanical.mirror', 'cad.mechanical.rib', 'cad.mechanical.offset-face', 'cad.mechanical.cut']) {
      expect(decideFeatureExecution({ featureId, intent: 'AUTHORITATIVE', runtime })).toMatchObject({ status: 'ALLOW_EXACT', featureId });
    }
    expect(decideFeatureExecution({ featureId: 'cad.mechanical.variable-fillet', intent: 'AUTHORITATIVE', runtime: { ...runtime, handlerIds: [] } })).toMatchObject({ status: 'BLOCK', reason: 'handler_unavailable' });
  });

  it('fails closed for unsupported, malformed and hostile inputs', () => {
    expect(decideFeatureExecution(request('tree:sweep'))).toMatchObject({
      status: 'BLOCK',
      reason: 'feature_unsupported',
    });
    expect(decideFeatureExecution(request('tree:sweep_path'))).toMatchObject({
      status: 'BLOCK',
      reason: 'feature_unsupported',
    });
    expect(decideFeatureExecution(request('unknown:feature'))).toMatchObject({
      status: 'BLOCK',
      reason: 'unknown_feature',
    });
    expect(decideFeatureExecution({ ...request('tree:extrude'), extra: true })).toMatchObject({
      status: 'BLOCK',
      reason: 'invalid_request',
    });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('hostile'); } });
    expect(decideFeatureExecution(hostile)).toMatchObject({
      status: 'BLOCK',
      reason: 'invalid_request',
    });
  });
});
