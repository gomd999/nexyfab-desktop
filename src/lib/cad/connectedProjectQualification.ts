import { createHash } from 'node:crypto';
import { AUTHORITY_DOMAINS, type AuthorityDomain, type DomainAuthorityManifest } from './domainAuthorityManifest';
import type { DomainDeliverableManifest } from './domainDeliverableManifest';
import {
  evaluateDomainProductReceipt,
  hashDomainProductReceipt,
  type DomainProductReceipt,
} from './domainProductReceipt';
import {
  evaluateSpatialDependencyGraph,
  hashSpatialDependencyGraph,
  type SpatialDependencyGraph,
} from './spatialDependencyGraph';

export const CONNECTED_PROJECT_QUALIFICATION_SCHEMA = 'nexyfab.connected-project-qualification.v1' as const;

export interface ConnectedDomainProductBinding {
  domain: AuthorityDomain;
  receipt: DomainProductReceipt;
  authorityManifest: DomainAuthorityManifest;
  deliverableManifest: DomainDeliverableManifest;
}

export interface ConnectedProjectQualificationInput {
  schema: typeof CONNECTED_PROJECT_QUALIFICATION_SCHEMA;
  projectId: string;
  dependencyGraph: SpatialDependencyGraph;
  domainProducts: ConnectedDomainProductBinding[];
}

export interface ConnectedProjectQualificationResult {
  status: 'PASS' | 'HOLD';
  readyForConnectedPilot: boolean;
  blockers: string[];
  dependencyGraphSha256?: string;
  domainReceiptSha256s: Partial<Record<AuthorityDomain, string>>;
  canonicalSha256?: string;
}

const INPUT_KEYS = ['schema', 'projectId', 'dependencyGraph', 'domainProducts'] as const;
const PRODUCT_KEYS = ['domain', 'receipt', 'authorityManifest', 'deliverableManifest'] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : isRecord(value)
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * Recomputes every domain and dependency decision. A caller cannot promote a
 * connected pilot with a boolean flag or a detached receipt hash.
 */
export function evaluateConnectedProjectQualification(input: unknown): ConnectedProjectQualificationResult {
  const blockers: string[] = [];
  const domainReceiptSha256s: Partial<Record<AuthorityDomain, string>> = {};
  if (!isRecord(input) || !exactKeys(input, INPUT_KEYS)) {
    return { status: 'HOLD', readyForConnectedPilot: false, blockers: ['input_keys_invalid'], domainReceiptSha256s };
  }
  if (input.schema !== CONNECTED_PROJECT_QUALIFICATION_SCHEMA) blockers.push('schema_invalid');
  if (typeof input.projectId !== 'string' || !ID.test(input.projectId)) blockers.push('project_id_invalid');

  const graphEvaluation = evaluateSpatialDependencyGraph(input.dependencyGraph);
  if (graphEvaluation.status !== 'PASS') blockers.push(...graphEvaluation.issues.map(issue => `dependency_graph:${issue}`));
  const graph = isRecord(input.dependencyGraph) ? input.dependencyGraph as unknown as SpatialDependencyGraph : undefined;
  if (graph?.projectId !== input.projectId) blockers.push('dependency_graph_project_mismatch');

  if (!Array.isArray(input.domainProducts) || input.domainProducts.length !== AUTHORITY_DOMAINS.length) {
    blockers.push('domain_products_exact_set_required');
  }
  const products = Array.isArray(input.domainProducts) ? input.domainProducts : [];
  const seen = new Set<AuthorityDomain>();
  for (const [index, value] of products.entries()) {
    const path = `domain_products[${index}]`;
    if (!isRecord(value) || !exactKeys(value, PRODUCT_KEYS)) { blockers.push(`${path}:keys_invalid`); continue; }
    const product = value as unknown as ConnectedDomainProductBinding;
    if (!AUTHORITY_DOMAINS.includes(product.domain)) { blockers.push(`${path}:domain_invalid`); continue; }
    if (seen.has(product.domain)) blockers.push(`${path}:domain_duplicate`);
    seen.add(product.domain);
    if (product.receipt?.domain !== product.domain) blockers.push(`${path}:receipt_domain_mismatch`);
    if (product.authorityManifest?.domain !== product.domain) blockers.push(`${path}:authority_domain_mismatch`);
    if (product.deliverableManifest?.domain !== product.domain) blockers.push(`${path}:deliverable_domain_mismatch`);
    if (product.receipt?.projectId !== input.projectId || product.authorityManifest?.projectId !== input.projectId) blockers.push(`${path}:project_mismatch`);

    const evaluation = evaluateDomainProductReceipt(product.receipt, {
      authorityManifest: product.authorityManifest,
      deliverableManifest: product.deliverableManifest,
    });
    if (!evaluation.structurallyValid || !evaluation.canonicalSha256) {
      blockers.push(...evaluation.blockers.map(issue => `${path}:receipt:${issue}`));
      continue;
    }
    domainReceiptSha256s[product.domain] = evaluation.canonicalSha256;
    if (evaluation.status !== 'PASS' || evaluation.eligibleState !== 'PRODUCT_QUALIFIED') {
      blockers.push(`${path}:product_not_qualified`);
      blockers.push(...evaluation.blockers.map(issue => `${path}:receipt:${issue}`));
    }

    const matchingGraphArtifacts = graph?.artifacts?.filter(artifact =>
      artifact.domain === product.domain
      && artifact.kind === 'product-receipt'
      && artifact.sourceRevision === product.receipt.projectRevision.id
      && artifact.contentSha256 === hashDomainProductReceipt(product.receipt)
      && artifact.status === 'CURRENT') ?? [];
    if (matchingGraphArtifacts.length !== 1) blockers.push(`${path}:current_receipt_graph_binding_required`);
  }
  for (const domain of AUTHORITY_DOMAINS) if (!seen.has(domain)) blockers.push(`domain_missing:${domain}`);

  const uniqueBlockers = unique(blockers);
  if (uniqueBlockers.length) {
    return {
      status: 'HOLD', readyForConnectedPilot: false, blockers: uniqueBlockers,
      dependencyGraphSha256: graphEvaluation.canonicalSha256,
      domainReceiptSha256s,
    };
  }
  const dependencyGraphSha256 = hashSpatialDependencyGraph(graph!);
  const canonicalSha256 = createHash('sha256').update(canonical({
    schema: input.schema,
    projectId: input.projectId,
    dependencyGraphSha256,
    domainReceiptSha256s,
  }), 'utf8').digest('hex');
  return { status: 'PASS', readyForConnectedPilot: true, blockers: [], dependencyGraphSha256, domainReceiptSha256s, canonicalSha256 };
}
