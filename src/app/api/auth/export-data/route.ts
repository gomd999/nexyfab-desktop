/**
 * GET /api/auth/export-data
 * GDPR Article 20 — Right to data portability.
 * Returns all user data as a JSON download.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 3 exports per hour per user
  if (!rateLimit(`export-data:${authUser.userId}`, 3, 3_600_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 1시간 후 다시 시도하세요.' }, { status: 429 });
  }

  const db = getDbAdapter();
  const uid = authUser.userId;

  const [profile, orders, rfqs, projects, files, comments] = await Promise.all([
    db.queryOne<Record<string, unknown>>(
      `SELECT id, email, name, plan, language, country, timezone, company, job_title,
              created_at, last_login_at, login_count, signup_source, terms_agreed_at, privacy_agreed_at,
              marketing_agreed, marketing_agreed_at, onboarding_done_at
       FROM nf_users WHERE id = ?`,
      uid,
    ),
    db.queryAll<Record<string, unknown>>(
      `SELECT id, rfq_id, part_name, manufacturer_name, quantity, total_price_krw,
              status, payment_status, created_at, estimated_delivery_at
       FROM nf_orders WHERE user_id = ? ORDER BY created_at DESC`,
      uid,
    ),
    db.queryAll<Record<string, unknown>>(
      `SELECT id, part_name, material, quantity, process, notes, status, created_at
       FROM nf_rfqs WHERE user_id = ? ORDER BY created_at DESC`,
      uid,
    ).catch(() => [] as Record<string, unknown>[]),
    db.queryAll<Record<string, unknown>>(
      `SELECT id, name, description, status, created_at, updated_at
       FROM nf_projects WHERE user_id = ? ORDER BY created_at DESC`,
      uid,
    ).catch(() => [] as Record<string, unknown>[]),
    db.queryAll<Record<string, unknown>>(
      `SELECT id, original_name, size_bytes, mime_type, ref_type, ref_id, created_at
       FROM nf_files WHERE user_id = ? ORDER BY created_at DESC`,
      uid,
    ).catch(() => [] as Record<string, unknown>[]),
    db.queryAll<Record<string, unknown>>(
      `SELECT id, content, created_at FROM nf_comments WHERE user_id = ? ORDER BY created_at DESC`,
      uid,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    dataController: 'Nexysys Lab Co., Ltd. | nexyfab@nexysys.com',
    profile,
    orders,
    rfqs,
    projects,
    files,
    comments,
  };

  const json = JSON.stringify(exportData, null, 2);

  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="nexyfab-data-export-${uid.slice(0, 8)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
