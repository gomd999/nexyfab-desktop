import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { getStorage } from '@/lib/storage';
import { rateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  abortArtifactMultipartUpload,
  artifactTenantNamespace,
  completeArtifactUpload,
  createArtifactUploadSession,
  DIRECT_ARTIFACT_MULTIPART_PART_BYTES,
  DIRECT_ARTIFACT_MULTIPART_THRESHOLD_BYTES,
  DIRECT_ARTIFACT_MULTIPART_TTL_MS,
  ensureDirectArtifactUploadTables,
  finalizeArtifactMultipartUpload,
  listArtifactMultipartParts,
  readOwnedArtifactUploadSession,
  resolveArtifactTenantId,
  safeArtifactNamespaceSegment,
  storageSupportsMultipart,
  validateArtifactUploadIntent,
} from '@/lib/artifacts/directArtifactUploadStore';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_JSON_BODY_BYTES = 4_096;

type UploadRequestBody = {
  action?: unknown;
  uploadId?: unknown;
  filename?: unknown;
  byteLength?: unknown;
  contentSha256?: unknown;
  shapeIdentitySha256?: unknown;
  partNumber?: unknown;
};

function producerBuildId(): string {
  return process.env.CF_VERSION_METADATA_ID
    || process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.NEXT_PUBLIC_BUILD_ID
    || 'development-unversioned';
}

