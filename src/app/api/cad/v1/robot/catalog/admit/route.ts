import { NextRequest, NextResponse } from 'next/server';
import { admitRobotCatalogBytes } from '@/lib/ai/robot/robotCatalogAdmission';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_ARTIFACTS = 25;
const MAX_ARTIFACT_BYTES = 100_000_000;
const MAX_TOTAL_ARTIFACT_BYTES = 250_000_000;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-catalog-admit:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 256_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'artifact byte limits exceeded' }, { status: 413 });
  const form = multipart.form;
  const manifest = form?.get('manifest'); const artifacts = form?.getAll('artifact') ?? [];
  if (!(manifest instanceof File) || artifacts.length < 1 || artifacts.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'one manifest and at least one artifact file are required' }, { status: 400 });
  if (manifest.size < 1 || manifest.size > MAX_MANIFEST_BYTES || artifacts.length > MAX_ARTIFACTS) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'manifest or artifact count exceeds admission limits' }, { status: 413 });
  const files = artifacts as File[];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (files.some(file => file.size < 1 || file.size > MAX_ARTIFACT_BYTES) || totalBytes > MAX_TOTAL_ARTIFACT_BYTES) return NextResponse.json({ ok: false, code: 'TOO_LARGE', message: 'artifact byte limits exceeded' }, { status: 413 });
  const report = admitRobotCatalogBytes(new Uint8Array(await manifest.arrayBuffer()), await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))));
  return NextResponse.json({ ok: report.valid, report, productionEligible: report.productionEligible, quoteOrRfqSideEffects: false }, { status: report.valid ? 200 : 422 });
}
