// ─── AI Dimension Advisor ─────────────────────────────────────────────────────
// Calls the server-side /api/nexyfab/ai-advisor proxy so the DeepSeek API key
// is never exposed in the client bundle.

export interface DimensionAdvice {
  param: string;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  reasonKo: string;
}

export type UseCase = 'general' | 'lightweight' | 'high_strength' | 'aesthetic' | 'cost_optimized';

export interface LoadContext {
  temperature: 'normal' | 'high' | 'cryogenic';   // normal <80°C, high 80-500°C, cryogenic <0°C
  environment: 'indoor' | 'outdoor' | 'corrosive' | 'marine';
  priority: 'cost' | 'weight' | 'strength';
}

export interface MaterialAdvice {
  recommendedMaterial: string;
  reasonEn: string;
  reasonKo: string;
  alternatives: string[];
}

export interface AdviceResult {
  advice: DimensionAdvice[];
  materialAdvice?: MaterialAdvice;
}

// ── Rule-based material recommendation ───────────────────────────────────────

const MATERIAL_LABELS: Record<string, string> = {
  aluminum: 'Aluminum (Al6061)',
  steel: 'Carbon Steel (S45C)',
  stainless: 'Stainless Steel (SUS304)',
  titanium: 'Titanium (Ti-6Al-4V)',
  abs_white: 'ABS Plastic',
  nylon: 'Nylon (PA12)',
  brass: 'Brass (C3604)',
  copper: 'Copper (C1100)',
};

function ruleBasedMaterial(
  material: string,
  useCase: UseCase,
  loadCtx: LoadContext,
): MaterialAdvice | undefined {
  const { temperature, environment, priority } = loadCtx;

  // High temperature — metal only
  if (temperature === 'high') {
    if (priority === 'weight') {
      return {
        recommendedMaterial: 'titanium',
        reasonEn: 'High-temperature + lightweight priority: Ti-6Al-4V retains strength up to 300°C with the best strength-to-weight ratio.',
        reasonKo: '고온 + 경량 우선: Ti-6Al-4V는 300°C까지 강도를 유지하며 최고의 비강도를 제공합니다.',
        alternatives: ['stainless', 'steel'],
      };
    }
    if (environment === 'corrosive' || environment === 'marine') {
      return {
        recommendedMaterial: 'stainless',
        reasonEn: 'High temperature + corrosive environment: SUS304/316 provides both heat resistance and corrosion protection.',
        reasonKo: '고온 + 부식 환경: SUS304/316은 내열성과 내식성을 동시에 제공합니다.',
        alternatives: ['titanium'],
      };
    }
    return {
      recommendedMaterial: 'steel',
      reasonEn: 'High-temperature application: Carbon steel offers cost-effective heat resistance for general industrial use.',
      reasonKo: '고온 용도: 탄소강은 일반 산업용에서 경제적인 내열 성능을 제공합니다.',
      alternatives: ['stainless', 'titanium'],
    };
  }

  // Cryogenic
  if (temperature === 'cryogenic') {
    return {
      recommendedMaterial: 'stainless',
      reasonEn: 'Cryogenic conditions: Austenitic stainless steel maintains toughness at very low temperatures where carbon steel becomes brittle.',
      reasonKo: '극저온 조건: 오스테나이트계 스테인리스강은 탄소강이 취성을 나타내는 저온에서도 인성을 유지합니다.',
      alternatives: ['aluminum'],
    };
  }

  // Marine / corrosive
  if (environment === 'marine' || environment === 'corrosive') {
    if (priority === 'cost') {
      return {
        recommendedMaterial: 'stainless',
        reasonEn: 'Corrosive/marine environment: SUS304 stainless provides excellent corrosion resistance at a reasonable cost.',
        reasonKo: '부식/해양 환경: SUS304 스테인리스는 합리적인 비용으로 우수한 내식성을 제공합니다.',
        alternatives: ['aluminum', 'nylon'],
      };
    }
    if (priority === 'weight') {
      return {
        recommendedMaterial: 'aluminum',
        reasonEn: 'Corrosive/marine + lightweight: Aluminum 6061-T6 forms a natural oxide layer for corrosion protection while being 1/3 the weight of steel.',
        reasonKo: '부식/해양 + 경량: 알루미늄 6061-T6는 자연 산화층으로 내식성을 가지면서 스틸 대비 1/3 무게입니다.',
        alternatives: ['stainless', 'nylon'],
      };
    }
  }

  // Normal environment — use-case + priority driven
  if (useCase === 'lightweight' || priority === 'weight') {
    if (material.includes('abs') || material.includes('nylon') || material.includes('resin')) {
      return undefined; // already a lightweight material, no change needed
    }
    return {
      recommendedMaterial: 'aluminum',
      reasonEn: 'Lightweight priority: Aluminum 6061-T6 offers a superior strength-to-weight ratio (σy=276MPa, ρ=2.7g/cm³) for structural components.',
      reasonKo: '경량 우선: 알루미늄 6061-T6는 우수한 비강도(σy=276MPa, ρ=2.7g/cm³)로 구조 부품에 적합합니다.',
      alternatives: ['nylon', 'abs_white'],
    };
  }

  if (useCase === 'high_strength' || priority === 'strength') {
    if (material === 'steel') return undefined; // already optimal
    return {
      recommendedMaterial: 'steel',
      reasonEn: 'High-strength priority: Carbon steel (S45C) provides σy=490MPa with excellent machinability and cost-effectiveness.',
      reasonKo: '고강도 우선: 탄소강(S45C)은 σy=490MPa의 인장 강도와 우수한 피삭성, 경제성을 제공합니다.',
      alternatives: ['stainless', 'titanium'],
    };
  }

  if (useCase === 'cost_optimized' || priority === 'cost') {
    if (material === 'steel') return undefined;
    return {
      recommendedMaterial: 'steel',
      reasonEn: 'Cost optimization: Carbon steel is the most cost-effective structural material for general machining applications.',
      reasonKo: '비용 최적화: 탄소강은 일반 기계 가공 용도에서 가장 경제적인 구조용 재료입니다.',
      alternatives: ['aluminum', 'abs_white'],
    };
  }

  return undefined;
}

