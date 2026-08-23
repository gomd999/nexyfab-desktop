import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { startAgentServer } from './agent-mcp-server.mjs';

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

const activeServers: Array<ReturnType<typeof startAgentServer> & { input: PassThrough; output: PassThrough }> = [];

function openServer(scope: 'read' | 'propose' | 'apply' | 'export' = 'read', profile: 'source' | 'installer-core' = 'source') {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = startAgentServer({ input, output, scope, profile });
  const active = { ...server, input, output };
  activeServers.push(active);
  return active;
}

function request(server: { input: PassThrough; output: PassThrough }, value: Record<string, unknown> | string): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      server.output.off('data', onData);
      try { resolve(JSON.parse(buffer.slice(0, newline)) as JsonRpcResponse); }
      catch (error) { reject(error); }
    };
    server.output.on('data', onData);
    server.input.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  });
}

function contentJson(response: JsonRpcResponse): Record<string, unknown> {
  const content = response.result?.content;
  if (!Array.isArray(content) || typeof content[0] !== 'object' || content[0] === null || typeof (content[0] as { text?: unknown }).text !== 'string') throw new Error('MCP content text missing');
  return JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>;
}

afterEach(() => {
  for (const server of activeServers.splice(0)) {
    server.readline.close();
    server.input.end();
    server.output.end();
  }
});

