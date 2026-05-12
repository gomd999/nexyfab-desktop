/**
 * GET    /api/nexyfab/admin/provider-chain — current override + env defaults.
 * POST   /api/nexyfab/admin/provider-chain — body { chain: ProviderName[] } → set/replace.
 *                                              Empty array clears the override.
 *
 * Uses the same disabled-variants kill-switch pattern: writes to
 * `nf_provider_override`; resolveChain() in chatCompletion() consults the
 * 30s cache before falling back to env vars.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { listProviderOverride, setProviderOverride, listProviderOverrideAudit } from '@/lib/ai/providerOverride';
import type { ProviderName } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS: ProviderName[] = ['deepseek', 'openai', 'anthropic', 'local'];

interface AdminOk { kind: 'ok'; userId: string }
interface AdminFail { kind: 'fail'; response: NextResponse }

async function requireAdmin(req: NextRequest): Promise<AdminOk | AdminFail> {
  const authUser = await getAuthUser(req);
  if (!authUser) return { kind: 'fail', response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return { kind: 'fail', response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { kind: 'ok', userId: authUser.userId };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  const includeAudit = req.nextUrl.searchParams.get('audit') === '1';
  const auditLimit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get('auditLimit') ?? '50', 10)));

  const [override, audit] = await Promise.all([
    listProviderOverride(),
    includeAudit ? listProviderOverrideAudit(auditLimit) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    override,
    envPrimary: (process.env.AI_PROVIDER_PRIMARY ?? 'deepseek').split(',').map(s => s.trim()).filter(Boolean),
    envFallbacks: (process.env.AI_PROVIDER_FALLBACKS ?? 'anthropic,openai,local').split(',').map(s => s.trim()).filter(Boolean),
    valid: VALID_PROVIDERS,
    ...(audit ? { audit } : {}),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  const body = await req.json().catch(() => ({}));
  const chain = Array.isArray(body.chain) ? (body.chain as unknown[]) : null;
  if (chain === null) {
    return NextResponse.json({ error: 'chain (string array) is required' }, { status: 400 });
  }
  // Validate all entries are known providers.
  const cleaned: ProviderName[] = [];
  const seen = new Set<string>();
  for (const item of chain) {
    if (typeof item !== 'string') continue;
    const lower = item.toLowerCase();
    if (!VALID_PROVIDERS.includes(lower as ProviderName)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleaned.push(lower as ProviderName);
  }
  // Reject if requester sent providers but none were valid — surface a clear error.
  if (chain.length > 0 && cleaned.length === 0) {
    return NextResponse.json(
      { error: `No valid providers in chain. Allowed: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 },
    );
  }

  await setProviderOverride(cleaned, auth.userId);
  return NextResponse.json({ ok: true, chain: cleaned, updatedAt: Date.now() });
}
