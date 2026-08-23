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
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { AiNotConfiguredError, AiProviderError } from '@/lib/ai';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { getPrompt } from '@/lib/ai/prompts';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import {
  expandBrief,
  toPlannerBrief,
  BriefExpanderError,
  BRIEF_DOMAINS,
  type BriefDomain,
} from '@/lib/ai/brief-expander';

const MAX_BODY_BYTES = 64 * 1024;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      const locale = resolveServerLocale(req, req.nextUrl.searchParams.get('lang'));
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'promptTooLong'), code: 'TOO_LONG', outputLanguage: locale.route }, { status: 413 });
    }
  }
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'messageRequired'), code: 'NO_TEXT', outputLanguage: locale.route }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'promptTooLong'), code: 'TOO_LONG', outputLanguage: locale.route }, { status: 413 });
  }
  const domain: BriefDomain | undefined =
    typeof body.domain === 'string' && (BRIEF_DOMAINS as readonly string[]).includes(body.domain)
      ? (body.domain as BriefDomain)
      : undefined;

  // Light per-IP throttle — this is one cheap LLM round-trip, guest-friendly.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`brief-expand:${ip}`, 30, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMIT', outputLanguage: locale.route }, { status: 429 });
  }
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;

  try {
    const brief = await expandBrief(text, {
      ...(domain ? { domain } : {}),
      systemPrompt: `${getPrompt('brief-expander').template}\n\n[OUTPUT LANGUAGE CONTRACT] Write user-facing natural-language labels and explanations in ${locale.languageName}; preserve parameter keys, units, and stable domain identifiers.`,
    });
    const plannerBrief = toPlannerBrief(brief, 'brief-expand');
    return NextResponse.json({ ok: true, brief, plannerBrief, outputLanguage: locale.route });
  } catch (e) {
    if (e instanceof BriefExpanderError) {
      // The model produced empty/non-JSON output — a transient provider glitch.
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'invalidAiResponse'), code: 'PARSE_FAILED', outputLanguage: locale.route }, { status: 502 });
    }
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerNotConfigured'), code: 'AI_UNCONFIGURED', outputLanguage: locale.route }, { status: 500 });
    }
    if (e instanceof AiProviderError) {
      const busy = e.status === 429 || e.status === 503;
      return NextResponse.json(
        { ok: false, error: busy ? localizedApiMessage(locale, 'visionBusy') : localizedApiMessage(locale, 'providerFailed'), code: busy ? 'AI_BUSY' : 'AI_FAILED', outputLanguage: locale.route },
        { status: busy ? 503 : 502 },
      );
    }
    console.error('brief-expand error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerFailed'), code: 'UNKNOWN', outputLanguage: locale.route }, { status: 500 });
  }
}
