/**
 * POST /api/nexyfab/intake-from-text
 *
 * 자유 텍스트(또는 이미지 설명) 를 LLM 으로 IntakeSpec 으로 변환.
 * Wizard 의 "건너뛰기" 빠른 진입로.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { EMPTY_SPEC } from '@/app/[lang]/shape-generator/intake/intakeSpec';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
const MAX_JSON_BODY_BYTES = 64 * 1024;


const VALID_CATEGORY = ['mechanical_part', 'structural', 'housing', 'jig_fixture', 'custom'];
const VALID_FUNCTION = ['fix', 'support', 'connect', 'transmit', 'protect', 'align', 'mount'];
const VALID_ENV = ['indoor', 'outdoor', 'humid', 'high_temp', 'low_temp', 'vibration', 'corrosive', 'cleanroom', 'food_grade'];
const VALID_LOAD = ['none', 'static', 'dynamic', 'impact', 'cyclic'];
const VALID_SIZE = ['micro', 'small', 'medium', 'large', 'xl'];
const VALID_QTY = ['proto', 'small', 'mid', 'mass'];
const VALID_BUDGET = ['cost', 'quality', 'speed', 'balanced'];
const VALID_REQS = ['transparent', 'conductive', 'insulating', 'waterproof', 'lightweight', 'high_precision', 'heat_resistant', 'chemical_resistant', 'food_safe', 'biocompatible'];

function safeEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  return fallback;
}
function safeEnumArray<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x));
}

export async function POST(req: NextRequest) {
  const body = await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({})) as { text?: unknown; lang?: unknown };
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const text = body.text;
  if (typeof text !== 'string' || text.trim().length < 4) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'messageRequired'), code: 'INTAKE_TEXT_REQUIRED' }, { status: 400 });
  }

  const promptDef = getPrompt('intake-from-text');
  const messages: ChatMessage[] = [
    { role: 'system', content: `${promptDef.template}\n\n[OUTPUT LANGUAGE CONTRACT]\nWrite the optional notes field in ${locale.languageName}. Keep all enum values and JSON keys unchanged.` },
    { role: 'user', content: text.trim().slice(0, 2000) },
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
      return NextResponse.json({ error: localizedApiMessage(locale, 'providerNotConfigured'), code: 'AI_NOT_CONFIGURED' }, { status: 500 });
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.error('intake-from-text AI provider error:', detail);
    return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), code: 'AI_REQUEST_FAILED' }, { status: 502 });
  }

  let parsed: Record<string, unknown>;
  try {
    let s = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    parsed = JSON.parse(s) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), code: 'AI_RESPONSE_INVALID' }, { status: 502 });
  }

  // 화이트리스트 필터링 (LLM 환각 방지)
  const ad = parsed.approxDimensions;
  const approxDimensions =
    ad && typeof ad === 'object' && Number.isFinite((ad as Record<string, unknown>).w)
      ? {
          w: Number((ad as Record<string, unknown>).w),
          h: Number((ad as Record<string, unknown>).h),
          d: Number((ad as Record<string, unknown>).d),
        }
      : undefined;

  const spec = {
    category: safeEnum(parsed.category, VALID_CATEGORY, EMPTY_SPEC.category),
    subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : undefined,
    function: safeEnum(parsed.function, VALID_FUNCTION, EMPTY_SPEC.function),
    environment: safeEnumArray(parsed.environment, VALID_ENV).length > 0
      ? safeEnumArray(parsed.environment, VALID_ENV)
      : EMPTY_SPEC.environment,
    loadType: safeEnum(parsed.loadType, VALID_LOAD, EMPTY_SPEC.loadType),
    sizeClass: safeEnum(parsed.sizeClass, VALID_SIZE, EMPTY_SPEC.sizeClass),
    approxDimensions,
    quantity: safeEnum(parsed.quantity, VALID_QTY, EMPTY_SPEC.quantity),
    budget: safeEnum(parsed.budget, VALID_BUDGET, EMPTY_SPEC.budget),
    specialReqs: safeEnumArray(parsed.specialReqs, VALID_REQS),
    materialPreference: typeof parsed.materialPreference === 'string' ? parsed.materialPreference : undefined,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : undefined,
  };

  return NextResponse.json({ spec, sourceText: text.trim().slice(0, 200), outputLanguage: locale.route });
}
