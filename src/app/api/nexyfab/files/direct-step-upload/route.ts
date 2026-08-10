import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { sanitizeFileName } from '@/lib/file-validation';
import { getStorage } from '@/lib/storage';
import { isOwnedDirectStepKey, validateDirectStepUpload } from '@/lib/brep-bridge/directStepUploadPolicy';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RequestBody = {
  action?: unknown;
  filename?: unknown;
  sizeBytes?: unknown;
  key?: unknown;
};

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = rateLimit(`direct-step-upload:${user.userId}`, 10, 60 * 60_000);
  if (!limited.allowed) return NextResponse.json({ error: 'Too many large-file requests' }, { status: 429 });
  const body = await req.json().catch(() => ({})) as RequestBody;
  const filename = sanitizeFileName(typeof body.filename === 'string' ? body.filename : '');
  const sizeBytes = Number(body.sizeBytes);
  const policy = validateDirectStepUpload(filename, sizeBytes);
  if (!policy.ok) {
    return NextResponse.json({ error: 'Invalid direct STEP upload', code: policy.code }, { status: 400 });
  }
  const storage = getStorage();

  if (body.action === 'intent') {
    if (!storage.createPrivateUploadUrl) {
      return NextResponse.json(
        { error: 'Direct large-file upload requires S3/R2 private storage', code: 'DIRECT_UPLOAD_UNAVAILABLE' },
        { status: 501 },
      );
    }
    const issued = await storage.createPrivateUploadUrl(
      policy.filename, `files/${user.userId}`, 'application/step', 300,
    );
    return NextResponse.json({
      key: issued.key, uploadUrl: issued.uploadUrl,
      method: 'PUT', contentType: 'application/step', expiresInSeconds: 300,
    });
  }

  if (body.action === 'complete') {
    const key = typeof body.key === 'string' ? body.key : '';
    if (!isOwnedDirectStepKey(key, user.userId)) {
      return NextResponse.json({ error: 'Object is unavailable', code: 'OBJECT_UNAVAILABLE' }, { status: 404 });
    }
    if (!storage.stat) {
      return NextResponse.json({ error: 'Object verification unavailable', code: 'STORAGE_UNAVAILABLE' }, { status: 501 });
    }
    let stored: { size: number };
    try { stored = await storage.stat(key); }
    catch { return NextResponse.json({ error: 'Uploaded object not found', code: 'OBJECT_UNAVAILABLE' }, { status: 404 }); }
    if (stored.size !== policy.sizeBytes) {
      await storage.delete(key).catch(() => {});
      return NextResponse.json(
        { error: 'Uploaded object size does not match intent', code: 'SIZE_MISMATCH', expected: policy.sizeBytes, actual: stored.size },
        { status: 409 },
      );
    }
    const db = getDbAdapter();
    const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_files WHERE storage_key = ?', key);
    if (existing) return NextResponse.json({ file: { id: existing.id, storage_key: key }, idempotent: true });
    const id = randomUUID();
    const now = Date.now();
    await db.execute(
      `INSERT INTO nf_files (id, user_id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at, replaces_file_id, cad_root_id, cad_version, uploaded_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, user.userId, key, policy.filename, 'application/step', stored.size,
      'cad', null, null, now, null, id, 1, null,
    );
    return NextResponse.json({
      file: { id, storage_key: key, filename: policy.filename, size_bytes: stored.size, category: 'cad', created_at: now },
    }, { status: 201 });
  }

  return NextResponse.json({ error: 'action must be intent or complete' }, { status: 400 });
}
