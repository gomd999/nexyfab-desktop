import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotEngineeringCoverageMatrix } from '@/lib/ai/robot/robotEngineeringCoverageMatrix';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-engineering-coverage:${ip}`, 1, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 110_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const requirements = form?.get('requirements');
  const manifest = form?.get('manifest');
  const uploaded = form?.getAll('artifact') ?? [];
  if (!(requirements instanceof File) || !(manifest instanceof File) || !uploaded.length || uploaded.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements, manifest and artifact files are required' }, { status: 400 });
  const artifactFiles = uploaded as File[];
  const totalBytes = artifactFiles.reduce((sum, file) => sum + file.size, 0);
  if (requirements.size < 1 || requirements.size > 2_000_000 || manifest.size < 1 || manifest.size > 2_000_000 || artifactFiles.length > 1_536 || artifactFiles.some(file => file.size < 1 || file.size > 5_000_000) || totalBytes > 100_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const names = artifactFiles.map(file => file.name);
  if (new Set(names).size !== names.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const artifacts = new Map(await Promise.all(artifactFiles.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = evaluateRobotEngineeringCoverageMatrix(new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await manifest.arrayBuffer()), artifacts);
  return NextResponse.json({ ok: report.coverageReady, report, releaseReady: false, externalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.coverageReady ? 200 : 422 });
}