// ── Rule-based dimension fallback ─────────────────────────────────────────────

function ruleBased(
  shape: string,
  params: Record<string, number>,
  material: string,
  useCase: UseCase,
  loadCtx?: LoadContext,
): AdviceResult {
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

  const dimensionAdvice = advice.length > 0 ? advice : [{
    param: Object.keys(params)[0] ?? 'size',
    currentValue: Object.values(params)[0] ?? 0,
    suggestedValue: Object.values(params)[0] ?? 0,
    reason: 'Current dimensions are well-suited for the selected use case and material.',
    reasonKo: '현재 치수는 선택된 용도와 재질에 적합합니다.',
  }];

  const materialAdvice = loadCtx ? ruleBasedMaterial(material, useCase, loadCtx) : undefined;
  return { advice: dimensionAdvice, materialAdvice };
}

// ── Server proxy call ─────────────────────────────────────────────────────────

export async function getAIDimensionAdvice(
  shape: string,
  params: Record<string, number>,
  material: string,
  useCase: UseCase,
  lang: string,
  loadContext?: LoadContext,
): Promise<AdviceResult> {
  try {
    const response = await fetch('/api/nexyfab/ai-advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape, params, material, useCase, lang, loadContext }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`ai-advisor proxy error: ${response.status}`);
    }

    const data = await response.json() as { advice?: DimensionAdvice[]; materialAdvice?: MaterialAdvice };
    if (!Array.isArray(data.advice)) throw new Error('Invalid response shape');
    return { advice: data.advice, materialAdvice: data.materialAdvice };
  } catch (err) {
    console.warn('[aiDimensionAdvisor] proxy call failed, using rule-based fallback:', err);
    return ruleBased(shape, params, material, useCase, loadContext);
  }
}
