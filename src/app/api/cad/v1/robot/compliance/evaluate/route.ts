import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotStructuralComplianceBytes } from '@/lib/ai/robot/robotStructuralCompliance';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-compliance-evaluate:${ip}`, 5, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 6_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const requirements = form?.get('requirements');
  const complianceInput = form?.get('complianceInput');
  if (!(requirements instanceof File) || !(complianceInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements and complianceInput files are required' }, { status: 400 });
  if (requirements.size < 1 || requirements.size > 2_000_000 || complianceInput.size < 1 || complianceInput.size > 3_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const report = evaluateRobotStructuralComplianceBytes(new Uint8Array(await requirements.arrayBuffer()), new Uint8Array(await complianceInput.arrayBuffer()));
  return NextResponse.json({ ok: report.structuralComplianceReady, report, releaseReady: false, physicalStiffnessValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.structuralComplianceReady ? 200 : 422 });
}
