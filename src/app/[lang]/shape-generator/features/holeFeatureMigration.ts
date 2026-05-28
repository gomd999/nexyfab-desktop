/**
 * Hole-feature schema migration — v7 → v8 (Phase 2 Week 6 Track C6).
 *
 * Spec ref: `wave-2-phase-2-hole-wizard-spec.md` §11 risks (table row 4)
 * and `wave-2-phase-2-master-task-tracker.md` Track C row W6.
 *
 * ⚠ **Two schema-version axes** in NexyFab:
 *
 *   1. **`.nfab` envelope** version (top-level `NFAB_FORMAT_VERSION`, currently 3).
 *      Shared across all Phase 2 tracks (D2 ref-geom, A1 configurations,
 *      C hole-wizard); a single bump for the whole document.
 *
 *   2. **Hole-feature schema** version (`HOLE_FEATURE_SCHEMA_VERSION`,
 *      currently 8). Internal axis for the hole-feature shape — does NOT
 *      bump `.nfab.version`. Lives **within** the v3 envelope (per master
 *      tracker R-2 mitigation: "C uses v8 (which is the same v3 envelope
 *      for hole features)").
 *
 * The version axis split lets the three Phase 2 tracks evolve their own
 * feature shapes without stacking bumps on the top-level document
 * version. The .nfab `parseProject` loader runs the top-level migration
 * chain (v1→v2→v3); per-feature loaders run the feature-axis chain
 * (v7→v8 here) on individual feature nodes.
 *
 * v7 → v8 changes:
 *   - Legacy `hole` feature param-bag (`{ holeType: 0/1/2, diameter,
 *     posX, posZ, depth, counterboreDia, counterboreDepth,
 *     countersinkAngle }`) → new `holeArrayDef: HoleArrayDefinition`
 *     with discriminated `params`, `holeSpec` ref, `holeSpecDetail`
 *     spec, and `terminationKind/Params`.
 *   - Old `holeType: 0` (through) maps to `kind: 'drilled'` + termination
 *     `through`; `1` → `counterbore`; `2` → `countersink`.
 *   - Old single-position (posX/posZ) becomes a `manual` array with one
 *     point. CAUTION — the legacy param model is XZ-plane while the new
 *     model uses XY; we map x → x, z → y to preserve the visual position
 *     in the host-plate's drilling plane (spec §5.1.1).
 *   - New `terminationKind` defaults to `through` when the old `depth`
 *     was ≥ 999 (legacy sentinel for "through"); `blind` otherwise.
 *
 * Pure, deterministic — no side effects, no async, no I/O.
 */

import type {
  HoleArrayDefinition,
  HoleSpec,
} from './holeArray';
import { DEFAULT_DRILL_TIP_ANGLE } from './holeArray';

// ─── Versions ──────────────────────────────────────────────────────────────

/**
 * Current hole-feature schema version. Bumped from v7 (legacy single-
 * position param bag) to v8 (multi-position holeArray with discriminated
 * HoleSpec). Lives within `.nfab` v3 envelope — does NOT bump the
 * top-level NFAB_FORMAT_VERSION.
 */
export const HOLE_FEATURE_SCHEMA_VERSION = 8 as const;

export type HoleFeatureSchemaVersion = 7 | 8;

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * Legacy hole-feature param bag — the shape stored on `HistoryNode.params`
 * for `featureType: 'hole'` nodes authored by builds running v7 and prior.
 * Field order matches `features/hole.ts` `params` declaration.
 */
export interface LegacyHoleParamsV7 {
  /** 0 = through, 1 = counterbore, 2 = countersink. */
  holeType: number;
  diameter: number;
  posX: number;
  posZ: number;
  /** Depth (mm). 999 = legacy sentinel for "through all". */
  depth: number;
  counterboreDia?: number;
  counterboreDepth?: number;
  countersinkAngle?: number;
  /** Engine selector — preserved on the migrated node as a sibling. */
  engine?: number;
}

/**
 * Migrated v8 representation. The original `params` blob is preserved
 * for back-compat (V1 modal can still edit a migrated feature), and a
 * sibling `holeArrayDef` field carries the new discriminated array
 * definition for V2 + downstream tools (holeMeta, BOM, drawing).
 */
