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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

const LANG_NAME: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', cn: 'Chinese', es: 'Spanish', ar: 'Arabic',
};

export async function POST(req: NextRequest) {
  // 감사 2026-07-16: 무가드 DeepSeek 프록시였음 — 최소 방어(보조 기능이라 슬롯은 미소모, 정직 표기)
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`enhance-prompt:${ip}`, 12, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ error: 'AI가 일시 중지되어 있습니다.' }, { status: 503 });
  } catch { /* ignore */ }
  const body = (await req.json().catch(() => null)) as { prompt?: string; lang?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length > 2000) return NextResponse.json({ error: 'prompt too long (max 2000 chars)' }, { status: 413 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  // Pin the output language explicitly — "same language as the request" was
  // unreliable (a short KO request like "M6 플랜지" came back in Japanese).
  const langName = LANG_NAME[body?.lang ?? 'ko'] ?? 'English';

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
    if (!enhanced) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 });
    return NextResponse.json({ enhanced });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    if (e instanceof AiProviderError) return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    return NextResponse.json({ error: 'enhance failed' }, { status: 500 });
  }
}
