import { NextRequest, NextResponse } from 'next/server';
import { parseTrustedRobotExactCadKeys } from '@/lib/ai/robot/robotReleaseEvidenceAuditV2';
import { parseTrustedRobotPhysicalValidationKeys } from '@/lib/ai/robot/robotPhysicalValidationReceipt';
import { auditRobotVerifiedSystemsRelease, parseRobotVerifiedSystemsAuditSigner, type RobotVerifiedSystemsReleaseAuditFiles } from '@/lib/ai/robot/robotVerifiedSystemsReleaseAudit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const FILE_KEYS: Array<keyof RobotVerifiedSystemsReleaseAuditFiles> = ['postIntegration', 'exactCadEvidence', 'manufacturingEvidence', 'engineeringCoverage', 'motionCoverage', 'cableLife', 'safetyElectrical', 'physicalReceipt', 'systemBinding'];

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-release-verified-audit:${ip}`, 2, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 255_000_000);
  if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  if (!form) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const uploaded = Object.fromEntries(FILE_KEYS.map(key => [key, form.get(key)])) as Record<keyof RobotVerifiedSystemsReleaseAuditFiles, FormDataEntryValue | null>;
  const artifacts = form.getAll('artifact');
  if (FILE_KEYS.some(key => !(uploaded[key] instanceof File)) || !artifacts.length || artifacts.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'complete verified-systems evidence and physical artifacts are required' }, { status: 400 });
  const reportFiles = FILE_KEYS.map(key => uploaded[key] as File), artifactFiles = artifacts as File[];
  const totalBytes = [...reportFiles, ...artifactFiles].reduce((sum, file) => sum + file.size, 0);
  if (reportFiles.some(file => file.size < 1 || file.size > 10_000_000) || artifactFiles.length > 512 || artifactFiles.some(file => file.size < 1 || file.size > 50_000_000) || totalBytes > 250_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  if (new Set(artifactFiles.map(file => file.name)).size !== artifactFiles.length) return NextResponse.json({ ok: false, code: 'DUPLICATE_ARTIFACT' }, { status: 400 });
  const files = Object.fromEntries(await Promise.all(FILE_KEYS.map(async key => [key, new Uint8Array(await (uploaded[key] as File).arrayBuffer())]))) as RobotVerifiedSystemsReleaseAuditFiles;
  const artifactMap = new Map(await Promise.all(artifactFiles.map(async file => [file.name, new Uint8Array(await file.arrayBuffer())] as const)));
  const report = auditRobotVerifiedSystemsRelease(files, artifactMap, { exactCad: parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS), manufacturing: parseTrustedRobotExactCadKeys(process.env.NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS), physical: parseTrustedRobotPhysicalValidationKeys(process.env.NEXYFAB_ROBOT_PHYSICAL_VALIDATION_KEYS) }, parseRobotVerifiedSystemsAuditSigner());
  return NextResponse.json({ ok: report.status === 'ready_for_final_review', report, releaseReady: false, releaseExecuted: false, finalReviewRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.status === 'ready_for_final_review' ? 200 : 422 });
}
