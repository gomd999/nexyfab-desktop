import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotBearingReducerLifeBytes } from '@/lib/ai/robot/robotBearingReducerLife';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-life-evaluate:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 8_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const dynamicReport = form?.get('dynamicReport');
  const lifeInput = form?.get('lifeInput');
  if (!(dynamicReport instanceof File) || !(lifeInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'dynamicReport and lifeInput files are required' }, { status: 400 });
  if (dynamicReport.size < 1 || dynamicReport.size > 5_000_000 || lifeInput.size < 1 || lifeInput.size > 2_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotBearingReducerLifeBytes(new Uint8Array(await dynamicReport.arrayBuffer()), new Uint8Array(await lifeInput.arrayBuffer()));
  return NextResponse.json({ ok: report.lifeReady, report, releaseReady: false, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.lifeReady ? 200 : 422 });
}
