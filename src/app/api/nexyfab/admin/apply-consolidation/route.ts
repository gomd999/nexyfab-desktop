/**
 * POST /api/nexyfab/admin/apply-consolidation
 *
 * One-click apply for a consolidation hint emitted by /admin/prompt-compare.
 * Atomically:
 *   1. Reads the current effective provider chain (DB override or env defaults).
 *   2. Removes the `drop` provider, ensures `keep` is present at the front.
 *   3. Persists the new chain via setProviderOverride() — writes the audit row.
 *
 * Body: { keep: { provider }, drop: { provider } }
 * Response: { ok, oldChain, newChain }
 *
 * Why the server resolves the chain instead of the client passing it:
 *   - the client only ever knows what the compare run returned, not what the
 *     active override currently is.
 *   - prevents stale-state edits where two admins edited the chain and the
 *     "Apply" click would overwrite a peer's reorder.
 *
 * Auth: super_admin / org_admin (same as the rest of the admin AI endpoints).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import {
  loadProviderOverride,
  setProviderOverride,
  applyConsolidation,
} from '@/lib/ai/providerOverride';
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

function envChain(): ProviderName[] {
  const primary = (process.env.AI_PROVIDER_PRIMARY ?? 'deepseek')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const fallbacks = (process.env.AI_PROVIDER_FALLBACKS ?? 'anthropic,openai,local')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const merged: ProviderName[] = [];
  const seen = new Set<string>();
  for (const p of [...primary, ...fallbacks]) {
    if (!VALID_PROVIDERS.includes(p as ProviderName)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    merged.push(p as ProviderName);
  }
  return merged;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  const body = await req.json().catch(() => ({}));
  const keep = typeof body?.keep?.provider === 'string'
    ? body.keep.provider.toLowerCase() : '';
  const drop = typeof body?.drop?.provider === 'string'
    ? body.drop.provider.toLowerCase() : '';

  if (!VALID_PROVIDERS.includes(keep as ProviderName)) {
    return NextResponse.json({ error: `Invalid keep provider: ${keep}` }, { status: 400 });
  }
  if (!VALID_PROVIDERS.includes(drop as ProviderName)) {
    return NextResponse.json({ error: `Invalid drop provider: ${drop}` }, { status: 400 });
  }
  if (keep === drop) {
    return NextResponse.json({ error: 'keep and drop must differ' }, { status: 400 });
  }

  // Resolve effective chain: DB override if set, otherwise env defaults.
  const dbChain = await loadProviderOverride(true);
  const oldChain: ProviderName[] = dbChain ?? envChain();

  const newChain = applyConsolidation(oldChain, keep as ProviderName, drop as ProviderName);

  await setProviderOverride(newChain, auth.userId);

  return NextResponse.json({
    ok: true,
    oldChain,
    newChain,
    appliedAt: Date.now(),
  });
}
