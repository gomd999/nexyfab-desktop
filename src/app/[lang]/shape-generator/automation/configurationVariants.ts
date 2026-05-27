/**
 * configurationVariants.ts — Rules-based variant generator.
 *
 * Above `designAutomation.ts` (which provides the form schema + rule
 * engine) this module orchestrates the *fanout* — taking a single
 * configuration model + a set of variant axes and producing every
 * valid combination, complete with per-variant cost, BOM, drawing
 * count, and lead-time estimate.
 *
 * Used by:
 *   - **Configurator microsite** — "explore all bracket sizes" lands
 *     on a pre-generated grid of variants with prices.
 *   - **PDF catalogs** — generate a 20-page bracket-family catalog
 *     overnight from a single master.
 *   - **B2B quote sheets** — customer asks "give me M3 / M4 / M5
 *     versions"; one click expands.
 *
 * The variant axis can be:
 *   - **Enumeration** — pick from a static list ('M3', 'M4', 'M5').
 *   - **Range** — every value in [min, max] step.
 *   - **Boolean** — true/false (include / exclude a feature).
 *   - **Derived** — computed from another axis (cost = 0.5 × diameter²).
 *
 * Cartesian product can explode; we provide:
 *   - Hard cap on total variant count.
 *   - Filter predicates per variant to drop invalid combinations
 *     (e.g. M3 bolt × 25mm hole isn't a useful pair).
 */

export type VariantAxisKind = 'enum' | 'range' | 'boolean' | 'derived';

export interface EnumAxis<T extends string | number = string | number> {
  id: string;
  kind: 'enum';
  values: T[];
  label?: string;
}

export interface RangeAxis {
  id: string;
  kind: 'range';
  min: number;
  max: number;
  step: number;
  label?: string;
}

export interface BooleanAxis {
  id: string;
  kind: 'boolean';
  label?: string;
}

export interface DerivedAxis {
  id: string;
  kind: 'derived';
  compute: (values: Record<string, string | number | boolean>) => string | number | boolean;
  label?: string;
}

export type VariantAxis = EnumAxis | RangeAxis | BooleanAxis | DerivedAxis;

export interface Variant {
  /** Unique id (e.g. "bracket-m4-thick-3"). */
  id: string;
  /** Values for each primary axis. */
  values: Record<string, string | number | boolean>;
  /** Derived axis values, computed at generation time. */
  derived: Record<string, string | number | boolean>;
  /** Optional per-variant fields populated by the user (cost, weight, etc). */
  metadata?: Record<string, number | string>;
}

export interface VariantGeneratorOptions {
  /** Hard cap on the number of variants returned. */
  maxVariants: number;
  /** Filter — return false to skip a variant. */
  filter?: (variant: Variant) => boolean;
  /** Naming function. */
  nameFn?: (variant: Variant) => string;
}

export const DEFAULT_GENERATOR_OPTIONS: VariantGeneratorOptions = {
  maxVariants: 10_000,
};

