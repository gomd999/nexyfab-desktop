import { createHash } from 'node:crypto';

export const SPATIAL_SEMANTIC_OBJECT_SCHEMA = 'nexyfab.cad.spatial-semantic-object-graph.v1' as const;
export type SpatialObjectNamespace = 'building' | 'civil' | 'landscape' | 'interior' | 'mechanical';
export type SpatialRepresentation = 'PREVIEW_BOUNDS' | 'BIM_SEMANTIC' | 'SURVEY_TIN' | 'CATALOG_BOUND' | 'HOST_BOUND' | 'EXACT_BREP';
export type SpatialObjectAuthority = 'PREVIEW' | 'AUTHORITATIVE';
export type SpatialRelationshipKind = 'HOST' | 'UPSTREAM' | 'COORDINATES_WITH';

export interface SpatialSemanticObject {
  id: string;
  namespace: SpatialObjectNamespace;
  semanticKind: string;
  authority: SpatialObjectAuthority;
  representation: SpatialRepresentation;
  sourceRevision: { id: string; sha256: string };
  contentSha256: string;
  transformSha256: string;
  coordinateFrameSha256: string;
}

export interface SpatialSemanticRelationship {
  id: string;
  kind: SpatialRelationshipKind;
  fromObjectId: string;
  toObjectId: string;
  sourceRevision: { id: string; sha256: string };
}

export interface SpatialSemanticObjectGraph {
  schema: typeof SPATIAL_SEMANTIC_OBJECT_SCHEMA;
  projectId: string;
  projectRevision: { id: string; sha256: string };
  releaseRepresentation: 'SPATIAL_SEMANTIC' | 'EXACT_BREP';
  objects: SpatialSemanticObject[];
  relationships: SpatialSemanticRelationship[];
}

export interface SpatialSemanticValidation { valid: boolean; errors: string[]; canonicalSha256?: string }

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KIND = /^[a-z][a-z0-9._:-]{0,63}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const NAMESPACES: SpatialObjectNamespace[] = ['building', 'civil', 'landscape', 'interior', 'mechanical'];
const REPRESENTATIONS: SpatialRepresentation[] = ['PREVIEW_BOUNDS', 'BIM_SEMANTIC', 'SURVEY_TIN', 'CATALOG_BOUND', 'HOST_BOUND', 'EXACT_BREP'];
const RELATIONSHIPS: SpatialRelationshipKind[] = ['HOST', 'UPSTREAM', 'COORDINATES_WITH'];
const GRAPH_KEYS = ['schema', 'projectId', 'projectRevision', 'releaseRepresentation', 'objects', 'relationships'];
const OBJECT_KEYS = ['id', 'namespace', 'semanticKind', 'authority', 'representation', 'sourceRevision', 'contentSha256', 'transformSha256', 'coordinateFrameSha256'];
const RELATIONSHIP_KEYS = ['id', 'kind', 'fromObjectId', 'toObjectId', 'sourceRevision'];

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const validHash = (value: unknown) => typeof value === 'string' && SHA.test(value);
const validRevision = (value: unknown): value is { id: string; sha256: string } => record(value)
  && exactKeys(value, ['id', 'sha256']) && typeof value.id === 'string' && REVISION.test(value.id) && validHash(value.sha256);

export function canonicalSpatialSemanticObjectGraphJson(graph: SpatialSemanticObjectGraph): string { return canonical(graph); }
export function hashSpatialSemanticObjectGraph(graph: SpatialSemanticObjectGraph): string {
  return createHash('sha256').update(canonicalSpatialSemanticObjectGraphJson(graph), 'utf8').digest('hex');
}

function allowedEdge(from: SpatialObjectNamespace, to: SpatialObjectNamespace): boolean {
  if (from === to) return true;
  return (from === 'mechanical' && (to === 'building' || to === 'interior'))
    || (from === 'civil' && (to === 'building' || to === 'landscape'))
    || (from === 'building' && to === 'interior');
}

function allowedRepresentation(namespace: SpatialObjectNamespace, representation: SpatialRepresentation): boolean {
  if (representation === 'PREVIEW_BOUNDS') return true;
  if (namespace === 'mechanical') return representation === 'EXACT_BREP';
  if (namespace === 'civil') return representation === 'SURVEY_TIN';
  if (namespace === 'building') return representation === 'BIM_SEMANTIC' || representation === 'HOST_BOUND';
  if (namespace === 'landscape') return representation === 'CATALOG_BOUND' || representation === 'HOST_BOUND';
  return representation === 'BIM_SEMANTIC' || representation === 'CATALOG_BOUND' || representation === 'HOST_BOUND';
}

