import { describe, expect, it } from 'vitest';
import type { FeatureRuntimeCapability } from './commercialFeaturePreflight';
import { decidePlannedFeatureExecution, preflightCommercialFeatureTree } from './commercialFeaturePreflight';
import { lookupFeature } from '@/lib/cad/featureRegistry';
import type { FeatureTree } from '@/lib/cad/featureTree';

const loop = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const extrude = (id: string) => ({
  id, name: id, dependencies: [],
  payload: { kind: 'extrude' as const, loop, depth: 5, direction: 'one_sided' as const, mode: 'add' as const },
});

const exactCapability = (): FeatureRuntimeCapability => ({
  executor: 'REAL_OCCT',
  identitySha256: 'a'.repeat(64),
  stubFallback: false,
  handlerIds: [
    'occt.sketchExtrude', 'occt.revolve', 'occt.hole', 'occt.fillet', 'occt.chamfer', 'occt.shell.open',
    'occt.boolean.union', 'occt.boolean.subtract', 'occt.boolean.intersect',
  ],
  verifierIds: ['part-exact-brep', 'part-step-roundtrip'],
});

describe('commercialFeaturePreflight', () => {
  it('passes only a bounded exact open-shell plan and never executes it', () => {
    const base = extrude('base');
    const tree: FeatureTree = { nodes: [base, {
      id: 'shell1', name: 'open shell', dependencies: ['base'],
      payload: { kind: 'shell', childId: 'base', childExtrude: base.payload, thickness: 1, openTopFace: true },
    }] };
    const result = preflightCommercialFeatureTree(tree, exactCapability());
    expect(result.status).toBe('PRECHECK_PASS');
    expect(result.plan).toMatchObject({ commandCount: 2, finalResultId: 'shell1', terminalIds: ['shell1'] });
    expect(result.decisions.map(decision => decision.commandOp)).toEqual(['extrude', 'shell']);
    expect(result).not.toHaveProperty('finalVerification');
  });

  it('holds generic closed shell and maps only open shell to shell-open', () => {
    const base = extrude('base');
    const closed: FeatureTree = { nodes: [base, {
      id: 'shell1', name: 'closed shell', dependencies: ['base'],
      payload: { kind: 'shell', childId: 'base', childExtrude: base.payload, thickness: 1 },
    }] };
    const result = preflightCommercialFeatureTree(closed, exactCapability());
    expect(result.status).toBe('HOLD');
    expect(result.issues.some(issue => issue.code === 'FEATURE_PREVIEW' || issue.code === 'PLAN_UNSUPPORTED')).toBe(true);
    // `tree:shell` is the lookup alias; the registry returns its canonical id.
    expect(result.decisions.find(decision => decision.nodeId === 'shell1')?.featureId).toBe('cad.mechanical.shell');
  });

  it('holds preview, unsupported, unknown, stub, missing handler, and missing verifier cases', () => {
    const base = extrude('base');
    const preview: FeatureTree = { nodes: [base, {
      id: 'pattern', name: 'pattern', dependencies: ['base'],
      payload: { kind: 'linear_pattern', childScad: 'cube(1);', count: 2, direction: { x: 1, y: 0, z: 0 }, spacing: 5 },
    }] };
    const previewResult = preflightCommercialFeatureTree(preview, exactCapability());
    expect(previewResult.status).toBe('HOLD');
    expect(previewResult.issues.some(issue => issue.code === 'FEATURE_PREVIEW' || issue.code === 'PLAN_UNSUPPORTED')).toBe(true);

    const stubResult = preflightCommercialFeatureTree({ nodes: [base] }, { ...exactCapability(), executor: 'STUB', stubFallback: true });
    expect(stubResult.status).toBe('HOLD');
    expect(stubResult.issues.some(issue => issue.code === 'FEATURE_STUB_RUNTIME')).toBe(true);

    const missingHandler = preflightCommercialFeatureTree({ nodes: [base] }, { ...exactCapability(), handlerIds: [] });
    expect(missingHandler.status).toBe('HOLD');
    expect(missingHandler.issues.some(issue => issue.code === 'FEATURE_HANDLER_MISSING')).toBe(true);

    const missingVerifier = preflightCommercialFeatureTree({ nodes: [base] }, { ...exactCapability(), verifierIds: [] });
    expect(missingVerifier.status).toBe('HOLD');
    expect(missingVerifier.issues.some(issue => issue.code === 'FEATURE_VERIFIER_MISSING')).toBe(true);

    const unknown = preflightCommercialFeatureTree({ nodes: [{ ...base, payload: { kind: 'not_a_feature' } }] }, exactCapability());
    expect(unknown.status).toBe('HOLD');
    expect(unknown.issues[0]?.code).toBe('INVALID_INPUT');
  });

  it('holds unsupported, embedded, empty, and non-terminal plans', () => {
    const base = extrude('base');
    const unsupported: FeatureTree = { nodes: [base, {
      id: 'sweep', name: 'sweep', dependencies: ['base'],
      payload: { kind: 'sweep', childId: 'base', childScad: 'cube(1);' } as never,
    }] };
    expect(preflightCommercialFeatureTree(unsupported, exactCapability()).status).toBe('HOLD');

    const embedded: FeatureTree = { nodes: [{
      id: 'f1', name: 'legacy fillet', dependencies: [],
      payload: { kind: 'fillet', childExtrude: base.payload, radius: 1, edgeSelection: 'all' },
    }] };
    const embeddedResult = preflightCommercialFeatureTree(embedded, exactCapability());
    expect(embeddedResult.status).toBe('HOLD');
    expect(embeddedResult.issues.some(issue => issue.code === 'PLAN_EMBEDDED_NODE')).toBe(true);

    expect(preflightCommercialFeatureTree({ nodes: [] }, exactCapability()).status).toBe('HOLD');

    const branches: FeatureTree = { nodes: [extrude('a'), extrude('b')] };
    const branchResult = preflightCommercialFeatureTree(branches, exactCapability());
    expect(branchResult.status).toBe('HOLD');
    expect(branchResult.issues.some(issue => issue.code === 'PLAN_TERMINAL_COUNT')).toBe(true);
  });

  it('skips suppressed nodes but holds an active node whose suppressed dependency is missing', () => {
    const suppressed: FeatureTree = { nodes: [{ ...extrude('preview'), suppressed: true }] };
    expect(preflightCommercialFeatureTree(suppressed, exactCapability()).status).toBe('HOLD');

    const active: FeatureTree = { nodes: [{ ...extrude('base'), suppressed: true }, {
      id: 'hole', name: 'hole', dependencies: ['base'],
      payload: { kind: 'hole', childId: 'base', center: { x: 5, y: 5 }, holeType: 'drilled', diameter: 2, depth: 4, terminationMode: 'blind' },
    }] };
    const result = preflightCommercialFeatureTree(active, exactCapability());
    expect(result.status).toBe('HOLD');
    expect(result.issues.some(issue => issue.code === 'PLAN_BUILD_ERROR')).toBe(true);
  });

  it('is bounded and nonthrowing for malformed tree/capability input', () => {
    expect(() => preflightCommercialFeatureTree(null, exactCapability())).not.toThrow();
    expect(preflightCommercialFeatureTree(null, exactCapability()).status).toBe('HOLD');
    expect(preflightCommercialFeatureTree({ nodes: [] }, null).status).toBe('HOLD');
    expect(preflightCommercialFeatureTree({ nodes: [{ id: 'x', name: 'x', dependencies: [], payload: { kind: 'extrude', loop: [] }, extra: true }] }, exactCapability()).status).toBe('HOLD');
    expect(preflightCommercialFeatureTree({ nodes: [extrude('x')] }, { ...exactCapability(), identitySha256: 'self-asserted' }).status).toBe('HOLD');
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('hostile'); } });
    expect(() => preflightCommercialFeatureTree(hostile, exactCapability())).not.toThrow();
    expect(preflightCommercialFeatureTree(hostile, exactCapability()).status).toBe('HOLD');
  });

  it('holds an exact feature whose values exceed the graduated command bounds', () => {
    const invalid = extrude('bad');
    invalid.payload.depth = -1;
    const result = preflightCommercialFeatureTree({ nodes: [invalid] }, exactCapability());
    expect(result.status).toBe('HOLD');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEATURE_PARAMETER_OUT_OF_BOUNDS', nodeId: 'bad' }),
    ]));
  });

  it('checks handler-to-command correspondence mechanically', () => {
    const entry = lookupFeature('native:revolve');
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    const decision = decidePlannedFeatureExecution(entry.feature, 'extrude', exactCapability());
    expect(decision.status).toBe('HOLD');
    expect(decision.issues.some(issue => issue.code === 'FEATURE_COMMAND_MISMATCH')).toBe(true);
  });
});
