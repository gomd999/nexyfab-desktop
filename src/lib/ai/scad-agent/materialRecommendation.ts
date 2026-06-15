/**
 * materialRecommendation.ts — Track M: AI material recommendation.
 *
 * Heuristic v1 mirror of processSelection.ts: each material starts at a
 * base score and accumulates +/- modifiers based on the part's intended
 * process, service environment, mechanical loading, budget tier, and
 * production quantity. Hard incompatibilities (metal on FDM, plastic
 * dies, PLA at high-temp) zero the score AND surface as `blockers` so
 * the agent can explain WHY a material is off the table.
 *
 * The output keeps all 6 materials in the list (sorted descending by
 * score) so the agent has a visible trade-off table — the caller decides
 * how many to surface to the user. Blocked materials (score = 0) sort to
 * the bottom; the caller should skip them when picking a top recommendation
 * but still show them with the blocker text for transparency.
 *
 * Why not a model-trained ranker? v1 needs to be cheap, deterministic and
 * cite-able. The rules below mirror the ASM-handbook-style guidance in
 * `engineeringCatalog.ts` so a user can follow the reasoning. v2 can fold
 * in shop quote history / accepted-recommendation telemetry once we have
 * the data — the agent surface (suggest_material tool) stays identical.
 *
 * Pure / additive — no mutation of session, no network, no async.
 */

import type { Material } from './costEstimation';
import type { ProcessForDfm } from './specVerification';

export interface MaterialScore {
  material: Material;
  /** 0..100, higher = better fit. */
  score: number;
  /** Headline rationale shown to the user. */
  reason: string;
  /** Hard incompatibilities (e.g. metal on FDM). Force score = 0. */
  blockers: string[];
  /** Soft concerns (e.g. "PLA above 50°C softens"). */
  warnings: string[];
  /** Cost per kg used in the ranking — surfaced so the caller can show
   *  the per-kg price alongside the headline score. */
  pricePerKgUsd: number;
}

export interface SuggestMaterialOptions {
  /** Process this part will be made by — narrows compatible materials. */
  process?: ProcessForDfm;
  /** Service environment. 'outdoor' favors corrosion-resistant (304, anodized Al);
   *  'food' restricts to food-safe (304, certain plastics).
   *  'high_temp' (≥80°C) blocks PLA / ABS for outdoor sun. */
  environment?: 'indoor' | 'outdoor' | 'food' | 'high_temp' | 'marine';
  /** Mechanical loading hint. 'structural' favors steel/aluminum;
   *  'cosmetic' allows plastics. */
  loading?: 'cosmetic' | 'light' | 'structural';
  /** Budget tier. 'cheap' biases toward A36/PLA; 'premium' opens 4140/304SS. */
  budget?: 'cheap' | 'standard' | 'premium';
  /** Quantity hint — high quantity favors materials cheap to source in bulk. */
  quantityHint?: number;
}

/**
 * Density (g/cm³) + spot price ($/kg) + metal/plastic flag. Mirrors the
 * MATERIAL_PHYSICS table in costEstimation.ts. Kept here (rather than
 * re-exported from costEstimation) so this module stays standalone and
 * tests don't need to import the cost helper.
 */
const MATERIAL_PHYSICS: Record<Material, { densityGPerCm3: number; priceUsdPerKg: number; type: 'metal' | 'plastic' }> = {
  aluminum_6061: { densityGPerCm3: 2.70, priceUsdPerKg: 5,   type: 'metal' },
  steel_a36:     { densityGPerCm3: 7.85, priceUsdPerKg: 1.5, type: 'metal' },
  steel_4140:    { densityGPerCm3: 7.85, priceUsdPerKg: 4,   type: 'metal' },
  stainless_304: { densityGPerCm3: 7.93, priceUsdPerKg: 7,   type: 'metal' },
  pla:           { densityGPerCm3: 1.24, priceUsdPerKg: 25,  type: 'plastic' },
  abs:           { densityGPerCm3: 1.05, priceUsdPerKg: 30,  type: 'plastic' },
};

/** Default headline rationale per material — overridden when modifiers fire. */
const DEFAULT_REASON: Record<Material, string> = {
  aluminum_6061: 'Workshop default — machinable, weldable, anodize-friendly.',
  steel_a36:     'Cheap mild structural steel; rusts, weldable, non-critical use.',
  steel_4140:    'Cr-Mo alloy, heat-treatable; shafts, gears, fatigue-loaded parts.',
  stainless_304: 'Austenitic stainless; corrosion + food safe + outdoor durable.',
  pla:           'Easy print, biodegradable; brittle for snap-fits, not for >50°C.',
  abs:           'Tougher than PLA; warps without enclosure; common for enclosures.',
};

