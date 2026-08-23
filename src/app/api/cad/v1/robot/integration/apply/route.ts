import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { createApprovedRobotCadIntegrationRevision } from '@/lib/ai/robot/robotCadIntegrationApply';
import type { RobotCadIntegrationPacket } from '@/lib/ai/robot/robotCadIntegrationPacket';
import type { RobotCadIntegrationReview } from '@/lib/ai/robot/robotCadIntegrationReview';
import { parseTrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { getTrustedClientIp } from '@/lib/client-ip'; import { rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers); if (!(await rateLimitAsync(`cad-v1-robot-integration-apply:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, 315_000_000); if (multipart.tooLarge) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const form = multipart.form; const program = form?.get('program'), revision = form?.get('revision'), packetFile = form?.get('packet'), reviewFile = form?.get('review'), housing = form?.get('housing'), requirements = form?.get('requirements'), manifest = form?.get('manifest'), artifacts = form?.getAll('artifact') ?? [];
  if (![program, revision, packetFile, reviewFile, housing, requirements, manifest].every(item => item instanceof File) || artifacts.length < 1 || artifacts.some(item => !(item instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'program, revision, packet, review, housing, requirements, manifest and artifact files are required' }, { status: 400 });
  const [p, r, pf, rf, h, q, m] = [program, revision, packetFile, reviewFile, housing, requirements, manifest] as File[]; const files = artifacts as File[]; const total = files.reduce((sum, file) => sum + file.size, 0);
  if (p.size < 1 || p.size > 50_000_000 || [r, h, q, rf].some(file => file.size < 1 || file.size > 1_000_000) || pf.size < 1 || pf.size > 5_000_000 || m.size < 1 || m.size > 2_000_000 || files.length > 25 || files.some(file => file.size < 1 || file.size > 100_000_000) || total > 250_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  try {
    const packet = parse(await pf.arrayBuffer(), 'packet') as RobotCadIntegrationPacket, review = parse(await rf.arrayBuffer(), 'review') as RobotCadIntegrationReview;
    const result = await createApprovedRobotCadIntegrationRevision({ programBytes: new Uint8Array(await p.arrayBuffer()), revisionManifestBytes: new Uint8Array(await r.arrayBuffer()), packet, review, housingBytes: new Uint8Array(await h.arrayBuffer()), requirementsBytes: new Uint8Array(await q.arrayBuffer()), catalogManifestBytes: new Uint8Array(await m.arrayBuffer()), artifacts: await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))), trustedKeys: parseTrustedReviewerKeys() });
    if (!result.ok || !result.programBytes || !result.manifestBytes || !result.manifest) return NextResponse.json({ ok: false, code: 'INTEGRATION_NOT_AUTHORIZED', errors: result.errors, cadAppliedToWorkspace: false, releaseReady: false, quoteOrRfqSideEffects: false }, { status: 422 });
    const receipt = { ...result, programBytes: undefined, manifestBytes: undefined, manifest: result.manifest };
    const receiptBytes = strToU8(`${JSON.stringify(receipt, null, 2)}\n`); const receiptHash = createHash('sha256').update(receiptBytes).digest('hex');
    const zip = zipSync({ [result.manifest.programArtifact]: result.programBytes, [`revision-${result.manifest.lineageId}-r${result.manifest.revision}-${result.manifest.programHash}.json`]: result.manifestBytes, [`integration-application-${result.targetHash}.json`]: receiptBytes }, { level: 6 });
    return new NextResponse(Buffer.from(zip), { status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="robot-cad-r${result.manifest.revision}-${result.manifest.programHash}.zip"`, 'x-nexyfab-target-hash': result.targetHash, 'x-nexyfab-program-hash': result.manifest.programHash, 'x-nexyfab-revision': String(result.manifest.revision), 'x-nexyfab-application-hash': result.applicationHash!, 'x-nexyfab-application-receipt-hash': receiptHash, 'x-nexyfab-drive-occurrences': String(result.appliedOccurrenceCounts.drive), 'x-nexyfab-auxiliary-occurrences': String(result.appliedOccurrenceCounts.auxiliary), 'x-nexyfab-catalog-unresolved': String(result.catalogUnresolvedCount), 'x-nexyfab-cad-applied-workspace': 'false', 'x-nexyfab-release-ready': 'false' } });
  } catch (cause) { return NextResponse.json({ ok: false, code: 'INVALID_INTEGRATION_INPUT', message: cause instanceof Error ? cause.message : String(cause), cadAppliedToWorkspace: false, releaseReady: false }, { status: 422 }); }
}
function parse(bytes: ArrayBuffer, label: string) { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a UTF-8 JSON object`); return value; }
