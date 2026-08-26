import type { AiDesignInputEvent } from './aiDesignInputAdapter';

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export type AiDesignRasterWorkspaceSource = {
  artifactId: string;
  sourceHash: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  kind: 'image' | 'drawing_2d';
  scaleMm?: number;
};

export function createAiDesignSessionId(): string {
  return `ai:${crypto.randomUUID()}`;
}

export async function createAiDesignWorkspaceRequestV10(input: {
  projectId: string;
  prompt: string;
  sessionId?: string;
  rasterSource?: AiDesignRasterWorkspaceSource;
}) {
  const normalized = input.prompt.trim();
  if (!normalized || normalized.length > 4_000) throw new Error('AI_DESIGN_PROMPT_LENGTH_INVALID');
  const bytes = new TextEncoder().encode(normalized);
  const textHash = await sha256Text(normalized);
  const sessionId = input.sessionId ?? createAiDesignSessionId();
  const projectContentHash = input.rasterSource
    ? await sha256Text(`${textHash}:${input.rasterSource.sourceHash}`)
    : textHash;
  const textInput: AiDesignInputEvent = {
    projectId: input.projectId,
    revision: 0,
    sourceId: `input:${crypto.randomUUID()}`,
    sourceHash: textHash,
    projectContentHash,
    kind: 'text',
    mimeType: 'text/plain',
    sizeBytes: bytes.byteLength,
    fields: [{ key: 'design_request', category: 'requirement', value: normalized }],
    authority: 'user_confirmed',
    provenance: { rights: 'user_owned', origin: 'nexyfab.ai-design.v10', aiUseAllowed: true, derivativeUseAllowed: true },
    label: 'AI Design request',
    extractionKind: 'user',
  };
  const inputs: AiDesignInputEvent[] = [textInput];
  if (input.rasterSource) {
    const source = input.rasterSource;
    inputs.push({
      projectId: input.projectId,
      revision: 0,
      sourceId: source.artifactId,
      sourceHash: source.sourceHash,
      projectContentHash,
      kind: source.kind,
      mimeType: source.mimeType,
      sizeBytes: source.byteLength,
      fields: [
        { key: 'source_artifact_id', category: 'fact', value: source.artifactId },
        { key: 'source_filename', category: 'fact', value: source.filename },
        { key: 'visual_reference', category: 'requirement', value: source.kind },
        ...(source.scaleMm ? [{ key: 'reference_longest_side', category: 'dimension' as const, value: source.scaleMm, unit: 'mm' }] : []),
      ],
      authority: 'imported_authority',
      provenance: { rights: 'user_owned', origin: 'nexyfab.ai-design.private-source.v1', aiUseAllowed: true, derivativeUseAllowed: true },
      label: source.filename,
      extractionKind: source.kind === 'drawing_2d' ? 'drawing' : 'vision',
      extracted: true,
    });
  }
  return {
    sessionId,
    body: {
      operation: 'create' as const,
      projectId: input.projectId,
      sessionId,
      revisionToken: `rev:${projectContentHash.slice(0, 48)}`,
      inputs,
    },
  };
}

export async function createAiDesignTextWorkspaceRequestV10(projectId: string, prompt: string) {
  return createAiDesignWorkspaceRequestV10({ projectId, prompt });
}