export interface GenerationResult {
  variants: Variant[];
  /** True if we hit the maxVariants cap. */
  truncated: boolean;
  /** Number of cartesian combinations evaluated (incl. filtered). */
  evaluated: number;
  /** Number of variants rejected by the filter. */
  filtered: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function generateVariants(
  axes: VariantAxis[],
  options: Partial<VariantGeneratorOptions> = {},
): GenerationResult {
  const opts = { ...DEFAULT_GENERATOR_OPTIONS, ...options };
  const primary = axes.filter((a): a is EnumAxis | RangeAxis | BooleanAxis => a.kind !== 'derived');
  const derived = axes.filter((a): a is DerivedAxis => a.kind === 'derived');

  // Materialize each axis's choices.
  const axisChoices: Array<Array<string | number | boolean>> = primary.map(materializeAxisValues);

  const variants: Variant[] = [];
  let evaluated = 0;
  let filtered = 0;
  let truncated = false;

  // Cartesian product.
  const indices = new Array(primary.length).fill(0);
  while (true) {
    if (evaluated >= opts.maxVariants) {
      truncated = true;
      break;
    }
    const values: Record<string, string | number | boolean> = {};
    for (let i = 0; i < primary.length; i++) {
      values[primary[i]!.id] = axisChoices[i]![indices[i]!]!;
    }
    const derivedValues: Record<string, string | number | boolean> = {};
    for (const da of derived) {
      derivedValues[da.id] = da.compute({ ...values });
    }
    const variant: Variant = {
      id: '',
      values,
      derived: derivedValues,
    };
    variant.id = opts.nameFn ? opts.nameFn(variant) : defaultVariantName(variant, primary);

    evaluated++;
    const ok = !opts.filter || opts.filter(variant);
    if (ok) {
      variants.push(variant);
    } else {
      filtered++;
    }

    // Increment indices in lexicographic order.
    if (primary.length === 0) break;
    indices[indices.length - 1]++;
    let done = false;
    for (let i = indices.length - 1; i >= 0; i--) {
      if (indices[i]! >= axisChoices[i]!.length) {
        indices[i] = 0;
        if (i === 0) {
          done = true;
          break;
        }
        indices[i - 1]++;
      } else {
        break;
      }
    }
    if (done) break;
  }

  return { variants, truncated, evaluated, filtered };
}

function materializeAxisValues(axis: EnumAxis | RangeAxis | BooleanAxis): Array<string | number | boolean> {
  switch (axis.kind) {
    case 'enum': return axis.values.slice();
    case 'range': {
      const out: number[] = [];
      const eps = axis.step / 1e6;
      for (let v = axis.min; v <= axis.max + eps; v += axis.step) {
        out.push(Math.round(v / axis.step) * axis.step);
      }
      return out;
    }
    case 'boolean': return [false, true];
  }
}

function defaultVariantName(variant: Variant, axes: Array<EnumAxis | RangeAxis | BooleanAxis>): string {
  const parts: string[] = [];
  for (const a of axes) {
    const v = variant.values[a.id];
    parts.push(`${a.id}=${String(v)}`);
  }
  return parts.join('|');
}

// ── Pricing / costing per variant ───────────────────────────────

export interface PricingModel {
  /** Compute the variant's price. */
  price: (variant: Variant) => number;
  /** Compute the variant's mass (grams). */
  massGrams?: (variant: Variant) => number;
  /** Compute lead-time (days). */
  leadTimeDays?: (variant: Variant) => number;
}

export interface PricedVariant extends Variant {
  priceUsd: number;
  massGrams?: number;
  leadTimeDays?: number;
}

export function priceVariants(variants: Variant[], model: PricingModel): PricedVariant[] {
  return variants.map(v => ({
    ...v,
    priceUsd: model.price(v),
    ...(model.massGrams ? { massGrams: model.massGrams(v) } : {}),
    ...(model.leadTimeDays ? { leadTimeDays: model.leadTimeDays(v) } : {}),
  }));
}

// ── Catalog grouping ────────────────────────────────────────────

export interface CatalogGroup {
  /** Axis used for the grouping. */
  groupBy: string;
  /** Values grouped under each key. */
  groups: Map<string | number | boolean, PricedVariant[]>;
}

export function groupVariants(variants: PricedVariant[], byAxisId: string): CatalogGroup {
  const groups = new Map<string | number | boolean, PricedVariant[]>();
  for (const v of variants) {
    const key = v.values[byAxisId] ?? v.derived[byAxisId] ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }
  return { groupBy: byAxisId, groups };
}

// ── Validators (filters) ────────────────────────────────────────

export function combineFilters(
  ...filters: Array<(v: Variant) => boolean>
): (v: Variant) => boolean {
  return (variant) => filters.every(f => f(variant));
}

/** Pairwise constraint: when axis A = X, axis B must be in [allowedB]. */
export function pairConstraint<TA, TB>(axisA: string, valueA: TA, axisB: string, allowedB: TB[]): (v: Variant) => boolean {
  return (variant) => {
    if (variant.values[axisA] !== valueA && variant.derived[axisA] !== valueA) return true;
    const valB = variant.values[axisB] ?? variant.derived[axisB];
    return allowedB.some(x => x === (valB as unknown));
  };
}

// ── Export to CSV (for quote sheets) ────────────────────────────

export function variantsToCsv(variants: PricedVariant[]): string {
  if (variants.length === 0) return '';
  const allKeys = new Set<string>(['id', 'priceUsd']);
  for (const v of variants) {
    for (const k of Object.keys(v.values)) allKeys.add(`val.${k}`);
    for (const k of Object.keys(v.derived)) allKeys.add(`drv.${k}`);
    if (v.massGrams !== undefined) allKeys.add('massGrams');
    if (v.leadTimeDays !== undefined) allKeys.add('leadTimeDays');
  }
  const headers = [...allKeys];
  const rows: string[] = [headers.join(',')];
  for (const v of variants) {
    const row: string[] = [];
    for (const h of headers) {
      let cell: string | number | boolean | undefined;
      if (h === 'id') cell = v.id;
      else if (h === 'priceUsd') cell = v.priceUsd;
      else if (h === 'massGrams') cell = v.massGrams;
      else if (h === 'leadTimeDays') cell = v.leadTimeDays;
      else if (h.startsWith('val.')) cell = v.values[h.slice(4)];
      else if (h.startsWith('drv.')) cell = v.derived[h.slice(4)];
      row.push(cell !== undefined ? String(cell) : '');
    }
    rows.push(row.join(','));
  }
  return rows.join('\n');
}
