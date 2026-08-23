import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotDriveDutyThermalBytes } from '@/lib/ai/robot/robotDriveDutyThermal';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-thermal-evaluate:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 7_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const dynamicReport = form?.get('dynamicReport');
  const thermalInput = form?.get('thermalInput');
  if (!(dynamicReport instanceof File) || !(thermalInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'dynamicReport and thermalInput files are required' }, { status: 400 });
  if (dynamicReport.size < 1 || dynamicReport.size > 5_000_000 || thermalInput.size < 1 || thermalInput.size > 1_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotDriveDutyThermalBytes(new Uint8Array(await dynamicReport.arrayBuffer()), new Uint8Array(await thermalInput.arrayBuffer()));
  return NextResponse.json({ ok: report.thermalReady, report, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.thermalReady ? 200 : 422 });
}