describe('drawing-to-3d agent MCP stdio gateway', () => {
  it('initializes with the negotiated protocol, server identity, and runtime profile', async () => {
    const response = await request(openServer(), {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' },
    });
    expect(response).toMatchObject({
      jsonrpc: '2.0', id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexyfab-agent-gateway', version: '0.1.0' },
        runtimeProfile: 'source',
      },
    });
  });

  it('counter-offers the supported legacy version and serves the modern discovery envelope', async () => {
    const legacy = openServer();
    await expect(request(legacy, { jsonrpc: '2.0', id: 20, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).resolves.toMatchObject({
      id: 20, result: { protocolVersion: '2025-11-25' },
    });
    await expect(request(legacy, { jsonrpc: '2.0', id: 25, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).resolves.toMatchObject({
      id: 25, result: { protocolVersion: '2025-11-25' },
    });

    const server = openServer();
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    server.input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26' } })}\n`);
    server.input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'code_check', arguments: { list: true } } })}\n`);
    await new Promise(resolve => setTimeout(resolve, 20));
    const discovered = await request(server, {
      jsonrpc: '2.0', id: 21, method: 'server/discover', params: { _meta: { ...meta, 'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } },
    });
    expect(discovered).toMatchObject({
      id: 21,
      result: {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-agent-gateway', version: '0.1.0' } },
        ttlMs: 60_000,
        cacheScope: 'private',
      },
    });
    const listed = await request(server, { jsonrpc: '2.0', id: 22, method: 'tools/list', params: { _meta: meta } });
    expect(listed.result?._meta).toEqual({ 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-agent-gateway', version: '0.1.0' } });
    expect(listed.result?.resultType).toBe('complete');
    expect(listed.result?.ttlMs).toBe(60_000);
    expect(listed.result?.cacheScope).toBe('private');
    const missingMeta = await request(server, { jsonrpc: '2.0', id: 23, method: 'tools/list', params: {} });
    expect(missingMeta).toMatchObject({ id: 23, error: { code: -32602, message: 'invalid params' } });
    expect(missingMeta).not.toHaveProperty('_meta');
    const incompleteDiscovery = await request(server, { jsonrpc: '2.0', id: 230, method: 'server/discover', params: { _meta: meta } });
    expect(incompleteDiscovery).toMatchObject({ id: 230, error: { code: -32602, message: 'invalid params' } });
    const downgrade = await request(server, { jsonrpc: '2.0', id: 231, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(downgrade).toMatchObject({ id: 231, error: { code: -32602, message: 'invalid params' } });
    expect(downgrade).not.toHaveProperty('_meta');
    const invalid = await request(server, { jsonrpc: '2.0', id: 24, method: 'tools/call', params: { _meta: meta, name: 'cad_capabilities', arguments: { unexpected: true } } });
    expect(invalid.result?.isError).toBe(true);
    expect(invalid.result?._meta).toEqual({ 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-agent-gateway', version: '0.1.0' } });

    const direct = openServer();
    const directList = await request(direct, { jsonrpc: '2.0', id: 26, method: 'tools/list', params: { _meta: meta } });
    expect(directList).toMatchObject({ id: 26, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-agent-gateway', version: '0.1.0' } } } });
  });

  it('lists only read-scope tools by default and annotates them as read-only', async () => {
    const response = await request(openServer(), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = response.result?.tools;
    expect(Array.isArray(tools)).toBe(true);
    const names = (tools as Array<{ name: string }>).map(tool => tool.name);
    expect(names).toContain('code_check');
    expect(names).toContain('cad_capabilities');
    expect(names).not.toContain('edit_part');
    expect(names).not.toContain('export_part_step');
    expect((tools as Array<{ annotations?: { readOnlyHint?: boolean } }>).every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('returns protocol errors for malformed JSON, invalid requests, and unknown methods', async () => {
    const server = openServer();
    await expect(request(server, '{not-json')).resolves.toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    await expect(request(server, '[1,2,3]')).resolves.toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
    await expect(request(server, { id: 3, method: 'ping' })).resolves.toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
    await expect(request(server, { jsonrpc: '2.0', id: 3, method: 'ping', params: [] })).resolves.toMatchObject({ jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'invalid params' } });
    await expect(request(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: [] } })).resolves.toMatchObject({ jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'invalid params' } });
    await expect(request(server, { jsonrpc: '2.0', id: 4, method: 'no/such-method' })).resolves.toMatchObject({ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'method not found: no/such-method' } });
    await expect(request(server, `{"jsonrpc":"2.0","id":5,"method":"ping","params":{"value":"${'x'.repeat(1_000_000)}"}}`)).resolves.toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } });
  });

  it('does not answer notifications and keeps inherited names outside the tool boundary', async () => {
    const server = openServer();
    let responseSeen = false;
    const onData = () => { responseSeen = true; };
    server.output.on('data', onData);
    server.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 20));
    server.output.off('data', onData);
    expect(responseSeen).toBe(false);

    const inherited = await request(server, { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: '__proto__', arguments: {} } });
    expect(inherited).toMatchObject({ jsonrpc: '2.0', id: 12, error: { code: -32602, message: 'invalid params' } });
  });

  it('executes a cheap deterministic read tool without network or provider access', async () => {
    const response = await request(openServer(), {
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'code_check', arguments: { list: true } },
    });
    expect(response.result?.isError).not.toBe(true);
    expect(contentJson(response)).toMatchObject({ ok: true });
  });

  it('denies unexposed apply and export tools before invocation with stable scope codes', async () => {
    const server = openServer();
    const apply = await request(server, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'edit_part', arguments: {} } });
    const exportCall = await request(server, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'export_part_step', arguments: {} } });
    expect(apply.result?.isError).toBe(true);
    expect(contentJson(apply)).toMatchObject({ ok: false, denied: true, code: 'SCOPE_REQUIRED' });
    expect(contentJson(exportCall)).toMatchObject({ ok: false, denied: true, code: 'SCOPE_REQUIRED' });
  });

  it('exposes apply but not export and keeps path arguments inside the project root', async () => {
    const previousRoot = process.env.NEXYFAB_PROJECT_ROOT;
    process.env.NEXYFAB_PROJECT_ROOT = process.cwd();
    try {
      const server = openServer('apply');
      const listed = await request(server, { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} });
      const names = (listed.result?.tools as Array<{ name: string }>).map(tool => tool.name);
      expect(names).toContain('edit_part');
      expect(names).not.toContain('export_part_step');
      const outside = await request(server, {
        jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { name: 'verify_complex_system_graph', arguments: { graphFile: `${process.cwd()}-outside/graph.json`, artifactFiles: ['graph.json'] } },
      });
      expect(contentJson(outside)).toMatchObject({ ok: false, denied: true, code: 'PATH_OUTSIDE_PROJECT_ROOT' });
    } finally {
      if (previousRoot === undefined) delete process.env.NEXYFAB_PROJECT_ROOT;
      else process.env.NEXYFAB_PROJECT_ROOT = previousRoot;
    }
  });

  it('requires a project root before an export tool can receive a path output', async () => {
    const previousRoot = process.env.NEXYFAB_PROJECT_ROOT;
    delete process.env.NEXYFAB_PROJECT_ROOT;
    try {
      const response = await request(openServer('export'), {
        jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'render_preview', arguments: { outDir: 'preview' } },
      });
      expect(contentJson(response)).toMatchObject({ ok: false, denied: true, code: 'PROJECT_ROOT_REQUIRED' });
    } finally {
      if (previousRoot === undefined) delete process.env.NEXYFAB_PROJECT_ROOT;
      else process.env.NEXYFAB_PROJECT_ROOT = previousRoot;
    }
  });
});
