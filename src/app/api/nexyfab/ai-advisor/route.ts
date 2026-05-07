import { NextRequest, NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimensionAdvice {
  param: string;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  reasonKo: string;
}

type UseCase = 'general' | 'lightweight' | 'high_strength' | 'aesthetic' | 'cost_optimized';

interface LoadContext {
  temperature: 'normal' | 'high' | 'cryogenic';
  environment: 'indoor' | 'outdoor' | 'corrosive' | 'marine';
  priority: 'cost' | 'weight' | 'strength';
}

interface MaterialAdvice {
  recommendedMaterial: string;
  reasonEn: string;
  reasonKo: string;
  alternatives: string[];
}

// ─── Rule-based fallback (server-side mirror of client logic) ─────────────────

function ruleBased(
  shape: string,
  params: Record<string, number>,
  material: string,
  useCase: UseCase,
): DimensionAdvice[] {
  const advice: DimensionAdvice[] = [];

  if ('thickness' in params) {
    const current = params.thickness;
    let suggested = current;
    let reason = '';
    let reasonKo = '';

    if (useCase === 'lightweight') {
      suggested = Math.max(1.5, current * 0.7);
      reason = 'Reduce wall thickness for lightweight design while maintaining minimum structural integrity.';
      reasonKo = '경량화를 위해 최소 구조 강도를 유지하면서 벽 두께를 줄입니다.';
    } else if (useCase === 'high_strength') {
      suggested = Math.min(current * 1.4, current + 5);
      reason = 'Increase wall thickness for improved load-bearing capacity.';
      reasonKo = '하중 지지력을 높이기 위해 벽 두께를 늘립니다.';
    } else if (useCase === 'cost_optimized') {
      suggested = Math.max(2, current * 0.8);
      reason = 'Optimized thickness reduces material usage and machining time.';
      reasonKo = '최적화된 두께로 재료 사용량과 가공 시간을 줄입니다.';
    }

    if (suggested !== current && Math.abs(suggested - current) > 0.05) {
      advice.push({ param: 'thickness', currentValue: current, suggestedValue: Math.round(suggested * 10) / 10, reason, reasonKo });
    }
  }

  if (shape === 'cylinder' && 'diameter' in params && 'height' in params) {
    const d = params.diameter;
    const h = params.height;
    if (useCase === 'high_strength' && h / d > 5) {
      advice.push({
        param: 'diameter',
        currentValue: d,
        suggestedValue: Math.round(h / 4),
        reason: 'High slenderness ratio detected. Increase diameter to prevent buckling.',
        reasonKo: '세장비가 너무 큽니다. 좌굴 방지를 위해 직경을 늘리세요.',
      });
    }
  }

  if (shape === 'gear' && 'module' in params && 'teeth' in params) {
    const m = params.module;
    const t = params.teeth;
    if (useCase === 'high_strength' && m < 2 && t > 20) {
      advice.push({
        param: 'module',
        currentValue: m,
        suggestedValue: Math.max(2, m * 1.5),
        reason: 'Increase module for higher torque capacity with this tooth count.',
        reasonKo: '이 잇수에서 토크 용량을 높이려면 모듈을 늘리세요.',
      });
    }
    if (useCase === 'lightweight' && m > 3) {
      advice.push({
        param: 'module',
        currentValue: m,
        suggestedValue: Math.max(1.5, m * 0.75),
        reason: 'Smaller module reduces gear mass while maintaining acceptable strength.',
        reasonKo: '모듈을 줄이면 강도를 유지하면서 기어 중량을 낮출 수 있습니다.',
      });
    }
  }

  if (material === 'aluminum' && useCase === 'high_strength' && 'thickness' in params) {
    if (!advice.find(a => a.param === 'thickness')) {
      const current = params.thickness;
      advice.push({
        param: 'thickness',
        currentValue: current,
        suggestedValue: Math.round(current * 1.3 * 10) / 10,
        reason: 'Aluminum has lower yield strength than steel. Increase thickness for high-strength application.',
        reasonKo: '알루미늄은 스틸보다 항복 강도가 낮습니다. 고강도 용도에서는 두께를 늘리세요.',
      });
    }
  }

  return advice;
}

function generateDfMFeedback(input: { process?: string; complexity?: number; volume_cm3?: number; bbox?: { w: number; h: number; d: number }; material?: string }): Array<{ severity: 'error' | 'warning' | 'info'; code: string; description: string; recommendation: string }> {
  const issues = [];
  const { process, complexity = 5, volume_cm3 = 0, bbox, material } = input;

  // Thin wall check
  if (bbox) {
    const minDim = Math.min(bbox.w, bbox.h, bbox.d);
    if (minDim < 1.5 && (process === 'cnc' || process === 'cnc_milling')) {
      issues.push({ severity: 'warning' as const, code: 'DFM_THIN_WALL', description: `최소 치수 ${minDim.toFixed(1)}mm — 얇은 벽 감지`, recommendation: '1.5mm 이상 살두께 권장. 가공 진동으로 인한 파손 위험.' });
    }
    // Aspect ratio check
    const maxDim = Math.max(bbox.w, bbox.h, bbox.d);
    if (maxDim / minDim > 8) {
      issues.push({ severity: 'warning' as const, code: 'DFM_HIGH_ASPECT', description: `종횡비 ${(maxDim/minDim).toFixed(1)}:1 — 고종횡비 형상`, recommendation: '긴 축 기준 중간 지지대 추가 또는 분할 가공 검토.' });
    }
  }

  // Complexity warnings
  if (complexity >= 8) {
    issues.push({ severity: 'warning' as const, code: 'DFM_HIGH_COMPLEXITY', description: '복잡도 8+ — 다축 가공 또는 특수 공구 필요 가능', recommendation: '5축 CNC 또는 전극 방전 가공(EDM) 검토. 비용 상승 예상.' });
  }

  // Material-process compatibility
  if (material === 'titanium' && process === 'die_casting') {
    issues.push({ severity: 'error' as const, code: 'DFM_MATERIAL_PROCESS', description: '티타늄 다이캐스팅 불가', recommendation: 'CNC 가공 또는 단조(forging) 사용.' });
  }
  if (material?.includes('plastic') && process === 'cnc_turning') {
    issues.push({ severity: 'info' as const, code: 'DFM_ALT_PROCESS', description: '플라스틱에 CNC 선반 사용 — 비효율', recommendation: '사출성형 또는 3D 프린팅이 더 경제적.' });
  }

  // Volume check for 3D printing
  if (process === '3d_printing' && volume_cm3 > 500) {
    issues.push({ severity: 'warning' as const, code: 'DFM_3DP_LARGE', description: `${volume_cm3.toFixed(0)}cm³ — 3D 프린팅에 큰 부피`, recommendation: '분할 출력 후 접합 또는 CNC 가공 전환 검토.' });
  }

  if (issues.length === 0) {
    issues.push({ severity: 'info' as const, code: 'DFM_OK', description: '주요 DfM 이슈 없음', recommendation: '파트너에게 상세 검토를 요청하세요.' });
  }

  return issues;
}

function ruleBasedMaterial(
  material: string,
  useCase: UseCase,
  loadCtx: LoadContext,
): MaterialAdvice | undefined {
  const { temperature, environment, priority } = loadCtx;
  if (temperature === 'high') {
    if (priority === 'weight') return { recommendedMaterial: 'titanium', reasonEn: 'High-temp + lightweight: Ti-6Al-4V retains strength up to 300°C with best strength-to-weight ratio.', reasonKo: '고온 + 경량: Ti-6Al-4V는 300°C까지 강도 유지 + 최고 비강도.', alternatives: ['stainless', 'steel'] };
    if (environment === 'corrosive' || environment === 'marine') return { recommendedMaterial: 'stainless', reasonEn: 'High-temp + corrosive: SUS304/316 provides combined heat and corrosion resistance.', reasonKo: '고온 + 부식: SUS304/316은 내열·내식성을 동시에 제공합니다.', alternatives: ['titanium'] };
    return { recommendedMaterial: 'steel', reasonEn: 'High-temperature application: Carbon steel is cost-effective for general industrial heat resistance.', reasonKo: '고온 용도: 탄소강은 일반 산업 내열 용도에 경제적입니다.', alternatives: ['stainless', 'titanium'] };
  }
  if (temperature === 'cryogenic') return { recommendedMaterial: 'stainless', reasonEn: 'Cryogenic: Austenitic stainless maintains toughness where carbon steel becomes brittle.', reasonKo: '극저온: 오스테나이트계 스테인리스는 탄소강이 취성화되는 온도에서도 인성을 유지합니다.', alternatives: ['aluminum'] };
  if (environment === 'marine' || environment === 'corrosive') {
    if (priority === 'weight') return { recommendedMaterial: 'aluminum', reasonEn: 'Corrosive/marine + lightweight: Al6061-T6 natural oxide layer + 1/3 weight of steel.', reasonKo: '부식/해양 + 경량: Al6061-T6 자연 산화층 + 스틸 대비 1/3 무게.', alternatives: ['stainless', 'nylon'] };
    return { recommendedMaterial: 'stainless', reasonEn: 'Corrosive/marine: SUS304 provides excellent corrosion resistance at reasonable cost.', reasonKo: '부식/해양: SUS304는 합리적인 비용으로 우수한 내식성 제공.', alternatives: ['aluminum', 'nylon'] };
  }
  if (useCase === 'lightweight' || priority === 'weight') {
    if (material === 'aluminum' || material.includes('abs') || material.includes('nylon')) return undefined;
    return { recommendedMaterial: 'aluminum', reasonEn: 'Lightweight priority: Al6061-T6 σy=276MPa, ρ=2.7g/cm³ — best structural strength-to-weight.', reasonKo: '경량 우선: Al6061-T6 σy=276MPa, ρ=2.7g/cm³ — 최고 비강도.', alternatives: ['nylon', 'abs_white'] };
  }
  if (useCase === 'high_strength' || priority === 'strength') {
    if (material === 'steel') return undefined;
    return { recommendedMaterial: 'steel', reasonEn: 'High-strength: Carbon steel S45C σy=490MPa with excellent machinability and low cost.', reasonKo: '고강도: 탄소강 S45C σy=490MPa, 우수한 피삭성 + 저비용.', alternatives: ['stainless', 'titanium'] };
  }
  if (useCase === 'cost_optimized' || priority === 'cost') {
    if (material === 'steel') return undefined;
    return { recommendedMaterial: 'steel', reasonEn: 'Cost optimization: Carbon steel is the most cost-effective structural material for general machining.', reasonKo: '비용 최적화: 탄소강은 일반 기계 가공에서 가장 경제적인 구조 재료입니다.', alternatives: ['aluminum', 'abs_white'] };
  }
  return undefined;
}

function stripMarkdownJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// POST /api/nexyfab/ai-advisor
export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'ai_advisor');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'AI Advisor requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited AI Advisor.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as {
    shape: string;
    params: Record<string, number>;
    material: string;
    useCase: UseCase;
    lang: string;
    loadContext?: LoadContext;
  };

  const { shape, params, material, useCase, lang, loadContext } = body;
  if (!shape || !params || !material || !useCase) {
    return NextResponse.json({ error: 'shape, params, material, useCase are required' }, { status: 400 });
  }

  // Server-only key — never exposed to client
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  // Rule-based material advice (used regardless of AI availability)
  const materialAdvice = loadContext ? ruleBasedMaterial(material, useCase, loadContext) : undefined;

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'ai_advisor');
    const advice = ruleBased(shape, params, material, useCase);
    return NextResponse.json({
      advice,
      materialAdvice,
      dfmIssues: generateDfMFeedback(body),
      noSuggestions: advice.length === 0,
      noSuggestionsKo: advice.length === 0 ? '현재 파라미터에서 룰 기반 최적화 제안이 없습니다.' : undefined,
    });
  }

  const systemPrompt =
    'You are a mechanical engineering expert specializing in manufacturing optimization. ' +
    'Analyze the provided shape parameters and suggest optimal dimensions. ' +
    'Respond with a JSON object with key "advice": an array of objects, each with these exact keys: ' +
    '"param" (parameter name), "currentValue" (number), "suggestedValue" (number), ' +
    '"reason" (English explanation), "reasonKo" (Korean explanation). ' +
    'Only include parameters that should actually be changed. ' +
    'Keep suggestions practical and within safe engineering tolerances. ' +
    'Do NOT wrap the JSON in markdown code blocks.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ shape, currentParameters: params, material, useCase, loadContext, requestedLanguage: lang }) },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as { advice?: DimensionAdvice[] } | DimensionAdvice[];

    const rawAdvice = Array.isArray(parsed) ? parsed : (parsed.advice ?? []);
    if (!Array.isArray(rawAdvice)) throw new Error('Not an array');

    const advice = rawAdvice
      .filter(item =>
        typeof item.param === 'string' &&
        typeof item.currentValue === 'number' &&
        typeof item.suggestedValue === 'number' &&
        typeof item.reason === 'string' &&
        typeof item.reasonKo === 'string',
      )
      .map(item => ({
        param: item.param,
        currentValue: Number(item.currentValue),
        suggestedValue: Number(item.suggestedValue),
        reason: item.reason,
        reasonKo: item.reasonKo,
      }));

    recordUsageEvent(planCheck.userId, 'ai_advisor');
    return NextResponse.json({ advice, materialAdvice });
  } catch (err) {
    console.warn('[ai-advisor] DeepSeek API call failed, using rule-based fallback:', err);
    const fallbackAdvice = ruleBased(shape, params, material, useCase);
    recordUsageEvent(planCheck.userId, 'ai_advisor');
    return NextResponse.json({
      advice: fallbackAdvice,
      materialAdvice,
      dfmIssues: generateDfMFeedback(body),
      noSuggestions: fallbackAdvice.length === 0,
      noSuggestionsKo: fallbackAdvice.length === 0 ? '현재 파라미터에서 최적화 제안이 없습니다.' : undefined,
    });
  }
}
