import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  hashCanonicalCadDocumentV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadRevisionRef,
} from './canonicalCadV2ConsumerDraft';
import type { FeatureTree } from './featureTree';
import { validateFeatureTreeValue } from './featureTreeValidation';

export const MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA =
  'nexyfab.precision-cad.mechanical-single-part-feature-tree.v1' as const;
export const MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND =
  'mechanical.single-part-feature-tree' as const;
export const RIGHTS_PROVENANCE_RECEIPT_SCHEMA =
  'nexyfab.rights-provenance-receipt.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEAD_KEYS = ['projectId', 'documentId', 'revision', 'document'] as const;
const PAYLOAD_KEYS = ['schema', 'partId', 'name', 'tree', 'treeSha256', 'rightsReceiptSha256'] as const;
const NODE_KEYS = ['id', 'name', 'dependencies', 'payload'] as const;
const BASE_PAYLOAD_KEYS = ['kind', 'loop', 'depth', 'direction', 'mode'] as const;
const HOLE_PAYLOAD_KEYS = ['kind', 'childId', 'center', 'holeType', 'diameter', 'depth'] as const;
const MAX_DEPTH = 32;
const MAX_NODES = 30_000;
const MAX_STRING_LENGTH = 10_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type PlainRecord = Record<string, unknown>;

export type MechanicalSinglePartFeatureTreeDecision =
  | {
      status: 'CANONICAL_TREE_BOUND';
      authority: 'CURRENT_HEAD_STRUCTURAL_BINDING';
      verification: 'STRUCTURAL_ONLY';
      release: 'HOLD';
      projectId: string;
      documentId: string;
      revision: CanonicalCadRevisionRef;
      partId: string;
      name: string;
      tree: FeatureTree;
      treeSha256: string;
      rightsReceiptRevision: string;
      rightsReceiptSha256: string;
    }
  | { status: 'HOLD'; release: 'HOLD'; blockers: readonly string[] };

function isRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshot(
  value: unknown,
  seen = new Set<object>(),
  budget = { nodes: 0 },
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ > MAX_NODES) throw new Error('snapshot_limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error('snapshot_string');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('snapshot_number');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('snapshot_type');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw new Error('snapshot_array');
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some(key => key !== 'length'
        && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) {
        throw new Error('snapshot_array_key');
      }
      return value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new Error('snapshot_accessor');
        }
        return snapshot(descriptor.value, seen, budget, depth + 1);
      });
    }
    if (!isRecord(value)) throw new Error('snapshot_object');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_NODES
      || ownKeys.some(key => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
      throw new Error('snapshot_object_key');
    }
    const out: PlainRecord = {};
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('snapshot_accessor');
      }
      out[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function exact(value: PlainRecord, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== 'string')) return false;
  const sorted = (actual as string[]).sort();
  const wanted = [...keys].sort();
  return sorted.length === wanted.length && sorted.every((item, index) => item === wanted[index]);
}

