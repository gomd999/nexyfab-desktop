/**
 * engineeringUnitConverter.ts — Physical quantity unit conversion
 * for CAD engineering: force, pressure, torque, energy, power,
 * temperature, density, velocity.
 *
 * The base unit per quantity is SI. Other units convert via a
 * factor + optional offset (temperature only).
 *
 * Designed for the cost / FEA panel — user types "120 lbf" and
 * the system internally stores SI Newtons.
 */

export type Quantity = 'length' | 'mass' | 'force' | 'pressure' | 'torque' | 'energy' | 'power' | 'temperature' | 'density' | 'velocity' | 'angle' | 'volume' | 'area';

export interface UnitDef {
  /** Symbol the user types (e.g., "N", "lbf"). */
  symbol: string;
  /** Display name. */
  name: string;
  /** Conversion: SI = factor × value + offset. */
  factor: number;
  /** Offset (Kelvin / Fahrenheit conversion only). */
  offset?: number;
  quantity: Quantity;
}

// ── Catalog ────────────────────────────────────────────────────

export const UNIT_LIBRARY: UnitDef[] = [
  // Length (SI: m)
  { symbol: 'm', name: 'meter', factor: 1, quantity: 'length' },
  { symbol: 'mm', name: 'millimeter', factor: 0.001, quantity: 'length' },
  { symbol: 'cm', name: 'centimeter', factor: 0.01, quantity: 'length' },
  { symbol: 'km', name: 'kilometer', factor: 1000, quantity: 'length' },
  { symbol: 'in', name: 'inch', factor: 0.0254, quantity: 'length' },
  { symbol: 'ft', name: 'foot', factor: 0.3048, quantity: 'length' },
  { symbol: 'yd', name: 'yard', factor: 0.9144, quantity: 'length' },
  // Mass (SI: kg)
  { symbol: 'kg', name: 'kilogram', factor: 1, quantity: 'mass' },
  { symbol: 'g', name: 'gram', factor: 0.001, quantity: 'mass' },
  { symbol: 'lb', name: 'pound', factor: 0.45359237, quantity: 'mass' },
  { symbol: 'oz', name: 'ounce', factor: 0.0283495, quantity: 'mass' },
  // Force (SI: N)
  { symbol: 'N', name: 'newton', factor: 1, quantity: 'force' },
  { symbol: 'kN', name: 'kilonewton', factor: 1000, quantity: 'force' },
  { symbol: 'lbf', name: 'pound-force', factor: 4.448222, quantity: 'force' },
  { symbol: 'kgf', name: 'kilogram-force', factor: 9.80665, quantity: 'force' },
  // Pressure (SI: Pa)
  { symbol: 'Pa', name: 'pascal', factor: 1, quantity: 'pressure' },
  { symbol: 'kPa', name: 'kilopascal', factor: 1000, quantity: 'pressure' },
  { symbol: 'MPa', name: 'megapascal', factor: 1_000_000, quantity: 'pressure' },
  { symbol: 'GPa', name: 'gigapascal', factor: 1_000_000_000, quantity: 'pressure' },
  { symbol: 'bar', name: 'bar', factor: 100_000, quantity: 'pressure' },
  { symbol: 'psi', name: 'psi', factor: 6894.757, quantity: 'pressure' },
  { symbol: 'ksi', name: 'ksi', factor: 6894757, quantity: 'pressure' },
  // Torque (SI: N·m)
  { symbol: 'Nm', name: 'newton-meter', factor: 1, quantity: 'torque' },
  { symbol: 'Ncm', name: 'newton-centimeter', factor: 0.01, quantity: 'torque' },
  { symbol: 'ft-lbf', name: 'foot-pound', factor: 1.3558, quantity: 'torque' },
  { symbol: 'in-lbf', name: 'inch-pound', factor: 0.11298, quantity: 'torque' },
  // Energy (SI: J)
  { symbol: 'J', name: 'joule', factor: 1, quantity: 'energy' },
  { symbol: 'kJ', name: 'kilojoule', factor: 1000, quantity: 'energy' },
  { symbol: 'cal', name: 'calorie', factor: 4.184, quantity: 'energy' },
  { symbol: 'BTU', name: 'BTU', factor: 1055.06, quantity: 'energy' },
  // Power (SI: W)
  { symbol: 'W', name: 'watt', factor: 1, quantity: 'power' },
  { symbol: 'kW', name: 'kilowatt', factor: 1000, quantity: 'power' },
  { symbol: 'hp', name: 'horsepower', factor: 745.7, quantity: 'power' },
  // Temperature (SI: K). Conversions need offset.
  { symbol: 'K', name: 'kelvin', factor: 1, quantity: 'temperature' },
  { symbol: 'degC', name: 'celsius', factor: 1, offset: 273.15, quantity: 'temperature' },
  { symbol: 'degF', name: 'fahrenheit', factor: 5 / 9, offset: 459.67 * 5 / 9, quantity: 'temperature' },
  // Density (SI: kg/m³)
  { symbol: 'kg/m^3', name: 'kg/m³', factor: 1, quantity: 'density' },
  { symbol: 'g/cm^3', name: 'g/cm³', factor: 1000, quantity: 'density' },
  { symbol: 'lb/in^3', name: 'lb/in³', factor: 27679.9, quantity: 'density' },
  // Velocity (SI: m/s)
  { symbol: 'm/s', name: 'meter/sec', factor: 1, quantity: 'velocity' },
  { symbol: 'km/h', name: 'kilometer/hour', factor: 1 / 3.6, quantity: 'velocity' },
  { symbol: 'mph', name: 'miles/hour', factor: 0.44704, quantity: 'velocity' },
  // Angle (SI: rad)
  { symbol: 'rad', name: 'radian', factor: 1, quantity: 'angle' },
  { symbol: 'deg', name: 'degree', factor: Math.PI / 180, quantity: 'angle' },
  // Volume (SI: m³)
  { symbol: 'm^3', name: 'cubic meter', factor: 1, quantity: 'volume' },
  { symbol: 'L', name: 'liter', factor: 0.001, quantity: 'volume' },
  { symbol: 'mL', name: 'milliliter', factor: 1e-6, quantity: 'volume' },
  { symbol: 'gal', name: 'US gallon', factor: 0.00378541, quantity: 'volume' },
  // Area (SI: m²)
  { symbol: 'm^2', name: 'square meter', factor: 1, quantity: 'area' },
  { symbol: 'mm^2', name: 'square millimeter', factor: 1e-6, quantity: 'area' },
  { symbol: 'cm^2', name: 'square centimeter', factor: 1e-4, quantity: 'area' },
  { symbol: 'in^2', name: 'square inch', factor: 0.00064516, quantity: 'area' },
];

