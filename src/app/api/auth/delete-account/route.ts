import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';

/**
 * DELETE /api/auth/delete-account
 *
 * GDPR Article 17 "Right to erasure" endpoint.
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * Cascade rules (enforced via FK ON DELETE CASCADE in schema):
 *   nf_projects, nf_rfqs, nf_shares, nf_comments, nf_refresh_tokens,
 *   nf_password_reset_tokens
 *
 * Additional cleanup performed here:
 *   - nf_orders (user_id match)
 *   - nf_collab_sessions (user_id match)
 *   - nf_audit_log entries for this user
 *   - Airwallex subscription cancellation (if active)
 */
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const userId = authUser.userId;

  // Fetch user details before deletion
  const user = await db.queryOne<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM nf_users WHERE id = ?',
    userId,
  );

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Cancel Airwallex subscriptions (best-effort)
  const awSubs = await db.queryAll<{ aw_subscription_id: string }>(
    "SELECT aw_subscription_id FROM nf_aw_subscriptions WHERE user_id = ? AND status = 'active'",
    userId,
  );
  for (const sub of awSubs) {
    try {
      const { cancelSubscription } = await import('@/lib/airwallex-client');
      await cancelSubscription(sub.aw_subscription_id);
    } catch (err) {
      console.error('[delete-account] Airwallex cancellation failed:', err);
    }
  }

  // Perform deletion in a transaction
  try {
    await db.transaction(async (db) => {
      // Manual cleanup for tables without FK cascade
      await db.execute('DELETE FROM nf_orders WHERE user_id = ?', userId);
      await db.execute('DELETE FROM nf_collab_sessions WHERE user_id = ?', userId);
      await db.execute('DELETE FROM nf_audit_log WHERE user_id = ?', userId);

      // This triggers FK cascades for:
      // nf_projects, nf_rfqs, nf_shares, nf_comments,
      // nf_refresh_tokens, nf_password_reset_tokens
      await db.execute('DELETE FROM nf_users WHERE id = ?', userId);
    });
  } catch (err) {
    console.error('[delete-account] DB deletion failed:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }

  // Audit log entry written AFTER deletion (uses a separate system-level userId)
  logAudit({
    userId: 'system',
    action: 'account.deleted',
    metadata: { deletedUserId: userId, email: user.email },
  });

  // Clear auth cookie
  const response = NextResponse.json({ deleted: true });
  response.cookies.set('nf_access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('nf_refresh_token', '', { maxAge: 0, path: '/api/auth' });
  return response;
}
