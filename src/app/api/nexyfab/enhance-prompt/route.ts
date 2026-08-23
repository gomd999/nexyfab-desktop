// Prompt-expansion: turn a short, casual part request into a precise, structured
// brief that the OpenSCAD codegen path can model well. The user reviews/edits the
// expanded brief before sending it to generate — a deliberate "refine the ask"
// step. Works best for mechanical/parametric parts; flags organic shapes that
// CSG cannot model so the user is steered to the image→3D mesh path instead.

import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, AiProviderError } from '@/lib/ai';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_JSON_BODY_BYTES = 64 * 1024;

const SYSTEM = `You rewrite a short, casual part request into a precise, structured brief for a parametric OpenSCAD model.
Output ONLY the rewritten brief — no code, no library names, no preamble.
Rules:
- Infer sensible millimetre dimensions where the user omits them, and state them explicitly.
- State the base shape first, then each feature (holes, fillets/chamfers, ribs, bosses, patterns) with sizes and positions.
- Name the key parameters (e.g. length, width, thickness, hole_dia, bolt_pcd, count).
- Keep it concise but complete (a tidy spec, not an essay).
- If the request is an organic shape (vehicle, animal, character, human, terrain), prepend exactly one line:
  "NOTE: organic shape — OpenSCAD/CSG cannot model this well; use an image→3D mesh instead."
- Do NOT include OpenSCAD code or include/use library statements.`;

export async function POST(req: NextRequest) {
  const body = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null)) as { prompt?: string; lang?: string } | null;
  const locale = resolveServerLocale(req, body?.lang, 'kr');
  // 감사 2026-07-16: 무가드 DeepSeek 프록시였음 — 최소 방어(보조 기능이라 슬롯은 미소모, 정직 표기)
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`enhance-prompt:${ip}`, 12, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMITED' }, { status: 429 });
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ error: localizedApiMessage(locale, 'breaker'), code: 'AI_PAUSED' }, { status: 503 });
  } catch { /* ignore */ }
  const prompt = body?.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: localizedApiMessage(locale, 'promptRequired'), code: 'PROMPT_REQUIRED' }, { status: 400 });
  if (prompt.length > 2000) return NextResponse.json({ error: localizedApiMessage(locale, 'promptTooLong'), code: 'PROMPT_TOO_LONG' }, { status: 413 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  // Pin the output language explicitly — "same language as the request" was
  // unreliable (a short KO request like "M6 플랜지" came back in Japanese).
  const langName = locale.languageName;

  try {
    const { text } = await chatCompletion({
      messages: [
        { role: 'system', content: `${SYSTEM}\nWrite the entire brief in ${langName}.` },
        { role: 'user', content: prompt },
      ],
      maxTokens: 700,
      temperature: 0.3,
    });
    const enhanced = (text || '').trim();
    if (!enhanced) return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), code: 'EMPTY_AI_RESPONSE' }, { status: 502 });
    return NextResponse.json({ enhanced, outputLanguage: locale.route });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: localizedApiMessage(locale, 'providerNotConfigured'), code: 'AI_NOT_CONFIGURED' }, { status: 500 });
    if (e instanceof AiProviderError) return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), code: 'AI_PROVIDER_FAILED' }, { status: 502 });
    return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), code: 'ENHANCE_FAILED' }, { status: 500 });
  }
}
