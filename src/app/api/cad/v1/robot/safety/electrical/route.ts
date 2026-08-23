import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotSafetyElectricalEvidenceBytes } from '@/lib/ai/robot/robotSafetyElectricalEvidence';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-safety-electrical:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 13_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const requirements = form?.get('requirements');
  const safetyElectricalInput = form?.get('safetyElectricalInput');
  if (!(requirements instanceof File) || !(safetyElectricalInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements and safetyElectricalInput files are required' }, { status: 400 });
  if (requirements.size < 1 || requirements.size > 2_000_000 || safetyElectricalInput.size < 1 || safetyElectricalInput.size > 10_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotSafetyElectricalEvidenceBytes(new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await safetyElectricalInput.arrayBuffer()));
  return NextResponse.json({ ok: report.designSupportReady, report, releaseReady: false, expertReviewRequired: true, physicalFaultValidationRequired: true, certificationClaimed: false, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.designSupportReady ? 200 : 422 });
}
