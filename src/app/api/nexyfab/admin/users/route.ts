// Admin user-search / quick actions — single endpoint backing the
// `/[lang]/nexyfab/admin/users` console. Operators can search by email/name,
// flip plan, suspend, and trigger a refund without dropping to raw SQL.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_ADMIN_USER_BODY_BYTES = 64 * 1024;

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  plan: z.enum(['free', 'pro', 'team', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  userId: z.string().min(1).max(128),
  plan: z.enum(['free', 'pro', 'team', 'enterprise']).optional(),
  suspend: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = searchSchema.safeParse({
    ...params,
    limit: params.limit ? parseInt(params.limit, 10) : undefined,
    offset: params.offset ? parseInt(params.offset, 10) : undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = getDbAdapter();
  const where: string[] = [];
  const args: unknown[] = [];
  if (parsed.data.q) {
    where.push('(email LIKE ? OR name LIKE ? OR id = ?)');
    args.push(`%${parsed.data.q}%`, `%${parsed.data.q}%`, parsed.data.q);
  }
  if (parsed.data.plan) { where.push('plan = ?'); args.push(parsed.data.plan); }
  if (parsed.data.status === 'suspended') where.push('suspended_at IS NOT NULL');
  if (parsed.data.status === 'active') where.push('suspended_at IS NULL AND deleted_at IS NULL');
  if (parsed.data.status === 'deleted') where.push('deleted_at IS NOT NULL');

  const sql = `
    SELECT id, email, name, plan, country, created_at, last_login_at,
           email_verified, project_count, signup_source
      FROM nf_users
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
  `;
  args.push(parsed.data.limit, parsed.data.offset);
  const users = await db.queryAll<Record<string, unknown>>(sql, ...args);
  return NextResponse.json({ users, count: users.length });
}

export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let raw: unknown = null;
  try { raw = await readBoundedJson(req, MAX_ADMIN_USER_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const db = getDbAdapter();
  // Ensure suspended_at column exists (idempotent).
  try { await db.execute('ALTER TABLE nf_users ADD COLUMN suspended_at INTEGER'); } catch { /* exists */ }
  try { await db.execute('ALTER TABLE nf_users ADD COLUMN suspended_reason TEXT'); } catch { /* exists */ }

  const updates: string[] = [];
  const args: unknown[] = [];
  if (parsed.data.plan) {
    updates.push('plan = ?');
    args.push(parsed.data.plan);
  }
  if (parsed.data.suspend !== undefined) {
    updates.push('suspended_at = ?');
    args.push(parsed.data.suspend ? Date.now() : null);
    if (parsed.data.suspend && parsed.data.reason) {
      updates.push('suspended_reason = ?');
      args.push(parsed.data.reason);
    }
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  args.push(parsed.data.userId);
  await db.execute(`UPDATE nf_users SET ${updates.join(', ')}, updated_at = ${Date.now()} WHERE id = ?`, ...args);

  try {
    logAudit({
      userId: 'admin',
      action: 'admin.user.update',
      resourceId: parsed.data.userId,
      metadata: {
        plan: parsed.data.plan ?? '',
        suspend: parsed.data.suspend ?? false,
        reason: parsed.data.reason ?? '',
      },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
}
