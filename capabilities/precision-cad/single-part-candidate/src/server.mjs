import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluateMechanicalSinglePartSourceRuns } from './contract.mjs';
import { buildPrecisionHealth } from './health.mjs';

const HEALTH_ROUTES = new Map([
  ['/health/live', 'live'],
  ['/health/ready', 'ready'],
  ['/health/release', 'release'],
]);
const MAX_JSON_BYTES = 256 * 1024;

class RequestInputError extends Error {
  constructor(code, statusCode) {
    super(code);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload, headOnly = false) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(headOnly ? undefined : body);
}

async function readJson(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestInputError('content_type_must_be_application_json', 415);
  const declaredBytes = Number.parseInt(request.headers['content-length'] ?? '', 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_JSON_BYTES) {
    throw new RequestInputError('request_too_large', 413);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) throw new RequestInputError('request_too_large', 413);
    chunks.push(chunk);
  }
  if (bytes === 0) throw new RequestInputError('request_body_required', 400);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestInputError('invalid_json', 400);
  }
}

function authenticated(request, env) {
  const token = env.INTERNAL_AUTH_TOKEN?.trim() ?? '';
  if (token.length < 32) return 'UNCONFIGURED';
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.authorization ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? 'PASS' : 'DENY';
}

function requestTimeout(env) {
  const value = Number.parseInt(env.NEXYFAB_REQUEST_TIMEOUT_MS ?? '5000', 10);
  return Number.isInteger(value) && value >= 1000 && value <= 30000 ? value : 5000;
}

export function createPrecisionServer(env = process.env, now = () => new Date(), fetcher = globalThis.fetch) {
  const server = http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = new URL(request.url ?? '/', 'http://slice.local').pathname.replace(/\/$/, '') || '/';
    const phase = HEALTH_ROUTES.get(pathname);
    if (phase && (method === 'GET' || method === 'HEAD')) {
      const payload = await buildPrecisionHealth(phase, env, now(), fetcher);
      sendJson(response, payload.status === 'ok' ? 200 : 503, payload, method === 'HEAD');
      return;
    }
    if (pathname === '/contract/source-runs' && method === 'POST') {
      const authentication = authenticated(request, env);
      if (authentication !== 'PASS') {
        sendJson(response, authentication === 'UNCONFIGURED' ? 503 : 401, {
          error: authentication === 'UNCONFIGURED' ? 'internal_auth_not_configured' : 'internal_auth_failed',
        });
        return;
      }
      try {
        const input = await readJson(request);
        if (typeof input.feature !== 'string' || !Array.isArray(input.runs)) {
          throw new RequestInputError('contract_input_invalid', 422);
        }
        sendJson(response, 200, evaluateMechanicalSinglePartSourceRuns(input.feature, input.runs));
      } catch (error) {
        sendJson(response, error instanceof RequestInputError ? error.statusCode : 400, {
          error: error instanceof RequestInputError ? error.message : 'contract_input_invalid',
        });
      }
      return;
    }
    sendJson(response, phase || pathname === '/contract/source-runs' ? 405 : 404, {
      error: phase || pathname === '/contract/source-runs' ? 'method_not_allowed' : 'not_found',
    });
  });
  server.requestTimeout = requestTimeout(env);
  server.headersTimeout = requestTimeout(env);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID');
  createPrecisionServer().listen(port, host, () => {
    process.stdout.write(`precision single-part candidate slice listening on ${host}:${port}\n`);
  });
}
