import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  hashCanonicalCadDocumentV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadRevisionRef,
} from './canonicalCadV2ConsumerDraft';
import type { FeatureTree, FeatureNode } from './featureTree';
import { validateFeatureTreeValue } from './featureTreeValidation';

export const MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA =
  'nexyfab.precision-cad.mechanical-single-part-feature-tree.v2' as const;
export const MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND =
  'mechanical.single-part-feature-tree' as const;
export const RIGHTS_PROVENANCE_RECEIPT_SCHEMA =
  'nexyfab.rights-provenance-receipt.v1' as const;
/** Existing plan/preflight accept `all`; edgeRefs are authoritative whenever present. */
export const EDGE_REFS_ONLY_SENTINEL = 'all' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEAD_KEYS = ['projectId', 'documentId', 'revision', 'document'] as const;
const PAYLOAD_KEYS = ['schema', 'partId', 'name', 'tree', 'treeSha256', 'rightsReceiptSha256'] as const;
const NODE_KEYS = ['id', 'name', 'dependencies', 'payload'] as const;
const BASE_KEYS = ['kind', 'loop', 'depth', 'direction', 'mode'] as const;
const TREATMENT_KEYS = ['kind', 'childId', 'childExtrude', 'radius', 'edgeSelection', 'edgeRefs'] as const;
const CHAMFER_KEYS = ['kind', 'childId', 'childExtrude', 'distance', 'edgeSelection', 'edgeRefs'] as const;
const HOLE_KEYS = ['kind', 'childId', 'center', 'holeType', 'diameter', 'depth'] as const;
const BOUND = 1_000_000;
const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
const MAX_STRING = 20_000;
type RecordValue = Record<string, unknown>;

export type MechanicalSinglePartFeatureTreeV2Decision =
  | {
      status: 'CANONICAL_TREE_V2_BOUND';
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
      treatmentKind: 'fillet' | 'chamfer';
      edgeRefs: readonly string[];
    }
  | { status: 'HOLD'; release: 'HOLD'; blockers: readonly string[] };

function plain(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exact(value: RecordValue, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string')) return false;
  const actual = [...own as string[]].sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function snapshot(value: unknown, seen = new Set<object>(), budget = { nodes: 0 }, depth = 0): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ > MAX_NODES) throw new Error('snapshot_limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new Error('snapshot_string');
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
      const keys = Reflect.ownKeys(value);
      if (value.length > MAX_NODES) throw new Error('array_size');
      if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) throw new Error('array_key');
      const out: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('array_accessor');
        out.push(snapshot(descriptor.value, seen, budget, depth + 1));
      }
      return out;
    }
    if (!plain(value)) throw new Error('object_proto');
    const out: RecordValue = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('object_key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('object_accessor');
      out[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return out;
  } finally { seen.delete(value); }
}

function digest(value: unknown): string {
  const hash = new Sha256();
  hash.update(canonicalCadConsumerDraftJson(value as never));
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hold(...blockers: string[]): MechanicalSinglePartFeatureTreeV2Decision {
  return { status: 'HOLD', release: 'HOLD', blockers: [...new Set(blockers)] };
}

function finitePoint(value: unknown): value is { x: number; y: number } {
  return plain(value) && exact(value, ['x', 'y'])
    && typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) <= BOUND
    && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) <= BOUND;
}

function convexLoop(value: unknown): value is Array<{ x: number; y: number }> {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64 || !value.every(finitePoint)) return false;
  let sign = 0;
  let area = 0;
  for (let i = 0; i < value.length; i += 1) {
    const a = value[i]!; const b = value[(i + 1) % value.length]!; const c = value[(i + 2) % value.length]!;
    if (!(Math.hypot(b.x - a.x, b.y - a.y) > 1e-9)) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!(Math.abs(cross) > 1e-9)) return false;
    const current = cross > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    if (sign !== current) return false;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) > 1e-9;
}

function edgeDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function strictlyInterior(point: { x: number; y: number }, loop: Array<{ x: number; y: number }>, radius: number): boolean {
  let sign = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i]!; const b = loop[(i + 1) % loop.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) <= 1e-9) return false;
    const current = cross > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    if (sign !== current || edgeDistance(point, a, b) <= radius + 1e-6) return false;
  }
  return true;
}

