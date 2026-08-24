import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assessDomainAccuracy } from './contract.mjs';
import { buildAiHealth } from './health.mjs';

const HEALTH_ROUTES = new Map([
  ['/health/live', 'live'],
  ['/health/ready', 'ready'],
  ['/health/release', 'release'],
]);

class HttpRequestError extends Error {
  constructor(statusCode, code) {
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
  const mediaType = String(request.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
    throw new HttpRequestError(415, 'content_type_must_be_application_json');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1048576) throw new HttpRequestError(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpRequestError(400, 'contract_input_invalid');
  }
}

function contractErrorResponse(error) {
  if (error instanceof HttpRequestError) {
    return { statusCode: error.statusCode, code: error.message };
  }
  if (error instanceof TypeError && /^DOMAIN_ACCURACY_[A-Z_]+:/.test(error.message)) {
    return { statusCode: 400, code: error.message };
  }
  return { statusCode: 400, code: 'contract_input_invalid' };
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

export function createAiServer(env = process.env, now = () => new Date(), fetcher = globalThis.fetch) {
  const server = http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = new URL(request.url ?? '/', 'http://slice.local').pathname.replace(/\/$/, '') || '/';
    const phase = HEALTH_ROUTES.get(pathname);
    if (phase && (method === 'GET' || method === 'HEAD')) {
      const payload = await buildAiHealth(phase, env, now(), fetcher);
      sendJson(response, payload.status === 'ok' ? 200 : 503, payload, method === 'HEAD');
      return;
    }
    if (pathname === '/contract/assess' && method === 'POST') {
      const authentication = authenticated(request, env);
      if (authentication !== 'PASS') {
        sendJson(response, authentication === 'UNCONFIGURED' ? 503 : 401, {
          error: authentication === 'UNCONFIGURED' ? 'internal_auth_not_configured' : 'internal_auth_failed',
        });
        return;
      }
      try {
        const input = await readJson(request);
        sendJson(response, 200, assessDomainAccuracy(input));
      } catch (error) {
        const failure = contractErrorResponse(error);
        sendJson(response, failure.statusCode, { error: failure.code });
      }
      return;
    }
    sendJson(response, phase || pathname === '/contract/assess' ? 405 : 404, {
      error: phase || pathname === '/contract/assess' ? 'method_not_allowed' : 'not_found',
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
  createAiServer().listen(port, host, () => {
    process.stdout.write(`AI domain-accuracy slice listening on ${host}:${port}\n`);
  });
}
