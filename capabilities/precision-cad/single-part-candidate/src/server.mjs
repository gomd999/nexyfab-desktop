import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { evaluateMechanicalSinglePartSourceRuns } from './contract.mjs';
import { buildPrecisionHealth } from './health.mjs';

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
    if (bytes > 262144) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createPrecisionServer(env = process.env, now = () => new Date()) {
  return http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = new URL(request.url ?? '/', 'http://slice.local').pathname.replace(/\/$/, '') || '/';
    const phase = HEALTH_ROUTES.get(pathname);
    if (phase && (method === 'GET' || method === 'HEAD')) {
      const payload = buildPrecisionHealth(phase, env, now());
      sendJson(response, payload.status === 'ok' ? 200 : 503, payload, method === 'HEAD');
      return;
    }
    if (pathname === '/contract/source-runs' && method === 'POST') {
      try {
        const input = await readJson(request);
        if (typeof input.feature !== 'string' || !Array.isArray(input.runs)) throw new Error('contract_input_invalid');
        sendJson(response, 200, evaluateMechanicalSinglePartSourceRuns(input.feature, input.runs));
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'contract_input_invalid' });
      }
      return;
    }
    sendJson(response, phase || pathname === '/contract/source-runs' ? 405 : 404, {
      error: phase || pathname === '/contract/source-runs' ? 'method_not_allowed' : 'not_found',
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID');
  createPrecisionServer().listen(port, host, () => {
    process.stdout.write(`precision single-part candidate slice listening on ${host}:${port}\n`);
  });
}
