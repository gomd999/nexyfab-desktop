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
import type { IntakeSpec } from '@/app/[lang]/shape-generator/intake/intakeSpec';
import {
  buildCandidates,
  scoreParts,
  scoreMethods,
  scoreMaterials,
} from '@/app/[lang]/shape-generator/library/scoring';
import { PARTS_BY_ID, renderPart } from '@/app/[lang]/shape-generator/library/parts';
import { METHODS_BY_ID } from '@/app/[lang]/shape-generator/library/methods';
import { MATERIALS_BY_ID } from '@/app/[lang]/shape-generator/library/materials';
import { estimateUnitCost } from '@/app/[lang]/shape-generator/library/costing';
import { sizeClassToDims, quantityTierToCount } from '@/app/[lang]/shape-generator/intake/intakeSpec';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a manufacturing design agent for NexyFab.

Your task: Given (a) a user's IntakeSpec, (b) pre-scored candidate bundles of (Part + Method + Material), select the best combination and return:
 - The chosen part template ID (from candidates) OR "freeform-custom" if none fit
 - Parameter values for the part (mm / deg / count)
 - Refined JSCAD code that implements the design
 - Manufacturing method ID and Material ID
 - Korean design rationale (설계 근거) in 2-4 concise bullet points

Rules:
1. PREFER candidates — only use "freeform-custom" if the top bundle score < 55 AND no candidate part matches user intent.
2. When using "freeform-custom", partId MUST equal "freeform-custom". Method/Material MUST still come from the candidates list.
3. Parameter values must respect each parameter's min/max bounds and IntakeSpec size class.
4. If user provided approxDimensions, use them to derive part parameters (use approxDimensions as primary size hints).
5. Start the JSCAD code from the chosen part's snippet with {{placeholders}} replaced by real numbers.
   For freeform-custom, write bespoke JSCAD that captures the user's specific geometry.
6. All code must be valid @jscad/modeling JS. Import destructure at top:
   const { primitives, booleans, transforms } = jscad;
   Export: module.exports = { main };
7. Keep rationale concise — a developer should understand *why* these choices in 10 seconds.

Return JSON only (no markdown, no prose outside JSON):
{
  "partId": "bracket-l",
  "methodId": "cnc-mill-3ax",
  "materialId": "al-6061",
  "params": { "width": 80, "height": 60, "depth": 50, ... },
  "code": "const { primitives, booleans, transforms } = jscad;\\n...\\nconst main = () => {...};\\nmodule.exports = { main };",
  "rationale": ["선택 근거 1", "선택 근거 2", ...],
  "freeform": false
}`;

function safeParseJson(raw: string): any {
  let s = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const spec: IntakeSpec | undefined = body.spec;
  if (!spec || !spec.category) {
    return NextResponse.json({ error: 'IntakeSpec required' }, { status: 400 });
  }
  // 사용자가 특정 layer 를 강제로 고정한 경우 (Result Panel 의 swap 액션)
  const force: { partId?: string; methodId?: string; materialId?: string } = body.force ?? {};

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

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
  }

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

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deepseekKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 3500,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'AI request failed', status: res.status }, { status: 502 });
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';

  let parsed: any;
  try {
    parsed = safeParseJson(raw);
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }

  // 4) LLM 결과 검증 + 폴백
  const isFreeform = parsed.partId === 'freeform-custom' || parsed.freeform === true;
  const chosenPart = isFreeform ? null : PARTS_BY_ID[parsed.partId];
  const chosenMethod = METHODS_BY_ID[parsed.methodId];
  const chosenMaterial = MATERIALS_BY_ID[parsed.materialId];

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
  if (chosenPart) {
    for (const prm of chosenPart.parameters) {
      const v = Number(parsed.params?.[prm.name]);
      if (Number.isFinite(v)) {
        safeParams[prm.name] = Math.max(prm.min, Math.min(prm.max, v));
      } else {
        safeParams[prm.name] = prm.default;
      }
    }
  } else if (isFreeform && parsed.params && typeof parsed.params === 'object') {
    // freeform: LLM 파라미터를 그대로 수용 (숫자만)
    for (const [k, v] of Object.entries(parsed.params)) {
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
    rationale: Array.isArray(parsed.rationale) ? parsed.rationale : [],
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

function summarizeBundle(b: any) {
  return {
    partId: b.part.item.id,
    methodId: b.method.item.id,
    materialId: b.material.item.id,
    totalScore: b.totalScore,
    summary: b.summary,
  };
}
