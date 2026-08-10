import type { AssemblyState } from '../assembly/assemblyState';
import type { FeatureTree } from '../cad/featureTree';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from './aiAssemblyProgram';

export type AiAssemblyRevisionPackage = {
  schema: 'nexyfab.ai-assembly-revision-package.v1';
  lineageId: string;
  revision: number;
  baseProgramHash: string;
  programHash: string;
  programArtifact: string;
  createdAt: string;
  sideEffects: { sourceModified: false; quoteCreated: false; rfqSent: false };
};

export function buildEditedAiAssemblyProgram(base: AiAssemblyProgram, documentState: AssemblyState, documentTrees: Readonly<Record<string, FeatureTree>>): AiAssemblyProgram {
  const governedIds = base.parts.map(part => part.instanceId);
  const governed = new Set(governedIds);
  const stateById = new Map(documentState.parts.map(part => [part.id, part]));
  for (const id of governedIds) {
    if (!stateById.has(id)) throw new Error(`required AI part was removed: ${id}`);
    if (!documentTrees[id]) throw new Error(`required AI FeatureTree is missing: ${id}`);
  }
  const assemblyParts = governedIds.map(id => ({ ...stateById.get(id)! }));
  const assemblyMates = documentState.mates.filter(mate => governed.has(mate.a.partId) && governed.has(mate.b.partId)).map(mate => ({ ...mate, a: { ...mate.a }, b: { ...mate.b } }));
  const revised: AiAssemblyProgram = {
    ...base,
    assembly: { ...base.assembly, parts: assemblyParts, mates: assemblyMates },
    parts: base.parts.map(part => ({ ...part, featureTree: documentTrees[part.instanceId]! })),
    structure: base.structure?.map(group => ({ ...group, instanceIds: group.instanceIds.filter(id => governed.has(id)) })),
    classification: base.unresolved.length ? 'concept_only' : base.classification,
  };
  const issues = validateAiAssemblyProgram(revised);
  if (issues.length) throw new Error(`edited AI program is invalid: ${issues[0]!.path}: ${issues[0]!.message}`);
  return revised;
}

export function serializeAiAssemblyProgram(program: AiAssemblyProgram): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(program, null, 2)}\n`);
}

export async function packageAiAssemblyRevision(program: AiAssemblyProgram, input: { lineageId: string; revision: number; baseProgramHash: string; createdAt?: string }): Promise<{ programBytes: Uint8Array; manifestBytes: Uint8Array; manifest: AiAssemblyRevisionPackage }> {
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(input.lineageId)) throw new Error('invalid design lineage');
  if (!Number.isInteger(input.revision) || input.revision < 2) throw new Error('revision must be an integer of at least 2');
  if (!/^[a-f0-9]{64}$/.test(input.baseProgramHash)) throw new Error('baseProgramHash must be a lowercase SHA-256');
  const programBytes = serializeAiAssemblyProgram(program);
  const programHash = await sha256(programBytes);
  if (programHash === input.baseProgramHash) throw new Error('edited program bytes are unchanged from the baseline');
  const manifest: AiAssemblyRevisionPackage = {
    schema: 'nexyfab.ai-assembly-revision-package.v1', lineageId: input.lineageId, revision: input.revision,
    baseProgramHash: input.baseProgramHash, programHash, programArtifact: `editable-program-${programHash}.json`,
    createdAt: input.createdAt ?? new Date().toISOString(), sideEffects: { sourceModified: false, quoteCreated: false, rfqSent: false },
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return { programBytes, manifestBytes, manifest };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
