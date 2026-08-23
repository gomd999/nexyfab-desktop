import type { DesignDomainId } from './domainProfile';
import architectureManifest from '../../../domains/architecture/domain.json';
import civilManifest from '../../../domains/civil/domain.json';
import interiorManifest from '../../../domains/interior/domain.json';
import landscapeManifest from '../../../domains/landscape/domain.json';
import mechanicalManifest from '../../../domains/mechanical/domain.json';

export type DomainAuthoringState = 'WORKING' | 'PREVIEW';
export type DomainExactExecutionState = 'FULL' | 'PARTIAL' | 'NOT_IMPLEMENTED';
export type DomainReleaseState = 'READY' | 'BLOCKED';

export interface DomainCapability {
  domain: DesignDomainId;
  authoringState: DomainAuthoringState;
  exactExecutionState: DomainExactExecutionState;
  releaseState: DomainReleaseState;
}

type DomainManifest = {
  schema?: unknown;
  id?: unknown;
  contractVersion?: unknown;
  authoringState?: unknown;
  exactExecutionState?: unknown;
  releaseState?: unknown;
};

const RAW_MANIFESTS: Record<DesignDomainId, DomainManifest> = {
  mechanical: mechanicalManifest,
  // The domain registry currently stores the architecture manifest under its
  // legacy name. It is the canonical capability source for the building ID.
  building: architectureManifest,
  civil: civilManifest,
  landscape: landscapeManifest,
  interior: interiorManifest,
};

const DOMAIN_ALIASES: Record<string, DesignDomainId> = { architecture: 'building' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes UI/domain-registry aliases without granting a new capability. */
export function normalizeDesignDomainId(value: unknown): DesignDomainId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = DOMAIN_ALIASES[value] ?? value;
  return Object.prototype.hasOwnProperty.call(RAW_MANIFESTS, normalized) ? normalized as DesignDomainId : undefined;
}

/** Parses only recognized, fail-closed implementation states from a manifest. */
export function parseDomainCapability(raw: unknown, domain: DesignDomainId): DomainCapability | undefined {
  if (!isRecord(raw)) return undefined;
  const expectedIds = domain === 'building' ? ['building', 'architecture'] : [domain];
  if (raw.schema !== 'nexyfab.cad-domain.v1'
    || raw.contractVersion !== 'nexyfab.cad-contract.v1'
    || typeof raw.id !== 'string' || !expectedIds.includes(raw.id)) return undefined;
  if (raw.authoringState !== 'WORKING' && raw.authoringState !== 'PREVIEW') return undefined;
  if (raw.exactExecutionState !== 'FULL' && raw.exactExecutionState !== 'PARTIAL' && raw.exactExecutionState !== 'NOT_IMPLEMENTED') return undefined;
  if (raw.releaseState !== 'READY' && raw.releaseState !== 'BLOCKED') return undefined;
  return {
    domain,
    authoringState: raw.authoringState,
    exactExecutionState: raw.exactExecutionState,
    releaseState: raw.releaseState,
  };
}

export function getDomainCapability(domain: DesignDomainId): DomainCapability | undefined {
  return parseDomainCapability(RAW_MANIFESTS[domain], domain);
}

export function supportsExactExecution(capability: DomainCapability | undefined): boolean {
  return capability?.exactExecutionState === 'FULL' || capability?.exactExecutionState === 'PARTIAL';
}

export function supportsRelease(capability: DomainCapability | undefined): boolean {
  return capability?.releaseState === 'READY';
}