function hash(value: unknown): string {
  const digest = new Sha256();
  digest.update(canonicalCadConsumerDraftJson(value as never));
  return [...digest.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hold(...blockers: string[]): MechanicalSinglePartFeatureTreeDecision {
  return { status: 'HOLD', release: 'HOLD', blockers: [...new Set(blockers)] };
}

function isBoundedBaseAndHoleTree(tree: FeatureTree): boolean {
  if (tree.nodes.length !== 2) return false;
  const [base, hole] = tree.nodes;
  if (!base || !hole || base.suppressed === true || hole.suppressed === true
    || !exact(base as unknown as PlainRecord, NODE_KEYS)
    || !exact(hole as unknown as PlainRecord, NODE_KEYS)
    || base.dependencies.length !== 0
    || hole.dependencies.length !== 1 || hole.dependencies[0] !== base.id
    || base.payload.kind !== 'extrude' || hole.payload.kind !== 'hole'
    || !exact(base.payload as unknown as PlainRecord, BASE_PAYLOAD_KEYS)
    || !exact(hole.payload as unknown as PlainRecord, HOLE_PAYLOAD_KEYS)
    || base.payload.mode !== 'add' || base.payload.direction !== 'one_sided'
    || !(base.payload.depth > 0)
    || base.payload.loop.length < 3 || base.payload.loop.length > 256
    || base.payload.loop.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    || hole.payload.childId !== base.id || hole.payload.holeType !== 'drilled'
    || !Number.isFinite(hole.payload.center.x) || !Number.isFinite(hole.payload.center.y)
    || !(hole.payload.diameter > 0) || !(hole.payload.depth > 0)) return false;
  return true;
}

/** Pure, structural extraction of one rights-bound base-extrude + drilled-hole tree. */
export function extractMechanicalSinglePartFeatureTree(input: unknown): MechanicalSinglePartFeatureTreeDecision {
  try {
    const head = snapshot(input);
    if (!isRecord(head) || !exact(head, HEAD_KEYS)) return hold('HEAD_KEYS_INVALID');
    if (typeof head.projectId !== 'string' || !ID.test(head.projectId)
      || typeof head.documentId !== 'string' || !ID.test(head.documentId)
      || !isRecord(head.revision) || !isRecord(head.document)) return hold('HEAD_BINDING_INVALID');
    const revision = head.revision;
    if (!exact(revision, ['revisionId', 'sequence', 'contentSha256'])
      || typeof revision.revisionId !== 'string' || !ID.test(revision.revisionId)
      || !Number.isSafeInteger(revision.sequence) || Number(revision.sequence) < 0
      || typeof revision.contentSha256 !== 'string' || !SHA256.test(revision.contentSha256)) {
      return hold('REVISION_INVALID');
    }
    const document = head.document;
    if (validateCanonicalCadDocumentV2(document).length) return hold('DOCUMENT_INVALID');
    const canonicalDocument = document as unknown as CanonicalCadDocumentV2ConsumerDraft;
    if (canonicalDocument.projectId !== head.projectId || canonicalDocument.documentId !== head.documentId
      || canonicalDocument.revision.revisionId !== revision.revisionId
      || canonicalDocument.revision.sequence !== revision.sequence
      || canonicalDocument.revision.contentSha256 !== revision.contentSha256
      || hashCanonicalCadDocumentV2(canonicalDocument) !== revision.contentSha256) {
      return hold('HEAD_DOCUMENT_PARITY_MISMATCH');
    }
    if (!canonicalDocument.domains.includes('mechanical')) return hold('MECHANICAL_DOMAIN_REQUIRED');
    const mechanicalObjects = canonicalDocument.objects.filter(object => object.namespace === 'mechanical');
    const candidates = mechanicalObjects.filter(
      object => object.objectKind === MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
    );
    if (mechanicalObjects.length !== 1 || candidates.length !== 1) {
      return hold('MECHANICAL_SINGLE_PART_OBJECT_COUNT_INVALID');
    }
    const object = candidates[0]!;
    if (!isRecord(object.payload) || !exact(object.payload, PAYLOAD_KEYS)
      || object.payload.schema !== MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA
      || typeof object.payload.partId !== 'string' || !ID.test(object.payload.partId)
      || typeof object.payload.name !== 'string' || object.payload.name.length === 0
      || object.payload.name.length > 256
      || typeof object.payload.treeSha256 !== 'string' || !SHA256.test(object.payload.treeSha256)
      || typeof object.payload.rightsReceiptSha256 !== 'string'
      || !SHA256.test(object.payload.rightsReceiptSha256)) return hold('PART_PAYLOAD_INVALID');
    const treeResult = validateFeatureTreeValue(object.payload.tree);
    if (!treeResult.ok || !isBoundedBaseAndHoleTree(treeResult.tree)) {
      return hold('BOUNDED_BASE_EXTRUDE_HOLE_TREE_REQUIRED');
    }
    if (hash(treeResult.tree) !== object.payload.treeSha256) return hold('TREE_HASH_MISMATCH');
    const rights = canonicalDocument.sourceBindings.filter(
      binding => binding.schema === RIGHTS_PROVENANCE_RECEIPT_SCHEMA
        && binding.contentSha256 === object.payload.rightsReceiptSha256,
    );
    if (rights.length !== 1 || !ID.test(rights[0]!.revision)) {
      return hold('RIGHTS_PROVENANCE_MISMATCH');
    }
    return {
      status: 'CANONICAL_TREE_BOUND',
      authority: 'CURRENT_HEAD_STRUCTURAL_BINDING',
      verification: 'STRUCTURAL_ONLY',
      release: 'HOLD',
      projectId: head.projectId,
      documentId: head.documentId,
      revision: revision as unknown as CanonicalCadRevisionRef,
      partId: object.payload.partId,
      name: object.payload.name,
      tree: treeResult.tree,
      treeSha256: object.payload.treeSha256,
      rightsReceiptRevision: rights[0]!.revision,
      rightsReceiptSha256: object.payload.rightsReceiptSha256,
    };
  } catch {
    return hold('MALFORMED_INPUT');
  }
}
