export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { getRfqAccessForUser } from '@/lib/rfq-partner-access';

// GET /api/nexyfab/files/[id]/download — generate signed URL and redirect

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDbAdapter();
  const file = await db.queryOne<{
    id: string; user_id: string; storage_key: string; filename: string; mime_type: string;
    ref_type: string | null; ref_id: string | null;
  }>(
    `SELECT id, user_id, storage_key, filename, mime_type, ref_type, ref_id FROM nf_files WHERE id = ?`,
    id,
  );

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Access check: the owner always; otherwise, for a file attached to an RFQ,
  // a partner who has a quote on that RFQ may download it (so they can quote/
  // produce from the real STEP/STL). Without this, RFQ-attached CAD files were
  // owner-only and the quoting partner had no way to fetch them. (2026-06-09)
  let allowed = file.user_id === authUser.userId;
  if (!allowed && file.ref_type === 'rfq' && file.ref_id) {
    const access = await getRfqAccessForUser(file.ref_id, authUser).catch(() => null);
    allowed = !!access;
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storage = getStorage();
  try {
    const signedUrl = await storage.getSignedUrl(file.storage_key, 300); // 5 min expiry
    return NextResponse.redirect(signedUrl);
  } catch (err) {
    console.error('Signed URL error:', err);
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
  }
}
