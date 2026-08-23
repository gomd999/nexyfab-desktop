import { NextRequest, NextResponse } from 'next/server';
import { parseTrustedRobotPhysicalValidationKeys, verifyRobotPhysicalValidationReceipt } from '@/lib/ai/robot/robotPhysicalValidationReceipt';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-physical-verify:${ip}`, 2, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 255_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const engineeringCoverage = form?.get('engineeringCoverage');
  const motionCoverage = form?.get('motionCoverage');
  const cableLife = form?.get('cableLife');
  const safetyElectrical = form?.get('safetyElectrical');
  const receipt = form?.get('receipt');
  const uploaded = form?.getAll('artifact') ?? [];
  const required = [engineeringCoverage, motionCoverage, cableLife, safetyElectrical, receipt];
  if (required.some(item => !(item instanceof File)) || !uploaded.length || uploaded.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'four upstream reports, receipt and artifact files are required' }, { status: 400 });
  const files = required as File[], artifacts = uploaded as File[];
  const totalBytes = [...files, ...artifacts].reduce((sum, file) => sum + file.size, 0);
  if (files.some(file => file.size < 1 || file.size > 10_000_000) || artifacts.length > 512 || artifacts.some(file => file.size < 1 || file.size > 50_000_000) || totalBytes > 250_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const names = artifacts.map(file => file.name);
  if (new Set(names).size !== names.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const artifactMap = new Map(await Promise.all(artifacts.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = verifyRobotPhysicalValidationReceipt({ engineeringCoverage: new Uint8Array(await files[0]!.arrayBuffer()), motionCoverage: new Uint8Array(await files[1]!.arrayBuffer()), cableLife: new Uint8Array(await files[2]!.arrayBuffer()), safetyElectrical: new Uint8Array(await files[3]!.arrayBuffer()) }, new Uint8Array(await files[4]!.arrayBuffer()), artifactMap, parseTrustedRobotPhysicalValidationKeys(process.env.NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS));
  return NextResponse.json({ ok: report.physicalValidationReady, report, releaseReady: false, finalReleaseReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.physicalValidationReady ? 200 : 422 });
}
