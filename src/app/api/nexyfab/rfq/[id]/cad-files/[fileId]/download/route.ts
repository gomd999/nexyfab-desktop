import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { getRfqAccessForUser } from '@/lib/rfq-partner-access';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// GET .../cad-files/[fileId]/download — JSON에 서명 URL (클라이언트가 Bearer로 호출 가능)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const authUser = await getAuthUser(_req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rfqId, fileId } = await params;

  const access = await getRfqAccessForUser(rfqId, authUser);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const file = await db.queryOne<{
    id: string;
    storage_key: string;
    filename: string;
    ref_type: string | null;
    ref_id: string | null;
    category: string;
  }>(
    `SELECT id, storage_key, filename, ref_type, ref_id, category FROM nf_files WHERE id = ?`,
    fileId,
  );
  if (!file || file.ref_type !== 'rfq' || file.ref_id !== rfqId || file.category !== 'cad') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storage = getStorage();
  try {
    const url = await storage.getSignedUrl(file.storage_key, 300);
    return NextResponse.json({ url, filename: file.filename });
  } catch (err) {
    console.error('RFQ CAD download signed URL error:', err);
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
  }
}
