import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { assessDomainAccuracy } from './contract.mjs';
import { buildAiHealth } from './health.mjs';

const HEALTH_ROUTES = new Map([
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

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1048576) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAiServer(env = process.env, now = () => new Date(), fetcher = globalThis.fetch) {
  return http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = new URL(request.url ?? '/', 'http://slice.local').pathname.replace(/\/$/, '') || '/';
    const phase = HEALTH_ROUTES.get(pathname);
    if (phase && (method === 'GET' || method === 'HEAD')) {
      const payload = await buildAiHealth(phase, env, now(), fetcher);
      sendJson(response, payload.status === 'ok' ? 200 : 503, payload, method === 'HEAD');
      return;
    }
    if (pathname === '/contract/assess' && method === 'POST') {
      try {
        const input = await readJson(request);
        sendJson(response, 200, assessDomainAccuracy(input));
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'contract_input_invalid' });
      }
      return;
    }
    sendJson(response, phase || pathname === '/contract/assess' ? 405 : 404, {
      error: phase || pathname === '/contract/assess' ? 'method_not_allowed' : 'not_found',
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID');
  createAiServer().listen(port, host, () => {
    process.stdout.write(`AI domain-accuracy slice listening on ${host}:${port}\n`);
  });
}