function stableEdges(value: unknown, count: number): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some(edge => typeof edge !== 'string')) return false;
  const allowed = /^(e\.vert|e\.cap\.top|e\.cap\.bottom)\.([0-9]+)$/;
  return new Set(value).size === value.length && value.every(edge => {
    const match = allowed.exec(edge);
    return !!match && Number(match[2]) < count;
  });
}

function baseValid(node: FeatureNode): node is FeatureNode & { payload: { kind: 'extrude'; loop: Array<{ x: number; y: number }>; depth: number } } {
  const payload = node.payload as unknown as RecordValue;
  return exact(node as unknown as RecordValue, NODE_KEYS) && ID.test(node.id) && typeof node.name === 'string' && node.name.length <= 256
    && node.dependencies.length === 0 && payload.kind === 'extrude' && exact(payload, BASE_KEYS)
    && payload.mode === 'add' && payload.direction === 'one_sided'
    && convexLoop(payload.loop) && typeof payload.depth === 'number'
    && Number.isFinite(payload.depth) && payload.depth > 0 && payload.depth <= BOUND;
}

function treatmentValid(node: FeatureNode, base: FeatureNode): node is FeatureNode & { payload: RecordValue } {
  const payload = node.payload as unknown as RecordValue;
  const basePayload = base.payload as unknown as { loop: Array<{ x: number; y: number }>; depth: number };
  const kind = payload.kind;
  const keys = kind === 'fillet' ? TREATMENT_KEYS : kind === 'chamfer' ? CHAMFER_KEYS : [];
  if (!keys.length || !exact(node as unknown as RecordValue, NODE_KEYS) || !ID.test(node.id) || typeof node.name !== 'string' || node.name.length > 256 || node.dependencies.length !== 1
    || node.dependencies[0] !== base.id || !exact(payload, keys) || payload.childId !== base.id
    || digest(payload.childExtrude) !== digest(basePayload)) return false;
  if (payload.edgeSelection !== EDGE_REFS_ONLY_SENTINEL || !stableEdges(payload.edgeRefs, basePayload.loop.length)) return false;
  const minDim = Math.min(basePayload.depth, ...(() => {
    const xs = basePayload.loop.map(point => point.x); const ys = basePayload.loop.map(point => point.y);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  })());
  const amount = kind === 'fillet' ? payload.radius : payload.distance;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && amount <= minDim / 4;
}

function holeValid(node: FeatureNode, treatment: FeatureNode, base: FeatureNode): boolean {
  const payload = node.payload as unknown as RecordValue;
  const basePayload = base.payload as unknown as { loop: Array<{ x: number; y: number }>; depth: number };
  const loop = basePayload.loop;
  return exact(node as unknown as RecordValue, NODE_KEYS) && ID.test(node.id) && typeof node.name === 'string' && node.name.length <= 256 && node.dependencies.length === 1
    && node.dependencies[0] === treatment.id && exact(payload, HOLE_KEYS)
    && payload.kind === 'hole' && payload.childId === treatment.id && payload.holeType === 'drilled'
    && finitePoint(payload.center) && typeof payload.diameter === 'number' && Number.isFinite(payload.diameter)
    && payload.diameter > 0 && payload.diameter <= BOUND && typeof payload.depth === 'number'
    && Number.isFinite(payload.depth) && payload.depth > 0 && payload.depth <= basePayload.depth
    && strictlyInterior(payload.center, loop, payload.diameter / 2);
}

