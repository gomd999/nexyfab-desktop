/**
 * marginRulesEngine.ts — Auto-determine RFQ margin from quantity,
 * complexity, customer tier, and lead time.
 *
 * Margin is the markup above cost that becomes the quote price.
 * Setting it manually for every quote is tedious and inconsistent.
 * A rules engine encodes the shop's pricing policy as a tiered
 * rule list:
 *
 *   - Per-quantity discount (orders > 100 → -3%).
 *   - Per-complexity surcharge (high complexity → +10%).
 *   - Per-customer tier (premium → +5%, distributor → -5%).
 *   - Per-rush surcharge (lead time < 7 days → +20%).
 *   - Per-floor / ceiling (don't go below 8% or above 80%).
 *
 * Rules apply in declared order; later rules override earlier
 * when their condition matches. Each rule has a numeric weight so
 * the engine can run "explain mode" — output the breakdown of
 * which rule contributed how much.
 *
 * Designed for the RFQ panel "auto margin" button.
 */

export type ComplexityTier = 'simple' | 'medium' | 'complex' | 'extreme';

export interface QuoteContext {
  /** Quantity in the order. */
  quantity: number;
  /** Job complexity tier. */
  complexity: ComplexityTier;
  /** Customer tier. */
  customerTier: 'distributor' | 'oem' | 'consumer' | 'premium';
  /** Lead time in days. */
  leadTimeDays: number;
  /** Optional category (sheet metal / cnc / additive / cast). */
  category?: string;
}

export type RuleAction =
  | { type: 'add'; percentPoints: number }
  | { type: 'multiply'; factor: number }
  | { type: 'floor'; percent: number }
  | { type: 'ceiling'; percent: number }
  | { type: 'set'; percent: number };

export interface MarginRule {
  id: string;
  description: string;
  /** Returns true if this rule should fire for the given context. */
  condition: (ctx: QuoteContext) => boolean;
  action: RuleAction;
  /** Higher = applied later (overrides earlier). */
  priority: number;
}

export interface RuleApplication {
  ruleId: string;
  description: string;
  marginBeforePct: number;
  marginAfterPct: number;
  deltaPct: number;
}

export interface MarginResult {
  finalMarginPct: number;
  applied: RuleApplication[];
  /** Rules that didn't fire. */
  skipped: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function computeMargin(ctx: QuoteContext, rules: MarginRule[], baseMarginPct: number = 20): MarginResult {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  let current = baseMarginPct;
  const applied: RuleApplication[] = [];
  const skipped: string[] = [];

  for (const rule of sorted) {
    if (!rule.condition(ctx)) {
      skipped.push(rule.id);
      continue;
    }
    const before = current;
    switch (rule.action.type) {
      case 'add':
        current += rule.action.percentPoints;
        break;
      case 'multiply':
        current *= rule.action.factor;
        break;
      case 'floor':
        current = Math.max(current, rule.action.percent);
        break;
      case 'ceiling':
        current = Math.min(current, rule.action.percent);
        break;
      case 'set':
        current = rule.action.percent;
        break;
    }
    applied.push({
      ruleId: rule.id,
      description: rule.description,
      marginBeforePct: before,
      marginAfterPct: current,
      deltaPct: current - before,
    });
  }

  return { finalMarginPct: current, applied, skipped };
}

// ── Default rule set ──────────────────────────────────────────

export function defaultShopRules(): MarginRule[] {
  return [
    {
      id: 'rush-surcharge',
      description: 'Rush order (lead time < 7 days) +15%',
      condition: (ctx) => ctx.leadTimeDays < 7,
      action: { type: 'add', percentPoints: 15 },
      priority: 10,
    },
    {
      id: 'large-volume-discount',
      description: 'Volume discount for orders > 500 units (-5%)',
      condition: (ctx) => ctx.quantity > 500,
      action: { type: 'add', percentPoints: -5 },
      priority: 20,
    },
    {
      id: 'complex-surcharge',
      description: 'Complex job surcharge (+8%)',
      condition: (ctx) => ctx.complexity === 'complex' || ctx.complexity === 'extreme',
      action: { type: 'add', percentPoints: 8 },
      priority: 30,
    },
    {
      id: 'distributor-discount',
      description: 'Distributor tier -5%',
      condition: (ctx) => ctx.customerTier === 'distributor',
      action: { type: 'add', percentPoints: -5 },
      priority: 40,
    },
    {
      id: 'premium-surcharge',
      description: 'Premium customer +3%',
      condition: (ctx) => ctx.customerTier === 'premium',
      action: { type: 'add', percentPoints: 3 },
      priority: 40,
    },
    {
      id: 'floor-8',
      description: 'Floor at 8% to maintain minimum margin',
      condition: () => true,
      action: { type: 'floor', percent: 8 },
      priority: 90,
    },
    {
      id: 'ceiling-80',
      description: 'Ceiling at 80% to remain competitive',
      condition: () => true,
      action: { type: 'ceiling', percent: 80 },
      priority: 95,
    },
  ];
}

// ── Quote final price ─────────────────────────────────────────

export interface QuotePrice {
  costUsd: number;
  marginPct: number;
  priceUsd: number;
}

export function quotePriceFromCost(costUsd: number, marginPct: number): QuotePrice {
  return { costUsd, marginPct, priceUsd: costUsd * (1 + marginPct / 100) };
}

// ── Summary ────────────────────────────────────────────────────

export interface MarginSummary {
  baseMarginPct: number;
  finalMarginPct: number;
  rulesFired: number;
  rulesSkipped: number;
  totalAdjustmentPct: number;
}

export function summarize(result: MarginResult, baseMarginPct: number): MarginSummary {
  return {
    baseMarginPct,
    finalMarginPct: result.finalMarginPct,
    rulesFired: result.applied.length,
    rulesSkipped: result.skipped.length,
    totalAdjustmentPct: result.finalMarginPct - baseMarginPct,
  };
}
