import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotCableLifeSweepBytes } from '@/lib/ai/robot/robotCableLifeSweep';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-cable-life:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 64_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const requirements = form?.get('requirements');
  const motionReport = form?.get('motionReport');
  const cableInput = form?.get('cableInput');
  if (!(requirements instanceof File) || !(motionReport instanceof File) || !(cableInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements, motionReport and cableInput files are required' }, { status: 400 });
  if (requirements.size < 1 || requirements.size > 2_000_000 || motionReport.size < 1 || motionReport.size > 10_000_000 || cableInput.size < 1 || cableInput.size > 50_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotCableLifeSweepBytes(new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await motionReport.arrayBuffer()), new Uint8Array(await cableInput.arrayBuffer()));
  return NextResponse.json({ ok: report.cableLifeReady, report, releaseReady: false, physicalFlexValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.cableLifeReady ? 200 : 422 });
}
