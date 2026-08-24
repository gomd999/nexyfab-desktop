// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  createCanonicalCadDocumentV2,
  type CanonicalCadJsonObject,
  sealCanonicalCadObjectV2,
} from './canonicalCadV2ConsumerDraft';
import type { FeatureTree } from './featureTree';
import {
  EDGE_REFS_ONLY_SENTINEL,
  extractMechanicalSinglePartFeatureTreeV2,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA,
  RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
} from './mechanicalSinglePartFeatureTreeV2Extractor';
import { extractMechanicalSinglePartFeatureTree, MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA as V1_SCHEMA } from './mechanicalSinglePartFeatureTreeExtractor';

function hash(value: unknown): string {
  const h = new Sha256(); h.update(canonicalCadConsumerDraftJson(value as never));
  return [...h.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const basePayload = {
  kind: 'extrude' as const,
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  depth: 10, direction: 'one_sided' as const, mode: 'add' as const,
};

function tree(kind: 'fillet' | 'chamfer' = 'fillet'): FeatureTree {
  const treatment = kind === 'fillet'
    ? { kind, childId: 'base', childExtrude: basePayload, radius: 1, edgeSelection: EDGE_REFS_ONLY_SENTINEL, edgeRefs: ['e.vert.0'] }
    : { kind, childId: 'base', childExtrude: basePayload, distance: 1, edgeSelection: EDGE_REFS_ONLY_SENTINEL, edgeRefs: ['e.cap.top.0'] };
  return { nodes: [
    { id: 'base', name: 'Base', dependencies: [], payload: basePayload },
    { id: 'treatment', name: 'Treatment', dependencies: ['base'], payload: treatment as never },
    { id: 'hole', name: 'Hole', dependencies: ['treatment'], payload: { kind: 'hole' as const, childId: 'treatment', center: { x: 10, y: 10 }, holeType: 'drilled' as const, diameter: 4, depth: 6 } },
  ] };
}

function head(schema: string = MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA, value = tree()) {
  const rights = 'b'.repeat(64);
  const payload = { schema, partId: 'part-1', name: 'V2 Part', tree: value, treeSha256: hash(value), rightsReceiptSha256: rights };
  const object = sealCanonicalCadObjectV2({ objectId: 'mechanical:part-1', namespace: 'mechanical', objectKind: MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND, objectRevision: 0, payload: payload as unknown as CanonicalCadJsonObject, transform: null });
  const document = createCanonicalCadDocumentV2({ projectId: 'project-1', documentId: 'document-1', domains: ['mechanical'], revision: { revisionId: 'revision-1', sequence: 1, contentSha256: 'a'.repeat(64) }, units: { length: 'mm', angle: 'deg' }, coordinateFrame: { frameId: 'frame-1', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, tolerancePolicy: { linear: 0.01, angularDeg: 0.1 }, objects: [object], relationships: [], sourceBindings: [{ schema: RIGHTS_PROVENANCE_RECEIPT_SCHEMA, revision: 'rights-1', contentSha256: rights }] });
  return { projectId: document.projectId, documentId: document.documentId, revision: document.revision, document };
}

describe('mechanical single-part FeatureTree v2 extractor', () => {
  it('binds fillet and chamfer variants structurally while remaining HOLD', () => {
    expect(extractMechanicalSinglePartFeatureTreeV2(head())).toMatchObject({ status: 'CANONICAL_TREE_V2_BOUND', treatmentKind: 'fillet', edgeRefs: ['e.vert.0'], release: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTreeV2(head(MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA, tree('chamfer')))).toMatchObject({ status: 'CANONICAL_TREE_V2_BOUND', treatmentKind: 'chamfer' });
  });

  it('keeps v1/v2 schemas non-interoperable', () => {
    const legacyTree: FeatureTree = { nodes: [
      { id: 'base', name: 'Base', dependencies: [], payload: basePayload },
      { id: 'hole', name: 'Hole', dependencies: ['base'], payload: { kind: 'hole', childId: 'base', center: { x: 10, y: 10 }, holeType: 'drilled', diameter: 4, depth: 6 } },
    ] };
    expect(extractMechanicalSinglePartFeatureTree(head(V1_SCHEMA, legacyTree) as never)).toMatchObject({ status: 'CANONICAL_TREE_BOUND' });
    // A genuinely sealed v1 document must not become a v2 tree merely because
    // it is presented to the newer extractor.
    expect(extractMechanicalSinglePartFeatureTreeV2(head(V1_SCHEMA, legacyTree))).toMatchObject({ status: 'HOLD' });
    const legacy = structuredClone(head());
    legacy.document.objects[0]!.payload.schema = V1_SCHEMA;
    expect(extractMechanicalSinglePartFeatureTreeV2(legacy)).toMatchObject({ status: 'HOLD' });
  });

  it('rejects stale, extra, hostile, fallback, topology, and geometry inputs', () => {
    const source = head();
    const extra = structuredClone(source); ((((extra.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]!.payload as unknown) as Record<string, unknown>).vertexRadii = [1];
    expect(extractMechanicalSinglePartFeatureTreeV2(extra)).toMatchObject({ status: 'HOLD' });
    const fallback = structuredClone(source); (((((fallback.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]!.payload) as unknown) as Record<string, unknown>).edgeSelection = 'vertical';
    expect(extractMechanicalSinglePartFeatureTreeV2(fallback)).toMatchObject({ status: 'HOLD' });
    const wrongEdge = structuredClone(source); (((((wrongEdge.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]!.payload) as unknown) as Record<string, unknown>).edgeRefs = ['e.vert.99'];
    expect(extractMechanicalSinglePartFeatureTreeV2(wrongEdge)).toMatchObject({ status: 'HOLD' });
    const badHole = structuredClone(source); (((((badHole.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[2]!.payload) as unknown) as Record<string, unknown>).center = { x: 0, y: 10 };
    expect(extractMechanicalSinglePartFeatureTreeV2(badHole)).toMatchObject({ status: 'HOLD' });
    const stale = structuredClone(source); stale.document.objects[0]!.payload.treeSha256 = 'c'.repeat(64);
    expect(extractMechanicalSinglePartFeatureTreeV2(stale)).toMatchObject({ status: 'HOLD' });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    expect(() => extractMechanicalSinglePartFeatureTreeV2(hostile)).not.toThrow();
  });

  it('rejects unsafe node identity and feature-link parity changes', () => {
    const invalidId = structuredClone(head());
    (((invalidId.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]! as { id: string }).id = 'bad id';
    expect(extractMechanicalSinglePartFeatureTreeV2(invalidId)).toMatchObject({ status: 'HOLD' });

    const invalidName = structuredClone(head());
    (((invalidName.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[2]! as { name: string }).name = 'x'.repeat(257);
    expect(extractMechanicalSinglePartFeatureTreeV2(invalidName)).toMatchObject({ status: 'HOLD' });

    const wrongDependencies = structuredClone(head());
    (((((wrongDependencies.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[2]!) as unknown) as { dependencies: string[] }).dependencies = ['base'];
    expect(extractMechanicalSinglePartFeatureTreeV2(wrongDependencies)).toMatchObject({ status: 'HOLD' });

    const wrongChildId = structuredClone(head());
    (((((wrongChildId.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]!.payload) as unknown) as Record<string, unknown>).childId = 'hole';
    expect(extractMechanicalSinglePartFeatureTreeV2(wrongChildId)).toMatchObject({ status: 'HOLD' });

    const copiedExtrudeDrift = structuredClone(head());
    (((((copiedExtrudeDrift.document.objects[0]!.payload as unknown) as { tree: FeatureTree }).tree.nodes[1]!.payload) as unknown) as Record<string, unknown>).childExtrude = { ...basePayload, depth: 9 };
    expect(extractMechanicalSinglePartFeatureTreeV2(copiedExtrudeDrift)).toMatchObject({ status: 'HOLD' });

    const wrongRights = structuredClone(head());
    wrongRights.document.sourceBindings[0]!.contentSha256 = 'c'.repeat(64);
    expect(extractMechanicalSinglePartFeatureTreeV2(wrongRights)).toMatchObject({ status: 'HOLD' });
  });

  it('fails closed for descriptor, prototype, symbol, proxy, cycle, depth, and size attacks', () => {
    const getter = { projectId: 'project-1' } as Record<string, unknown>;
    Object.defineProperty(getter, 'documentId', { enumerable: true, get() { throw new Error('getter'); } });
    expect(() => extractMechanicalSinglePartFeatureTreeV2(getter)).not.toThrow();
    expect(extractMechanicalSinglePartFeatureTreeV2(getter)).toMatchObject({ status: 'HOLD' });

    const hidden = { projectId: 'project-1', documentId: 'document-1' } as Record<string, unknown>;
    Object.defineProperty(hidden, 'hidden', { enumerable: false, value: true });
    expect(extractMechanicalSinglePartFeatureTreeV2(hidden)).toMatchObject({ status: 'HOLD' });

    const symbolKey = { projectId: 'project-1', documentId: 'document-1', [Symbol('untrusted')]: true };
    expect(extractMechanicalSinglePartFeatureTreeV2(symbolKey)).toMatchObject({ status: 'HOLD' });

    const proxy = new Proxy({ projectId: 'project-1' }, { getOwnPropertyDescriptor() { throw new Error('descriptor'); } });
    expect(() => extractMechanicalSinglePartFeatureTreeV2(proxy)).not.toThrow();
    expect(extractMechanicalSinglePartFeatureTreeV2(proxy)).toMatchObject({ status: 'HOLD' });

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(extractMechanicalSinglePartFeatureTreeV2(cycle)).toMatchObject({ status: 'HOLD' });

    let deep: Record<string, unknown> = {};
    const deepRoot = deep;
    for (let i = 0; i < 50; i += 1) { deep.next = {}; deep = deep.next as Record<string, unknown>; }
    expect(extractMechanicalSinglePartFeatureTreeV2(deepRoot)).toMatchObject({ status: 'HOLD' });

    const oversized = { values: new Array(50_001).fill(0) };
    expect(extractMechanicalSinglePartFeatureTreeV2(oversized)).toMatchObject({ status: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTreeV2({ text: 'x'.repeat(20_001) })).toMatchObject({ status: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTreeV2({ value: Number.NaN })).toMatchObject({ status: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTreeV2({ value: Number.POSITIVE_INFINITY })).toMatchObject({ status: 'HOLD' });
  });
});
