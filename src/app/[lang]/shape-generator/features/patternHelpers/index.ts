/**
 * Pattern-helper barrel for the Hole Wizard (Phase 2 W5 — Track C5).
 *
 * Phase 2 W2 (C2) shipped the linear / circular / rect array kinds as
 * inline cases inside `expandHoleArray`. W5 promotes those to dedicated
 * modules so:
 *
 *  - the wizard's Position tab can call them directly (e.g. CSV paste
 *    previews a "linear pattern, count=N" expansion before commit),
 *  - the new `linear2D` kind has somewhere natural to live without
 *    further bloating `holeArray.ts`,
 *  - the circular kind can grow `partialAngle` + `direction` without
 *    breaking C2 fixtures (defaults preserved).
 *
 * `expandPattern(def)` is the single-entry dispatcher used by both the
 * wizard and the holeArray expansion path.
 */

import type { HolePosition } from '../holeArray';
import {
  expandLinearPattern,
  expandLinear2DPattern,
  type LinearPatternParams,
  type Linear2DPatternParams,
} from './linearPattern';
import {
  expandCircularPattern,
  type CircularPatternParams,
} from './circularPattern';
import { expandRectPattern, type RectPatternParams } from './rectPattern';

export {
  expandLinearPattern,
  expandLinear2DPattern,
  expandCircularPattern,
  expandRectPattern,
};
export type {
  LinearPatternParams,
  Linear2DPatternParams,
  CircularPatternParams,
  RectPatternParams,
};

/**
 * Discriminated union of every math-driven pattern kind. Caller passes one
 * of these to `expandPattern(arrayId, def)` and gets back the flat
 * HolePosition list, deterministic per `arrayId`.
 */
export type PatternDef =
  | LinearPatternParams
  | Linear2DPatternParams
  | CircularPatternParams
  | RectPatternParams;

export function expandPattern(arrayId: string, def: PatternDef): HolePosition[] {
  switch (def.kind) {
    case 'linear':
      return expandLinearPattern(arrayId, def);
    case 'linear2D':
      return expandLinear2DPattern(arrayId, def);
    case 'circular':
      return expandCircularPattern(arrayId, def);
    case 'rect':
      return expandRectPattern(arrayId, def);
    default: {
      // Exhaustive — TS flags any unhandled kind.
      const _exhaustive: never = def;
      void _exhaustive;
      return [];
    }
  }
}
