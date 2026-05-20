import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { verifyGeneratedModel, formatVerificationCritique, formatForCustomer, formatForVendor, formatForAudience } from './verifyGeneratedModel';

function box(s = 20): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s, s, s);
  g.computeVertexNormals();
  return g;
}

/** A box with one face's two triangles removed → open boundary. */
function openBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const pos = g.attributes.position.array as Float32Array;
  // Drop the last 2 triangles (one face): keep all but the final 18 floats.
  const kept = pos.slice(0, pos.length - 2 * 9);
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(kept, 3));
  o.computeVertexNormals();
  return o;
}

describe('verifyGeneratedModel — passing cases', () => {
  it('a clean closed box passes with no error-severity failures', () => {
    const r = verifyGeneratedModel(box());
    expect(r.pass).toBe(true);
    expect(r.metrics.boundaryEdges).toBe(0);
    expect(r.metrics.volumeMm3).toBeGreaterThan(0);
    expect(r.checks.find(c => c.id === 'watertight')!.pass).toBe(true);
  });

  it('critique is empty when everything passes', () => {
    expect(formatVerificationCritique(verifyGeneratedModel(box()))).toBe('');
  });
});

describe('verifyGeneratedModel — failing cases (actionable critique)', () => {
  it('empty geometry → non-empty error, no crash', () => {
    const r = verifyGeneratedModel(new THREE.BufferGeometry());
    expect(r.pass).toBe(false);
    expect(r.checks[0]!.id).toBe('non-empty');
    expect(formatVerificationCritique(r)).toMatch(/ERROR \[non-empty\]/);
  });

  it('open mesh → watertight error with actionable message', () => {
    const r = verifyGeneratedModel(openBox());
    expect(r.pass).toBe(false);
    const wt = r.checks.find(c => c.id === 'watertight')!;
    expect(wt.pass).toBe(false);
    expect(r.metrics.boundaryEdges).toBeGreaterThan(0);
    expect(formatVerificationCritique(r)).toMatch(/not watertight/i);
  });

  it('oversized model → max-size error against the constraint', () => {
    const r = verifyGeneratedModel(box(200), { maxSizeMm: 100 });
    expect(r.pass).toBe(false);
    expect(r.checks.find(c => c.id === 'max-size')!.pass).toBe(false);
    expect(formatVerificationCritique(r)).toMatch(/exceeds the limit/);
  });

  it('requireWatertight=false tolerates an open mesh', () => {
    const r = verifyGeneratedModel(openBox(), { requireWatertight: false });
    // No watertight error now; the open mesh passes the gate.
    expect(r.checks.find(c => c.id === 'watertight' && !c.pass)).toBeUndefined();
  });
});

describe('formatVerificationCritique', () => {
  it('orders errors before warnings', () => {
    const r = verifyGeneratedModel(box(200), { maxSizeMm: 100, minSizeMm: 300 });
    const critique = formatVerificationCritique(r);
    // max-size is an error, min-size is a warning → error line comes first.
    expect(critique.indexOf('ERROR')).toBeLessThan(critique.indexOf('WARN'));
  });
});

describe('role-based formatting (one engine, two surfaces)', () => {
  it('vendor view is the technical critique (alias of formatVerificationCritique)', () => {
    const r = verifyGeneratedModel(openBox());
    expect(formatForVendor(r)).toBe(formatVerificationCritique(r));
    expect(formatForVendor(r)).toMatch(/watertight/i); // jargon kept for experts
  });

  it('customer view translates an open mesh into plain language (no jargon)', () => {
    const r = verifyGeneratedModel(openBox());
    const en = formatForCustomer(r, 'en');
    const ko = formatForCustomer(r, 'ko');
    expect(en).toMatch(/gaps or holes/i);
    expect(en).not.toMatch(/watertight|boundary edge/i); // no engineering terms
    expect(ko).toMatch(/틈이나 구멍/);
  });

  it('customer view is empty when the model is sound', () => {
    expect(formatForCustomer(verifyGeneratedModel(box()))).toBe('');
  });

  it('customer view skips technical-only failures it cannot map', () => {
    // Force a check id with no lay mapping by stubbing a result shape.
    const r = { pass: false, checks: [{ id: 'sliver-facets', pass: false, severity: 'warning' as const, message: 'x' }], metrics: { triangleCount: 0, volumeMm3: 0, bbox: { x: 0, y: 0, z: 0 }, boundaryEdges: 0 } };
    expect(formatForCustomer(r)).toBe('');
    // …but the vendor still sees it.
    expect(formatForVendor(r)).toMatch(/sliver-facets/);
  });

  it('formatForAudience dispatches to the right surface', () => {
    const r = verifyGeneratedModel(openBox());
    expect(formatForAudience(r, 'vendor')).toBe(formatForVendor(r));
    expect(formatForAudience(r, 'customer', 'ko')).toBe(formatForCustomer(r, 'ko'));
  });
});
