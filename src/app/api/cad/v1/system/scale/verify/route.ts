import { NextRequest, NextResponse } from 'next/server';
import { verifyComplexAssemblyScaleBenchmarkBytes } from '@/lib/ai/complexAssemblyScaleBenchmark';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
// The platform proxy and this parser share the same 128 MiB envelope. The
// multipart parser is not incremental, so reserve 4 MiB for framing/fields and
// keep the materialized file set below 124 MiB. Larger qualification bundles
// must use direct object storage plus an isolated verifier worker before GA.
const MAX_SCALE_MULTIPART_BYTES = 128 * 1024 * 1024;
const MAX_SCALE_FILE_BYTES = 124 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!(await rateLimitAsync(`cad-v1-system-scale-verify:${ip}`, 2, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const { form, tooLarge } = await readBoundedMultipartForm(req, MAX_SCALE_MULTIPART_BYTES);
  if (tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const benchmark = form?.get('benchmark'), uploaded = form?.getAll('artifact') ?? [];
  if (!(benchmark instanceof File) || !uploaded.length || uploaded.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'benchmark and artifact files are required' }, { status: 400 });
  const artifacts = uploaded as File[], all = [benchmark, ...artifacts]; if (benchmark.size < 1 || benchmark.size > 20_000_000 || artifacts.length > 256 || all.some(file => file.size < 1 || file.size > 100_000_000) || all.reduce((sum, file) => sum + file.size, 0) > MAX_SCALE_FILE_BYTES) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  if (new Set(artifacts.map(file => file.name)).size !== artifacts.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const artifactMap = new Map<string, Uint8Array>();
  for (const file of artifacts) artifactMap.set(file.name, new Uint8Array(await file.arrayBuffer()));
  const report = verifyComplexAssemblyScaleBenchmarkBytes(new Uint8Array(await benchmark.arrayBuffer()), artifactMap);
  return NextResponse.json({ ok: report.benchmarkExecutionReady, report, releaseReady: false, independentBenchmarkApprovalRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.benchmarkExecutionReady ? 200 : 422 });
}