function errorStatus(code: string): number {
  if (code === 'SESSION_NOT_FOUND' || code === 'OBJECT_UNAVAILABLE') return 404;
  if (code === 'SESSION_EXPIRED') return 410;
  if (code === 'SIZE_MISMATCH' || code === 'SHA256_MISMATCH') return 409;
  if (code === 'PARTS_INCOMPLETE') return 409;
  return 422;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: projectId } = await params;
  const projectSegment = safeArtifactNamespaceSegment(projectId);
  if (!projectSegment) return NextResponse.json({ error: 'Invalid project identifier' }, { status: 400 });
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  let body: UploadRequestBody;
  try { body = await readBoundedJson<UploadRequestBody>(req, MAX_JSON_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Upload request too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const limited = rateLimit(`artifact-upload:${action}:${auth.userId}:${projectId}`, action === 'intent' ? 20 : 60, 60 * 60_000);
  if (!limited.allowed) return NextResponse.json({ error: 'Too many artifact upload requests' }, { status: 429 });

  await ensureDirectArtifactUploadTables(db);
  const storage = getStorage();
  if (action === 'intent') {
    const validation = validateArtifactUploadIntent({
      filename: typeof body.filename === 'string' ? body.filename : '',
      byteLength: Number(body.byteLength),
      contentSha256: typeof body.contentSha256 === 'string' ? body.contentSha256 : '',
      ...(typeof body.shapeIdentitySha256 === 'string' ? { shapeIdentitySha256: body.shapeIdentitySha256 } : {}),
    });
    if (!validation.ok) {
      return NextResponse.json({ error: 'Invalid artifact upload intent', code: validation.code }, { status: 400 });
    }
    if (!storage.sha256) {
      return NextResponse.json(
        { error: 'Direct verified upload requires S3/R2 private storage', code: 'DIRECT_UPLOAD_UNAVAILABLE' },
        { status: 501 },
      );
    }
    const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
    let tenantNamespace: string;
    try { tenantNamespace = artifactTenantNamespace(tenantId); }
    catch { return NextResponse.json({ error: 'Invalid tenant identifier' }, { status: 422 }); }
    const directory = `artifacts/${tenantNamespace}/projects/${projectSegment}`;
    const requiresMultipart = validation.value.byteLength >= DIRECT_ARTIFACT_MULTIPART_THRESHOLD_BYTES;
    if (requiresMultipart && !storageSupportsMultipart(storage)) {
      return NextResponse.json(
        { error: 'Large artifact upload requires resumable multipart storage', code: 'RESUMABLE_UPLOAD_UNAVAILABLE' },
        { status: 501 },
      );
    }
    if (!requiresMultipart && !storage.createPrivateUploadUrl) {
      return NextResponse.json(
        { error: 'Direct verified upload requires S3/R2 private storage', code: 'DIRECT_UPLOAD_UNAVAILABLE' },
        { status: 501 },
      );
    }
    const issued = requiresMultipart
      ? await storage.createPrivateMultipartUpload!(validation.value.filename, directory, validation.value.mediaType)
      : await storage.createPrivateUploadUrl!(validation.value.filename, directory, validation.value.mediaType, PRESIGNED_URL_TTL_SECONDS);
    const partSize = requiresMultipart ? DIRECT_ARTIFACT_MULTIPART_PART_BYTES : undefined;
    const totalParts = partSize ? Math.ceil(validation.value.byteLength / partSize) : undefined;
    const session = await createArtifactUploadSession(db, {
      projectId,
      tenantId,
      userId: auth.userId,
      objectKey: issued.key,
      intent: validation.value,
      uploadMode: requiresMultipart ? 'MULTIPART' : 'SINGLE_PUT',
      ...('storageUploadId' in issued ? { storageUploadId: issued.storageUploadId } : {}),
      ...(partSize ? { partSize, totalParts, expiresInMs: DIRECT_ARTIFACT_MULTIPART_TTL_MS } : {}),
    });
    logAudit({
      userId: auth.userId,
      action: 'cad.artifact_upload_intent',
      resourceId: projectId,
      ip: getTrustedClientIpOrUndefined(req.headers),
      metadata: { uploadId: session.id, format: session.format, byteLength: session.expected_size },
    });
    return NextResponse.json({
      uploadId: session.id,
      ...('uploadUrl' in issued ? { uploadUrl: issued.uploadUrl } : {}),
      method: requiresMultipart ? 'MULTIPART_PUT' : 'PUT',
      contentType: validation.value.mediaType,
      expiresAt: new Date(session.expires_at).toISOString(),
      verification: 'SERVER_STREAM_SHA256',
      resumable: requiresMultipart,
      ...(requiresMultipart ? {
        partSizeBytes: partSize,
        totalParts,
        partUrlAction: 'part-url',
        resumeAction: 'status',
      } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (action === 'part-url' || action === 'status') {
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!safeArtifactNamespaceSegment(uploadId)) {
      return NextResponse.json({ error: 'Invalid upload identifier' }, { status: 400 });
    }
    const resume = await listArtifactMultipartParts(db, storage, { uploadId, projectId, userId: auth.userId });
    if (!resume.ok) {
      return NextResponse.json({ error: 'Multipart upload is unavailable', code: resume.code }, { status: errorStatus(resume.code) });
    }
    if (action === 'status') {
      return NextResponse.json({
        uploadId,
        resumable: true,
        partSizeBytes: Number(resume.session.part_size),
        totalParts: Number(resume.session.total_parts),
        uploadedParts: resume.parts.map(part => ({ partNumber: part.partNumber, size: part.size, etag: part.etag })),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const partNumber = Number(body.partNumber);
    const totalPartsForSession = Number(resume.session.total_parts);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > totalPartsForSession) {
      return NextResponse.json({ error: 'Invalid multipart part number' }, { status: 400 });
    }
    const uploaded = resume.parts.find(part => part.partNumber === partNumber);
    if (uploaded) {
      return NextResponse.json({ uploadId, partNumber, alreadyUploaded: true, size: uploaded.size, etag: uploaded.etag });
    }
    if (!storage.createPrivateMultipartPartUrl || !resume.session.storage_upload_id) {
      return NextResponse.json({ error: 'Multipart upload is unavailable', code: 'MULTIPART_UNAVAILABLE' }, { status: 501 });
    }
    const issuedPart = await storage.createPrivateMultipartPartUrl(
      resume.session.object_key,
      resume.session.storage_upload_id,
      partNumber,
      PRESIGNED_URL_TTL_SECONDS,
    );
    return NextResponse.json({
      uploadId,
      partNumber,
      uploadUrl: issuedPart.uploadUrl,
      method: 'PUT',
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      alreadyUploaded: false,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (action === 'abort') {
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!safeArtifactNamespaceSegment(uploadId)) return NextResponse.json({ error: 'Invalid upload identifier' }, { status: 400 });
    const aborted = await abortArtifactMultipartUpload(db, storage, { uploadId, projectId, userId: auth.userId });
    if (!aborted.ok) return NextResponse.json({ error: 'Multipart upload could not be aborted', code: aborted.code }, { status: errorStatus(aborted.code) });
    return NextResponse.json({ ok: true, uploadId }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (action === 'complete') {
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!safeArtifactNamespaceSegment(uploadId)) {
      return NextResponse.json({ error: 'Invalid upload identifier' }, { status: 400 });
    }
    const session = await readOwnedArtifactUploadSession(db, { uploadId, projectId, userId: auth.userId });
    if (!session) return NextResponse.json({ error: 'Artifact upload could not be committed', code: 'SESSION_NOT_FOUND' }, { status: 404 });
    if (session.upload_mode === 'MULTIPART' && !session.multipart_completed_at) {
      const finalized = await finalizeArtifactMultipartUpload(db, storage, { uploadId, projectId, userId: auth.userId });
      if (!finalized.ok) {
        return NextResponse.json({ error: 'Multipart upload could not be finalized', code: finalized.code }, { status: errorStatus(finalized.code) });
      }
    }
    const result = await completeArtifactUpload(db, storage, {
      uploadId,
      projectId,
      userId: auth.userId,
      producerBuildId: producerBuildId(),
    });
    if (!result.ok) {
      logAudit({
        userId: auth.userId,
        action: 'cad.artifact_upload_failed',
        resourceId: projectId,
        ip: getTrustedClientIpOrUndefined(req.headers),
        metadata: { uploadId, code: result.code },
      });
      return NextResponse.json({ error: 'Artifact upload could not be committed', code: result.code }, { status: errorStatus(result.code) });
    }
    logAudit({
      userId: auth.userId,
      action: result.idempotent ? 'cad.artifact_upload_replayed' : 'cad.artifact_upload_completed',
      resourceId: projectId,
      ip: getTrustedClientIpOrUndefined(req.headers),
      metadata: { uploadId, artifactId: result.artifact.artifactId, contentSha256: result.artifact.contentSha256 },
    });
    return NextResponse.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  return NextResponse.json({ error: 'action must be intent, part-url, status, complete or abort' }, { status: 400 });
}
