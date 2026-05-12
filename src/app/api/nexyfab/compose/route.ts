/**
 * POST /api/nexyfab/compose
 *
 * L5 Composition Agent — IntakeSpec 를 받아:
 *  1) Scoring 엔진으로 상위 후보 bundle 계산
 *  2) LLM 이 bundle 중 최유력 조합 선택 + 파라미터 확정 + JSCAD 코드 합성
 *  3) 설계 근거 리포트 반환
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import type { IntakeSpec } from '@/app/[lang]/shape-generator/intake/intakeSpec';
import {
  buildCandidates,
  scoreParts,
  scoreMethods,
  scoreMaterials,
  type CandidateBundle,
} from '@/app/[lang]/shape-generator/library/scoring';
import { PARTS_BY_ID, renderPart } from '@/app/[lang]/shape-generator/library/parts';
import { METHODS_BY_ID } from '@/app/[lang]/shape-generator/library/methods';
import { MATERIALS_BY_ID } from '@/app/[lang]/shape-generator/library/materials';
import { estimateUnitCost } from '@/app/[lang]/shape-generator/library/costing';
import { sizeClassToDims, quantityTierToCount } from '@/app/[lang]/shape-generator/intake/intakeSpec';

export const dynamic = 'force-dynamic';


function safeParseJson(raw: string): unknown {
  let s = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const spec = body.spec as IntakeSpec | undefined;
  if (!spec || !spec.category) {
    return NextResponse.json({ error: 'IntakeSpec required' }, { status: 400 });
  }
  // 사용자가 특정 layer 를 강제로 고정한 경우 (Result Panel 의 swap 액션)
  const force = (body.force ?? {}) as { partId?: string; methodId?: string; materialId?: string };

  // 1) 스코어링 엔진으로 후보 생성
  const allBundles = buildCandidates(spec, 30);
  // force 된 layer 가 있으면 해당 bundle 만 통과
  const filtered = allBundles.filter((b) => {
    if (force.partId && b.part.item.id !== force.partId) return false;
    if (force.methodId && b.method.item.id !== force.methodId) return false;
    if (force.materialId && b.material.item.id !== force.materialId) return false;
    return true;
  });
  const bundles = filtered.length > 0 ? filtered.slice(0, 6) : allBundles.slice(0, 6);
  const topParts = scoreParts(spec).slice(0, 5);
  const topMethods = scoreMethods(spec).slice(0, 5);
  const topMaterials = scoreMaterials(spec).slice(0, 5);

  if (bundles.length === 0) {
    return NextResponse.json(
      {
        error: '호환되는 부품/제조법/재료 조합을 찾지 못했습니다.',
        spec,
      },
      { status: 422 }
    );
  }

  // 2) LLM 입력 페이로드 구성
  const bundleSummary = bundles.map((b, i) => {
    const p = b.part.item;
    const m = b.method.item;
    const mat = b.material.item;
    const paramsList = p.parameters
      .map((pr) => `${pr.name}[${pr.min}~${pr.max}${pr.unit}, default ${pr.default}]`)
      .join(', ');
    return `[#${i + 1} score=${b.totalScore}]
  Part: ${p.id} — ${p.nameKo} (${p.description})
    params: ${paramsList}
    snippet has {{placeholders}} to fill.
  Method: ${m.id} — ${m.nameKo} | 공차 ±${m.toleranceMm}mm, ${m.leadTimeDays[0]}~${m.leadTimeDays[1]}일
  Material: ${mat.id} — ${mat.nameKo} | ${mat.description}`;
  }).join('\n\n');

  // 3) 선택된 후보의 파트 스니펫 전부 제공 (LLM 이 코드 합성용으로 사용)
  const snippetBlock = bundles
    .slice(0, 3)
    .map((b) => `// ═══ Part ${b.part.item.id} 원본 스니펫 ═══\n${b.part.item.jscadSnippet}`)
    .join('\n\n');

  const userMessage = `IntakeSpec (사용자 아이디어):
${JSON.stringify(spec, null, 2)}

Top candidate bundles (부품+제조법+재료 사전 스코어링 결과):

${bundleSummary}

Reference JSCAD snippets (선택한 partId 의 snippet 을 기반으로 코드 합성하세요):

${snippetBlock}

Pick the best bundle (don't have to be #1 if another fits user's specific needs better), fill params, generate JSCAD code, and return the JSON.`;

  const promptDef = getPrompt('compose');
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
    console.error('compose AI provider error:', detail);
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = safeParseJson(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }

  // 4) LLM 결과 검증 + 폴백
  const isFreeform = parsed.partId === 'freeform-custom' || parsed.freeform === true;
  const chosenPart = isFreeform ? null : PARTS_BY_ID[String(parsed.partId)];
  const chosenMethod = METHODS_BY_ID[String(parsed.methodId)];
  const chosenMaterial = MATERIALS_BY_ID[String(parsed.materialId)];

  if ((!chosenPart && !isFreeform) || !chosenMethod || !chosenMaterial) {
    // LLM 이 존재하지 않는 id 를 반환한 경우 → 상위 bundle 로 폴백
    const fallback = bundles[0];
    const fallbackCode = renderPart(fallback.part.item.id, paramDefaults(fallback.part.item));
    return NextResponse.json({
      partId: fallback.part.item.id,
      methodId: fallback.method.item.id,
      materialId: fallback.material.item.id,
      params: paramDefaults(fallback.part.item),
      code: wrapJscadMain(fallbackCode),
      rationale: ['AI 응답 검증 실패 → 최고 점수 조합으로 폴백'],
      fallback: true,
      bundles: bundles.slice(0, 3).map(summarizeBundle),
    });
  }

  // 5) 파라미터 bound check + 누락시 default
  const safeParams: Record<string, number> = {};
  const paramsRec = parsed.params as Record<string, unknown> | undefined;
  if (chosenPart) {
    for (const prm of chosenPart.parameters) {
      const v = Number(paramsRec?.[prm.name]);
      if (Number.isFinite(v)) {
        safeParams[prm.name] = Math.max(prm.min, Math.min(prm.max, v));
      } else {
        safeParams[prm.name] = prm.default;
      }
    }
  } else if (isFreeform && paramsRec) {
    // freeform: LLM 파라미터를 그대로 수용 (숫자만)
    for (const [k, v] of Object.entries(paramsRec)) {
      if (Number.isFinite(Number(v))) safeParams[k] = Number(v);
    }
  }

  // 6) 코드가 비었으면 스니펫 렌더링으로 대체
  let code: string;
  if (typeof parsed.code === 'string' && parsed.code.trim().length > 50) {
    code = parsed.code;
  } else if (chosenPart) {
    code = wrapJscadMain(renderPart(chosenPart.id, safeParams));
  } else {
    // freeform + 빈 코드 → 폴백 bundle 로
    const fallback = bundles[0];
    code = wrapJscadMain(renderPart(fallback.part.item.id, paramDefaults(fallback.part.item)));
  }

  // JSCAD main 함수 모양 보정
  if (!/module\.exports\s*=/.test(code)) {
    code = code.trimEnd() + '\n\nmodule.exports = { main };\n';
  }

  // 단가 추정
  const fallbackDims = spec.approxDimensions || sizeClassToDims(spec.sizeClass);
  const unitsPerOrder = quantityTierToCount(spec.quantity);
  const cost = estimateUnitCost(
    chosenPart?.id ?? 'freeform-custom',
    safeParams,
    chosenMethod.id,
    chosenMaterial.id,
    fallbackDims,
    unitsPerOrder
  );

  return NextResponse.json({
    partId: chosenPart?.id ?? 'freeform-custom',
    methodId: chosenMethod.id,
    materialId: chosenMaterial.id,
    partNameKo: chosenPart?.nameKo ?? '맞춤 설계',
    methodNameKo: chosenMethod.nameKo,
    materialNameKo: chosenMaterial.nameKo,
    params: safeParams,
    code,
    freeform: isFreeform,
    rationale: Array.isArray(parsed.rationale) ? (parsed.rationale as unknown[]) : [],
    estimate: {
      toleranceMm: chosenMethod.toleranceMm,
      leadTimeDays: chosenMethod.leadTimeDays,
      materialPricePerKgUsd: chosenMaterial.pricePerKgUsd,
      unitCostUsd: cost?.totalUnitUsd,
      mass_g: cost?.mass_g,
      volume_cm3: cost?.volume_cm3,
      setupOnceUsd: cost?.setupOnceUsd,
      unitsPerOrder,
      breakdown: cost ? {
        materialUsd: cost.materialCostUsd,
        machiningUsd: cost.machiningCostUsd,
        notes: cost.notes,
      } : undefined,
    },
    alternatives: {
      parts: topParts.slice(0, 3).map((p) => ({ id: p.item.id, name: p.item.nameKo, score: p.score })),
      methods: topMethods.slice(0, 3).map((m) => ({ id: m.item.id, name: m.item.nameKo, score: m.score })),
      materials: topMaterials.slice(0, 3).map((m) => ({ id: m.item.id, name: m.item.nameKo, score: m.score })),
    },
    bundles: bundles.slice(0, 3).map(summarizeBundle),
  });
}

function paramDefaults(part: { parameters: { name: string; default: number }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of part.parameters) out[p.name] = p.default;
  return out;
}

function wrapJscadMain(snippet: string): string {
  if (/const\s+main\s*=/.test(snippet) || /function\s+main/.test(snippet)) {
    return /module\.exports\s*=/.test(snippet)
      ? snippet
      : snippet.trimEnd() + '\n\nmodule.exports = { main };\n';
  }
  return `const jscad = require('@jscad/modeling');
const { primitives, booleans, transforms } = jscad;

const main = () => {
${snippet}
};

module.exports = { main };
`;
}

function summarizeBundle(b: CandidateBundle) {
  return {
    partId: b.part.item.id,
    methodId: b.method.item.id,
    materialId: b.material.item.id,
    totalScore: b.totalScore,
    summary: b.summary,
  };
}
