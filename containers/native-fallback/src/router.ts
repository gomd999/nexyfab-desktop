import { timingSafeEqual } from 'node:crypto';
import { validateCadJobComputeRequest, validateCadJobReceipt, type CadJobComputeRequest } from '../../../packages/job-contracts/src/index';

export interface NativeFallbackEnv {
  computeSharedSecret: string;
  upstreamSharedSecret: string;
  exactOrigin?: string;
  openscadOrigin?: string;
  feaOrigin?: string;
  interopOrigin?: string;
  fetchImpl?: typeof fetch;
}

function sameSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return expected.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

function target(request: CadJobComputeRequest, env: NativeFallbackEnv): string | undefined {
  if (request.message.kind === 'EXACT_BREP_BUILD' || request.message.kind === 'EXACT_CLASH') return env.exactOrigin;
  if (request.message.kind === 'OPENSCAD_RENDER') return env.openscadOrigin;
  if (request.message.kind === 'FEA_SOLVE') return env.feaOrigin;
  return env.interopOrigin;
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export function createNativeFallbackRouter(env: NativeFallbackEnv) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') return json(200, {
      ok: true, service: 'native-fallback', execution: 'NOT_RUN',
      routes: {
        exact: Boolean(env.exactOrigin), openscad: Boolean(env.openscadOrigin),
        fea: Boolean(env.feaOrigin), interop: Boolean(env.interopOrigin),
      },
    });
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!sameSecret(env.computeSharedSecret, supplied)) return json(403, { ok: false, code: 'FORBIDDEN' });
    if (request.method !== 'POST' || url.pathname !== '/v1/jobs') return json(404, { ok: false, code: 'NOT_FOUND' });
    let body: CadJobComputeRequest;
    try { body = await request.json() as CadJobComputeRequest; }
    catch { return json(400, { ok: false, code: 'INVALID_JSON' }); }
    const issues = validateCadJobComputeRequest(body);
    if (issues.length) return json(422, { ok: false, code: 'COMPUTE_REQUEST_REJECTED', issues });
    const origin = target(body, env)?.replace(/\/$/, '');
    if (!origin) return json(503, { ok: false, code: 'FALLBACK_TARGET_NOT_CONFIGURED', execution: 'NOT_RUN' });
    const upstream = await (env.fetchImpl ?? fetch)(`${origin}/v1/jobs`, {
      method: 'POST', headers: { authorization: `Bearer ${env.upstreamSharedSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: request.signal,
    });
    const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) return json(upstream.status, payload);
    const receiptIssues = payload.receipt ? validateCadJobReceipt(payload.receipt as never) : ['compute_receipt_required'];
    if (receiptIssues.length) return json(502, { ok: false, code: 'FALLBACK_RECEIPT_REJECTED', issues: receiptIssues });
    return json(200, payload);
  };
}