/** All 6 materials the v1 selector considers. */
const ALL_MATERIALS: Material[] = [
  'aluminum_6061', 'stainless_304', 'pla',
  'steel_a36', 'steel_4140', 'abs',
];

/**
 * Score one material under the given options. Pure. All modifiers are
 * inline-commented so the user can follow the reasoning when they ask
 * "why is 304 ranked higher than 4140 for my food container?".
 */
function scoreOne(material: Material, opts: SuggestMaterialOptions): MaterialScore {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 50;
  const reasons: string[] = [];

  const physics = MATERIAL_PHYSICS[material];
  const isMetal = physics.type === 'metal';
  const isPlastic = physics.type === 'plastic';

  // ─── Process compatibility ───────────────────────────────────────────
  if (opts.process === 'fdm' || opts.process === 'sla') {
    if (isMetal) {
      blockers.push(`Cannot print metal on ${opts.process} — use cnc_mill / casting instead`);
      score = 0;
    }
  }
  if (opts.process === 'cnc_mill' && isPlastic) {
    score -= 10;
    warnings.push('Plastic CNC is unusual; check workholding (vacuum or soft jaws)');
  }
  if (opts.process === 'injection_molding' && isMetal) {
    blockers.push('Use die_cast for metal molding — injection_molding is plastic-only');
    score = 0;
  }
  if (opts.process === 'die_cast' && isPlastic) {
    blockers.push('Use injection_molding for plastic — die_cast is metal-only');
    score = 0;
  }

  // ─── Environment ─────────────────────────────────────────────────────
  if (opts.environment === 'outdoor') {
    if (material === 'steel_a36') {
      score -= 25;
      warnings.push('A36 rusts outdoors — needs paint or hot-dip galvanize');
    }
    if (material === 'pla') {
      score -= 30;
      warnings.push('PLA degrades in UV/sun — choose ABS or a metal');
    }
    if (material === 'stainless_304') {
      score += 20;
      reasons.push('Stainless 304 ideal for outdoor');
    }
    if (material === 'aluminum_6061') {
      score += 15;
      warnings.push('Anodize Type II (MIL-A-8625) for outdoor corrosion protection');
      reasons.push('aluminum + anodize is the workshop outdoor default');
    }
  }
  if (opts.environment === 'marine') {
    if (material === 'steel_a36' || material === 'steel_4140') {
      score -= 30;
      warnings.push('Steel + saltwater = rapid corrosion; needs aggressive coating');
    }
    if (material === 'stainless_304') {
      // 304 is OK above water but pits in chlorides — flag for 316 swap.
      warnings.push('304 pits in chloride splash zones; consider 316 for hardware-grade marine');
    }
    if (material === 'aluminum_6061') {
      score += 5;
      warnings.push('Use 6061 marine-grade or 5083 for sustained saltwater exposure');
    }
  }
  if (opts.environment === 'food') {
    const foodSafe: Material[] = ['stainless_304', 'pla', 'abs'];
    if (!foodSafe.includes(material)) {
      blockers.push('Not food-safe out of the box — choose 304SS, food-grade PLA, or food-grade ABS');
      score = 0;
    }
    if (material === 'stainless_304') {
      score += 30;
      reasons.push('304SS is the food-contact default (NSF/3-A approved alloys)');
    }
  }
  if (opts.environment === 'high_temp') {
    if (material === 'pla') {
      blockers.push('PLA softens at 60°C glass transition — fails immediately above ambient sun');
      score = 0;
    }
    if (material === 'abs') {
      score -= 15;
      warnings.push('ABS Tg 105°C — borderline for sustained high-temp service');
    }
    if (material === 'stainless_304' || material === 'steel_4140') {
      score += 10;
      reasons.push('alloy steel handles sustained high temp');
    }
  }

  // ─── Loading ────────────────────────────────────────────────────────
  if (opts.loading === 'structural') {
    if (isPlastic) {
      score -= 25;
      warnings.push('Plastic for structural use needs design review (creep + fatigue)');
    }
    if (material === 'steel_4140') {
      score += 15;
      reasons.push('Heat-treated 4140 ideal for fatigue/load');
    }
    if (material === 'aluminum_6061') {
      score += 10;
      reasons.push('6061-T6 handles structural with weight savings');
    }
  }
  if (opts.loading === 'cosmetic') {
    if (material === 'steel_4140') {
      score -= 10;
      reasons.push('Overkill for cosmetic — cheaper options exist');
    }
    if (material === 'stainless_304') {
      score += 5;
      reasons.push('304 finish polishes well for cosmetic surfaces');
    }
  }

  // ─── Budget ─────────────────────────────────────────────────────────
  if (opts.budget === 'cheap') {
    if (material === 'steel_a36') {
      score += 20;
      reasons.push('cheapest structural metal');
    }
    if (material === 'pla') {
      score += 15;
      reasons.push('cheap prototype plastic');
    }
    if (material === 'stainless_304' || material === 'steel_4140') {
      score -= 20;
      reasons.push('alloy + stainless cost dominates a cheap-tier budget');
    }
  }
  if (opts.budget === 'premium') {
    if (material === 'stainless_304' || material === 'steel_4140') {
      score += 10;
      reasons.push('premium budget unlocks alloy / stainless');
    }
  }

  // ─── Quantity ───────────────────────────────────────────────────────
  if (typeof opts.quantityHint === 'number' && opts.quantityHint >= 1000) {
    if (material === 'steel_4140' || material === 'stainless_304') {
      score -= 10;
      warnings.push(`At qty ${opts.quantityHint}, ${material} lead time + raw cost compound`);
    }
  }

  // ─── Default ranking when caller passed nothing ──────────────────────
  // Bias toward broadly-applicable workshop defaults so the agent has a
  // sensible "no info → pick aluminum" answer instead of a tied tie.
  const noUserContext = !opts.process && !opts.environment && !opts.loading
    && !opts.budget && typeof opts.quantityHint !== 'number';
  if (noUserContext) {
    if (material === 'aluminum_6061') {
      score += 20;
      reasons.push('workshop default when no other constraints given');
    }
    if (material === 'stainless_304') {
      score += 10;
      reasons.push('broadly applicable secondary choice');
    }
    if (material === 'pla') {
      score += 5;
      reasons.push('cheap prototyping fallback');
    }
  }

  // ─── Clamp + headline ────────────────────────────────────────────────
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const headline = blockers.length > 0
    ? blockers[0]!
    : (reasons.length > 0
        ? `${DEFAULT_REASON[material]} (${reasons.join('; ')})`
        : DEFAULT_REASON[material]);

  return {
    material,
    score,
    reason: headline,
    blockers,
    warnings,
    pricePerKgUsd: physics.priceUsdPerKg,
  };
}

