/**
 * GET /api/auth/sso/discover?email=<address>
 *
 * Email-domain SSO discovery — mirrors the NexyFlow pattern. When the
 * user types an email whose domain is mapped here, we return a quick
 * "Continue with <provider>" link the login UI can promote above the
 * password field. Returns `{ found: false }` silently when nothing
 * matches so the client can call this on every keystroke without UI
 * noise.
 *
 * Phase 1 — in-process domain → provider map. Phase 2 will move the
 * source of truth to auth-server so enterprise admins can register
 * their own IdPs and the same domain works across NexyFlow / NexyFab.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Provider {
  /** Display name shown on the discovery button. */
  name: string;
  /** Full URL the browser navigates to when the user clicks. */
  loginUrl: string;
}

/**
 * Domain → provider map. Lower-case keys; entries match the domain part
 * of the user's email exactly. Wildcards / sub-domain matching land in
 * phase 2 once auth-server owns this.
 */
const DOMAIN_MAP: Record<string, Provider> = {
  // NexySys staff & internal tenants → unified NexySys OAuth (already
  // wired up for the partner portal; reused here for customer login).
  'nexysys.com': { name: 'NexySys', loginUrl: '/api/auth/nexysys/start' },
  'nexyfab.com': { name: 'NexySys', loginUrl: '/api/auth/nexysys/start' },
};

function provider(domain: string): Provider | null {
  return DOMAIN_MAP[domain.toLowerCase()] ?? null;
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email.includes('@')) {
    return NextResponse.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const domain = email.split('@')[1] ?? '';
  if (!domain) {
    return NextResponse.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const p = provider(domain);
  if (!p) {
    return NextResponse.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({
    found: true,
    provider: { name: p.name },
    login_url: p.loginUrl,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
