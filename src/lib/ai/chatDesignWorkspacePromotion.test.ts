import { describe, expect, it, vi } from 'vitest';
import { createChatAiDesignWorkspace, ensureChatDesignProject } from './chatDesignWorkspacePromotion';
import { safeReturnPath } from '@/lib/safeReturnPath';

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('chat-first durable workspace promotion', () => {
  it('reuses the free editable project without attempting a paid second project', async () => {
    const fetcher = vi.fn(async () => json({ projects: [{ id: 'project-1', name: 'Existing', canEdit: true }] }));
    const resolved = await ensureChatDesignProject('new bracket', fetcher as typeof fetch);
    expect(resolved).toMatchObject({ reused: true, project: { id: 'project-1' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates a tagged project only when the workspace is empty', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ projects: [] }))
      .mockResolvedValueOnce(json({ project: { id: 'project-2', name: 'Bracket', canEdit: true } }, { status: 201 }));
    const resolved = await ensureChatDesignProject('Bracket\nwith holes', fetcher as typeof fetch);
    expect(resolved.reused).toBe(false);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ tags: ['chat-first-design', 'ai-design'] });
  });

  it('creates the server workspace after resolving a project', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ projects: [{ id: 'project-1', name: 'Existing', canEdit: true }] }))
      .mockResolvedValueOnce(json({ state: { runtimeRevision: 0 } }, { status: 201 }));
    const promoted = await createChatAiDesignWorkspace({ prompt: 'Design a bracket', fetchImpl: fetcher as typeof fetch });
    expect(promoted.project.id).toBe('project-1');
    const workspaceBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(workspaceBody).toMatchObject({ operation: 'create', projectId: 'project-1' });
    expect(workspaceBody.inputs[0]).toMatchObject({ kind: 'text', authority: 'user_confirmed' });
  });
});

describe('safe login return path', () => {
  it('accepts same-origin paths and rejects redirects or backslashes', () => {
    expect(safeReturnPath('/kr/?draft=1')).toBe('/kr/?draft=1');
    expect(safeReturnPath('//evil.example/path')).toBe('/account');
    expect(safeReturnPath('/\\evil.example/path')).toBe('/account');
    expect(safeReturnPath('https://evil.example/path')).toBe('/account');
  });
});
