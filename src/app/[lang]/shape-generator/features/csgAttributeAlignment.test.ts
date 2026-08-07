/**
 * K2 (95% plan) — CSG attribute-mismatch crash regression.
 *
 * three-bvh-csg's Evaluator processes ['position','uv','normal'] by default
 * and reads `.array` of an ABSENT attribute ("Cannot read properties of
 * undefined (reading 'array')"). OCCT tessellations carry no uv, welded/
 * derived meshes sometimes carry no normal — any boolean mixing them with a
 * three.js primitive crashed the whole mesh fallback path (REF-PART 1's
 * f-fillet/boss failures). Contract: meshMerge.configureEvaluatorAttributes
 * is the canonical evaluator setup for arbitrary operands.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyBooleanSyncSafe } from './boolean';
import { configureEvaluatorAttributes } from './meshMerge';

function noUvBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const src = new THREE.BoxGeometry(w, h, d);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', src.getAttribute('position').clone());
  out.setAttribute('normal', src.getAttribute('normal').clone());
  out.setIndex(src.getIndex()!.clone());
  return out;
}

function bareBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const src = new THREE.BoxGeometry(w, h, d);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', src.getAttribute('position').clone());
  out.setIndex(src.getIndex()!.clone());
  return out;
}

describe('CSG attribute alignment (K2)', () => {
  it('OCCT-like (no uv) vs three primitive boolean succeeds', () => {
    const r = applyBooleanSyncSafe('union', noUvBox(10, 10, 10), new THREE.CylinderGeometry(3, 3, 20, 16));
    expect(r.error).toBeNull();
    expect(r.geometry!.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('no-uv vs no-uv and bare-position operands both succeed', () => {
    expect(applyBooleanSyncSafe('subtract', noUvBox(10, 10, 10), noUvBox(6, 6, 20)).error).toBeNull();
    expect(applyBooleanSyncSafe('subtract', bareBox(10, 10, 10), new THREE.BoxGeometry(6, 6, 20)).error).toBeNull();
  });

  it('configureEvaluatorAttributes computes missing normals and intersects uv', () => {
    const a = bareBox(10, 10, 10);
    const b = new THREE.BoxGeometry(5, 5, 5);
    const evaluator = { attributes: ['position', 'uv', 'normal'] };
    configureEvaluatorAttributes(evaluator, a, b);
    expect(a.getAttribute('normal')).toBeTruthy();
    expect(evaluator.attributes).toContain('normal');
    expect(evaluator.attributes).not.toContain('uv');
  });
});
