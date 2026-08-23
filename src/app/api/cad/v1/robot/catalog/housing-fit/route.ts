import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotHousingFitEvidence } from '@/lib/ai/robot/robotHousingFitEvidence';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-catalog-housing-fit:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 258_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const housing = form?.get('housing'); const requirements = form?.get('requirements'); const manifest = form?.get('manifest'); const artifacts = form?.getAll('artifact') ?? [];
  if (!(housing instanceof File) || !(requirements instanceof File) || !(manifest instanceof File) || artifacts.length < 1 || artifacts.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'housing, requirements, manifest and artifact files are required' }, { status: 400 });
  const files = artifacts as File[]; const total = files.reduce((sum, file) => sum + file.size, 0);
  if (housing.size < 1 || housing.size > 1_000_000 || requirements.size < 1 || requirements.size > 1_000_000 || manifest.size < 1 || manifest.size > 2_000_000 || files.length > 25 || files.some(file => file.size < 1 || file.size > 100_000_000) || total > 250_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotHousingFitEvidence(new Uint8Array(await housing.arrayBuffer()), new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await manifest.arrayBuffer()), await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))));
  return NextResponse.json({ ok: report.housingStatus === 'passed', report, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.housingStatus === 'passed' ? 200 : 422 });
}
