import { NextRequest, NextResponse } from 'next/server';
import { analyzeComplexSystemChangeImpactBytes } from '@/lib/ai/complexSystemChangeImpact';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_CHANGE_IMPACT_MULTIPART_BYTES = 300_000_000 + 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-system-change-impact:${ip}`, 2, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const { form, tooLarge } = await readBoundedMultipartForm(req, MAX_CHANGE_IMPACT_MULTIPART_BYTES);
  if (tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const baseGraph = form?.get('baseGraph'), targetGraph = form?.get('targetGraph'), baseUpload = form?.getAll('baseArtifact') ?? [], targetUpload = form?.getAll('targetArtifact') ?? [];
  if (!(baseGraph instanceof File) || !(targetGraph instanceof File) || !baseUpload.length || !targetUpload.length || baseUpload.some(item => !(item instanceof File)) || targetUpload.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'baseGraph, targetGraph, baseArtifact and targetArtifact files are required' }, { status: 400 });
  const baseArtifacts = baseUpload as File[], targetArtifacts = targetUpload as File[], all = [baseGraph, targetGraph, ...baseArtifacts, ...targetArtifacts];
  if (baseGraph.size < 1 || targetGraph.size < 1 || baseGraph.size > 10_000_000 || targetGraph.size > 10_000_000 || baseArtifacts.length > 256 || targetArtifacts.length > 256 || all.some(file => file.size < 1 || file.size > 50_000_000) || all.reduce((sum, file) => sum + file.size, 0) > 300_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  if (new Set(baseArtifacts.map(file => file.name)).size !== baseArtifacts.length || new Set(targetArtifacts.map(file => file.name)).size !== targetArtifacts.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const toMap = async (files: File[]) => new Map(await Promise.all(files.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = analyzeComplexSystemChangeImpactBytes(new Uint8Array(await baseGraph.arrayBuffer()), new Uint8Array(await targetGraph.arrayBuffer()), await toMap(baseArtifacts), await toMap(targetArtifacts));
  return NextResponse.json({ ok: report.impactPlanReady, report, releaseReady: false, revalidationRequired: report.revalidationRequired, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.impactPlanReady ? 200 : 422 });
}
