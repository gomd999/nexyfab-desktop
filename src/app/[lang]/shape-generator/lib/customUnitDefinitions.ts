/**
 * customUnitDefinitions.ts — User-defined custom unit support
 * (compose new units from existing ones).
 *
 * The engineering unit converter ships a fixed catalog. This module
 * lets users define new units composed from existing primitives:
 *
 *   - "kgf·m" = kgf × m (torque).
 *   - "kPa·s" = kPa × s (viscosity).
 *   - "rpm" = revolution per minute (angular velocity).
 *   - "g/100mL" = mass per volume (concentration).
 *
 * Definitions are stored in a registry, with conversion factors
 * derived automatically from the constituent units' SI factors.
 * Custom labels survive serialization so projects can share unit
 * vocabularies.
 */

export type Quantity = 'length' | 'mass' | 'time' | 'force' | 'pressure' | 'torque' | 'energy' | 'power' | 'temperature' | 'density' | 'velocity' | 'angle' | 'volume' | 'area' | 'frequency' | 'derived';

export interface BaseUnit {
  symbol: string;
  /** Factor to SI: SI value = factor × user value. */
  siFactor: number;
  quantity: Quantity;
}

export interface CustomUnit {
  id: string;
  /** Display label (e.g. "kgf·m"). */
  label: string;
  /** Composition: list of (baseUnit symbol, exponent). */
  composition: Array<{ baseSymbol: string; exponent: number }>;
  /** Optional explicit SI factor override; if absent, computed from composition. */
  explicitSiFactor?: number;
  /** Computed quantity (free-form for derived). */
  quantity: Quantity;
}

export interface CustomUnitRegistry {
  units: Map<string, CustomUnit>;
  baseUnits: Map<string, BaseUnit>;
}

// ── Defaults ───────────────────────────────────────────────────

export const BASE_UNITS: BaseUnit[] = [
  { symbol: 'm', siFactor: 1, quantity: 'length' },
  { symbol: 'kg', siFactor: 1, quantity: 'mass' },
  { symbol: 's', siFactor: 1, quantity: 'time' },
  { symbol: 'mm', siFactor: 0.001, quantity: 'length' },
  { symbol: 'g', siFactor: 0.001, quantity: 'mass' },
  { symbol: 'min', siFactor: 60, quantity: 'time' },
  { symbol: 'h', siFactor: 3600, quantity: 'time' },
  { symbol: 'kgf', siFactor: 9.80665, quantity: 'force' },
  { symbol: 'N', siFactor: 1, quantity: 'force' },
  { symbol: 'kPa', siFactor: 1000, quantity: 'pressure' },
  { symbol: 'Pa', siFactor: 1, quantity: 'pressure' },
  { symbol: 'rev', siFactor: 2 * Math.PI, quantity: 'angle' },
  { symbol: 'rad', siFactor: 1, quantity: 'angle' },
];

// ── Construction ───────────────────────────────────────────────

export function createRegistry(): CustomUnitRegistry {
  const baseUnits = new Map<string, BaseUnit>();
  for (const u of BASE_UNITS) baseUnits.set(u.symbol, u);
  return { units: new Map(), baseUnits };
}

// ── Custom unit ops ───────────────────────────────────────────

export interface DefineOptions {
  label: string;
  composition: Array<{ baseSymbol: string; exponent: number }>;
  /** Optional override of computed SI factor. */
  explicitSiFactor?: number;
  /** Optional quantity classification. */
  quantity?: Quantity;
}

export function defineUnit(registry: CustomUnitRegistry, id: string, options: DefineOptions): CustomUnit {
  const factor = options.explicitSiFactor ?? computeCompositeFactor(registry, options.composition);
  const quantity = options.quantity ?? inferQuantity(registry, options.composition);
  const unit: CustomUnit = {
    id,
    label: options.label,
    composition: options.composition,
    quantity,
    ...(options.explicitSiFactor !== undefined ? { explicitSiFactor: options.explicitSiFactor } : {}),
  };
  registry.units.set(id, unit);
  void factor;
  return unit;
}

export function getUnit(registry: CustomUnitRegistry, id: string): CustomUnit | null {
  return registry.units.get(id) ?? null;
}

export function removeUnit(registry: CustomUnitRegistry, id: string): boolean {
  return registry.units.delete(id);
}

export function listUnits(registry: CustomUnitRegistry): CustomUnit[] {
  return [...registry.units.values()];
}

// ── Conversion ────────────────────────────────────────────────

export interface ConvertResult {
  value: number;
  siValue: number;
  fromUnitId: string;
  toUnitId: string;
  ok: boolean;
  error?: string;
}

export function convert(registry: CustomUnitRegistry, value: number, fromId: string, toId: string): ConvertResult {
  const from = registry.units.get(fromId);
  const to = registry.units.get(toId);
  if (!from) return { value: NaN, siValue: NaN, fromUnitId: fromId, toUnitId: toId, ok: false, error: 'unknown source' };
  if (!to) return { value: NaN, siValue: NaN, fromUnitId: fromId, toUnitId: toId, ok: false, error: 'unknown target' };
  if (from.quantity !== to.quantity && from.quantity !== 'derived' && to.quantity !== 'derived') {
    return { value: NaN, siValue: NaN, fromUnitId: fromId, toUnitId: toId, ok: false, error: 'quantity mismatch' };
  }
  const fromFactor = from.explicitSiFactor ?? computeCompositeFactor(registry, from.composition);
  const toFactor = to.explicitSiFactor ?? computeCompositeFactor(registry, to.composition);
  const si = value * fromFactor;
  return {
    value: si / toFactor,
    siValue: si,
    fromUnitId: fromId,
    toUnitId: toId,
    ok: true,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function computeCompositeFactor(registry: CustomUnitRegistry, composition: Array<{ baseSymbol: string; exponent: number }>): number {
  let factor = 1;
  for (const { baseSymbol, exponent } of composition) {
    const base = registry.baseUnits.get(baseSymbol);
    if (!base) continue;
    factor *= Math.pow(base.siFactor, exponent);
  }
  return factor;
}

function inferQuantity(registry: CustomUnitRegistry, composition: Array<{ baseSymbol: string; exponent: number }>): Quantity {
  // If a single base unit with exponent 1, inherit its quantity.
  if (composition.length === 1 && composition[0]!.exponent === 1) {
    const base = registry.baseUnits.get(composition[0]!.baseSymbol);
    if (base) return base.quantity;
  }
  return 'derived';
}

// ── Serialization ─────────────────────────────────────────────

export function toJSON(registry: CustomUnitRegistry): string {
  const units = [...registry.units.values()];
  return JSON.stringify(units);
}

export function fromJSON(registry: CustomUnitRegistry, jsonText: string): number {
  let parsed: CustomUnit[] = [];
  try {
    parsed = JSON.parse(jsonText) as CustomUnit[];
  } catch {
    return 0;
  }
  let count = 0;
  for (const unit of parsed) {
    registry.units.set(unit.id, unit);
    count++;
  }
  return count;
}

// ── Summary ────────────────────────────────────────────────────

export interface RegistrySummary {
  baseUnitCount: number;
  customUnitCount: number;
  derivedCount: number;
  quantities: Quantity[];
}

export function summarize(registry: CustomUnitRegistry): RegistrySummary {
  const quantities = new Set<Quantity>();
  let derived = 0;
  for (const u of registry.units.values()) {
    quantities.add(u.quantity);
    if (u.quantity === 'derived') derived++;
  }
  return {
    baseUnitCount: registry.baseUnits.size,
    customUnitCount: registry.units.size,
    derivedCount: derived,
    quantities: [...quantities],
  };
}
