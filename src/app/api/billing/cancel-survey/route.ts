// Cancellation survey + win-back trigger.
// Recorded when the user cancels. A separate cron (cancel-winback)
// re-checks the list 7 days later and sends a 30%-off offer mail to any
// row marked `winback_eligible = 1`.

import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sanitizeText } from '@/lib/sanitize';

const REASONS = [
  'too_expensive',
  'missing_feature',
  'switched_competitor',
  'no_longer_needed',
  'too_complex',
  'bugs_or_quality',
  'other',
] as const;
const CANCEL_SURVEY_JSON_BYTES = 64 * 1024;

const surveySchema = z.object({
  product: z.enum(['nexyfab', 'nexyflow', 'nexywise', 'nexyremote']).default('nexyfab'),
  reason: z.enum(REASONS),
  competitor: z.string().max(80).optional(),
  feedback: z.string().max(2000).optional(),
  /** May we follow up with discount offer in 7 days? */
  acceptWinback: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let raw: unknown = null;
  try { raw = await readBoundedJson(req, CANCEL_SURVEY_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }
  const parsed = surveySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_cancel_surveys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product TEXT NOT NULL,
      reason TEXT NOT NULL,
      competitor TEXT,
      feedback TEXT,
      winback_eligible INTEGER NOT NULL DEFAULT 1,
      winback_sent_at INTEGER,
      winback_converted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  const id = `csurv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await db.execute(
    `INSERT INTO nf_cancel_surveys
       (id, user_id, product, reason, competitor, feedback, winback_eligible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    authUser.userId,
    parsed.data.product,
    parsed.data.reason,
    parsed.data.competitor ? sanitizeText(parsed.data.competitor) : null,
    parsed.data.feedback ? sanitizeText(parsed.data.feedback) : null,
    parsed.data.acceptWinback ? 1 : 0,
    Date.now(),
  );

  return NextResponse.json({ ok: true, id });
}
