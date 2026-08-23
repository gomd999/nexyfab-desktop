import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotEngineeringAnalysisPacket, type RobotEngineeringAnalysisPacketFiles } from '@/lib/ai/robot/robotEngineeringAnalysisPacket';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMITS: Record<keyof RobotEngineeringAnalysisPacketFiles, number> = {
  requirements: 2_000_000,
  dynamicInput: 5_000_000,
  dynamicReport: 5_000_000,
  thermalInput: 2_000_000,
  lifeInput: 3_000_000,
  complianceInput: 3_000_000,
  precisionInput: 3_000_000,
};

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-engineering-analyze:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 25_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  if (!form) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const entries = Object.keys(LIMITS) as Array<keyof RobotEngineeringAnalysisPacketFiles>;
  const uploaded = Object.fromEntries(entries.map(key => [key, form.get(key)])) as Record<keyof RobotEngineeringAnalysisPacketFiles, FormDataEntryValue | null>;
  if (entries.some(key => !(uploaded[key] instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: `required files: ${entries.join(', ')}` }, { status: 400 });
  if (entries.some(key => (uploaded[key] as File).size < 1 || (uploaded[key] as File).size > LIMITS[key])) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const files = Object.fromEntries(await Promise.all(entries.map(async key => [key, new Uint8Array(await (uploaded[key] as File).arrayBuffer())]))) as RobotEngineeringAnalysisPacketFiles;
  const report = evaluateRobotEngineeringAnalysisPacket(files);
  return NextResponse.json({ ok: report.engineeringAnalysisReady, report, releaseReady: false, externalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.engineeringAnalysisReady ? 200 : 422 });
}
