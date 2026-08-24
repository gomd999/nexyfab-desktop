// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canonicalCadConsumerDraftJson, createCanonicalCadDocumentV2, hashCanonicalCadDocumentV2, sealCanonicalCadObjectV2 } from './canonicalCadV2ConsumerDraft';
import {
  extractMechanicalSinglePartFeatureTree,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA,
  RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
} from './mechanicalSinglePartFeatureTreeExtractor';
import type { FeatureTree } from './featureTree';
import { Sha256 } from '@aws-crypto/sha256-js';
import type { CanonicalCadJsonObject } from './canonicalCadV2ConsumerDraft';

const H = 'a'.repeat(64);
function digest(value: unknown): string { const h = new Sha256(); h.update(canonicalCadConsumerDraftJson(value as never)); return [...h.digestSync()].map(b => b.toString(16).padStart(2, '0')).join(''); }
const tree: FeatureTree = { nodes: [
  { id: 'base', name: 'Base', dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], depth: 10, direction: 'one_sided', mode: 'add' } },
  { id: 'hole', name: 'Hole', dependencies: ['base'], payload: { kind: 'hole', childId: 'base', center: { x: 10, y: 10 }, holeType: 'drilled', diameter: 4, depth: 6 } },
] };
function head() {
  const rights = H;
  const payload = { schema: MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA, partId: 'part-1', name: 'Test Part', tree, treeSha256: digest(tree), rightsReceiptSha256: rights };
  const object = sealCanonicalCadObjectV2({ objectId: 'mechanical:part-1', namespace: 'mechanical', objectKind: MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND, objectRevision: 0, payload: payload as unknown as CanonicalCadJsonObject, transform: null });
  const document = createCanonicalCadDocumentV2({ projectId: 'project-1', documentId: 'document-1', domains: ['mechanical'], revision: { revisionId: 'revision-1', sequence: 1, contentSha256: H }, units: { length: 'mm', angle: 'deg' }, coordinateFrame: { frameId: 'frame-1', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, tolerancePolicy: { linear: 0.01, angularDeg: 0.1 }, objects: [object], relationships: [], sourceBindings: [{ schema: RIGHTS_PROVENANCE_RECEIPT_SCHEMA, revision: 'rights-1', contentSha256: rights }] });
  return { projectId: document.projectId, documentId: document.documentId, revision: document.revision, document };
}
describe('mechanical single-part FeatureTree extractor', () => {
  it('binds one canonical, rights-provenanced base+hole tree and stays HOLD', () => {
    const value = head();
    expect(extractMechanicalSinglePartFeatureTree(value)).toMatchObject({
      status: 'CANONICAL_TREE_BOUND', authority: 'CURRENT_HEAD_STRUCTURAL_BINDING',
      verification: 'STRUCTURAL_ONLY', release: 'HOLD', partId: 'part-1',
      treeSha256: digest(tree), rightsReceiptRevision: 'rights-1',
    });
    expect(value.document.revision.contentSha256).toBe(hashCanonicalCadDocumentV2(value.document));
  });
  it('fails closed for tamper, extras, missing parity, and hostile proxies', () => {
    const value = head();
    expect(extractMechanicalSinglePartFeatureTree({ ...value, extra: true })).toMatchObject({ status: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTree({ ...value, document: { ...value.document, projectId: 'other' } })).toMatchObject({ status: 'HOLD' });
    expect(extractMechanicalSinglePartFeatureTree({ ...value, document: { ...value.document, objects: [] } })).toMatchObject({ status: 'HOLD' });
    const wrongKind = structuredClone(value);
    wrongKind.document.objects[0]!.objectKind = 'mechanical.single-part';
    expect(extractMechanicalSinglePartFeatureTree(wrongKind)).toMatchObject({ status: 'HOLD' });
    const extraNode = structuredClone(value);
    ((extraNode.document.objects[0]!.payload.tree as unknown) as { nodes: unknown[] }).nodes = [...tree.nodes, tree.nodes[1]!];
    expect(extractMechanicalSinglePartFeatureTree(extraNode)).toMatchObject({ status: 'HOLD' });
    const wrongDependency = structuredClone(value);
    (((wrongDependency.document.objects[0]!.payload.tree as unknown) as { nodes: Array<{ dependencies: string[] }> }).nodes[1]!).dependencies = [];
    expect(extractMechanicalSinglePartFeatureTree(wrongDependency)).toMatchObject({ status: 'HOLD' });
    const symbolArray = structuredClone(value);
    Object.defineProperty(((symbolArray.document.objects[0]!.payload.tree as unknown) as { nodes: unknown[] }).nodes, Symbol('hidden'), { value: true });
    expect(extractMechanicalSinglePartFeatureTree(symbolArray)).toMatchObject({ status: 'HOLD' });
    const staleRightsRevision = structuredClone(value);
    staleRightsRevision.document.sourceBindings[0]!.revision = '';
    expect(extractMechanicalSinglePartFeatureTree(staleRightsRevision)).toMatchObject({ status: 'HOLD' });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    expect(() => extractMechanicalSinglePartFeatureTree(hostile)).not.toThrow();
    expect(extractMechanicalSinglePartFeatureTree(hostile)).toMatchObject({ status: 'HOLD' });
  });
});
