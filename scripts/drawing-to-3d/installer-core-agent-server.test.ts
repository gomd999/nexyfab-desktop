import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { installerCoreToolNames, startInstallerCoreServer } from './installer-core-agent-server.mjs';

type Rpc = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

class Collector extends Writable {
  text = '';
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.text += chunk.toString();
    callback();
  }
  messages(): Rpc[] {
    return this.text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Rpc);
  }
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  required,
  additionalProperties: false,
  properties,
});

const schemas: Record<string, Record<string, unknown>> = {
  list_domains: objectSchema({}),
  build_assembly: objectSchema({ assembly: { type: 'object' } }, ['assembly']),
  analyze_dfm: objectSchema({ intent: { type: 'object' } }, ['intent']),
  fab_estimate: objectSchema({ intent: { type: 'object' } }, ['intent']),
  resolve_constraints: objectSchema({ assembly: { type: 'object' } }, ['assembly']),
  render_preview: objectSchema({ assembly: { type: 'object' }, outDir: { type: 'string' } }, ['assembly']),
  blade_ring: objectSchema({ dummy: { type: 'number' } }, ['dummy']),
  loft_part: objectSchema({ stations: { type: 'array', items: { type: 'object' } } }, ['stations']),
};

const tools = installerCoreToolNames.map((name) => ({
  name,
  description: `${name} test tool`,
  inputSchema: schemas[name],
}));

const legacyInitialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
const modernMeta = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };
const modernDiscovery = {
  jsonrpc: '2.0', id: 10, method: 'server/discover', params: {
    _meta: {
      ...modernMeta._meta,
      'io.modelcontextprotocol/clientInfo': { name: 'installer-test', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
};

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { assertion(); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
  }
  assertion();
}

describe('installer-core governed MCP server', () => {
  it('uses a one-megabyte byte cap, emits one error, and resumes after CRLF', async () => {
    const input = new PassThrough();
    const output = new Collector();
    const server = await startInstallerCoreServer({ input, output, toolsLoader: async () => tools });
    input.write(Buffer.from(`{"jsonrpc":"2.0","id":1,"method":"ping","padding":"${'x'.repeat(1_100_000)}"}\r`));
    input.write(Buffer.from('\n'));
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
    await eventually(() => expect(output.messages()).toHaveLength(2));
    expect(output.messages()).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } },
      { jsonrpc: '2.0', id: 2, result: {} },
    ]);
    server.readline.close();
  });

  it('rejects an invalid UTF-8 frame and continues with the next request', async () => {
    const input = new PassThrough();
    const output = new Collector();
    const server = await startInstallerCoreServer({ input, output, toolsLoader: async () => tools });
    input.write(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"pi'), Buffer.from([0xff]), Buffer.from('ng"}\n')]));
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
    await eventually(() => expect(output.messages()).toHaveLength(2));
    expect(output.messages()).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { jsonrpc: '2.0', id: 2, result: {} },
    ]);
    server.readline.close();
  });

  it('supports modern discovery, pins the era, and returns canonical -32022', async () => {
    const output = new Collector();
    const server = await startInstallerCoreServer({ input: new PassThrough(), output, toolsLoader: async () => tools });
    await server.handle(modernDiscovery);
    await server.handle({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: modernMeta });
    await server.handle({ jsonrpc: '2.0', id: 12, method: 'ping' });
    expect(output.messages()[0]).toMatchObject({ id: 10, result: { resultType: 'complete', supportedVersions: ['2026-07-28'], ttlMs: 60_000, cacheScope: 'private', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-agent-gateway' } } } });
    expect(output.messages()[1]).toMatchObject({ id: 11, result: { resultType: 'complete', tools: expect.any(Array) } });
    expect(output.messages()[2]).toMatchObject({ id: 12, error: { code: -32602, message: 'invalid params' } });

    const unsupportedOutput = new Collector();
    const unsupported = await startInstallerCoreServer({ input: new PassThrough(), output: unsupportedOutput, toolsLoader: async () => tools });
    await unsupported.handle({ jsonrpc: '2.0', id: 13, method: 'ping', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } });
    expect(unsupportedOutput.messages()[0]).toEqual({ jsonrpc: '2.0', id: 13, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: '2099-01-01' } } });
    server.readline.close(); unsupported.readline.close();
  });

  it('keeps id-less requests silent and never invokes a tool', async () => {
    const output = new Collector();
    const toolCaller = vi.fn(async () => ({ ok: true }));
    const server = await startInstallerCoreServer({ input: new PassThrough(), output, toolsLoader: async () => tools, toolCaller });
    await server.handle({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    await server.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_domains', arguments: {} } });
    await server.handle({ jsonrpc: '2.0', id: 20, method: 'ping', params: modernMeta });
    expect(toolCaller).not.toHaveBeenCalled();
    expect(output.messages()).toHaveLength(1);
    expect(output.messages()[0]).toMatchObject({ id: 20, result: { resultType: 'complete' } });
    server.readline.close();
  });

  it('validates strict schemas before execution and serializes streamed calls', async () => {
    const input = new PassThrough();
    const output = new Collector();
    const calls: string[] = [];
    const toolCaller = vi.fn(async (name: string) => {
      if (name === 'build_assembly') await new Promise((resolve) => setTimeout(resolve, 20));
      calls.push(name);
      return { ok: true, name };
    });
    const server = await startInstallerCoreServer({ input, output, scope: 'apply', toolsLoader: async () => tools, toolCaller });
    input.write(`${JSON.stringify(legacyInitialize)}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'build_assembly', arguments: { assembly: {}, extra: true } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'build_assembly', arguments: { assembly: {} } } })}\n`);
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'blade_ring', arguments: { dummy: 1 } } })}\n`);
    await eventually(() => expect(output.messages()).toHaveLength(4));
    expect(output.messages().map((message) => message.id)).toEqual([1, 2, 3, 4]);
    expect(output.messages()[1]).toMatchObject({ result: { isError: true, content: [{ text: 'ERROR: INVALID_TOOL_ARGUMENTS' }] } });
    expect(calls).toEqual(['build_assembly', 'blade_ring']);
    server.readline.close();
  });

  it('preserves dynamic scope and project-root/symlink policy', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'nexyfab-sidecar-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'nexyfab-sidecar-outside-'));
    const linked = join(projectRoot, 'linked-output');
    mkdirSync(join(projectRoot, 'safe-output'));
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const output = new Collector();
    const toolCaller = vi.fn(async () => ({ ok: true }));
    const server = await startInstallerCoreServer({ input: new PassThrough(), output, scope: 'export', projectRoot, toolsLoader: async () => tools, toolCaller });
    await server.handle(legacyInitialize);
    await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: {}, outDir: outside } } });
    await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: {}, outDir: linked } } });
    await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: {}, outDir: join(projectRoot, 'safe-output'), confirmWrite: true } } });
    const messages = output.messages();
    expect(messages[1]?.result).toMatchObject({ isError: true });
    expect((messages[1]?.result?.content as Array<{ text: string }>)[0].text).toContain('PATH_OUTSIDE_PROJECT_ROOT');
    expect((messages[2]?.result?.content as Array<{ text: string }>)[0].text).toContain('PATH_OUTSIDE_PROJECT_ROOT');
    expect(messages[3]?.result).not.toHaveProperty('isError');
    expect(toolCaller).toHaveBeenCalledTimes(1);
    server.readline.close();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('requires per-call approval for a sidecar filesystem render and strips it before execution', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'nexyfab-sidecar-approval-'));
    const output = new Collector();
    const toolCaller = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ ok: true, args }));
    const server = await startInstallerCoreServer({ input: new PassThrough(), output, scope: 'export', projectRoot, toolsLoader: async () => tools, toolCaller });
    await server.handle(legacyInitialize);
    const outDir = join(projectRoot, 'safe-output');
    await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: {}, outDir } } });
    await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'render_preview', arguments: { assembly: {}, outDir, confirmWrite: true } } });
    const messages = output.messages();
    expect(messages[1]?.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('MCP_WRITE_APPROVAL_REQUIRED') }] });
    expect(messages[2]?.result).not.toHaveProperty('isError');
    expect(toolCaller).toHaveBeenCalledTimes(1);
    expect(toolCaller.mock.calls[0]?.[1]).toEqual({ assembly: {}, outDir });
    server.readline.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });
});
