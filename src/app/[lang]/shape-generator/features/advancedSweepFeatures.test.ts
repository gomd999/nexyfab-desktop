import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { variableSectionSweepFeature, multiSectionSweepFeature } from './advancedSweepFeatures';
import { FEATURE_MAP, getFeatureDefinition } from './index';

/** Build a full params record from a FeatureDefinition's declared defaults. */
function defaults(def: typeof variableSectionSweepFeature): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Max distance from the Z axis over a single station ring. */
function ringMaxRadius(geo: THREE.BufferGeometry, ring: number, profileCount: number): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let max = 0;
  const base = ring * profileCount;
  for (let p = 0; p < profileCount; p++) {
    const x = pos.getX(base + p);
    const y = pos.getY(base + p);
    max = Math.max(max, Math.hypot(x, y));
  }
  return max;
}

describe('advanced sweep features — registration', () => {
  it('both are registered in FEATURE_MAP', () => {
    expect(FEATURE_MAP.variableSectionSweep).toBe(variableSectionSweepFeature);
    expect(FEATURE_MAP.multiSectionSweep).toBe(multiSectionSweepFeature);
  });

  it('are resolvable via getFeatureDefinition', () => {
    expect(getFeatureDefinition('variableSectionSweep')).toBe(variableSectionSweepFeature);
    expect(getFeatureDefinition('multiSectionSweep')).toBe(multiSectionSweepFeature);
  });

  it('expose a non-empty param schema and an apply()', () => {
    expect(variableSectionSweepFeature.params.length).toBeGreaterThan(0);
    expect(multiSectionSweepFeature.params.length).toBeGreaterThan(0);
    expect(typeof variableSectionSweepFeature.apply).toBe('function');
    expect(typeof multiSectionSweepFeature.apply).toBe('function');
  });
});

describe('variableSectionSweepFeature.apply', () => {
  const base = new THREE.BoxGeometry(10, 10, 10);

  it('produces a solid whose section radius morphs start → end', () => {
    const params = defaults(variableSectionSweepFeature); // startRadius 30 → endRadius 12
    const geo = variableSectionSweepFeature.apply(base, params);
    const pc = 96; // profileResolution used by the wrapper
    const stations = params.stations; // sweepVariableSection emits exactly `stations` rings
    const firstR = ringMaxRadius(geo, 0, pc);
    const lastR = ringMaxRadius(geo, stations - 1, pc);
    // First ring tracks startRadius (30), last tracks endRadius (12).
    expect(firstR).toBeCloseTo(30, 0);
    expect(lastR).toBeLessThan(firstR);
    expect(lastR).toBeCloseTo(12, 0);
  });

  it('honors the arc path type (spine bends into +Z/+X)', () => {
    const params = { ...defaults(variableSectionSweepFeature), pathType: 1 };
    const geo = variableSectionSweepFeature.apply(base, params);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    // Arc sweep leaves the Z=0 plane and advances in +Z, so depth > a section.
    expect(bb.max.z - bb.min.z).toBeGreaterThan(40);
  });
});

describe('multiSectionSweepFeature.apply', () => {
  const base = new THREE.BoxGeometry(10, 10, 10);

  it('produces a lofted solid from the 3 sections', () => {
    const params = { ...defaults(multiSectionSweepFeature), guideMode: 0 };
    const geo = multiSectionSweepFeature.apply(base, params);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getIndex()!.count).toBeGreaterThan(0);
  });

  it('the guide rail pulls the loft in +X (bbox extends beyond the section size)', () => {
    const off = { ...defaults(multiSectionSweepFeature), guideMode: 0 };
    const on = { ...defaults(multiSectionSweepFeature), guideMode: 1, guideOffset: 60 };
    const geoOff = multiSectionSweepFeature.apply(base, off);
    const geoOn = multiSectionSweepFeature.apply(base, on);
    geoOff.computeBoundingBox();
    geoOn.computeBoundingBox();
    // Without a guide the loft stays centered (max X ≈ startSize 40); the rail
    // drags later stations toward +60, so the guided bbox reaches much further.
    expect(geoOff.boundingBox!.max.x).toBeLessThan(50);
    expect(geoOn.boundingBox!.max.x).toBeGreaterThan(70);
  });
});
