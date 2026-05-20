import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { verifyGeneratedModel, formatVerificationCritique } from './verifyGeneratedModel';

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
