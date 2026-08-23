import { createHash } from 'node:crypto';

export interface DesignArtifactBindingInput {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface DesignArtifactBinding {
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
}

export interface DesignArtifactManifest {
  schema: 'nexyfab.design-artifact-manifest.v1';
  revisionId: string;
  revisionSha256: string;
  releaseStatus: 'review_required';
  manufacturingAllowed: false;
  artifacts: DesignArtifactBinding[];
}

const sha256 = (bytes: Uint8Array | string): string => (
  createHash('sha256').update(bytes).digest('hex')
);

/** Canonical JSON keeps a revision stable when object key insertion order differs. */
export function canonicalDesignJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDesignJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalDesignJson(item)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

export function designRevisionSha256(value: unknown): string {
  return sha256(canonicalDesignJson(value));
}

/**
 * Bind the exact exported bytes to one canonical design revision.
 * This proves co-revision identity; it deliberately does not claim that any
 * artifact passed STEP/BOM/drawing round-trip or manufacturing review.
 */
export function buildDesignArtifactManifest(input: {
  revisionId: string;
  revisionValue: unknown;
  artifacts: readonly DesignArtifactBindingInput[];
}): { manifest: DesignArtifactManifest; manifestSha256: string } {
  if (!input.revisionId.trim()) throw new Error('DESIGN_ARTIFACT_REVISION_ID_REQUIRED');
  if (input.artifacts.length === 0) throw new Error('DESIGN_ARTIFACTS_REQUIRED');

  const names = new Set<string>();
  const artifacts = input.artifacts.map((artifact) => {
    if (!artifact.name.trim() || names.has(artifact.name)) {
      throw new Error('DESIGN_ARTIFACT_NAME_INVALID_OR_DUPLICATE');
    }
    names.add(artifact.name);
    return {
      name: artifact.name,
      mime: artifact.mime,
      bytes: artifact.bytes.byteLength,
      sha256: sha256(artifact.bytes),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const manifest: DesignArtifactManifest = {
    schema: 'nexyfab.design-artifact-manifest.v1',
    revisionId: input.revisionId,
    revisionSha256: designRevisionSha256(input.revisionValue),
    releaseStatus: 'review_required',
    manufacturingAllowed: false,
    artifacts,
  };
  return {
    manifest,
    manifestSha256: sha256(canonicalDesignJson(manifest)),
  };
}
