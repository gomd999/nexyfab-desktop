/**
 * coolantStrategyPicker.ts — Choose coolant strategy for a CAM
 * operation.
 *
 * Coolant options:
 *
 *   - Flood: high volume, ambient pressure. Cheap, but wasteful and
 *     not great for chip evacuation.
 *   - Mist: aerosolized, low volume. Good for aluminum, plastics.
 *   - Through-spindle (TSC): high-pressure coolant via spindle.
 *     Best for deep holes / drilling.
 *   - MQL (Minimum Quantity Lubrication): micro-drops of oil. Best
 *     for stainless / titanium where flood causes thermal shock.
 *   - Dry: no coolant. For some HSM aluminum, cast iron.
 *   - Cryogenic (LN2 / CO2): for nickel alloys, titanium.
 *
 * Module scores each strategy against the operation (material, depth,
 * Re-cuttable expectation, machine capability) and recommends one.
 */

export type Strategy = 'flood' | 'mist' | 'through-spindle' | 'mql' | 'dry' | 'cryogenic';
export type Material = 'aluminum' | 'steel' | 'stainless' | 'titanium' | 'inconel' | 'cast-iron' | 'plastic' | 'copper';
export type Operation = 'milling-roughing' | 'milling-finishing' | 'drilling' | 'tapping' | 'turning' | 'grinding' | 'reaming';

export interface MachineCapabilities {
  hasTSC: boolean;
  hasMQL: boolean;
  hasCryogenic: boolean;
}

export interface OperationContext {
  material: Material;
  operation: Operation;
  depthOverDiameterRatio: number;
  spindleRpm: number;
  /** Whether the part is heat-sensitive (plastic / fine-pitch). */
  heatSensitive?: boolean;
}

export interface StrategyScore {
  strategy: Strategy;
  score: number;       // 0-100
  available: boolean;
  rationale: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function rankStrategies(ctx: OperationContext, caps: MachineCapabilities): StrategyScore[] {
  const all: Strategy[] = ['flood', 'mist', 'through-spindle', 'mql', 'dry', 'cryogenic'];
  return all
    .map(s => ({ ...scoreStrategy(s, ctx, caps), strategy: s }))
    .sort((a, b) => b.score - a.score);
}

function scoreStrategy(strategy: Strategy, ctx: OperationContext, caps: MachineCapabilities): Omit<StrategyScore, 'strategy'> {
  const available = isAvailable(strategy, caps);
  if (!available) {
    return { score: 0, available: false, rationale: 'Machine does not support this coolant strategy.' };
  }
  let score = 50; // baseline
  const reasons: string[] = [];

  // Material rules.
  switch (ctx.material) {
    case 'aluminum':
      if (strategy === 'mist' || strategy === 'mql') { score += 25; reasons.push('Aluminum loves mist/MQL.'); }
      if (strategy === 'flood') { score += 10; reasons.push('Flood OK for aluminum but wasteful.'); }
      if (strategy === 'dry') { score += 5; }
      break;
    case 'stainless':
      if (strategy === 'flood' || strategy === 'mql') { score += 20; reasons.push('Stainless needs lubricated cooling.'); }
      if (strategy === 'mist') { score -= 10; }
      break;
    case 'titanium':
      if (strategy === 'flood' || strategy === 'cryogenic') { score += 25; reasons.push('Titanium ignites dry; need flooding or cryo.'); }
      if (strategy === 'dry') { score -= 50; reasons.push('Titanium dry cutting is dangerous.'); }
      break;
    case 'inconel':
      if (strategy === 'cryogenic') { score += 30; reasons.push('Inconel: cryo gives best tool life.'); }
      if (strategy === 'flood') { score += 15; }
      break;
    case 'cast-iron':
      if (strategy === 'dry') { score += 25; reasons.push('Cast iron prefers dry to keep chips dusty.'); }
      if (strategy === 'flood') { score -= 10; reasons.push('Flood creates abrasive slurry on CI.'); }
      break;
    case 'plastic':
      if (strategy === 'dry' || strategy === 'mist') { score += 20; reasons.push('Plastics avoid coolant absorption.'); }
      if (strategy === 'flood') { score -= 20; }
      break;
    case 'steel':
      if (strategy === 'flood' || strategy === 'mql') { score += 15; }
      break;
    case 'copper':
      if (strategy === 'mist' || strategy === 'mql') { score += 15; }
      break;
  }

  // Operation rules.
  if (ctx.operation === 'drilling' && ctx.depthOverDiameterRatio > 3) {
    if (strategy === 'through-spindle') { score += 25; reasons.push('Deep hole: TSC flushes chips.'); }
    else if (strategy === 'flood') { score += 5; }
    else { score -= 10; }
  }
  if (ctx.operation === 'tapping') {
    if (strategy === 'flood' || strategy === 'mql') { score += 15; reasons.push('Tapping needs lubrication.'); }
    if (strategy === 'dry') { score -= 20; }
  }
  if (ctx.operation === 'grinding') {
    if (strategy === 'flood') { score += 25; reasons.push('Grinding needs heavy flood.'); }
    if (strategy === 'cryogenic') { score -= 10; }
  }
  if (ctx.operation === 'milling-roughing') {
    if (strategy === 'dry' && ctx.material !== 'cast-iron') { score -= 10; }
  }

  // Heat-sensitive overrides.
  if (ctx.heatSensitive && strategy === 'dry') { score -= 20; }

  return {
    score: Math.max(0, Math.min(100, score)),
    available,
    rationale: reasons.join(' ') || 'Default scoring.',
  };
}

function isAvailable(strategy: Strategy, caps: MachineCapabilities): boolean {
  if (strategy === 'through-spindle') return caps.hasTSC;
  if (strategy === 'mql') return caps.hasMQL;
  if (strategy === 'cryogenic') return caps.hasCryogenic;
  return true;
}

// ── Recommend best ────────────────────────────────────────────

export interface Recommendation {
  best: Strategy;
  score: number;
  alternates: Strategy[];
  rationale: string;
}

export function recommend(ctx: OperationContext, caps: MachineCapabilities): Recommendation {
  const ranked = rankStrategies(ctx, caps);
  const best = ranked[0]!;
  const alternates = ranked.slice(1, 3).filter(s => s.score >= 60).map(s => s.strategy);
  return {
    best: best.strategy,
    score: best.score,
    alternates,
    rationale: best.rationale,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CoolantSummary {
  recommended: Strategy;
  recommendedScore: number;
  availableStrategyCount: number;
  alternateCount: number;
}

export function summarize(ctx: OperationContext, caps: MachineCapabilities): CoolantSummary {
  const ranked = rankStrategies(ctx, caps);
  const available = ranked.filter(s => s.available).length;
  const rec = recommend(ctx, caps);
  return {
    recommended: rec.best,
    recommendedScore: rec.score,
    availableStrategyCount: available,
    alternateCount: rec.alternates.length,
  };
}
