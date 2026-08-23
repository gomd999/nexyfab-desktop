/**
 * POST /api/nexyfab/shape-to-jscad
 * Converts existing parametric shape + features into editable JSCAD code.
 * Input: { shapeId, params, features, bbox }
 * Output: { code, description }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;


export async function POST(req: NextRequest) {
  const body = await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({})) as {
    lang?: string;
    shapeId?: string;
    params?: Record<string, number>;
    features?: Array<{ type: string; params: Record<string, number> }>;
    bbox?: { w: number; h: number; d: number };
  };
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const { shapeId, params, features, bbox } = body;

  const featureList = Array.isArray(features) && features.length > 0
    ? `\nApplied features: ${features.map((f: { type: string; params: Record<string, number> }) => `${f.type}(${JSON.stringify(f.params)})`).join(', ')}`
    : '';

  const bboxNote = bbox ? `\nBounding box: ${bbox.w}×${bbox.h}×${bbox.d} mm` : '';

  const userMessage = `Convert this shape to JSCAD code:
Shape type: ${shapeId ?? 'unknown'}
Parameters: ${JSON.stringify(params ?? {})}${bboxNote}${featureList}

Generate accurate JSCAD code that recreates this geometry with the exact same dimensions.`;

  const promptDef = getPrompt('shape-to-jscad');
  const messages: ChatMessage[] = [
    { role: 'system', content: `${promptDef.template}\n\n[OUTPUT LANGUAGE CONTRACT]\nWrite description in ${locale.languageName}; preserve shape IDs, parameter keys, JSCAD code, and standard identifiers.` },
    { role: 'user', content: userMessage },
  ];

  let raw = '';
  try {
    const result = await chatCompletion({
      messages,
      maxTokens: promptDef.defaults.maxTokens,
      temperature: promptDef.defaults.temperature,
      timeoutMs: promptDef.defaults.timeoutMs,
      task: promptDef.id,
    });
    raw = result.text;
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'providerNotConfigured'), outputLanguage: locale.route }, { status: 500 });
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.error('shape-to-jscad AI provider error:', detail);
    return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), outputLanguage: locale.route }, { status: 502 });
  }

  try {
    let jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '');
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
    const parsed = JSON.parse(jsonStr.trim());
    if (!parsed.code) throw new Error('No code');
    return NextResponse.json({ code: parsed.code, description: parsed.description ?? '', outputLanguage: locale.route });
  } catch {
    return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), outputLanguage: locale.route }, { status: 500 });
  }
}
