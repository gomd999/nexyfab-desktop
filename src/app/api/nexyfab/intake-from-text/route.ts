/**
 * POST /api/nexyfab/intake-from-text
 *
 * 자유 텍스트(또는 이미지 설명) 를 LLM 으로 IntakeSpec 으로 변환.
 * Wizard 의 "건너뛰기" 빠른 진입로.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { EMPTY_SPEC } from '@/app/[lang]/shape-generator/intake/intakeSpec';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are an intake parser for NexyFab manufacturing platform.
Convert user's free-form Korean/English description of a product idea into a normalized IntakeSpec JSON.

Allowed enum values:
  category: "mechanical_part" | "structural" | "housing" | "jig_fixture" | "custom"
  function: "fix" | "support" | "connect" | "transmit" | "protect" | "align" | "mount"
  environment: array of: "indoor" | "outdoor" | "humid" | "high_temp" | "low_temp" | "vibration" | "corrosive" | "cleanroom" | "food_grade"
  loadType: "none" | "static" | "dynamic" | "impact" | "cyclic"
  sizeClass: "micro" (<20mm) | "small" (20~100mm) | "medium" (100~300mm) | "large" (300~1000mm) | "xl" (>1000mm)
  quantity: "proto" (1~5) | "small" (10~100) | "mid" (100~1000) | "mass" (1000+)
  budget: "cost" | "quality" | "speed" | "balanced"
  specialReqs: array of: "transparent" | "conductive" | "insulating" | "waterproof" | "lightweight" | "high_precision" | "heat_resistant" | "chemical_resistant" | "food_safe" | "biocompatible"

Optional subCategory (mechanical_part 만): "bracket-l" | "bracket-flat" | "flange-round" | "shaft-cylindrical" | "coupling-rigid" | "standoff" | "gear-spur" | "plate-with-holes" | "cover-plate" | "bearing-seat" | "housing-box"

Inference rules:
- If user says "야외/방수/햇빛" → environment includes "outdoor", "humid", "waterproof" req
- If user says "주방/식품/조리" → environment "food_grade", req "food_safe"
- If user says "대량/공장/N개" → infer quantity tier from N
- If user says "가벼운/경량/드론/항공" → req "lightweight"
- If user says "정밀/마이크론/IT6" → req "high_precision"
- If user says "회전/베어링/모터" → loadType "dynamic"
- If user says "프레임/구조/벽" → category "structural", function "support"
- If user says "케이스/하우징/박스/커버" → category "housing", function "protect"
- If user mentions specific dimensions, fill approxDimensions {w, h, d} in mm and pick the matching sizeClass
- If user is vague, default to: small/balanced/proto/static/indoor/no special reqs
- Always pick the BEST match — even rough guesses are better than nothing
- notes 필드에는 LLM 이 추출하지 못한 사용자의 원문 nuance(브랜드, 색상, 기타 요구) 만 담는다

Return JSON ONLY, matching IntakeSpec interface. No markdown, no prose.

Required fields: category, function, environment[], loadType, sizeClass, quantity, budget, specialReqs[]
Optional: subCategory, approxDimensions, materialPreference, notes

Example output:
{
  "category": "housing",
  "function": "protect",
  "environment": ["outdoor", "humid"],
  "loadType": "static",
  "sizeClass": "small",
  "approxDimensions": {"w": 100, "h": 80, "d": 30},
  "quantity": "small",
  "budget": "balanced",
  "specialReqs": ["waterproof", "lightweight"],
  "notes": "검정색, 10개 정도"
}`;

const VALID_CATEGORY = ['mechanical_part', 'structural', 'housing', 'jig_fixture', 'custom'];
const VALID_FUNCTION = ['fix', 'support', 'connect', 'transmit', 'protect', 'align', 'mount'];
const VALID_ENV = ['indoor', 'outdoor', 'humid', 'high_temp', 'low_temp', 'vibration', 'corrosive', 'cleanroom', 'food_grade'];
const VALID_LOAD = ['none', 'static', 'dynamic', 'impact', 'cyclic'];
const VALID_SIZE = ['micro', 'small', 'medium', 'large', 'xl'];
const VALID_QTY = ['proto', 'small', 'mid', 'mass'];
const VALID_BUDGET = ['cost', 'quality', 'speed', 'balanced'];
const VALID_REQS = ['transparent', 'conductive', 'insulating', 'waterproof', 'lightweight', 'high_precision', 'heat_resistant', 'chemical_resistant', 'food_safe', 'biocompatible'];

function safeEnum<T extends string>(v: any, allowed: T[], fallback: T): T {
  return allowed.includes(v) ? v : fallback;
}
function safeEnumArray<T extends string>(v: any, allowed: T[]): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is T => allowed.includes(x as T));
}

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const { text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || text.trim().length < 4) {
    return NextResponse.json({ error: '설명이 너무 짧습니다 (4자 이상)' }, { status: 400 });
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.trim().slice(0, 2000) },
      ],
      max_tokens: 800,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'AI request failed', status: res.status }, { status: 502 });
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';

  let parsed: any;
  try {
    let s = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    parsed = JSON.parse(s);
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }

  // 화이트리스트 필터링 (LLM 환각 방지)
  const spec = {
    category: safeEnum(parsed.category, VALID_CATEGORY, EMPTY_SPEC.category),
    subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : undefined,
    function: safeEnum(parsed.function, VALID_FUNCTION, EMPTY_SPEC.function),
    environment: safeEnumArray(parsed.environment, VALID_ENV).length > 0
      ? safeEnumArray(parsed.environment, VALID_ENV)
      : EMPTY_SPEC.environment,
    loadType: safeEnum(parsed.loadType, VALID_LOAD, EMPTY_SPEC.loadType),
    sizeClass: safeEnum(parsed.sizeClass, VALID_SIZE, EMPTY_SPEC.sizeClass),
    approxDimensions:
      parsed.approxDimensions &&
      typeof parsed.approxDimensions === 'object' &&
      Number.isFinite(parsed.approxDimensions.w)
        ? {
            w: Number(parsed.approxDimensions.w),
            h: Number(parsed.approxDimensions.h),
            d: Number(parsed.approxDimensions.d),
          }
        : undefined,
    quantity: safeEnum(parsed.quantity, VALID_QTY, EMPTY_SPEC.quantity),
    budget: safeEnum(parsed.budget, VALID_BUDGET, EMPTY_SPEC.budget),
    specialReqs: safeEnumArray(parsed.specialReqs, VALID_REQS),
    materialPreference: typeof parsed.materialPreference === 'string' ? parsed.materialPreference : undefined,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : undefined,
  };

  return NextResponse.json({ spec, sourceText: text.trim().slice(0, 200) });
}
