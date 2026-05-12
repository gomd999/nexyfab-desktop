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

export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const { shapeId, params, features, bbox } = await req.json().catch(() => ({}));

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
    { role: 'system', content: promptDef.template },
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
      return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.error('shape-to-jscad AI provider error:', detail);
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  try {
    let jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '');
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
    const parsed = JSON.parse(jsonStr.trim());
    if (!parsed.code) throw new Error('No code');
    return NextResponse.json({ code: parsed.code, description: parsed.description ?? '' });
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }
}
