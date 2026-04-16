export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { validateUploadedFile, sanitizeFileName } from '@/lib/file-validation';
import { PLAN_LIMITS } from '@/lib/billing-engine';
import { recordUsage } from '@/lib/billing-engine';

type Plan = 'free' | 'pro' | 'team' | 'enterprise';

// ─── GET: List user's files + storage usage ─────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const category = searchParams.get('category');
  const refType = searchParams.get('ref_type');
  const refId = searchParams.get('ref_id');
  const rawPage = parseInt(searchParams.get('page') || '1');
  const rawLimit = parseInt(searchParams.get('limit') || '50');
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
  const offset = (page - 1) * limit;

  // Build query with optional filters
  let where = 'WHERE user_id = ?';
  const params: unknown[] = [authUser.userId];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (refType) {
    where += ' AND ref_type = ?';
    params.push(refType);
  }
  if (refId) {
    where += ' AND ref_id = ?';
    params.push(refId);
  }

  const [files, countRow, usageRow] = await Promise.all([
    db.queryAll<{
      id: string; storage_key: string; filename: string;
      mime_type: string; size_bytes: number; category: string;
      ref_type: string | null; ref_id: string | null; created_at: number;
    }>(
      `SELECT id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at
       FROM nf_files ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM nf_files ${where}`,
      ...params,
    ),
    db.queryOne<{ total_bytes: number }>(
      `SELECT COALESCE(SUM(size_bytes), 0) as total_bytes FROM nf_files WHERE user_id = ?`,
      authUser.userId,
    ),
  ]);

  const totalBytes = usageRow?.total_bytes ?? 0;
  const plan = (authUser.plan || 'free') as Plan;
  const limitGb = PLAN_LIMITS[plan]?.storage_gb ?? 1;

  return NextResponse.json({
    files,
    pagination: { page, limit, total: countRow?.total ?? 0 },
    storage: {
      used_bytes: totalBytes,
      used_gb: +(totalBytes / (1024 ** 3)).toFixed(3),
      limit_gb: limitGb,
      usage_percent: +((totalBytes / (limitGb * 1024 ** 3)) * 100).toFixed(1),
    },
  });
}

// ─── POST: Upload file to R2 + save metadata ───────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const plan = (authUser.plan || 'free') as Plan;
  const limitBytes = (PLAN_LIMITS[plan]?.storage_gb ?? 1) * 1024 ** 3;

  // Check current usage before accepting upload
  const usageRow = await db.queryOne<{ total_bytes: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0) as total_bytes FROM nf_files WHERE user_id = ?`,
    authUser.userId,
  );
  const currentUsage = usageRow?.total_bytes ?? 0;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const category = (formData.get('category') as string) || 'general';
  const refType = formData.get('ref_type') as string | null;
  const refId = formData.get('ref_id') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Soft quota — uploads always succeed; overage is billed at $0.06/GB
  const isOverQuota = currentUsage + file.size > limitBytes;

  // Validate file
  const validation = await validateUploadedFile(file, {
    allowedExtensions: [
      '.step', '.stp', '.stl', '.obj', '.blend',
      '.pdf', '.doc', '.docx', '.dwg', '.dxf',
      '.jpg', '.jpeg', '.png', '.webp', '.gif',
      '.zip', '.rar', '.7z',
    ],
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
    checkMagicBytes: false,
  });
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeFilename = sanitizeFileName(file.name);
  const storage = getStorage();

  let storageResult;
  try {
    storageResult = await storage.upload(buffer, safeFilename, `files/${authUser.userId}`);
  } catch (err) {
    console.error('File upload error:', err);
    return NextResponse.json({ error: 'File upload failed' }, { status: 500 });
  }

  // Save metadata to DB
  const fileId = randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_files (id, user_id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fileId, authUser.userId, storageResult.key, safeFilename,
    file.type || 'application/octet-stream', storageResult.size,
    category, refType, refId, now,
  );

  // Record usage for billing
  try {
    const newTotal = currentUsage + storageResult.size;
    const totalGb = Math.ceil(newTotal / (1024 ** 3));
    await recordUsage({
      userId: authUser.userId,
      product: 'nexyfab',
      metric: 'storage_gb',
      quantity: totalGb,
    });
  } catch { /* billing failure should not block upload */ }

  const newTotalGb = +((currentUsage + storageResult.size) / (1024 ** 3)).toFixed(2);
  const limitGb = PLAN_LIMITS[plan]?.storage_gb ?? 1;

  return NextResponse.json({
    file: {
      id: fileId,
      storage_key: storageResult.key,
      filename: safeFilename,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: storageResult.size,
      category,
      ref_type: refType,
      ref_id: refId,
      created_at: now,
    },
    storage: { usedGb: newTotalGb, limitGb, overQuota: isOverQuota },
  }, { status: 201 });
}

// ─── DELETE: Remove file from R2 + DB ───────────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fileId = req.nextUrl.searchParams.get('id');
  if (!fileId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const file = await db.queryOne<{ id: string; user_id: string; storage_key: string }>(
    `SELECT id, user_id, storage_key FROM nf_files WHERE id = ?`,
    fileId,
  );

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  if (file.user_id !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Delete from storage
  try {
    const storage = getStorage();
    await storage.delete(file.storage_key);
  } catch { /* storage deletion failure shouldn't block DB cleanup */ }

  // Delete from DB
  await db.execute(`DELETE FROM nf_files WHERE id = ?`, fileId);

  return NextResponse.json({ success: true });
}
