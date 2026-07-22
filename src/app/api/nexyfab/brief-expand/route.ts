/**
 * POST /api/nexyfab/brief-expand
 *
 * The UPSTREAM clarify→structure pre-pass. A rough one-liner in; a structured,
 * SOURCE-LABELLED draft out ({ given | assumption | needs_input }) plus the
 * clarifying questions to ask back — and a `plannerBrief` already shaped for the
 * existing planners (scad-intent-from-nl / design-driver / eng-domain).
 *
 * This route NEVER fabricates spec numbers: the expander re-grounds every value
 * against the user's own words (see brief-expander/expandBrief.ts).
 *
 * Response: { ok, brief, plannerBrief } | { ok:false, error, code }
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { AiNotConfiguredError, AiProviderError } from '@/lib/ai';
import {
  expandBrief,
  toPlannerBrief,
  BriefExpanderError,
  BRIEF_DOMAINS,
  type BriefDomain,
} from '@/lib/ai/brief-expander';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ ok: false, error: 'text is required', code: 'NO_TEXT' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ ok: false, error: 'text too long (max 2000 chars)', code: 'TOO_LONG' }, { status: 413 });
  }
  const domain: BriefDomain | undefined =
    typeof body.domain === 'string' && (BRIEF_DOMAINS as readonly string[]).includes(body.domain)
      ? (body.domain as BriefDomain)
      : undefined;

  // Light per-IP throttle — this is one cheap LLM round-trip, guest-friendly.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`brief-expand:${ip}`, 30, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'Too many requests — try again later.', code: 'RATE_LIMIT' }, { status: 429 });
  }

  try {
    const brief = await expandBrief(text, domain ? { domain } : {});
    const plannerBrief = toPlannerBrief(brief, 'brief-expand');
    return NextResponse.json({ ok: true, brief, plannerBrief });
  } catch (e) {
    if (e instanceof BriefExpanderError) {
      // The model produced empty/non-JSON output — a transient provider glitch.
      return NextResponse.json({ ok: false, error: 'Could not structure the brief — please rephrase and retry.', code: 'PARSE_FAILED' }, { status: 502 });
    }
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ ok: false, error: 'AI provider not configured', code: 'AI_UNCONFIGURED' }, { status: 500 });
    }
    if (e instanceof AiProviderError) {
      const busy = e.status === 429 || e.status === 503;
      return NextResponse.json(
        { ok: false, error: busy ? 'AI is busy right now — please try again shortly.' : 'AI request failed', code: busy ? 'AI_BUSY' : 'AI_FAILED' },
        { status: busy ? 503 : 502 },
      );
    }
    console.error('brief-expand error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'Unexpected error', code: 'UNKNOWN' }, { status: 500 });
  }
}