export function extractMechanicalSinglePartFeatureTreeV2(input: unknown): MechanicalSinglePartFeatureTreeV2Decision {
  try {
    const raw = snapshot(input);
    if (!plain(raw) || !exact(raw, HEAD_KEYS)) return hold('HEAD_KEYS_INVALID');
    if (typeof raw.projectId !== 'string' || !ID.test(raw.projectId) || typeof raw.documentId !== 'string' || !ID.test(raw.documentId)
      || !plain(raw.revision) || !plain(raw.document)) return hold('HEAD_BINDING_INVALID');
    const revision = raw.revision;
    if (!exact(revision, ['revisionId', 'sequence', 'contentSha256']) || typeof revision.revisionId !== 'string' || !ID.test(revision.revisionId)
      || !Number.isSafeInteger(revision.sequence) || (revision.sequence as number) < 0 || typeof revision.contentSha256 !== 'string' || !SHA256.test(revision.contentSha256)) return hold('REVISION_INVALID');
    if (validateCanonicalCadDocumentV2(raw.document).length) return hold('DOCUMENT_INVALID');
    const document = raw.document as unknown as CanonicalCadDocumentV2ConsumerDraft;
    const revisionId = revision.revisionId as string;
    const sequence = revision.sequence as number;
    const contentSha256 = revision.contentSha256 as string;
    if (document.projectId !== raw.projectId || document.documentId !== raw.documentId
      || document.revision.revisionId !== revisionId || document.revision.sequence !== sequence
      || document.revision.contentSha256 !== contentSha256 || hashCanonicalCadDocumentV2(document) !== contentSha256) return hold('HEAD_DOCUMENT_PARITY_MISMATCH');
    if (!document.domains.includes('mechanical')) return hold('MECHANICAL_DOMAIN_REQUIRED');
    const mechanical = document.objects.filter(object => object.namespace === 'mechanical');
    const candidates = mechanical.filter(object => object.objectKind === MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND);
    if (mechanical.length !== 1 || candidates.length !== 1) return hold('MECHANICAL_SINGLE_PART_OBJECT_COUNT_INVALID');
    const object = candidates[0]!;
    if (!plain(object.payload) || !exact(object.payload, PAYLOAD_KEYS) || object.payload.schema !== MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA
      || typeof object.payload.partId !== 'string' || !ID.test(object.payload.partId) || typeof object.payload.name !== 'string'
      || object.payload.name.length === 0 || object.payload.name.length > 256 || typeof object.payload.treeSha256 !== 'string' || !SHA256.test(object.payload.treeSha256)
      || typeof object.payload.rightsReceiptSha256 !== 'string' || !SHA256.test(object.payload.rightsReceiptSha256)) return hold('PART_PAYLOAD_INVALID');
    const treeResult = validateFeatureTreeValue(object.payload.tree);
    if (!treeResult.ok || !plain(object.payload.tree) || !exact(object.payload.tree, ['nodes']) || treeResult.tree.nodes.length !== 3) return hold('V2_TREE_SHAPE_INVALID');
    const [base, treatment, hole] = treeResult.tree.nodes;
    if (!base || !treatment || !hole || !baseValid(base) || !treatmentValid(treatment, base) || !holeValid(hole, treatment, base)) return hold('V2_TREE_GEOMETRY_INVALID');
    if (digest(treeResult.tree) !== object.payload.treeSha256) return hold('TREE_HASH_MISMATCH');
    const rights = document.sourceBindings.filter(binding => binding.schema === RIGHTS_PROVENANCE_RECEIPT_SCHEMA && binding.contentSha256 === object.payload.rightsReceiptSha256);
    if (rights.length !== 1 || !ID.test(rights[0]!.revision)) return hold('RIGHTS_PROVENANCE_MISMATCH');
    return {
      status: 'CANONICAL_TREE_V2_BOUND', authority: 'CURRENT_HEAD_STRUCTURAL_BINDING', verification: 'STRUCTURAL_ONLY', release: 'HOLD',
      projectId: raw.projectId, documentId: raw.documentId, revision: revision as unknown as CanonicalCadRevisionRef,
      partId: object.payload.partId, name: object.payload.name, tree: treeResult.tree, treeSha256: object.payload.treeSha256,
      rightsReceiptRevision: rights[0]!.revision, rightsReceiptSha256: object.payload.rightsReceiptSha256,
      treatmentKind: treatment.payload.kind as 'fillet' | 'chamfer', edgeRefs: [...(treatment.payload.edgeRefs as string[])],
    };
  } catch { return hold('MALFORMED_INPUT'); }
}
