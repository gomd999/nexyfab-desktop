/**
 * sheetMetalMaterialId.ts — Load-time alias for legacy sheet metal material ids.
 *
 * Sheet metal shipped with three independent material id schemas, each invented
 * by a different feature module. They drift in style (camelCase vs dashed),
 * grade specificity (cold-rolled vs hot-rolled vs just "mild-steel"), and
 * trade-name (`copper` vs `copper-c110`). The K-factor curves attached to each
 * id also drift up to 0.07 between Schemas A and C at R/T=1.0, which fails the
 * ±0.1mm unfold tolerance on a 5-bend hat section.
 *
 * Phase 2 Track B Week 1 consolidates everything onto Schema A
 * (camelCase, `features/sheetMetalTables.ts`). This module owns the alias map
 * so existing `.nfab` files written under the old schemas continue to load
 * without re-saving. The alias runs at load time only — there is no runtime
 * cost on hot paths.
 *
 *   Schema A (canonical):  `mildSteel`, `stainless304`, ...
 *   Schema B (kFactorTable, dashed grade-spec): `steel-cold-rolled`, ...
 *   Schema C (bendDeductionCalculator, dashed common): `mild-steel`, ...
 *
 * `aliasSheetMetalMaterialId` is idempotent: calling it on an already-canonical
 * id returns that id unchanged. Calling it on an unknown id returns the
 * `DEFAULT_MATERIAL` and logs a one-line warning (dev only — production
 * unknowns are silent and just fall back, to avoid breaking party-imported
 * files at 3am).
 */

import {
  DEFAULT_MATERIAL,
  SHEET_METAL_MATERIALS,
  type SheetMetalMaterial,
} from '@/app/[lang]/shape-generator/features/sheetMetalTables';

/**
 * Every legacy id we know how to map. The keys here are intentionally
 * lowercased on lookup so e.g. `Aluminum-6061` and `aluminum-6061` collapse to
 * the same canonical entry. Unknown inputs fall through to `DEFAULT_MATERIAL`.
 */
const ALIAS_MAP: Readonly<Record<string, SheetMetalMaterial>> = Object.freeze({
  // Schema A — canonical ids, passthrough.
  mildsteel: 'mildSteel',
  stainless304: 'stainless304',
  aluminum5052: 'aluminum5052',
  aluminum6061: 'aluminum6061',
  galvanized: 'galvanized',
  brass: 'brass',
  copper: 'copper',

  // Schema B — kFactorTable.ts dashed grade-spec.
  'aluminum-5052': 'aluminum5052',
  'aluminum-6061': 'aluminum6061',
  'steel-cold-rolled': 'mildSteel',
  'steel-hot-rolled': 'mildSteel',
  'steel-stainless-304': 'stainless304',
  'copper-c110': 'copper',
  'brass-260': 'brass',

  // Schema C — bendDeductionCalculator.ts dashed common-name.
  'mild-steel': 'mildSteel',
  'stainless-304': 'stainless304',
  // 'copper' and 'brass' already covered by Schema A passthrough.

  // Common alternate spellings seen in saved .nfab files / Korean shop tickets.
  sgcc: 'galvanized',
  spcc: 'mildSteel',
  sus304: 'stainless304',
  al5052: 'aluminum5052',
  al6061: 'aluminum6061',
});

/**
 * Map any legacy sheet metal material id to the canonical Schema A id. Returns
 * `DEFAULT_MATERIAL` for inputs we do not recognise — never throws. Pass
 * `strict: true` to throw on unknown input instead (useful in tests / CI).
 *
 * @example
 *   aliasSheetMetalMaterialId('mild-steel')        // → 'mildSteel'
 *   aliasSheetMetalMaterialId('steel-cold-rolled') // → 'mildSteel'
 *   aliasSheetMetalMaterialId('mildSteel')         // → 'mildSteel' (idempotent)
 *   aliasSheetMetalMaterialId('unknown')           // → DEFAULT_MATERIAL
 */
export function aliasSheetMetalMaterialId(
  input: string | null | undefined,
  opts: { strict?: boolean } = {},
): SheetMetalMaterial {
  if (input === null || input === undefined || input === '') {
    if (opts.strict) {
      throw new Error('aliasSheetMetalMaterialId: empty/null input');
    }
    return DEFAULT_MATERIAL;
  }

  // Canonical ids are camelCase and case-sensitive in Schema A, but the alias
  // map is lowercased so we can collapse `Aluminum-6061` / `AL5052` etc. into
  // a single entry. Fast path: if the input is already a Schema A id, return
  // it directly to preserve identity (important for idempotency).
  if (Object.prototype.hasOwnProperty.call(SHEET_METAL_MATERIALS, input)) {
    return input as SheetMetalMaterial;
  }

  const key = input.toLowerCase();
  const hit = ALIAS_MAP[key];
  if (hit !== undefined) {
    return hit;
  }

  if (opts.strict) {
    throw new Error(`aliasSheetMetalMaterialId: unknown material id "${input}"`);
  }
  return DEFAULT_MATERIAL;
}

/**
 * Type guard: does this string correspond to a known sheet-metal material in
 * any of the three schemas (i.e. would `aliasSheetMetalMaterialId` accept it
 * without falling back to default)?
 */
export function isKnownSheetMetalMaterialId(input: string | null | undefined): boolean {
  if (input === null || input === undefined || input === '') return false;
  if (Object.prototype.hasOwnProperty.call(SHEET_METAL_MATERIALS, input)) return true;
  return Object.prototype.hasOwnProperty.call(ALIAS_MAP, input.toLowerCase());
}

/**
 * The full set of recognised legacy ids, primarily for diagnostics and the
 * idempotency test. Order is not significant.
 */
export const LEGACY_SHEET_METAL_MATERIAL_IDS: ReadonlyArray<string> = Object.freeze(
  Object.keys(ALIAS_MAP),
);
