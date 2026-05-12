/**
 * Logical category mapping for the shape gallery filter.
 *
 * Existing `ShapeConfig.tier` (1=basic, 2=mechanical) is too coarse for the
 * filter UI now that we have ~30 shapes. This file maps each shape id to a
 * human-readable category so the gallery can present (Primitive / Standard
 * Part / Structural / Manufacturing) chips without touching every shape file.
 *
 * `std:*` ids come from `library/standardParts.ts`. Structural library parts are
 * listed in `STANDARD_LIBRARY_STRUCTURAL` (keep in sync when adding structural std parts).
 *
 * New shapes default to 'manufacturing' if not listed — the gallery will
 * still render them, just under that bucket. Adding a new shape to its
 * proper category is a one-line change here.
 */

export type ShapeCategory = 'primitive' | 'standard' | 'structural' | 'manufacturing';

/** `std:*` shape ids with StandardPart.category === 'structural'. Sync with `standardParts.ts`. */
export const STANDARD_LIBRARY_STRUCTURAL = new Set([
  'iBeam', 'angleBracket', 'channelBeam', 'lmGuideRail',
]);

const PRIMITIVE = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'ellipsoid', 'ellipticDisk',
]);

/** Built-in shape ids only (not `std:*`). Must match `SHAPES` registry keys. */
const STANDARD = new Set([
  'bearing', 'bolt', 'hexNut', 'washer', 'flange',
]);

const STRUCTURAL = new Set([
  'iBeam', 'lBracket',
]);

// Everything else (gears, blades, springs, heatsinks, etc.) is "manufacturing".

// Memoize per-id results so repeated lookups during a render pass are O(1)
// (no Set.has chain). The map is bounded by the number of unique shape ids
// seen at runtime, which is small.
const _categoryCache = new Map<string, ShapeCategory>();

export function getShapeCategory(id: string): ShapeCategory {
  const hit = _categoryCache.get(id);
  if (hit !== undefined) return hit;
  let cat: ShapeCategory;

  if (id.startsWith('std:')) {
    const base = id.slice(4);
    cat = STANDARD_LIBRARY_STRUCTURAL.has(base) ? 'structural' : 'standard';
    _categoryCache.set(id, cat);
    return cat;
  }

  if (PRIMITIVE.has(id)) cat = 'primitive';
  else if (STANDARD.has(id)) cat = 'standard';
  else if (STRUCTURAL.has(id)) cat = 'structural';
  else cat = 'manufacturing';
  _categoryCache.set(id, cat);
  return cat;
}

interface CategoryLabels {
  primitive: string;
  standard: string;
  structural: string;
  manufacturing: string;
}

const dict: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', CategoryLabels> = {
  ko: { primitive: '기본형', standard: '표준 부품', structural: '구조재',  manufacturing: '제조 부품' },
  en: { primitive: 'Primitive', standard: 'Standard part', structural: 'Structural', manufacturing: 'Manufacturing' },
  ja: { primitive: '基本形', standard: '標準部品', structural: '構造材', manufacturing: '製造部品' },
  zh: { primitive: '基本形', standard: '标准件', structural: '结构件', manufacturing: '制造件' },
  es: { primitive: 'Primitiva', standard: 'Parte estándar', structural: 'Estructural', manufacturing: 'Manufactura' },
  ar: { primitive: 'أولية', standard: 'قطعة قياسية', structural: 'هيكلية', manufacturing: 'تصنيع' },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export function getCategoryLabel(cat: ShapeCategory, lang: string): string {
  return dict[langMap[lang] ?? 'en'][cat];
}
