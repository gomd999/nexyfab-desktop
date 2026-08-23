import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createXcafWorker, XcafWorkerError } from './workerClient';

const port = Number(process.env.PORT ?? 8080);
const nativeFile = process.env.OCCT_XCAF_NATIVE_BIN ?? '/opt/occt-xcaf/bin/occt-xcaf-inspect';
const maxBytes = Number(process.env.OCCT_XCAF_MAX_INPUT_BYTES ?? 64 * 1024 * 1024);
const worker = createXcafWorker({
  nativeCommand: { file: nativeFile },
  inputRoot: process.env.OCCT_XCAF_INPUT_ROOT,
  maxBytes,
  defaultTimeoutMs: Number(process.env.OCCT_XCAF_TIMEOUT_MS ?? 120_000),
});

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

async function body(request: IncomingMessage, maximum: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximum) throw new XcafWorkerError('REQUEST_TOO_LARGE', 'request body exceeds the configured limit', 413);
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new XcafWorkerError('REQUEST_JSON_INVALID', 'request body must be valid JSON', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new XcafWorkerError('REQUEST_JSON_INVALID', 'request body must be a JSON object', 400);
  return parsed as Record<string, unknown>;
}

export function createXcafRequestHandler(activeWorker = worker, requestMaximum = maxBytes) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && requestUrl.pathname === '/health/live') {
        json(response, 200, { ok: true, service: 'occt-xcaf', schema: 'nexyfab.occt-xcaf.health.v1' });
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/capabilities') {
        json(response, 200, await activeWorker.capabilities());
        return;
      }
      if (request.method !== 'POST' || requestUrl.pathname !== '/v1/inspect') {
        json(response, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      const input = await body(request, requestMaximum * 2 + 16_384);
      const base64 = typeof input.inputBase64 === 'string' ? input.inputBase64 : undefined;
      if (base64 && (base64.length > Math.ceil(requestMaximum / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))) {
        throw new XcafWorkerError('INPUT_BASE64_INVALID', 'inputBase64 is malformed or too large', 400);
      }
      const inputBytes = base64 ? Buffer.from(base64, 'base64') : undefined;
      const result = await activeWorker.inspect({
        inputBytes,
        inputPath: typeof input.inputPath === 'string' ? input.inputPath : undefined,
        sha256: typeof input.sha256 === 'string' ? input.sha256 : undefined,
        timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
      });
      json(response, 200, result);
    } catch (error) {
      const failure = error instanceof XcafWorkerError
        ? error
        : new XcafWorkerError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      json(response, failure.httpStatus, { ok: false, code: failure.code, error: failure.message });
    }
  };
}

if (process.env.NODE_ENV !== 'test') {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT_INVALID');
  createServer(createXcafRequestHandler()).listen(port, '0.0.0.0', () => {
    process.stdout.write(`occt-xcaf listening on ${port}\n`);
  });
}