/** Strict, fail-closed validation for the shared spatial semantic graph. */
export function validateSpatialSemanticObjectGraph(input: unknown): SpatialSemanticValidation {
  const errors: string[] = [];
  if (!record(input) || !exactKeys(input, GRAPH_KEYS)) return { valid: false, errors: ['graph_keys_invalid'] };
  const graph = input as unknown as SpatialSemanticObjectGraph;
  if (graph.schema !== SPATIAL_SEMANTIC_OBJECT_SCHEMA) errors.push('schema_invalid');
  if (typeof graph.projectId !== 'string' || !ID.test(graph.projectId)) errors.push('project_id_invalid');
  if (!validRevision(graph.projectRevision)) errors.push('project_revision_invalid');
  if (graph.releaseRepresentation !== 'SPATIAL_SEMANTIC' && graph.releaseRepresentation !== 'EXACT_BREP') errors.push('release_representation_invalid');
  if (!Array.isArray(graph.objects) || graph.objects.length === 0 || graph.objects.length > 10_000) return { valid: false, errors: [...errors, 'objects_invalid'] };
  if (!Array.isArray(graph.relationships) || graph.relationships.length > 20_000) return { valid: false, errors: [...errors, 'relationships_invalid'] };

  const objects = new Map<string, SpatialSemanticObject>();
  for (const [index, raw] of graph.objects.entries()) {
    const path = `objects[${index}]`;
    if (!record(raw) || !exactKeys(raw, OBJECT_KEYS)) { errors.push(`${path}:keys_invalid`); continue; }
    const object = raw as unknown as SpatialSemanticObject;
    if (typeof object.id !== 'string' || !ID.test(object.id)) errors.push(`${path}:id_invalid`);
    else if (objects.has(object.id)) errors.push(`${path}:id_duplicate`);
    else objects.set(object.id, object);
    if (!NAMESPACES.includes(object.namespace)) errors.push(`${path}:namespace_invalid`);
    if (typeof object.semanticKind !== 'string' || !KIND.test(object.semanticKind)) errors.push(`${path}:semantic_kind_invalid`);
    if (object.namespace && typeof object.id === 'string' && !object.id.startsWith(`${object.namespace}:`)) errors.push(`${path}:id_namespace_mismatch`);
    if (!['PREVIEW', 'AUTHORITATIVE'].includes(object.authority)) errors.push(`${path}:authority_invalid`);
    if (!REPRESENTATIONS.includes(object.representation)) errors.push(`${path}:representation_invalid`);
    else if (!allowedRepresentation(object.namespace, object.representation)) errors.push(`${path}:representation_domain_mismatch`);
    if (!validRevision(object.sourceRevision)) errors.push(`${path}:source_revision_invalid`);
    for (const field of ['contentSha256', 'transformSha256', 'coordinateFrameSha256'] as const) if (!validHash(object[field])) errors.push(`${path}:${field}_invalid`);
    if (object.authority === 'PREVIEW' && object.representation !== 'PREVIEW_BOUNDS') errors.push(`${path}:preview_representation_mismatch`);
    if (object.authority === 'AUTHORITATIVE' && object.representation === 'PREVIEW_BOUNDS') errors.push(`${path}:preview_authority_promotion_blocked`);
    if (object.representation === 'EXACT_BREP' && (object.namespace !== 'mechanical' || !object.semanticKind.startsWith('coordination.'))) errors.push(`${path}:exact_brep_coordination_only`);
  }

  const relationships = new Map<string, SpatialSemanticRelationship>();
  for (const [index, raw] of graph.relationships.entries()) {
    const path = `relationships[${index}]`;
    if (!record(raw) || !exactKeys(raw, RELATIONSHIP_KEYS)) { errors.push(`${path}:keys_invalid`); continue; }
    const relation = raw as unknown as SpatialSemanticRelationship;
    if (typeof relation.id !== 'string' || !ID.test(relation.id)) errors.push(`${path}:id_invalid`);
    else if (relationships.has(relation.id)) errors.push(`${path}:id_duplicate`);
    else relationships.set(relation.id, relation);
    if (!RELATIONSHIPS.includes(relation.kind)) errors.push(`${path}:kind_invalid`);
    if (typeof relation.fromObjectId !== 'string' || !ID.test(relation.fromObjectId) || !objects.has(relation.fromObjectId)) errors.push(`${path}:from_dangling`);
    if (typeof relation.toObjectId !== 'string' || !ID.test(relation.toObjectId) || !objects.has(relation.toObjectId)) errors.push(`${path}:to_dangling`);
    if (!validRevision(relation.sourceRevision)) errors.push(`${path}:source_revision_invalid`);
    const from = objects.get(relation.fromObjectId); const to = objects.get(relation.toObjectId);
    if (from && to) {
      if (relation.fromObjectId === relation.toObjectId) errors.push(`${path}:self_reference`);
      if (!allowedEdge(to.namespace, from.namespace)) errors.push(`${path}:domain_edge_forbidden`);
      if (relation.kind === 'HOST' && to.authority !== 'AUTHORITATIVE') errors.push(`${path}:preview_host_forbidden`);
      if (relation.sourceRevision.id !== from.sourceRevision.id || relation.sourceRevision.sha256 !== from.sourceRevision.sha256) errors.push(`${path}:source_revision_mismatch`);
    }
  }

  if (graph.releaseRepresentation === 'EXACT_BREP') errors.push('spatial_release_exact_brep_claim_blocked');
  if (graph.objects.some(object => object.authority === 'PREVIEW' || object.representation === 'PREVIEW_BOUNDS')) errors.push('spatial_release_preview_object_blocked');
  if (graph.releaseRepresentation === 'SPATIAL_SEMANTIC' && graph.objects.some(object => object.representation === 'EXACT_BREP' && object.namespace !== 'mechanical')) errors.push('spatial_release_representation_disguise');

  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { errors.push(`relationship_cycle:${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const relation of graph.relationships) if (relation.fromObjectId === id && (relation.kind === 'HOST' || relation.kind === 'UPSTREAM')) visit(relation.toObjectId);
    visiting.delete(id); visited.add(id);
  };
  for (const id of objects.keys()) visit(id);
  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length ? { valid: false, errors: uniqueErrors } : { valid: true, errors: [], canonicalSha256: hashSpatialSemanticObjectGraph(graph) };
}
