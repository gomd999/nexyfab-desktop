import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { contractId } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<{
    id: string; customer_email: string | null; partner_email: string | null; attachments: string | null;
  }>(
    'SELECT id, customer_email, partner_email, attachments FROM nf_contracts WHERE id = ?',
    contractId,
  );

  if (!row) {
    return NextResponse.json({ error: '계약을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 본인 계약만 조회 가능 (admin 제외)
  const isOwner = row.customer_email === authUser.email || row.partner_email === authUser.email;
  const isAdmin = await verifyAdmin(req);

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 });
  }

  let attachments: any[] = [];
  try { attachments = JSON.parse(row.attachments || '[]'); } catch { /* empty */ }

  return NextResponse.json({ attachments });
}
