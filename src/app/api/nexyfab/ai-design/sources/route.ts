import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { getStorage } from '@/lib/storage';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';
import { rateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { artifactTenantNamespace, resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import {
  AI_DESIGN_SOURCE_MAX_BYTES,
  assertAiDesignSourceArtifactSchema,
  persistAiDesignSourceArtifact,
  validateAiDesignSourceFile,
} from '@/lib/ai/aiDesignSourceArtifactStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_MULTIPART_BYTES = AI_DESIGN_SOURCE_MAX_BYTES + 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-source:${auth.userId}`, 20, 60 * 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const multipart = await readBoundedMultipartForm(req, MAX_MULTIPART_BYTES);
  if (multipart.tooLarge) return NextResponse.json({ error: 'SOURCE_TOO_LARGE' }, { status: 413 });
  const form = multipart.form;
  const projectId = String(form?.get('projectId') ?? '');
  const sessionId = String(form?.get('sessionId') ?? '');
  const kind = String(form?.get('kind') ?? '');
  const file = form?.get('file');
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(sessionId) || !(file instanceof File)) return NextResponse.json({ error: 'INVALID_SOURCE_REQUEST' }, { status: 400 });
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAiDesignSourceFile({ filename: file.name, mimeType: file.type, kind, bytes });
  if (!validated.ok) return NextResponse.json({ error: validated.code }, { status: validated.code === 'SOURCE_SIZE_INVALID' ? 413 : 400 });
  let classification: unknown;
  const classificationJson = form?.get('classification');
  if (typeof classificationJson === 'string' && classificationJson.length <= 4_096) {
    try { classification = JSON.parse(classificationJson); } catch { return NextResponse.json({ error: 'INVALID_CLASSIFICATION' }, { status: 400 }); }
  }
  await assertAiDesignSourceArtifactSchema(db);
  const tenantNamespace = artifactTenantNamespace(resolveArtifactTenantId(access.row.org_id, access.ownerUserId));
  const artifact = await persistAiDesignSourceArtifact({
    db, storage: getStorage(), userId: auth.userId, projectId, sessionId, tenantNamespace,
    filename: validated.filename, mimeType: validated.mimeType, kind: validated.kind,
    bytes, sourceHash: validated.sourceHash, classification,
  });
  logAudit({
    userId: auth.userId,
    action: 'ai_design.source.persist',
    resourceId: projectId,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { artifactId: artifact.artifactId, sessionId, sourceHash: artifact.sourceHash, byteLength: artifact.byteLength, kind: artifact.kind },
  });
  return NextResponse.json({ artifact: { ...artifact, objectKey: undefined }, persistence: 'PRIVATE_SERVER_OWNED_IMMUTABLE' }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
