import { NextRequest, NextResponse } from 'next/server';
import { verifyGearboxFamilyContractBytes } from '@/lib/ai/familyContracts/gearbox/gearboxContract';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_GEARBOX_MULTIPART_BYTES = 150_000_000 + 2 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-system-gearbox-verify:${ip}`, 2, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const { form, tooLarge } = await readBoundedMultipartForm(req, MAX_GEARBOX_MULTIPART_BYTES);
  if (tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const graph = form?.get('graph'), contract = form?.get('contract'), uploaded = form?.getAll('artifact') ?? [];
  if (!(graph instanceof File) || !(contract instanceof File) || !uploaded.length || uploaded.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'graph, gearbox contract and artifact files are required' }, { status: 400 });
  const artifacts = uploaded as File[], total = graph.size + contract.size + artifacts.reduce((sum, file) => sum + file.size, 0);
  if (graph.size < 1 || graph.size > 10_000_000 || contract.size < 1 || contract.size > 10_000_000 || artifacts.length > 256 || artifacts.some(file => file.size < 1 || file.size > 50_000_000) || total > 150_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  if (new Set(artifacts.map(file => file.name)).size !== artifacts.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const artifactMap = new Map(await Promise.all(artifacts.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = verifyGearboxFamilyContractBytes(new Uint8Array(await graph.arrayBuffer()), new Uint8Array(await contract.arrayBuffer()), artifactMap);
  return NextResponse.json({ ok: report.familyContractReady, report, releaseReady: false, physicalValidationRequired: true, finalExpertReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.familyContractReady ? 200 : 422 });
}