/**
 * Score every material under the given options. Returns the full list
 * (all 6) sorted descending by score — blocked materials (score = 0)
 * always sort to the bottom so the caller can slice top-N from the head
 * and still show blockers in a "rejected" footer if desired.
 */
export function suggestMaterialForPart(opts: SuggestMaterialOptions = {}): MaterialScore[] {
  if (opts !== null && typeof opts !== 'object') {
    throw new Error('suggestMaterialForPart requires an options object');
  }
  const scores = ALL_MATERIALS.map(m => scoreOne(m, opts));
  scores.sort((a, b) => {
    // Blocked materials (score = 0) always sort below non-blocked ones,
    // even at tie. Mirrors processSelection's tie-break rule.
    if (a.score === 0 && b.score !== 0) return 1;
    if (b.score === 0 && a.score !== 0) return -1;
    return b.score - a.score;
  });
  return scores;
}

/**
 * Human-readable formatter — mirrors formatProcessScores / formatSuggestions
 * shape so the agent's tool-result rendering is uniform across the
 * recommendation family. Lists every material with rank + score, indents
 * blockers/warnings under each line.
 */
export function formatMaterialScores(scores: MaterialScore[]): string {
  if (scores.length === 0) return 'No material recommendations available.';
  const lines: string[] = [`Material recommendations (${scores.length}, ranked):`];
  scores.forEach((s, i) => {
    const priceTag = `$${s.pricePerKgUsd}/kg`;
    lines.push(`${i + 1}. ${s.material} (score ${s.score}, ${priceTag}): ${s.reason}`);
    for (const b of s.blockers) lines.push(`     BLOCKER: ${b}`);
    for (const w of s.warnings) lines.push(`     warning: ${w}`);
  });
  return lines.join('\n');
}
