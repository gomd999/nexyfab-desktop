import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callTool,
  LOCAL_MCP_CONDITIONAL_WRITE_TOOLS,
  LOCAL_MCP_WRITE_TOOLS,
  MCP_WRITE_APPROVAL_ERROR,
} from './mcp-server.mjs';

describe('raw local MCP write approval', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('fails closed before any filesystem mutation when approval is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexyfab-mcp-write-'));
    roots.push(root);
    const attempts: Array<[string, Record<string, unknown>, string]> = [
      ['export_step', { intent: {}, outPath: join(root, 'part.step') }, join(root, 'part.step')],
      ['html_render', { assembly: { parts: [] }, outPath: join(root, 'preview.html') }, join(root, 'preview.html')],
      ['generate_package', { assembly: {}, outDir: join(root, 'package') }, join(root, 'package')],
      ['generate_domain_package', { domain: 'civil', templateId: 'fixture', outDir: join(root, 'domain') }, join(root, 'domain')],
    ];

    for (const [tool, args, target] of attempts) {
      const result = await callTool(tool, args);
      expect(result).toMatchObject({ ok: false, code: MCP_WRITE_APPROVAL_ERROR, tool });
      await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('does not treat a whitespace outDir as an in-memory preview', async () => {
    const result = await callTool('render_preview', {
      assembly: { parts: [] },
      outDir: ' ',
    });
    expect(result).toMatchObject({
      ok: false,
      code: MCP_WRITE_APPROVAL_ERROR,
      tool: 'render_preview',
    });
  });

  it('accepts explicit approval for the local file writer and keeps read-only tools unguarded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexyfab-mcp-write-'));
    roots.push(root);
    const outPath = join(root, 'preview.html');
    const assembly = {
      name: 'fixture',
      parts: [{ id: 'base', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } }],
    };

    const written = await callTool('html_render', {
      assembly,
      outPath,
      confirmWrite: true,
    });
    expect(written.ok).toBe(true);
    expect((await stat(outPath)).size).toBeGreaterThan(0);

    const readOnly = await callTool('build_assembly', { assembly });
    expect(readOnly.code).not.toBe(MCP_WRITE_APPROVAL_ERROR);
  });

  it('advertises every unconditional local filesystem writer in the approval inventory', () => {
    expect(LOCAL_MCP_WRITE_TOOLS).toEqual([
      'export_step',
      'html_render',
      'generate_package',
      'generate_domain_package',
    ]);
    expect(LOCAL_MCP_CONDITIONAL_WRITE_TOOLS).toEqual(['render_preview']);
  });

  it('never forwards local approval metadata to the HTTP API', async () => {
    let forwarded: Record<string, unknown> | undefined;
    vi.stubEnv('NEXYFAB_API_KEY', 'test-only-key');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      forwarded = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await callTool('transition_ai_generation_state', {
      action: 'recover',
      confirmWrite: true,
    });

    expect(result.ok).toBe(true);
    expect(forwarded).toEqual({ action: 'recover' });
  });
});