export interface MigratedHoleFeatureV8 {
  /** Schema version stamp — written on every migrated node. */
  holeFeatureSchemaVersion: 8;
  /** Original v7 param bag — kept for legacy V1 modal compatibility. */
  legacyParams: LegacyHoleParamsV7;
  /** New v8 discriminated array definition. */
  holeArrayDef: HoleArrayDefinition;
}

// ─── Heuristics ────────────────────────────────────────────────────────────

const LEGACY_THROUGH_DEPTH = 999;

function inferHoleSpec(params: LegacyHoleParamsV7): HoleSpec {
  const diameter = params.diameter > 0 ? params.diameter : 5;
  const angle = DEFAULT_DRILL_TIP_ANGLE;
  switch (params.holeType) {
    case 1: {
      // Counterbore — pull cbore diameter from explicit field, fall back
      // to drill * 1.6 (typical socket-head ratio) when absent.
      const headDiameter =
        params.counterboreDia && params.counterboreDia > diameter
          ? params.counterboreDia
          : Math.max(diameter * 1.6, diameter + 2);
      const headDepth =
        params.counterboreDepth && params.counterboreDepth > 0
          ? params.counterboreDepth
          : Math.max(diameter, 2);
      return {
        kind: 'counterbore',
        diameter,
        headDiameter,
        headDepth,
        drillTipAngle: angle,
      };
    }
    case 2: {
      // Countersink — pull angle from explicit field; if absent default
      // to 90° (ISO 10642 metric flat-head). cone ⌀ defaults to drill * 2.
      const coneAngle =
        params.countersinkAngle && params.countersinkAngle > 0
          ? params.countersinkAngle
          : 90;
      return {
        kind: 'countersink',
        diameter,
        coneDiameter: Math.max(diameter * 2, diameter + 3),
        coneAngle,
        drillTipAngle: angle,
      };
    }
    case 0:
    default:
      return {
        kind: 'drilled',
        diameter,
        drillTipAngle: angle,
      };
  }
}

function inferTermination(
  params: LegacyHoleParamsV7,
): { kind: HoleArrayDefinition['terminationKind']; params: HoleArrayDefinition['terminationParams'] } {
  if (params.depth >= LEGACY_THROUGH_DEPTH || !Number.isFinite(params.depth)) {
    return { kind: 'through', params: { kind: 'through' } };
  }
  if (params.depth > 0) {
    return {
      kind: 'blind',
      params: {
        kind: 'blind',
        depth: params.depth,
        bottomShape: 'conical',
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      },
    };
  }
  // Zero or negative depth — treat as through (defensive).
  return { kind: 'through', params: { kind: 'through' } };
}

/**
 * Build a stable manual array containing the legacy single position.
 * The id is derived from the feature node id so re-migrations of the
 * same input produce identical position lists (lets test fixtures
 * round-trip cleanly).
 */
