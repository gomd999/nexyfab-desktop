/**
 * sheet.dimension — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Covers the Sheet IR extension that carries `dimensions` and
 * `gdtCallouts` top-level annotations referencing viewports by id.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSheet,
  SheetValidationError,
  type Sheet,
  type Viewport,
} from './sheet';
import type { Dimension, GdtCallout } from './dimension';

function vp(id: string, x = 100, y = 100): Viewport {
  return {
    id,
    sourceId: 'src',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x, y },
    widthOnSheet: 80,
    scale: 1,
  };
}

function baseSheet(): Sheet {
  return {
    id: 's1',
    name: 'Test',
    paperSize: 'A3',
    viewports: [vp('v1', 100, 100), vp('v2', 250, 100)],
  };
}

const linearDim: Dimension = {
  id: 'd1', viewportId: 'v1', kind: 'linear', refs: ['e1', 'e2'],
};

const flatGdt: GdtCallout = {
  id: 'g1', viewportId: 'v1', kind: 'flatness', targetRef: 'f1', toleranceValue: 0.05,
};

describe('Sheet.dimensions / Sheet.gdtCallouts (Phase 4.2)', () => {
  it('sheet without dimensions/gdtCallouts validates (backward-compat)', () => {
    expect(() => validateSheet(baseSheet())).not.toThrow();
  });

  it('sheet with a valid dimension validates', () => {
    const sheet: Sheet = { ...baseSheet(), dimensions: [linearDim] };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('sheet with a valid GD&T callout validates', () => {
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [flatGdt] };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('sheet with both dimensions AND gdtCallouts validates', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      dimensions: [linearDim],
      gdtCallouts: [flatGdt],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('rejects dimension referencing an unknown viewport', () => {
    const bad: Dimension = { ...linearDim, viewportId: 'ghost' };
    const sheet: Sheet = { ...baseSheet(), dimensions: [bad] };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
    expect(() => validateSheet(sheet)).toThrow(/unknown viewport/);
  });

  it('rejects GD&T referencing an unknown viewport', () => {
    const bad: GdtCallout = { ...flatGdt, viewportId: 'ghost' };
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [bad] };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
    expect(() => validateSheet(sheet)).toThrow(/unknown viewport/);
  });

  it('rejects duplicate dimension ids', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      dimensions: [linearDim, { ...linearDim, refs: ['e3', 'e4'] }],
    };
    expect(() => validateSheet(sheet)).toThrow(/duplicate dimension/);
  });

  it('rejects duplicate GD&T ids', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      gdtCallouts: [flatGdt, { ...flatGdt, targetRef: 'f2' }],
    };
    expect(() => validateSheet(sheet)).toThrow(/duplicate GD&T/);
  });

  it('propagates dimension IR validation errors (wrong ref count)', () => {
    const bad: Dimension = { ...linearDim, refs: ['e1'] };
    const sheet: Sheet = { ...baseSheet(), dimensions: [bad] };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
    expect(() => validateSheet(sheet)).toThrow(/2 refs/);
  });

  it('propagates GD&T IR validation errors (missing datums for position)', () => {
    const bad: GdtCallout = { ...flatGdt, kind: 'position', datums: [] };
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [bad] };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
    expect(() => validateSheet(sheet)).toThrow(/datums/);
  });

  it('empty dimensions array and undefined behave identically', () => {
    const s1: Sheet = { ...baseSheet(), dimensions: [] };
    const s2: Sheet = baseSheet();
    expect(() => validateSheet(s1)).not.toThrow();
    expect(() => validateSheet(s2)).not.toThrow();
  });
});
