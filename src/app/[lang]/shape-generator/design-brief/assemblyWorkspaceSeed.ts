import type { EditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import { validateAssembly } from '@/lib/assembly/assemblyState';
import { validateTree } from '@/lib/cad/featureTree';

export const AI_ASSEMBLY_SEED_SCHEMA = 'nexyfab.ai-assembly-workspace-seed.v1' as const;
const STORAGE_PREFIX = 'nexyfab:ai-assembly-seed:';

export interface AiAssemblyWorkspaceSeed {
  schema: typeof AI_ASSEMBLY_SEED_SCHEMA;
  revisionId: string;
  candidate: EditableWorkspaceCandidate;
}

function storageOrNull(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(revisionId: string): string {
  return `${STORAGE_PREFIX}${revisionId}`;
}

function validateSeed(seed: AiAssemblyWorkspaceSeed, revisionId: string): void {
  if (seed.schema !== AI_ASSEMBLY_SEED_SCHEMA || seed.revisionId !== revisionId) {
    throw new Error('assembly_seed_identity_mismatch');
  }
  const candidate = seed.candidate;
  if (
    candidate.schema !== 'nexyfab.editable-workspace-candidate.v1'
    || candidate.target !== 'assembly-browser'
    || !candidate.supported
    || !candidate.assembly
    || !candidate.reverificationRequired
    || candidate.inheritedVerification
    || candidate.manufacturingReleaseReady
  ) {
    throw new Error('assembly_seed_contract_invalid');
  }
  validateAssembly(candidate.assembly.state);
  const partIds = new Set(candidate.assembly.state.parts.map(part => part.id));
  for (const partId of partIds) {
    const tree = candidate.assembly.featureTrees[partId];
    if (!tree) throw new Error(`assembly_seed_tree_missing:${partId}`);
    validateTree(tree);
  }
  for (const partId of Object.keys(candidate.assembly.featureTrees)) {
    if (!partIds.has(partId)) throw new Error(`assembly_seed_tree_orphan:${partId}`);
  }
}

export function writeAiAssemblyWorkspaceSeed(
  revisionId: string,
  candidate: EditableWorkspaceCandidate,
  storage?: Storage,
): { ok: true } | { ok: false; reason: string } {
  const target = storageOrNull(storage);
  if (!target) return { ok: false, reason: 'assembly_seed_storage_unavailable' };
  const seed: AiAssemblyWorkspaceSeed = {
    schema: AI_ASSEMBLY_SEED_SCHEMA,
    revisionId,
    candidate,
  };
  try {
    validateSeed(seed, revisionId);
    target.setItem(storageKey(revisionId), JSON.stringify(seed));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'assembly_seed_write_failed' };
  }
}

export function readAiAssemblyWorkspaceSeed(
  revisionId: string,
  storage?: Storage,
): AiAssemblyWorkspaceSeed | null {
  const target = storageOrNull(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(storageKey(revisionId));
    if (!raw) return null;
    const seed = JSON.parse(raw) as AiAssemblyWorkspaceSeed;
    validateSeed(seed, revisionId);
    return seed;
  } catch {
    return null;
  }
}

export function removeAiAssemblyWorkspaceSeed(revisionId: string, storage?: Storage): void {
  const target = storageOrNull(storage);
  if (!target) return;
  try {
    target.removeItem(storageKey(revisionId));
  } catch {
    // Session handoff cleanup is best-effort. The seed is revision-keyed and
    // never reused without an explicit matching URL revision id.
  }
}
