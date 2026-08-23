import { z } from 'zod';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { verifyMepConnections } from '@/lib/ai/mepConnectionVerification';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { strictPhysicalNetworkModelSchema } from '@/lib/ai/mepConnectionSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const bodySchema = z.object({ network: strictPhysicalNetworkModelSchema }).strict();

export async function POST(request: Request) {
  const ip = getTrustedClientIp(request.headers);
  if (!rateLimit(`cad-v1-physical-network-verify:${ip}`, 60, 60_000).allowed) return Response.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let parsed: unknown;
  try { parsed = await readBoundedJson<unknown>(request, MAX_BODY_BYTES); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded) return Response.json({ ok: false, code: bounded.code, ...(bounded.code === 'PAYLOAD_TOO_LARGE' ? { maxBytes: MAX_BODY_BYTES } : {}) }, { status: bounded.status }); throw error; }
  const checked = bodySchema.safeParse(parsed);
  if (!checked.success) return Response.json({ ok: false, code: 'INVALID_PHYSICAL_NETWORK', issues: checked.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })), releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  const network = checked.data.network;
  const verification = verifyMepConnections(network.ports, network.nodes, network.connections, network.runs, network.rules);
  return Response.json({
    ok: true,
    networkId: network.id,
    verificationReady: verification.releaseReady,
    releaseReady: false,
    releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
    verification,
    quoteOrRfqSideEffects: false,
  });
}
