import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotTcpPositionErrorBudgetBytes } from '@/lib/ai/robot/robotTcpPositionErrorBudget';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-precision-evaluate:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 5_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const requirements = form?.get('requirements');
  const precisionInput = form?.get('precisionInput');
  if (!(requirements instanceof File) || !(precisionInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements and precisionInput files are required' }, { status: 400 });
  if (requirements.size < 1 || requirements.size > 2_000_000 || precisionInput.size < 1 || precisionInput.size > 2_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotTcpPositionErrorBudgetBytes(new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await precisionInput.arrayBuffer()));
  return NextResponse.json({ ok: report.precisionBudgetReady, report, releaseReady: false, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.precisionBudgetReady ? 200 : 422 });
}
