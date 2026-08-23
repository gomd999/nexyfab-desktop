import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonRpcResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

function exchange(lines: string[]) {
  const result = spawnSync(process.execPath, [resolve('public/downloads/nexyfab-mcp.mjs')], {
    cwd: process.cwd(),
    env: { ...process.env, NEXYFAB_API_KEY: '' },
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 10_000_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as JsonRpcResponse);
}

function exchangeBytes(input: Buffer) {
  const result = spawnSync(process.execPath, [resolve('public/downloads/nexyfab-mcp.mjs')], {
    cwd: process.cwd(), env: { ...process.env, NEXYFAB_API_KEY: '' }, input, timeout: 5_000, maxBuffer: 10_000_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr.toString('utf8')).toBe('');
  return result.stdout.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as JsonRpcResponse);
}

describe('downloadable NexyFab remote MCP', () => {
  it('bounds input incrementally, emits one framing error, and resumes after an oversized CRLF-delimited line', () => {
    const oversized = `{"jsonrpc":"2.0","id":50,"method":"ping","params":{"x":"${'x'.repeat(1_100_000)}"}}`;
    const responses = exchange([oversized, `${JSON.stringify({ jsonrpc: '2.0', id: 51, method: 'ping' })}\r`]);
    expect(responses).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } },
      { jsonrpc: '2.0', id: 51, result: {} },
    ]);
  });

  it('rejects invalid UTF-8 framing and resumes on the next line', () => {
    const invalid = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":50,"method":"pi'), Buffer.from([0xff]), Buffer.from('ng"}\n')]);
    const valid = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 51, method: 'ping' })}\n`);
    expect(exchangeBytes(Buffer.concat([invalid, valid]))).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { jsonrpc: '2.0', id: 51, result: {} },
    ]);
  });

  it('negotiates one fixed protocol and publishes bounded strict tool schemas', () => {
    const responses = exchange([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2099-01-01' } }),
    ]);
    expect(responses[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'nexyfab-remote', version: '1.1.0' } } });
    const tools = responses[1]!.result!.tools as Array<{ name: string; inputSchema: { additionalProperties?: boolean } }>;
    expect(tools).toHaveLength(15);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    expect(tools.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
    const publicTool = tools.find(tool => tool.name === 'code_check') as { annotations?: Record<string, unknown>; inputSchema: { properties?: Record<string, unknown> } };
    const consequentialTool = tools.find(tool => tool.name === 'design_assembly') as { annotations?: Record<string, unknown>; inputSchema: { properties?: Record<string, unknown> } };
    expect(publicTool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(consequentialTool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(consequentialTool.inputSchema.properties).toHaveProperty('confirmCall');
    expect(responses[2]).toMatchObject({ id: 3, result: { protocolVersion: '2025-03-26' } });
  });

  it('supports modern server discovery and requires its protocol metadata thereafter', () => {
    const protocolMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const responses = exchange([
      JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'code_check', arguments: { list: true } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'server/discover', params: { _meta: { ...protocolMeta, 'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tools/list', params: { _meta: protocolMeta } }),
      JSON.stringify({ jsonrpc: '2.0', id: 32, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 33, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 34, method: 'server/discover', params: { _meta: protocolMeta } }),
    ]);
    expect(responses[0]).toMatchObject({
      id: 30,
      result: {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-remote', version: '1.1.0' } },
      },
    });
    expect((responses[1]!.result!.tools as unknown[])).toHaveLength(15);
    expect(responses[1]).toMatchObject({ result: { resultType: 'complete', ttlMs: 60_000, cacheScope: 'private', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'nexyfab-remote', version: '1.1.0' } } } });
    expect(responses[2]).toEqual({ jsonrpc: '2.0', id: 32, error: { code: -32602, message: 'invalid params' } });
    expect(responses[3]).toEqual({ jsonrpc: '2.0', id: 33, error: { code: -32602, message: 'invalid params' } });
    expect(responses[4]).toEqual({ jsonrpc: '2.0', id: 34, error: { code: -32602, message: 'invalid params' } });
  });

  it('returns canonical errors and never answers notifications', () => {
    const responses = exchange([
      '{bad json',
      JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
      JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: [] }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'unknown', params: {} }),
    ]);
    expect(responses).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'invalid request' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'invalid params' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'method not found' } },
    ]);
  });

  it('fails closed on a private call until explicit approval, before API-key or network work', () => {
    const [response] = exchange([
      JSON.stringify({ jsonrpc: '2.0', id: 'call-1', method: 'tools/call', params: { name: 'design_assembly', arguments: { description: 'test' } } }),
    ]);
    expect(response).toMatchObject({ id: 'call-1', result: { isError: true, content: [{ type: 'text', text: 'ERROR: REMOTE_CALL_APPROVAL_REQUIRED' }] } });
    expect(JSON.stringify(response)).not.toContain('nf_live_');
  });

  it('accepts approval metadata in the schema but never forwards it to the remote body', () => {
    // This is a contract-level check; the no-key path proves the approval is
    // consumed before the API-key gate and therefore cannot leak into a body.
    const [response] = exchange([
      JSON.stringify({ jsonrpc: '2.0', id: 'call-2', method: 'tools/call', params: { name: 'design_assembly', arguments: { description: 'test', confirmCall: true } } }),
    ]);
    expect(response).toMatchObject({ id: 'call-2', result: { isError: true, content: [{ type: 'text', text: 'ERROR: TOOL_CALL_FAILED' }] } });
  });

  it('rejects unknown tools and invalid schemas before any remote fetch', () => {
    const deep = { value: { value: { value: { value: { value: { value: { value: { value: { value: { value: true } } } } } } } } } };
    const responses = exchange([
      JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } }),
      JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'code_check', arguments: { list: 'yes' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'part_op', arguments: { op: 'delete' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'code_check', arguments: { list: true, unexpected: true } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'code_check', arguments: { features: deep } } }),
      '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"code_check","arguments":{"__proto__":{"polluted":true}}}}',
    ]);
    expect(responses).toHaveLength(6);
    expect(responses[0]!.error?.code).toBe(-32602);
    expect(responses.slice(1).every(response => response.result?.isError === true)).toBe(true);
    expect(responses.slice(1).every(response => JSON.stringify(response).includes('INVALID_TOOL_ARGUMENTS'))).toBe(true);
  });

  it('enforces bounded arrays and strings before private-tool authorization', () => {
    const responses = exchange([
      JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'part_op', arguments: { assembly: {}, op: 'delete', partIds: Array.from({ length: 101 }, () => 'part') } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'design_assembly', arguments: { description: 'x'.repeat(256 * 1024 + 1) } } }),
    ]);
    expect(responses).toHaveLength(2);
    expect(responses.every(response => response.result?.isError === true)).toBe(true);
  });
});
