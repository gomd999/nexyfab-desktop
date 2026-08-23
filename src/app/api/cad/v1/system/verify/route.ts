import { NextRequest, NextResponse } from 'next/server';
import { verifyComplexSystemGraphBytes } from '@/lib/ai/complexSystemGraph';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_SYSTEM_VERIFY_MULTIPART_BYTES = 150_000_000 + 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-system-verify:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const { form, tooLarge } = await readBoundedMultipartForm(req, MAX_SYSTEM_VERIFY_MULTIPART_BYTES);
  if (tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const graph = form?.get('graph'), uploaded = form?.getAll('artifact') ?? [];
  if (!(graph instanceof File) || !uploaded.length || uploaded.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'graph and artifact files are required' }, { status: 400 });
  const artifacts = uploaded as File[], total = graph.size + artifacts.reduce((sum, file) => sum + file.size, 0);
  if (graph.size < 1 || graph.size > 10_000_000 || artifacts.length > 256 || artifacts.some(file => file.size < 1 || file.size > 50_000_000) || total > 150_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  if (new Set(artifacts.map(file => file.name)).size !== artifacts.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const artifactMap = new Map(await Promise.all(artifacts.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = verifyComplexSystemGraphBytes(new Uint8Array(await graph.arrayBuffer()), artifactMap);
  return NextResponse.json({ ok: report.graphReady, report, releaseReady: false, familyContractRequired: true, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.graphReady ? 200 : 422 });
}
