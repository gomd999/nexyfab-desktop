import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildCoreApiHealth } from './health/runtime.mjs';

const ROUTES = new Map([
  ['/api/health/live', 'live'],
  ['/api/health/ready', 'ready'],
  ['/api/health/release', 'release'],
  ['/health/live', 'live'],
  ['/health/ready', 'ready'],
  ['/health/release', 'release'],
]);

function sendJson(response, statusCode, payload, headOnly = false) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(headOnly ? undefined : body);
}

export function createCoreApiServer(env = process.env, now = () => new Date()) {
  return http.createServer((request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(response, 405, { error: 'method_not_allowed' }, method === 'HEAD');
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://slice.local').pathname.replace(/\/$/, '') || '/';
    const phase = ROUTES.get(pathname);
    if (!phase) {
      sendJson(response, 404, { error: 'not_found' }, method === 'HEAD');
      return;
    }
    const payload = buildCoreApiHealth(phase, env, now());
    sendJson(response, payload.status === 'ok' ? 200 : 503, payload, method === 'HEAD');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID');
  createCoreApiServer().listen(port, host, () => {
    process.stdout.write(`core-api slice listening on ${host}:${port}\n`);
  });
}
