import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { evaluateRobotMotionCoverageBytes, parseRobotSweptEvidenceTrustedSigners } from '@/lib/ai/robot/robotMotionCoverage';
import { boundedMultipartBodyError, readBoundedMultipartBody } from '@/lib/boundedMultipartBody';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SWEPT_EVIDENCE_FILES = 512;
const MAX_SWEPT_EVIDENCE_FILE_BYTES = 5_000_000;
const MAX_SWEPT_EVIDENCE_TOTAL_BYTES = 50_000_000;
const MAX_MULTIPART_REQUEST_BYTES = 55_000_000;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`cad-v1-robot-motion-coverage:${ip}`, 3, 60_000)).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  const requestContentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  if (!requestContentType.startsWith('multipart/form-data;')) return NextResponse.json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_REQUEST_BYTES) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedMultipartBody(req, MAX_MULTIPART_REQUEST_BYTES);
  } catch (error) {
    const bounded = boundedMultipartBodyError(error);
    if (bounded) return NextResponse.json({ ok: false, code: bounded.code === 'PAYLOAD_TOO_LARGE' ? 'TOO_LARGE' : 'BAD_REQUEST' }, { status: bounded.status });
    throw error;
  }
  const parsedHeaders = new Headers(req.headers);
  // The bounded reader is authoritative for the reconstructed body. Do not
  // forward attacker-controlled transport framing that may disagree with the
  // measured bytes; content-type (including the multipart boundary) remains.
  parsedHeaders.delete('content-length');
  parsedHeaders.delete('transfer-encoding');
  const parsedRequest = new Request(req.url, { method: req.method, headers: parsedHeaders, body });
  const form = await parsedRequest.formData().catch(() => null);
  const requirements = form?.get('requirements');
  const motionInput = form?.get('motionInput');
  if (!(requirements instanceof File) || !(motionInput instanceof File)) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'requirements and motionInput files are required' }, { status: 400 });
  if (!isJsonFile(requirements) || !isJsonFile(motionInput)) return NextResponse.json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'requirements and motionInput must be application/json files' }, { status: 415 });
  if (requirements.size < 1 || requirements.size > 2_000_000 || motionInput.size < 1 || motionInput.size > 50_000_000) return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  const evidenceEntries = form?.getAll('sweptEvidence') ?? [];
  if (evidenceEntries.some(entry => !(entry instanceof File))) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'sweptEvidence entries must be files' }, { status: 400 });
  const evidenceFiles = evidenceEntries as File[];
  if (evidenceFiles.some(file => !isJsonFile(file))) return NextResponse.json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'sweptEvidence files must be application/json files' }, { status: 415 });
  const evidenceTotalBytes = evidenceFiles.reduce((total, file) => total + file.size, 0);
  if (evidenceFiles.length > MAX_SWEPT_EVIDENCE_FILES
    || evidenceFiles.some(file => file.size < 1 || file.size > MAX_SWEPT_EVIDENCE_FILE_BYTES)
    || evidenceTotalBytes > MAX_SWEPT_EVIDENCE_TOTAL_BYTES) {
    return NextResponse.json({ ok: false, code: 'TOO_LARGE' }, { status: 413 });
  }
  const sweptEvidenceArtifacts = new Map<string, Uint8Array>();
  for (const file of evidenceFiles) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    sweptEvidenceArtifacts.set(createHash('sha256').update(bytes).digest('hex'), bytes);
  }
  const report = evaluateRobotMotionCoverageBytes(
    new Uint8Array(await requirements.arrayBuffer()),
    new Uint8Array(await motionInput.arrayBuffer()),
    sweptEvidenceArtifacts,
    parseRobotSweptEvidenceTrustedSigners(),
  );
  return NextResponse.json({ ok: report.motionCoverageReady, report, releaseReady: false, physicalValidationRequired: true, cadModified: false, quoteOrRfqSideEffects: false }, { status: report.motionCoverageReady ? 200 : 422 });
}

function isJsonFile(file: File): boolean {
  const mediaType = file.type.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}
