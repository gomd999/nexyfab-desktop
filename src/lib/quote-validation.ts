/**
 * Server-side validation for quote inputs.
 *
 * The client sends geometry metrics (volume, surface area, bbox) and option
 * fields. Every one of these ends up multiplying into the final price, so we
 * cannot trust the client — a spoofed `volume_cm3: 0.001` would otherwise
 * produce a near-zero quote. This module enforces:
 *
 *   - numeric sanity (finite, positive)
 *   - manufacturing bounds (a part cannot be 1mm³ or 10m³)
 *   - internal consistency (volume ≤ bbox volume, surface ≥ bbox min surface)
 *   - whitelisted enums (material, process, finish, tolerance)
 *   - clamped integers (quantity, complexity)
 */

export interface RawQuoteInput {
  geometry?: {
    volume_cm3?: unknown;
    surface_area_cm2?: unknown;
    bbox?: { w?: unknown; h?: unknown; d?: unknown };
  };
  material?: unknown;
  process?: unknown;
  quantity?: unknown;
  finishType?: unknown;
  tolerance?: unknown;
  aiAnalysis?: { complexity?: unknown };
}

export interface ValidatedQuoteInput {
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
  material: string;
  process: string;
  quantity: number;
  finishType: string;
  tolerance: string;
  complexity: number;
}

const ALLOWED_MATERIALS = new Set([
  'steel_s45c', 'aluminum_6061', 'stainless_304', 'brass',
  'abs_plastic', 'pom', 'pc', 'titanium',
]);
const ALLOWED_PROCESSES = new Set([
  'cnc', 'injection_molding', 'die_casting', 'sheet_metal',
  '3d_printing_fdm', '3d_printing_sla', '3d_printing_sls', 'forging',
]);
const ALLOWED_FINISHES = new Set(['none', 'anodize', 'paint', 'chrome', 'nickel', 'powder_coat']);
const ALLOWED_TOLERANCES = new Set(['it7', 'it8', 'it9', 'it11']);

// Manufacturing bounds — anything outside is either a measurement error
// or an attempt to game pricing.
const BBOX_MIN_MM = 1;         // a 1mm part is the practical floor
const BBOX_MAX_MM = 2000;      // 2m is larger than any industrial CNC bed we quote
const VOLUME_MIN_CM3 = 0.01;   // 10 mm³
const VOLUME_MAX_CM3 = 5_000_000; // 5 m³ — dwarfs the biggest printable part
const SURFACE_MIN_CM2 = 0.1;
const SURFACE_MAX_CM2 = 10_000_000;

function asFiniteNumber(v: unknown, field: string): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new QuoteValidationError(`${field}은(는) 유한한 숫자여야 합니다`);
  }
  return n;
}

export class QuoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteValidationError';
  }
}

export function validateQuoteInput(raw: RawQuoteInput): ValidatedQuoteInput {
  if (!raw || typeof raw !== 'object') {
    throw new QuoteValidationError('Invalid request body');
  }
  if (!raw.geometry || typeof raw.geometry !== 'object') {
    throw new QuoteValidationError('geometry가 필요합니다');
  }

  const volume_cm3 = asFiniteNumber(raw.geometry.volume_cm3, 'volume_cm3');
  const surface_area_cm2 = asFiniteNumber(raw.geometry.surface_area_cm2, 'surface_area_cm2');

  if (!raw.geometry.bbox || typeof raw.geometry.bbox !== 'object') {
    throw new QuoteValidationError('bbox가 필요합니다');
  }
  const w = asFiniteNumber(raw.geometry.bbox.w, 'bbox.w');
  const h = asFiniteNumber(raw.geometry.bbox.h, 'bbox.h');
  const d = asFiniteNumber(raw.geometry.bbox.d, 'bbox.d');

  // Range checks.
  for (const [name, val, lo, hi] of [
    ['volume_cm3', volume_cm3, VOLUME_MIN_CM3, VOLUME_MAX_CM3],
    ['surface_area_cm2', surface_area_cm2, SURFACE_MIN_CM2, SURFACE_MAX_CM2],
    ['bbox.w', w, BBOX_MIN_MM, BBOX_MAX_MM],
    ['bbox.h', h, BBOX_MIN_MM, BBOX_MAX_MM],
    ['bbox.d', d, BBOX_MIN_MM, BBOX_MAX_MM],
  ] as const) {
    if (val < lo || val > hi) {
      throw new QuoteValidationError(`${name}이(가) 허용 범위를 벗어났습니다 (${lo}-${hi})`);
    }
  }

  // Internal consistency: volume must fit inside the bbox.
  // bbox is in mm, volume in cm³ → bbox volume in cm³ is (w*h*d)/1000.
  const bboxVol_cm3 = (w * h * d) / 1000;
  if (volume_cm3 > bboxVol_cm3 * 1.01) { // 1% float slack
    throw new QuoteValidationError('volume_cm3가 bbox 부피보다 큽니다 (기하 불일치)');
  }

  // Surface area lower bound: a solid sphere of the same volume has the
  // smallest possible surface area for that volume. Anything less means the
  // client fabricated the numbers.
  // r = (3V/4π)^(1/3), surface = 4πr²
  const volMm3 = volume_cm3 * 1000;
  const rMm = Math.cbrt((3 * volMm3) / (4 * Math.PI));
  const minSurfaceCm2 = (4 * Math.PI * rMm * rMm) / 100;
  if (surface_area_cm2 < minSurfaceCm2 * 0.99) {
    throw new QuoteValidationError('surface_area_cm2가 물리적으로 불가능합니다 (구 표면적보다 작음)');
  }

  // Enum whitelist.
  const material = String(raw.material ?? '');
  const process = String(raw.process ?? '');
  if (!ALLOWED_MATERIALS.has(material)) {
    throw new QuoteValidationError(`Unknown material: ${material}`);
  }
  if (!ALLOWED_PROCESSES.has(process)) {
    throw new QuoteValidationError(`Unknown process: ${process}`);
  }

  const finishType = String(raw.finishType ?? 'none');
  const tolerance = String(raw.tolerance ?? 'it9');
  if (!ALLOWED_FINISHES.has(finishType)) {
    throw new QuoteValidationError(`Unknown finishType: ${finishType}`);
  }
  if (!ALLOWED_TOLERANCES.has(tolerance)) {
    throw new QuoteValidationError(`Unknown tolerance: ${tolerance}`);
  }

  // Integer / range clamps.
  let quantity = Math.floor(asFiniteNumber(raw.quantity ?? 1, 'quantity'));
  if (quantity < 1) quantity = 1;
  if (quantity > 100_000) quantity = 100_000;

  let complexity = 5;
  if (raw.aiAnalysis && raw.aiAnalysis.complexity != null) {
    const c = Number(raw.aiAnalysis.complexity);
    if (Number.isFinite(c)) complexity = Math.max(1, Math.min(10, c));
  }

  return {
    volume_cm3,
    surface_area_cm2,
    bbox: { w, h, d },
    material,
    process,
    quantity,
    finishType,
    tolerance,
    complexity,
  };
}
