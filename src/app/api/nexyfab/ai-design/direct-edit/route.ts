import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { planDirectManipulation } from '@/lib/ai/directManipulation';
import { directManipulationDigest } from '@/lib/ai/directManipulationDigest';
import { directManipulationRequestSchema } from '@/lib/ai/directManipulationSchema';

const MAX_BODY_BYTES = 128 * 1024;

/**
 * Validates a gauge/direct-manipulation proposal. This route never mutates CAD.
 * A commit-phase response is only READY_FOR_CAD; Precision CAD must recheck the
 * authoritative revision and return an execution/verification receipt.
 */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await readBoundedJson(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    raw = null;
  }
  const parsed = directManipulationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'INVALID_DIRECT_MANIPULATION_REQUEST',
      issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
  }

  const access = await resolveProjectAccess(getDbAdapter(), parsed.data.intent.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const intentDigestSha256 = directManipulationDigest(parsed.data.intent);
  if (intentDigestSha256 !== parsed.data.intentDigestSha256) {
    return NextResponse.json({ error: 'INTENT_DIGEST_MISMATCH' }, { status: 409 });
  }

  const result = planDirectManipulation(parsed.data.intent, parsed.data.currentRevision);
  if (!result.ok) {
    return NextResponse.json({ error: 'DIRECT_MANIPULATION_BLOCKED', issues: result.issues }, { status: 409 });
  }
  return NextResponse.json({
    proposal: result.proposal,
    proposalDigestSha256: directManipulationDigest(result.proposal),
    executionBoundary: 'precision-cad',
  });
}
