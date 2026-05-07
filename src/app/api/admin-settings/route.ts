/**
 * GET  /api/admin-settings — Returns current admin settings
 * POST /api/admin-settings — Saves admin settings (admin-only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getAdminSettings, saveAdminSettings, type AdminSettings } from '@/lib/adminSettings';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(getAdminSettings());
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Partial<AdminSettings> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const current = getAdminSettings();
  const merged: AdminSettings = {
    googleAnalyticsId:  String(body.googleAnalyticsId  ?? current.googleAnalyticsId),
    naverVerification:  String(body.naverVerification   ?? current.naverVerification),
    bingVerification:   String(body.bingVerification    ?? current.bingVerification),
    googleVerification: String(body.googleVerification  ?? current.googleVerification),
    headScripts:        String(body.headScripts         ?? current.headScripts),
    bodyScripts:        String(body.bodyScripts         ?? current.bodyScripts),
    adminEmails:        String(body.adminEmails         ?? current.adminEmails),
    fbPixelId:          String(body.fbPixelId           ?? current.fbPixelId ?? ''),
  };

  const ok = saveAdminSettings(merged);
  if (!ok) return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });

  return NextResponse.json({ ok: true, settings: merged });
}
