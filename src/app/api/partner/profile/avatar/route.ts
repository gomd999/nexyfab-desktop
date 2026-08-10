/**
 * POST /api/partner/profile/avatar
 * Uploads a partner company logo to storage and updates nf_factories.avatar_url
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { findFactoryForPartnerEmail } from '@/lib/partner-factory-access';
import { getStorage } from '@/lib/storage';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageExtension(type: string, bytes: Buffer): string | null {
  if (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (type === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'forbidden origin' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 형식이 필요합니다.' }, { status: 400 });
  }

  const file = formData.get('avatar') as File | null;
  if (!file) return NextResponse.json({ error: 'avatar 파일이 필요합니다.' }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'JPG, PNG, WebP, SVG 형식만 허용됩니다.' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: '파일 크기는 2MB를 초과할 수 없습니다.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = imageExtension(file.type, buffer);
  if (!ext) return NextResponse.json({ error: 'file content does not match image type' }, { status: 400 });
  const storage = getStorage();

  const result = await storage.upload(buffer, `avatar.${ext}`, `partner-avatars/${partner.email.replace(/[^a-z0-9]/gi, '_')}`);

  const db = getDbAdapter();
  const fac = await findFactoryForPartnerEmail(partner.email, { activeOnly: false });
  if (!fac) {
    return NextResponse.json({ error: '등록된 공장 프로필을 찾을 수 없습니다.' }, { status: 404 });
  }
  await db.execute('UPDATE nf_factories SET avatar_url = ? WHERE id = ?', result.url, fac.id);

  return NextResponse.json({ ok: true, avatarUrl: result.url });
}
