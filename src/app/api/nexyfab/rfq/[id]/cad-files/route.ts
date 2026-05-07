import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { getRfqAccessForUser } from '@/lib/rfq-partner-access';

export const dynamic = 'force-dynamic';

type FileRow = {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: number;
  user_id: string;
  replaces_file_id: string | null;
  cad_root_id: string | null;
  cad_version: number;
  uploaded_by_role: string | null;
};

// GET /api/nexyfab/rfq/[id]/cad-files — CAD 첨부 버전 목록 (고객·승인된 파트너)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(_req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rfqId } = await params;

  const access = await getRfqAccessForUser(rfqId, authUser);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const rows = await db.queryAll<FileRow>(
    `SELECT f.id, f.filename, f.size_bytes, f.created_at, f.user_id,
            f.replaces_file_id, f.cad_root_id, f.cad_version, f.uploaded_by_role
     FROM nf_files f
     WHERE f.ref_type = 'rfq' AND f.ref_id = ? AND f.category = 'cad'
     ORDER BY COALESCE(f.cad_root_id, f.id), f.cad_version ASC, f.created_at ASC`,
    rfqId,
  );

  const rootMap = new Map<string, FileRow[]>();
  for (const r of rows) {
    const root = r.cad_root_id ?? r.id;
    const list = rootMap.get(root) ?? [];
    list.push(r);
    rootMap.set(root, list);
  }

  const threads = [...rootMap.entries()].map(([rootId, versions]) => ({
    rootId,
    versions: versions.map(v => ({
      id: v.id,
      filename: v.filename,
      sizeBytes: Number(v.size_bytes),
      createdAt: v.created_at,
      cadVersion: v.cad_version,
      replacesFileId: v.replaces_file_id,
      uploadedByRole: v.uploaded_by_role
        ?? (v.user_id === access.rfqUserId ? 'customer' : 'partner'),
      isUploaderYou: v.user_id === authUser.userId,
    })),
  }));

  return NextResponse.json({ rfqId, threads, role: access.role });
}
