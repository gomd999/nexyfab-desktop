/**
 * POST /api/nexyfab/openscad-gen
 * (경로명은 역사적 — 응답 본문은 **@jscad/modeling** JavaScript, OpenSCAD 언어 아님.)
 * Modes:
 *   generate  — natural language → new JSCAD code
 *   refine    — modify existing code based on follow-up prompt
 *   fix       — auto-fix compile error in existing code
 *   face-op   — apply an operation to a specific face of existing code
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';

export const dynamic = 'force-dynamic';

const MODE_TO_PROMPT_ID: Record<'generate' | 'refine' | 'fix' | 'face-op', string> = {
  generate: 'openscad-gen-generate',
  refine: 'openscad-gen-refine',
  fix: 'openscad-gen-fix',
  'face-op': 'openscad-gen-face-op',
};

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const body = await req.json().catch(() => ({}));
  const {
    prompt = '',
    currentCode,
    errorMsg,
    selectedFace,
    mode = 'generate',
  } = body as {
    prompt?: string;
    currentCode?: string;
    errorMsg?: string;
    selectedFace?: { normal: number[]; normalLabel: string; area: number; position: number[] };
    mode?: 'generate' | 'refine' | 'fix' | 'face-op';
  };

  let resolvedMode: 'generate' | 'refine' | 'fix' | 'face-op' = 'generate';
  let userMessage: string;

  if (mode === 'fix' && currentCode && errorMsg) {
    resolvedMode = 'fix';
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nERROR:\n${errorMsg}`;
  } else if (mode === 'refine' && currentCode) {
    resolvedMode = 'refine';
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nUSER REQUEST: ${prompt}`;
  } else if (mode === 'face-op' && currentCode && selectedFace) {
    resolvedMode = 'face-op';
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nSELECTED FACE:\n- Direction: ${selectedFace.normalLabel} (normal: [${selectedFace.normal.map(n => n.toFixed(2)).join(', ')}])\n- Area: ${selectedFace.area.toFixed(1)} mm²\n- Click position: [${selectedFace.position.map(p => p.toFixed(1)).join(', ')}] mm\n\nUSER REQUEST: ${prompt}`;
  } else {
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }
    resolvedMode = 'generate';
    userMessage = prompt;
  }

  const promptDef = getPrompt(MODE_TO_PROMPT_ID[resolvedMode]);
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
    console.error('openscad-gen AI provider error:', detail);
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  try {
    let jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '');
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
    const parsed = JSON.parse(jsonStr.trim());

    if (!parsed.code || typeof parsed.code !== 'string') throw new Error('No code');

    return NextResponse.json({
      code: parsed.code,
      description: parsed.description ?? '',
      dims: parsed.dims ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }
}