function buildManualArray(
  nodeId: string,
  spec: HoleSpec,
  params: LegacyHoleParamsV7,
  term: ReturnType<typeof inferTermination>,
): HoleArrayDefinition {
  // Catalog reference — when the legacy params don't carry one, infer
  // by diameter mapping to the nearest ISO row. We default to 'ISO' /
  // 'M{round(diameter)}' which is wrong for non-metric tools but at
  // least surfaces a sensible label in the V2 wizard's Size tab.
  const designation = `M${Math.max(1, Math.round(spec.diameter))}`;
  return {
    id: `${nodeId}-array-v8`,
    kind: 'manual',
    params: {
      kind: 'manual',
      data: {
        points: [
          {
            id: `${nodeId}-pos-0`,
            x: params.posX,
            // XZ-plane → XY-plane: legacy `posZ` becomes new `y` so the
            // visual position in the drill-plane stays unchanged.
            y: params.posZ,
          },
        ],
      },
    },
    holeSpec: {
      series: 'ISO',
      designation,
      fitClass: 'normal',
    },
    holeSpecDetail: spec,
    terminationKind: term.kind,
    terminationParams: term.params,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Migrate a single legacy hole-feature param bag (v7) to the new
 * `MigratedHoleFeatureV8` shape. Pure — no I/O.
 *
 * Callers (typically a per-node loader inside `parseProject` or a
 * one-shot upgrade script) should:
 *   1. Detect `featureType === 'hole'` nodes with
 *      `holeFeatureSchemaVersion !== 8` (or absent).
 *   2. Call this function with the node's `params`.
 *   3. Persist the result alongside the node so V1 + V2 modals can
 *      both consume it.
 *
 * `nodeId` is used to derive stable array + position ids; pass the
 * `HistoryNode.id` of the feature being migrated.
 */
export function migrateLegacyHoleFeature(
  nodeId: string,
  raw: Partial<LegacyHoleParamsV7> | Record<string, unknown>,
): MigratedHoleFeatureV8 {
  const legacy: LegacyHoleParamsV7 = {
    holeType: typeof raw.holeType === 'number' ? raw.holeType : 0,
    diameter:
      typeof raw.diameter === 'number' && raw.diameter > 0 ? raw.diameter : 5,
    posX: typeof raw.posX === 'number' ? raw.posX : 0,
    posZ: typeof raw.posZ === 'number' ? raw.posZ : 0,
    depth:
      typeof raw.depth === 'number' && Number.isFinite(raw.depth)
        ? raw.depth
        : LEGACY_THROUGH_DEPTH,
    counterboreDia:
      typeof raw.counterboreDia === 'number' ? raw.counterboreDia : undefined,
    counterboreDepth:
      typeof raw.counterboreDepth === 'number' ? raw.counterboreDepth : undefined,
    countersinkAngle:
      typeof raw.countersinkAngle === 'number' ? raw.countersinkAngle : undefined,
    engine: typeof raw.engine === 'number' ? raw.engine : undefined,
  };

  const spec = inferHoleSpec(legacy);
  const term = inferTermination(legacy);
  const holeArrayDef = buildManualArray(nodeId, spec, legacy, term);

  return {
    holeFeatureSchemaVersion: 8,
    legacyParams: legacy,
    holeArrayDef,
  };
}

/**
 * Already-v8 detection. Returns true when `obj.holeFeatureSchemaVersion === 8`
 * (or the structurally-newer field `holeArrayDef` is present and well-
 * formed). Used by callers to skip the migration step on already-current
 * fixtures.
 */
export function isHoleFeatureV8(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (o.holeFeatureSchemaVersion === 8) return true;
  if (o.holeArrayDef && typeof o.holeArrayDef === 'object') {
    const def = o.holeArrayDef as Record<string, unknown>;
    return (
      typeof def.id === 'string' &&
      typeof def.kind === 'string' &&
      def.params !== undefined
    );
  }
  return false;
}

/**
 * Convenience — pass `(nodeId, params)` for any v7-or-v8 input and get
 * back a v8 representation. Already-v8 inputs are returned with the
 * existing `holeArrayDef` preserved (no re-derivation). Legacy v7
 * inputs run through `migrateLegacyHoleFeature` as above.
 */
export function ensureHoleFeatureV8(
  nodeId: string,
  raw: unknown,
): MigratedHoleFeatureV8 {
  if (isHoleFeatureV8(raw)) {
    const o = raw as Record<string, unknown>;
    const legacy = (o.legacyParams ?? o) as Record<string, unknown>;
    return {
      holeFeatureSchemaVersion: 8,
      legacyParams: {
        holeType: typeof legacy.holeType === 'number' ? legacy.holeType : 0,
        diameter: typeof legacy.diameter === 'number' ? legacy.diameter : 5,
        posX: typeof legacy.posX === 'number' ? legacy.posX : 0,
        posZ: typeof legacy.posZ === 'number' ? legacy.posZ : 0,
        depth: typeof legacy.depth === 'number' ? legacy.depth : LEGACY_THROUGH_DEPTH,
        counterboreDia: typeof legacy.counterboreDia === 'number' ? legacy.counterboreDia : undefined,
        counterboreDepth: typeof legacy.counterboreDepth === 'number' ? legacy.counterboreDepth : undefined,
        countersinkAngle: typeof legacy.countersinkAngle === 'number' ? legacy.countersinkAngle : undefined,
        engine: typeof legacy.engine === 'number' ? legacy.engine : undefined,
      },
      holeArrayDef: o.holeArrayDef as HoleArrayDefinition,
    };
  }
  return migrateLegacyHoleFeature(nodeId, (raw ?? {}) as Record<string, unknown>);
}
