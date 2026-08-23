import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createBoundedLineReader } from './mcp-stdio-transport.mjs';

type Rpc = { jsonrpc: string; id: string | number | null; result?: Record<string, unknown>; error?: { code: number; message: string } };

function exchange(server: string, lines: Array<string | Record<string, unknown>>): Rpc[] {
  const input = lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [resolve(server)], { cwd: process.cwd(), input, encoding: 'utf8', timeout: 15_000, maxBuffer: 20_000_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Rpc);
}

function exchangeBytes(server: string, input: Buffer): Rpc[] {
  const result = spawnSync(process.execPath, [resolve(server)], { cwd: process.cwd(), input, timeout: 15_000, maxBuffer: 20_000_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr.toString('utf8')).toBe('');
  return result.stdout.toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Rpc);
}

const servers = ['scripts/engineering-core/mcp-server.mjs', 'scripts/drawing-to-3d/mcp-server.mjs'];
const modernMeta = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };

describe('local MCP stdio dual-era transport', () => {
  it('frames byte-bounded UTF-8 lines across chunks and discards each oversized frame once', async () => {
    const input = new PassThrough();
    const lines: string[] = [];
    let oversized = 0;
    createBoundedLineReader({
      input,
      maxBytes: 7,
      onLine: (line) => lines.push(Buffer.from(line).toString('utf8')),
      onOversizedLine: () => { oversized += 1; },
    });
    input.write(Buffer.from([0xe2]));
    input.write(Buffer.from([0x82, 0xac, 0x0d]));
    input.write(Buffer.from([0x0a]));
    input.write(Buffer.from('1234567\r'));
    input.write(Buffer.from('\n12345678\n'));
    input.end();
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines).toEqual(['€', '1234567']);
    expect(oversized).toBe(1);
  });

  it.each(servers)('negotiates bounded legacy versions and rejects arbitrary echo (%s)', (server) => {
    const responses = exchange(server, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'no/such-method' },
    ]);
    expect(responses[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } });
    expect(responses[1]).toMatchObject({ id: 2, result: {} });
    expect(responses[2]).toMatchObject({ id: 3, error: { code: -32601, message: 'method not found' } });
  });

  it.each(servers)('supports modern discovery/direct requests and fixed-era metadata (%s)', (server) => {
    const discovered = exchange(server, [
      { jsonrpc: '2.0', id: 10, method: 'server/discover', params: { _meta: { ...modernMeta._meta, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } },
      { jsonrpc: '2.0', id: 11, method: 'tools/list', params: modernMeta },
      { jsonrpc: '2.0', id: 12, method: 'ping' },
    ]);
    expect(discovered[0]).toMatchObject({ id: 10, result: { resultType: 'complete', supportedVersions: ['2026-07-28'], ttlMs: 60_000, cacheScope: 'private', _meta: { 'io.modelcontextprotocol/serverInfo': expect.any(Object) } } });
    expect(discovered[1]).toMatchObject({ id: 11, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': expect.any(Object) } } });
    expect(discovered[2]).toMatchObject({ id: 12, error: { code: -32602, message: 'invalid params' } });

    const direct = exchange(server, [{ jsonrpc: '2.0', id: 13, method: 'ping', params: modernMeta }]);
    expect(direct[0]).toMatchObject({ id: 13, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': expect.any(Object) } } });

    const incompleteDiscovery = exchange(server, [{ jsonrpc: '2.0', id: 14, method: 'server/discover', params: modernMeta }]);
    expect(incompleteDiscovery[0]).toMatchObject({ id: 14, error: { code: -32602, message: 'invalid params' } });
  });

  it.each(servers)('keeps notifications silent and returns canonical framing errors (%s)', (server) => {
    const responses = exchange(server, [
      { jsonrpc: '2.0', method: 'ping' },
      '{not-json',
      { jsonrpc: '2.0', id: 20, method: 'ping', params: [] },
      { jsonrpc: '2.0', id: 21, method: 'no/such-method' },
    ]);
    expect(responses).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { jsonrpc: '2.0', id: 20, error: { code: -32600, message: 'invalid request' } },
      { jsonrpc: '2.0', id: 21, error: { code: -32601, message: 'method not found' } },
    ]);
  });

  it.each(servers)('rejects invalid UTF-8 frames and recovers on the next line (%s)', (server) => {
    const invalid = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":19,"method":"pi'), Buffer.from([0xff]), Buffer.from('ng"}\n')]);
    const valid = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'ping' })}\n`);
    expect(exchangeBytes(server, Buffer.concat([invalid, valid]))).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { jsonrpc: '2.0', id: 20, result: {} },
    ]);
  });

  it.each(servers)('does not let id-less requests execute or change the protocol era (%s)', (server) => {
    const responses = exchange(server, [
      { jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'eng_list_standards', arguments: {} } },
      { jsonrpc: '2.0', id: 24, method: 'ping', params: modernMeta },
    ]);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ id: 24, result: { resultType: 'complete' } });
  });

  it.each(servers)('rejects unsupported modern versions and keeps errors canonical (%s)', (server) => {
    const [response] = exchange(server, [{ jsonrpc: '2.0', id: 22, method: 'ping', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } }]);
    expect(response).toMatchObject({ id: 22, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: '2099-01-01' } } });
    expect(response).not.toHaveProperty('_meta');
  });

  it.each(servers)('does not negotiate the modern protocol through legacy initialize (%s)', (server) => {
    const [response] = exchange(server, [{ jsonrpc: '2.0', id: 23, method: 'initialize', params: { protocolVersion: '2026-07-28' } }]);
    expect(response).toMatchObject({ id: 23, result: { protocolVersion: '2025-11-25' } });
  });

  it.each(servers)('enforces the line cap without leaking internals (%s)', (server) => {
    const responses = exchange(server, [`{"jsonrpc":"2.0","id":30,"method":"ping","params":{"x":"${'x'.repeat(1_100_000)}"}}`]);
    expect(responses).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }]);
    expect(JSON.stringify(responses)).not.toMatch(/stack|Error:|node_modules/i);
  });

  it('marks drawing tool input validation as an MCP tool error', () => {
    const [response] = exchange('scripts/drawing-to-3d/mcp-server.mjs', [{ jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'code_check', arguments: { list: 'yes' } } }]);
    expect(response).toMatchObject({ id: 40, result: { isError: true, content: [{ text: 'ERROR: INVALID_TOOL_ARGUMENTS' }] } });
  });

  it('returns unknown tools as invalid params and sanitizes engineering tool failures', () => {
    const responses = exchange('scripts/engineering-core/mcp-server.mjs', [
      { jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: '__unknown__', arguments: {} } },
      { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'eng_rag_search', arguments: {} } },
    ]);
    expect(responses[0]).toMatchObject({ id: 41, error: { code: -32602, message: 'invalid params' } });
    expect(responses[1]).toMatchObject({ id: 42, result: { isError: true, content: [{ text: 'ERROR: INVALID_TOOL_ARGUMENTS' }] } });
    expect(JSON.stringify(responses)).not.toMatch(/file:|node_modules|at /i);
  });
});
