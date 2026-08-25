import {
  createAiDesignSessionId,
  createAiDesignWorkspaceRequestV10,
  type AiDesignRasterWorkspaceSource,
} from './aiDesignWorkspaceBootstrap';
import type { RasterDesignClassification } from '@/lib/designEntryFlow';

type EditableProject = {
  id: string;
  name: string;
  canEdit?: boolean;
  tags?: string[];
};

type FetchLike = typeof fetch;

export type ChatDesignProjectResolution = {
  project: EditableProject;
  reused: boolean;
};

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function projectName(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  return (oneLine || 'AI design').slice(0, 80);
}

function editableProjects(value: unknown): EditableProject[] {
  if (!value || typeof value !== 'object') return [];
  const projects = (value as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return [];
  return projects.filter((item): item is EditableProject => {
    if (!item || typeof item !== 'object') return false;
    const project = item as Partial<EditableProject>;
    return typeof project.id === 'string' && typeof project.name === 'string' && project.canEdit !== false;
  });
}

/**
 * Free accounts own one active project. Reuse an editable chat-first project,
 * then the latest editable project, and create only when the workspace is empty.
 */
export async function ensureChatDesignProject(
  prompt: string,
  fetchImpl: FetchLike = fetch,
): Promise<ChatDesignProjectResolution> {
  const listed = await fetchImpl('/api/nexyfab/projects?limit=50', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  const listedBody = await responseJson(listed);
  if (!listed.ok) throw new Error(listed.status === 401 ? 'AUTHENTICATION_REQUIRED' : String(listedBody.code ?? listedBody.error ?? `HTTP_${listed.status}`));
  const projects = editableProjects(listedBody);
  const existing = projects.find(project => project.tags?.includes('chat-first-design')) ?? projects[0];
  if (existing) return { project: existing, reused: true };

  const created = await fetchImpl('/api/nexyfab/projects', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: projectName(prompt), tags: ['chat-first-design', 'ai-design'] }),
  });
  const createdBody = await responseJson(created);
  const project = createdBody.project;
  if (!created.ok || !project || typeof project !== 'object' || typeof (project as EditableProject).id !== 'string') {
    throw new Error(created.status === 401 ? 'AUTHENTICATION_REQUIRED' : String(createdBody.code ?? createdBody.error ?? `HTTP_${created.status}`));
  }
  return { project: project as EditableProject, reused: false };
}

export async function createChatAiDesignWorkspace(input: {
  prompt: string;
  attachment?: { file: File; classification?: RasterDesignClassification; scaleMm?: number };
  fetchImpl?: FetchLike;
}): Promise<{ project: EditableProject; reusedProject: boolean; sessionId: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolved = await ensureChatDesignProject(input.prompt, fetchImpl);
  const sessionId = createAiDesignSessionId();
  let rasterSource: AiDesignRasterWorkspaceSource | undefined;
  if (input.attachment) {
    const form = new FormData();
    form.set('projectId', resolved.project.id);
    form.set('sessionId', sessionId);
    form.set('kind', input.attachment.classification?.kind === 'drawing' ? 'drawing_2d' : 'image');
    form.set('file', input.attachment.file);
    if (input.attachment.classification) form.set('classification', JSON.stringify(input.attachment.classification));
    const uploaded = await fetchImpl('/api/nexyfab/ai-design/sources', {
      method: 'POST', credentials: 'same-origin', body: form,
    });
    const uploadedBody = await responseJson(uploaded);
    const artifact = uploadedBody.artifact as Partial<AiDesignRasterWorkspaceSource> | undefined;
    if (!uploaded.ok || !artifact || typeof artifact.artifactId !== 'string' || typeof artifact.sourceHash !== 'string'
      || typeof artifact.filename !== 'string' || typeof artifact.mimeType !== 'string' || typeof artifact.byteLength !== 'number'
      || (artifact.kind !== 'image' && artifact.kind !== 'drawing_2d')) {
      throw new Error(uploaded.status === 401 ? 'AUTHENTICATION_REQUIRED' : String(uploadedBody.error ?? `HTTP_${uploaded.status}`));
    }
    rasterSource = {
      artifactId: artifact.artifactId,
      sourceHash: artifact.sourceHash,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      byteLength: artifact.byteLength,
      kind: artifact.kind,
      ...(input.attachment.scaleMm ? { scaleMm: input.attachment.scaleMm } : {}),
    };
  }
  const request = await createAiDesignWorkspaceRequestV10({
    projectId: resolved.project.id,
    prompt: input.prompt,
    sessionId,
    rasterSource,
  });
  const response = await fetchImpl('/api/nexyfab/ai-design/workspace-session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(response.status === 401 ? 'AUTHENTICATION_REQUIRED' : String(body.error ?? `HTTP_${response.status}`));
  return { project: resolved.project, reusedProject: resolved.reused, sessionId: request.sessionId };
}
