import type { GenerationDomainId } from './domainGenerationRequest';
import { getDomainProfile } from './domainProfileRegistry';
import {
  validateUnifiedDesignProject,
  type DesignDomain,
  type RepresentationKind,
  type UnifiedDesignProject,
} from './unifiedDesignProject';

export interface DomainAssemblyPart {
  id?: unknown;
  [key: string]: unknown;
}

export interface DomainAssemblyPayload {
  name?: string;
  parts?: DomainAssemblyPart[];
  templateId?: unknown;
  templateDomain?: unknown;
  alignment?: unknown;
  terrain?: unknown;
  terrainMeta?: unknown;
  [key: string]: unknown;
}

const DOCUMENT_DOMAIN: Record<GenerationDomainId, DesignDomain> = {
  mech: 'mechanical',
  building: 'architecture',
  civil: 'civil',
  landscape: 'landscape',
  interior: 'interior',
};

function representationsFor(domain: GenerationDomainId, assembly: DomainAssemblyPayload): RepresentationKind[] {
  const representations: RepresentationKind[] = ['procedural'];
  if (domain === 'civil' && assembly.alignment) representations.push('alignment');
  if (domain === 'landscape' && (assembly.terrain || assembly.terrainMeta)) representations.push('tin');
  return representations;
}

export function assemblyUnifiedProject(
  projectId: string,
  domain: GenerationDomainId,
  assembly: DomainAssemblyPayload,
): { project: UnifiedDesignProject; issues: string[] } {
  const parts = Array.isArray(assembly.parts) ? assembly.parts : [];
  const objectIds = parts.map(part => typeof part.id === 'string' ? part.id.trim() : '');
  const coordinateKind = domain === 'civil' || domain === 'landscape' ? 'site' : domain === 'building' || domain === 'interior' ? 'building' : 'local';
  const profileId = domain === 'mech' ? 'mechanical' : domain;
  const targetSchema = getDomainProfile(profileId).documentSchemas[0]!;
  const sourceTemplateId = typeof assembly.templateId === 'string' && assembly.templateId.trim()
    ? assembly.templateId.trim()
    : undefined;
  const project: UnifiedDesignProject = {
    schema: 'nexyfab.unified-design-project.v1',
    id: projectId,
    revision: 0,
    coordinateSystems: [{
      id: 'project-local',
      kind: coordinateKind,
      units: 'mm',
      origin: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    }],
    documents: [{
      id: `${domain}-assembly`,
      domain: DOCUMENT_DOMAIN[domain],
      schema: 'nexyfab.domain-assembly.v1',
      revision: 0,
      coordinateSystemId: 'project-local',
      representations: representationsFor(domain, assembly),
      objectIds,
      payload: structuredClone(assembly),
      profileId,
      profileVersion: 1,
      semanticState: {
        status: 'not_run',
        targetSchema,
        ...(sourceTemplateId ? { sourceTemplateId } : {}),
        reasonCode: 'DEEP_DOCUMENT_ADAPTER_NOT_RUN',
        note: `The deterministic assembly is preserved, but ${targetSchema} generation and validation have not run.`,
      },
    }],
    references: [],
  };
  const issues = parts.length === 0 ? ['Domain assembly must contain at least one part.'] : [];
  issues.push(...validateUnifiedDesignProject(project));
  return { project, issues };
}
