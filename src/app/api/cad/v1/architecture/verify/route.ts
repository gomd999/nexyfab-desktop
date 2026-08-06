import { NextRequest, NextResponse } from 'next/server';
import { validateArchitectureDocument, type ArchitectureDocument } from '@/lib/ai/architectureInteriorDocuments';
import { verifyArchitectureTopology } from '@/lib/ai/architectureTopologyVerification';
import { verifyArchitecturalCirculation, type ArchitecturalCirculationModel, type CirculationRules } from '@/lib/ai/architecturalCirculation';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-architecture-verify:${ip}`, 60, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const body = await req.json().catch(() => null) as { architecture?: ArchitectureDocument; circulation?: ArchitecturalCirculationModel; rules?: CirculationRules; topologyToleranceMm?: number } | null;
  if (!body?.architecture) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'architecture is required' }, { status: 400 });
  const semanticIssues = validateArchitectureDocument(body.architecture);
  if (semanticIssues.length) return NextResponse.json({ ok: false, code: 'INVALID_ARCHITECTURE', semanticIssues, releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
  const topology = verifyArchitectureTopology(body.architecture, body.topologyToleranceMm);
  const circulation = body.circulation ? verifyArchitecturalCirculation(body.circulation, body.rules) : { status: 'not_run' as const, failures: [{ objectId: 'project', code: 'CIRCULATION_MODEL_MISSING' }], method: 'governed_semantic_dimensions' as const };
  const releaseReady = topology.releaseReady && circulation.status === 'passed';
  return NextResponse.json({ ok: true, releaseReady, topology, circulation, quoteOrRfqSideEffects: false });
}
