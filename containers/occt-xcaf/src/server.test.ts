import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createXcafRequestHandler } from './server';
import { createXcafWorker } from './workerClient';

const mock = path.join(process.cwd(), 'containers/occt-xcaf/src/mock-native.mjs');
const source = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;\n');
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('OCCT XCAF HTTP contract', () => {
  it('serves health, capabilities, and hash-bound inspect', async () => {
    const worker = createXcafWorker({ nativeCommand: { file: process.execPath, args: [mock] }, maxBytes: 1024 * 1024 });
    const server = createServer(createXcafRequestHandler(worker, 1024 * 1024));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/health/live`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'occt-xcaf' });
    const capabilities = await fetch(`${base}/capabilities`);
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ schema: 'nexyfab.occt-xcaf.capabilities.v1', nativeAvailable: true });
    const inspect = await fetch(`${base}/v1/inspect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputBase64: source.toString('base64') }),
    });
    expect(inspect.status).toBe(200);
    expect(await inspect.json()).toMatchObject({ schema: 'nexyfab.occt-xcaf.inspect-result.v1', native: { status: 'PASS_NATIVE' } });
  });

  it('rejects unsupported routes and malformed input without invoking native', async () => {
    const worker = createXcafWorker({ nativeCommand: { file: process.execPath, args: [mock] }, maxBytes: 1024 * 1024 });
    const server = createServer(createXcafRequestHandler(worker, 1024 * 1024));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const malformed = await fetch(`${base}/v1/inspect`, { method: 'POST', body: '{not-json' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ ok: false, code: 'REQUEST_JSON_INVALID' });
  });
});
