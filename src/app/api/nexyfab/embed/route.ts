import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET — get embed config / verify embed token
export async function GET(req: NextRequest) {
  const embedToken = req.nextUrl.searchParams.get('token');
  if (!embedToken) {
    return NextResponse.json({
      embedUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/embed/shape-generator`,
      docs: 'Pass ?token=YOUR_EMBED_TOKEN to authenticate. Get token at /api/nexyfab/embed (POST).',
    });
  }

  const db = getDbAdapter();
  const config = await db.queryOne<{
    user_id: string; allowed_origins: string; features: string;
    rfq_auto_submit: number; branding: string; created_at: number;
  }>(
    "SELECT user_id, allowed_origins, features, rfq_auto_submit, branding, created_at FROM nf_embed_configs WHERE token = ? AND status = 'active'",
    embedToken,
  ).catch(() => null);

  if (!config) return NextResponse.json({ error: 'Invalid embed token' }, { status: 401 });

  return NextResponse.json({
    valid: true,
    features: JSON.parse(config.features ?? '[]'),
    allowedOrigins: JSON.parse(config.allowed_origins ?? '[]'),
    rfqAutoSubmit: !!config.rfq_auto_submit,
    branding: JSON.parse(config.branding ?? '{}'),
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

// POST — create embed token (authenticated user)
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Enterprise plan only
  if (!['enterprise', 'team'].includes(authUser.plan)) {
    return NextResponse.json({ error: '임베드 기능은 Team 플랜 이상에서 사용 가능합니다.' }, { status: 403 });
  }

  const schema = z.object({
    allowedOrigins: z.array(z.string().url()).max(10).default([]),
    features: z.array(z.enum(['design', 'dfm', 'fea', 'rfq', 'export'])).default(['design', 'rfq']),
    rfqAutoSubmit: z.boolean().default(true),
    branding: z.object({
      logoUrl: z.string().url().optional(),
      primaryColor: z.string().optional(),
      companyName: z.string().max(100).optional(),
    }).default({}),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const db = getDbAdapter();

  const { randomBytes } = await import('crypto');
  const token = randomBytes(24).toString('hex');
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_embed_configs (token, user_id, allowed_origins, features, rfq_auto_submit, branding, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    token, authUser.userId,
    JSON.stringify(parsed.data.allowedOrigins),
    JSON.stringify(parsed.data.features),
    parsed.data.rfqAutoSubmit ? 1 : 0,
    JSON.stringify(parsed.data.branding),
    now,
  );

  const embedUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/embed/shape-generator?token=${token}`;

  return NextResponse.json({
    token,
    embedUrl,
    iframeSnippet: `<iframe src="${embedUrl}" width="100%" height="700" frameborder="0" allow="fullscreen"></iframe>`,
    allowedOrigins: parsed.data.allowedOrigins,
    features: parsed.data.features,
  }, { status: 201 });
}
