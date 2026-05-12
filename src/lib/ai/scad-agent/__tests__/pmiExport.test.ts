/**
 * Z5 — PMI export contract tests.
 *
 * Pins the AP242 supplement format + companion JSON shape so MBD-aware
 * downstream tools (Tetra4D, Inspector, etc.) can reliably parse what
 * we emit.
 */

import { describe, it, expect } from 'vitest';
import { exportPmi } from '../pmiExport';
import type { GdtFrame, DatumTarget, SurfaceFinish, AnnotatedDimension } from '../types';

describe('exportPmi', () => {
  it('emits a valid JSON companion + STEP supplement skeleton', () => {
    const r = exportPmi({
      partName: 'bracket',
      gdtFrames: [],
      datumTargets: [],
      surfaceFinishes: [],
      annotatedDimensions: [],
    });
    const parsed = JSON.parse(r.companionJson);
    expect(parsed.schema).toBe('NexyFab.PMI');
    expect(parsed.part).toBe('bracket');
    expect(r.stepSupplement).toContain('ISO-10303-21;');
    expect(r.stepSupplement).toContain('END-ISO-10303-21;');
    expect(r.stepSupplement).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF');
  });

  it('renders GD&T frames into the AP242 supplement', () => {
    const frames: GdtFrame[] = [
      { id: 'g1', featureRef: 'occt:1:top', symbol: 'position', tolerance: 0.05, diameter: true, modifier: 'M', datums: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }] },
    ];
    const r = exportPmi({ partName: 'p', gdtFrames: frames, datumTargets: [], surfaceFinishes: [], annotatedDimensions: [] });
    expect(r.stepSupplement).toContain('GEOMETRIC_TOLERANCE_WITH_DEFINED_AREA_UNIT');
    expect(r.stepSupplement).toContain('POSITION');
    expect(r.stepSupplement).toContain('A | B | C');
  });

  it('renders datum targets with location', () => {
    const targets: DatumTarget[] = [
      { letter: 'A', index: 1, type: 'point', location: [10, 0, 5] },
      { letter: 'A', index: 2, type: 'area', location: [20, 0, 5], sizeMm: 5 },
    ];
    const r = exportPmi({ partName: 'p', gdtFrames: [], datumTargets: targets, surfaceFinishes: [], annotatedDimensions: [] });
    expect(r.stepSupplement).toContain("DATUM_TARGET('A1'");
    expect(r.stepSupplement).toContain("DATUM_TARGET('A2'");
    expect(r.stepSupplement).toContain('10,0,5');
  });

  it('renders surface finishes with Ra range and lay', () => {
    const finishes: SurfaceFinish[] = [
      { id: 'sf1', featureRef: 'occt:1:side', roughnessRaUm: { upper: 1.6 } },
      { id: 'sf2', featureRef: 'occt:1:top', roughnessRaUm: { upper: 3.2, lower: 0.8 }, lay: '=' },
    ];
    const r = exportPmi({ partName: 'p', gdtFrames: [], datumTargets: [], surfaceFinishes: finishes, annotatedDimensions: [] });
    expect(r.stepSupplement).toContain('Ra 1.6');
    expect(r.stepSupplement).toContain('Ra 0.8-3.2');
    expect(r.stepSupplement).toContain('lay==');
  });

  it('renders dimensions with kind classification', () => {
    const dims: AnnotatedDimension[] = [
      { id: 'd1', featureRef: 'occt:1', kind: 'basic', valueMm: 50 },
      { id: 'd2', featureRef: 'occt:1', kind: 'standard', valueMm: 25, tolerance: { plus: 0.1, minus: 0.05 } },
    ];
    const r = exportPmi({ partName: 'p', gdtFrames: [], datumTargets: [], surfaceFinishes: [], annotatedDimensions: dims });
    expect(r.stepSupplement).toContain('basic 50');
    expect(r.stepSupplement).toContain('+0.1/-0.05');
  });

  it('escapes single quotes in part names', () => {
    const r = exportPmi({ partName: "Joe's part", gdtFrames: [], datumTargets: [], surfaceFinishes: [], annotatedDimensions: [] });
    expect(r.stepSupplement).toContain("Joe''s part");
  });

  it('counts include all PMI categories', () => {
    const r = exportPmi({
      partName: 'p',
      gdtFrames: [{ id: 'g', featureRef: 'f', symbol: 'flatness', tolerance: 0.1 }],
      datumTargets: [{ letter: 'A', index: 1, type: 'point', location: [0, 0, 0] }],
      surfaceFinishes: [{ id: 's', featureRef: 'f', roughnessRaUm: { upper: 1.6 } }],
      annotatedDimensions: [{ id: 'd', featureRef: 'f', kind: 'reference', valueMm: 100 }],
    });
    const parsed = JSON.parse(r.companionJson);
    expect(parsed.counts).toEqual({ gdtFrames: 1, datumTargets: 1, surfaceFinishes: 1, annotatedDimensions: 1 });
  });
});
