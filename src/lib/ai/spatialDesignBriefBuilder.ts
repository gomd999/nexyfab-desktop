import { useEffect, useMemo, useState } from 'react';
import type { SpatialCadDocument, SpatialCadParameters, SpatialCadDomain } from '@/lib/cad/spatialCadCommand';
import type { AiCandidateLock } from './aiCanonicalCandidate';
import { stableSpatialCadDocumentJson } from '@/lib/cad/spatialCadHash';
import {
  saveSpatialDesignBriefHandoff,
  saveSpatialDesignBriefHandoffV2,
  type SpatialDesignBriefHandoffV2,
  type SpatialDesignDomain,
  type SpatialDraftVerification,
} from './spatialDesignBriefHandoff';

export function createSpatialDocumentId(domain: SpatialDesignDomain | Extract<SpatialCadDomain, 'coordination'>): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${domain}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `spatial:${domain}:${uuid}`;
}

export function spatialCadDocumentSnapshot(
  domain: SpatialDesignDomain,
  revision: number,
  parameters: SpatialCadParameters,
): SpatialCadDocument {
  return {
    schema: 'nexyfab.spatial-cad-document.v1', domain, revision,
    parameters: structuredClone(parameters), verification: 'NOT_RUN', updatedBy: 'human',
  };
}

export async function spatialCadContentHash(document: SpatialCadDocument): Promise<string> {
  const bytes = new TextEncoder().encode(stableSpatialCadDocumentJson(document));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function useSpatialCadContentHash(document: SpatialCadDocument): string | null {
  const [hash, setHash] = useState<string | null>(null);
  const serialized = useMemo(() => stableSpatialCadDocumentJson(document), [document]);
  useEffect(() => {
    let active = true;
    void spatialCadContentHash(JSON.parse(serialized) as SpatialCadDocument).then(next => { if (active) setHash(next); });
    return () => { active = false; };
  }, [serialized]);
  return hash;
}

export async function saveSpatialCadDraftHandoff(input: {
  domain: SpatialDesignDomain;
  unit: 'mm' | 'm';
  verification: SpatialDraftVerification;
  parameters: Record<string, string | number | boolean>;
  missingAuthority: string[];
  baseDocumentRevision: number;
  documentId: string;
  locks?: readonly AiCandidateLock[];
  mode?: 'new_design' | 'request_only_edit';
  selectedParameterPath?: string | null;
  legacy?: boolean;
}): Promise<SpatialDesignBriefHandoffV2 | null> {
  const mode = input.mode ?? 'request_only_edit';
  if (mode === 'request_only_edit' && !input.selectedParameterPath?.trim()) return null;
  if (mode === 'request_only_edit' && !Object.prototype.hasOwnProperty.call(input.parameters, input.selectedParameterPath!)) return null;
  const document = spatialCadDocumentSnapshot(input.domain, input.baseDocumentRevision, input.parameters);
  const contentHash = await spatialCadContentHash(document);
  const handoff: Omit<SpatialDesignBriefHandoffV2, 'schema' | 'createdAt'> = {
    domain: input.domain,
    unit: input.unit,
    verification: input.verification,
    parameters: structuredClone(input.parameters),
    missingAuthority: [...input.missingAuthority],
    baseDocumentRevision: input.baseDocumentRevision,
    contentHash,
    documentId: input.documentId,
    parameterPaths: mode === 'new_design' ? Object.keys(input.parameters).sort() : [input.selectedParameterPath!],
    locks: (input.locks ?? []).map(lock => ({ id: lock.id, target: { ...lock.target } })),
    mode,
  };
  saveSpatialDesignBriefHandoffV2(window.sessionStorage, handoff);
  if (input.legacy !== false) saveSpatialDesignBriefHandoff(window.sessionStorage, input);
  return { schema: 'nexyfab.spatial-design-brief-handoff.v2', createdAt: Date.now(), ...handoff };
}
