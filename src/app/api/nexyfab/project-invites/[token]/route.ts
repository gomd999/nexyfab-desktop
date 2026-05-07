import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { ensureProjectInvitesTable, maskEmailForInvite } from '@/lib/nfProjectInvites';

/** 공개 메타: 토큰 유효성·역할 (이메일은 마스킹). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length > 80) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureProjectInvitesTable(db);
  const row = await db.queryOne<{
    project_id: string;
    email_norm: string;
    role: string;
    expires_at: number;
  }>(
    'SELECT project_id, email_norm, role, expires_at FROM nf_project_invites WHERE token = ?',
    token,
  );
  if (!row || Date.now() > row.expires_at) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 });
  }

  return NextResponse.json({
    projectId: row.project_id,
    role: row.role,
    emailHint: maskEmailForInvite(row.email_norm),
  });
}
