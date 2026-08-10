import { NFAB_FORMAT_VERSION, parseProject, type NfabProjectV1 } from './nfabFormat';

export const NFAB_CANONICALIZATION_POLICY = 'nfab-design-v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;

export interface CadRevisionManifestV1 {
  schema: 'nexyfab.cad-revision-manifest.v1';
  projectFormat: 'nfab';
  projectFormatVersion: 3;
  artifactSha256: string;
  canonicalDesignSha256: string;
  canonicalizationPolicy: typeof NFAB_CANONICALIZATION_POLICY;
  revisionId: string;
  parentManifestSha256: string | null;
  kernelStackIdentitySha256: string;
  createdAt: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function asJson(value: unknown, path = '$'): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`NFAB_CANONICAL_NON_FINITE:${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => asJson(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = asJson(item, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`NFAB_CANONICAL_UNSUPPORTED:${path}`);
}

function stableStringify(value: unknown): string {
  const json = asJson(value);
  const render = (item: JsonValue): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(render).join(',')}]`;
    return `{${Object.keys(item).map(key => `${JSON.stringify(key)}:${render(item[key]!)}`).join(',')}}`;
  };
  return render(json);
}

function designScene(scene: NfabProjectV1['scene']) {
  return {
    selectedId: scene.selectedId,
    params: scene.params,
    paramExpressions: scene.paramExpressions,
    materialId: scene.materialId,
    color: scene.color,
    sketchPlane: scene.sketchPlane,
    sketchProfile: scene.sketchProfile,
    sketchConfig: scene.sketchConfig,
    sketchFaceFrame: scene.sketchFaceFrame ?? null,
    globalVariables: scene.globalVariables ?? [],
  };
}

/**
 * Explicit design-semantic allowlist. Timestamps, thumbnail, project name,
 * AI conversation and viewport/ribbon state are intentionally excluded.
 * Arrays retain authoring order; object keys are sorted; finite JS numbers are
 * preserved exactly (except -0 → 0). Policy changes require a new policy id.
 */
export function canonicalizeNfabDesign(project: NfabProjectV1): string {
  return stableStringify({
    magic: project.magic,
    version: project.version,
    tree: project.tree,
    scene: designScene(project.scene),
    assembly: project.assembly ?? null,
    manufacturing: project.manufacturing ?? null,
    configurations: project.configurations ?? [],
    activeConfigurationId: project.activeConfigurationId ?? null,
    scadIntents: project.scadIntents ?? {},
    referenceGeometry: project.referenceGeometry ?? [],
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function hashNfabArtifact(bytes: Uint8Array): Promise<string> {
  return sha256(bytes);
}

export async function hashNfabCanonicalDesign(project: NfabProjectV1): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalizeNfabDesign(project)));
}

export async function buildCadRevisionManifest(input: {
  artifactBytes: Uint8Array;
  revisionId: string;
  parentManifestSha256: string | null;
  kernelStackIdentitySha256: string;
  createdAt?: string;
}): Promise<CadRevisionManifestV1> {
  if (!input.revisionId.trim()) throw new Error('CAD_REVISION_ID_REQUIRED');
  if (input.parentManifestSha256 !== null && !SHA256.test(input.parentManifestSha256)) throw new Error('CAD_PARENT_MANIFEST_SHA256_INVALID');
  if (!SHA256.test(input.kernelStackIdentitySha256)) throw new Error('CAD_KERNEL_STACK_IDENTITY_SHA256_INVALID');
  const exactText = new TextDecoder('utf-8', { fatal: true }).decode(input.artifactBytes);
  const rawProject = JSON.parse(exactText) as { version?: unknown };
  if (rawProject.version !== NFAB_FORMAT_VERSION) throw new Error('CAD_PROJECT_FORMAT_VERSION_NOT_CURRENT');
  const project = parseProject(exactText);
  if (project.version !== NFAB_FORMAT_VERSION) throw new Error('CAD_PROJECT_MIGRATION_NOT_CURRENT');
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('CAD_REVISION_CREATED_AT_INVALID');
  return {
    schema: 'nexyfab.cad-revision-manifest.v1',
    projectFormat: 'nfab',
    projectFormatVersion: NFAB_FORMAT_VERSION,
    artifactSha256: await hashNfabArtifact(input.artifactBytes),
    canonicalDesignSha256: await hashNfabCanonicalDesign(project),
    canonicalizationPolicy: NFAB_CANONICALIZATION_POLICY,
    revisionId: input.revisionId,
    parentManifestSha256: input.parentManifestSha256,
    kernelStackIdentitySha256: input.kernelStackIdentitySha256,
    createdAt,
  };
}

export async function cadRevisionManifestSha256(manifest: CadRevisionManifestV1): Promise<string> {
  return sha256(new TextEncoder().encode(stableStringify(manifest)));
}
