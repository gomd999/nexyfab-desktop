/**
 * GET    /api/nexyfab/admin/disabled-variants — list current overrides
 * POST   /api/nexyfab/admin/disabled-variants — body { variantId, reason? } → disable
 * DELETE /api/nexyfab/admin/disabled-variants?variantId=… — re-enable
 *
 * Disabled variants force getPromptVariant to return the baseline regardless
 * of rollout fraction. Use after burn-in flags a regression — flip the kill
 * switch first, fix the variant later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import {
  disableVariant,
  enableVariant,
  listDisabledVariants,
} from '@/lib/ai/disabledVariants';
import { listPromptIds } from '@/lib/ai/prompts';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_DISABLED_VARIANT_BODY_BYTES = 16 * 1024;

export const dynamic = 'force-dynamic';

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
  return NextResponse.json({
    disabled: await listDisabledVariants(),
    knownVariants: listPromptIds().filter(id => id.includes(':')),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  let body: Record<string, unknown> = {};
  try { body = await readBoundedJson<Record<string, unknown>>(req, MAX_DISABLED_VARIANT_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const variantId = typeof body.variantId === 'string' ? body.variantId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;

  if (!variantId.includes(':')) {
    return NextResponse.json({ error: 'variantId must include a ":" separator (e.g. "shape-chat:exp-v2")' }, { status: 400 });
  }
  if (!listPromptIds().includes(variantId)) {
    return NextResponse.json({ error: `Unknown variant id: ${variantId}` }, { status: 404 });
  }

  await disableVariant({ variantId, reason, disabledBy: auth.userId });
  return NextResponse.json({ ok: true, variantId, disabledAt: Date.now() });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;
  const variantId = req.nextUrl.searchParams.get('variantId') ?? '';
  if (!variantId.includes(':')) {
    return NextResponse.json({ error: 'variantId must include a ":" separator' }, { status: 400 });
  }
  await enableVariant(variantId);
  return NextResponse.json({ ok: true, variantId });
}
