export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getUserOrgs } from '@/lib/rbac';
import {
  ACTIVE_ORG_COOKIE,
  PERSONAL_ORG_CONTEXT,
  activeOrgCookieOptions,
} from '@/lib/org-context';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const ORG_SELECTION_JSON_BYTES = 64 * 1024;

const selectionSchema = z.object({
  orgId: z.string().trim().min(1).nullable(),
}).strict();

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    activeOrgId: authUser.activeOrgId,
    orgContextStatus: authUser.orgContextStatus,
    orgs: await getUserOrgs(authUser.userId),
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown = null;
  try {
    rawBody = await readBoundedJson(req, ORG_SELECTION_JSON_BYTES);
  } catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    }
  }
  const parsed = selectionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'orgId must be a non-empty string or null' }, { status: 400 });
  }

  const selectedOrgId = parsed.data.orgId;
  if (selectedOrgId !== null && !authUser.orgIds.includes(selectedOrgId)) {
    return NextResponse.json({ error: 'Organization not found', code: 'ORG_CONTEXT_INVALID' }, { status: 403 });
  }

  const response = NextResponse.json({
    ok: true,
    activeOrgId: selectedOrgId,
    orgContextStatus: selectedOrgId === null ? 'personal' : 'active',
  });
  response.cookies.set(
    ACTIVE_ORG_COOKIE,
    selectedOrgId ?? PERSONAL_ORG_CONTEXT,
    activeOrgCookieOptions(),
  );
  return response;
}