// ── Lookup ─────────────────────────────────────────────────────

export function findUnit(symbol: string): UnitDef | null {
  return UNIT_LIBRARY.find(u => u.symbol === symbol) ?? null;
}

export function listForQuantity(q: Quantity): UnitDef[] {
  return UNIT_LIBRARY.filter(u => u.quantity === q);
}

// ── Conversion ────────────────────────────────────────────────

export interface ConvertResult {
  value: number;
  fromUnit: string;
  toUnit: string;
  /** SI value (intermediate). */
  siValue: number;
  /** True if conversion succeeded. */
  ok: boolean;
  error?: string;
}

export function convert(value: number, fromSymbol: string, toSymbol: string): ConvertResult {
  const from = findUnit(fromSymbol);
  const to = findUnit(toSymbol);
  if (!from) return { value: NaN, fromUnit: fromSymbol, toUnit: toSymbol, siValue: NaN, ok: false, error: `Unknown source unit: ${fromSymbol}` };
  if (!to) return { value: NaN, fromUnit: fromSymbol, toUnit: toSymbol, siValue: NaN, ok: false, error: `Unknown target unit: ${toSymbol}` };
  if (from.quantity !== to.quantity) {
    return {
      value: NaN, fromUnit: fromSymbol, toUnit: toSymbol, siValue: NaN, ok: false,
      error: `Quantity mismatch: ${from.quantity} vs ${to.quantity}`,
    };
  }
  const si = value * from.factor + (from.offset ?? 0);
  const converted = (si - (to.offset ?? 0)) / to.factor;
  return { value: converted, fromUnit: fromSymbol, toUnit: toSymbol, siValue: si, ok: true };
}

// ── Parse "120 lbf" → { value: 120, unit: "lbf" } ───────────

export interface ParsedQuantity {
  value: number;
  unit: string;
  quantity: Quantity;
}

export function parseQuantity(text: string): ParsedQuantity | null {
  const match = text.trim().match(/^(-?[\d.]+)\s*([A-Za-z][A-Za-z0-9/^.°-]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unitSymbol = match[2]!;
  const unit = findUnit(unitSymbol);
  if (!unit) return null;
  return { value, unit: unitSymbol, quantity: unit.quantity };
}

// ── Summary ────────────────────────────────────────────────────

export interface LibrarySummary {
  totalUnits: number;
  quantityCount: number;
  unitsPerQuantity: Record<Quantity, number>;
}

export function summarize(): LibrarySummary {
  const counts: Record<string, number> = {};
  const quantities = new Set<Quantity>();
  for (const u of UNIT_LIBRARY) {
    counts[u.quantity] = (counts[u.quantity] ?? 0) + 1;
    quantities.add(u.quantity);
  }
  return {
    totalUnits: UNIT_LIBRARY.length,
    quantityCount: quantities.size,
    unitsPerQuantity: counts as Record<Quantity, number>,
  };
}
