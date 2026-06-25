/**
 * meshMerge — unit tests for the shared attribute/index unification layer.
 *
 * The full producer matrix that broke merges in production (reference-parts
 * findings P1/P3): BoxGeometry (indexed, uv), ExtrudeGeometry (non-indexed,
 * uv), OCCT tessellation stand-in (indexed, NO uv), pipeline outputs
 * (per-vertex nfabFaceFeatureId provenance stamp).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  alignForMerge,
  mergeAligned,
  configureEvaluatorAttributes,
  ensureFaceIdSentinel,
} from './meshMerge';
import { FACE_FEATURE_ID_ATTR, stampFaceFeatureIdAll } from './faceProvenance';

/** Indexed, uv-less mesh — the shape of an OCCT tessellation output. */
function occtLikeBox(w = 10, h = 10, d = 10): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  return g;
}

/** Non-indexed, uv-carrying mesh — the shape of an ExtrudeGeometry tool. */
function extrudeLike(w = 4, h = 4, d = 4): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed();
}

describe('alignForMerge — attribute matrix', () => {
  it('uv on one side only → dropped so the pair merges', () => {
    const a = occtLikeBox();         // no uv
    const b = extrudeLike();         // uv
    const [ax, bx] = alignForMerge(a, b);
    expect(ax.getAttribute('uv')).toBeUndefined();
    expect(bx.getAttribute('uv')).toBeUndefined();
    expect(mergeGeometries([ax, bx], false)).not.toBeNull();
  });

  it('uv on both sides → kept', () => {
    const a = new THREE.BoxGeometry(10, 10, 10);
    const b = new THREE.BoxGeometry(4, 4, 4);
    const [ax, bx] = alignForMerge(a, b);
    expect(ax.getAttribute('uv')).toBeDefined();
    expect(bx.getAttribute('uv')).toBeDefined();
    expect(mergeGeometries([ax, bx], false)).not.toBeNull();
  });

  it('provenance stamp on one side → SYNTHESIZED (sentinel) on the other, never dropped', () => {
    const a = occtLikeBox();
    stampFaceFeatureIdAll(a, 'feat-1');
    const b = extrudeLike();
    const [ax, bx] = alignForMerge(a, b);
    expect(ax.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
    expect(bx.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
    // Sentinel side reads back 0 ("unattributed"), stamped side keeps its id.
    const bAttr = bx.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    expect(bAttr.getX(0)).toBe(0);
    const aAttr = ax.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    expect(aAttr.getX(0)).toBeGreaterThan(0);
    const merged = mergeGeometries(
      // index parity already aligned by alignForMerge
      [ax, bx],
      false,
    );
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
  });

  it('index parity: indexed × non-indexed → both non-indexed', () => {
    const a = occtLikeBox();   // indexed
    const b = extrudeLike();   // non-indexed
    const [ax, bx] = alignForMerge(a, b);
    expect(ax.index).toBeNull();
    expect(bx.index).toBeNull();
  });

  it('missing normals are computed', () => {
    const a = new THREE.BufferGeometry();
    a.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const b = extrudeLike();
    const [ax, bx] = alignForMerge(a, b);
    expect(ax.getAttribute('normal')).toBeDefined();
    expect(bx.getAttribute('normal')).toBeDefined();
  });

  it('does NOT mutate the inputs (lazy clone-on-write)', () => {
    const a = new THREE.BoxGeometry(10, 10, 10); // indexed, uv
    const b = occtLikeBox();                     // indexed, no uv
    alignForMerge(a, b);
    // a still has its uv; b untouched.
    expect(a.getAttribute('uv')).toBeDefined();
    expect(b.getAttribute('uv')).toBeUndefined();
    expect(a.index).not.toBeNull();
  });

  it('zero-vertex attribute-complete base (empty sketch document) merges with a tool', () => {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    empty.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(new Uint32Array(0), 1));
    const tool = extrudeLike();
    stampFaceFeatureIdAll(tool, 'first');
    const merged = mergeAligned(empty, tool);
    expect(merged).not.toBeNull();
    expect(merged!.attributes.position.count).toBe(tool.attributes.position.count);
  });
});

describe('mergeAligned — end-to-end producer matrix', () => {
  const CASES: Array<[string, () => THREE.BufferGeometry, () => THREE.BufferGeometry]> = [
    ['box × extrude', () => new THREE.BoxGeometry(10, 10, 10), () => extrudeLike()],
    ['occt × extrude', () => occtLikeBox(), () => extrudeLike()],
    ['occt × box', () => occtLikeBox(), () => new THREE.BoxGeometry(4, 4, 4)],
    ['stamped occt × extrude', () => { const g = occtLikeBox(); stampFaceFeatureIdAll(g, 'a'); return g; }, () => extrudeLike()],
    ['stamped box × stamped extrude', () => { const g = new THREE.BoxGeometry(10, 10, 10); stampFaceFeatureIdAll(g, 'a'); return g; }, () => { const g = extrudeLike(); stampFaceFeatureIdAll(g, 'b'); return g; }],
  ];
  for (const [label, mkA, mkB] of CASES) {
    it(`merges ${label}`, () => {
      const merged = mergeAligned(mkA(), mkB());
      expect(merged, label).not.toBeNull();
      expect(merged!.attributes.position.count).toBeGreaterThan(0);
    });
  }
});

describe('configureEvaluatorAttributes — CSG operand unification', () => {
  it('restricts interpolated attributes to the shared set (uv-less base survives)', () => {
    const base = occtLikeBox(20, 4, 20);
    const tool = new THREE.BoxGeometry(4, 10, 4); // uv-carrying
    const ev = new Evaluator();
    configureEvaluatorAttributes(ev, base, tool);
    expect(ev.attributes).toEqual(['position', 'normal']);
    const out = ev.evaluate(
      new Brush(base, new THREE.MeshStandardMaterial()),
      new Brush(tool, new THREE.MeshStandardMaterial()),
      SUBTRACTION,
    );
    expect(out.geometry.attributes.position.count).toBeGreaterThan(0);
  });

  it('stamped TOOL × unstamped BASE no longer crashes — base is sentinel-filled', () => {
    // The exact reliefCuts failure mode: csgSubtract stamps the tool with
    // provenance, the fresh base (feature #1 input) was never stamped, and
    // three-bvh-csg dereferenced the missing attribute.
    const base = new THREE.BoxGeometry(20, 2, 20);
    const tool = new THREE.BoxGeometry(4, 6, 4);
    stampFaceFeatureIdAll(tool, 'relief-1');
    const ev = new Evaluator();
    configureEvaluatorAttributes(ev, base, tool);
    expect(ev.attributes).toContain(FACE_FEATURE_ID_ATTR);
    expect(base.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined(); // sentinel
    const out = ev.evaluate(
      new Brush(base, new THREE.MeshStandardMaterial()),
      new Brush(tool, new THREE.MeshStandardMaterial()),
      SUBTRACTION,
    );
    expect(out.geometry.attributes.position.count).toBeGreaterThan(0);
    expect(out.geometry.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
  });

  it('no provenance anywhere → attribute not added, nothing synthesized', () => {
    const a = new THREE.BoxGeometry(10, 10, 10);
    const b = new THREE.BoxGeometry(4, 4, 4);
    const ev = new Evaluator();
    configureEvaluatorAttributes(ev, a, b);
    expect(ev.attributes).toEqual(['position', 'normal', 'uv']);
    expect(a.getAttribute(FACE_FEATURE_ID_ATTR)).toBeUndefined();
  });
});

describe('ensureFaceIdSentinel', () => {
  it('fills a per-vertex zero attribute and is idempotent', () => {
    const g = new THREE.BoxGeometry(2, 2, 2);
    ensureFaceIdSentinel(g);
    const attr = g.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    expect(attr.count).toBe(g.attributes.position.count);
    expect(attr.getX(0)).toBe(0);
    stampFaceFeatureIdAll(g, 'x'); // overwrite with a real id
    ensureFaceIdSentinel(g);       // must NOT reset the stamp
    expect((g.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute).getX(0)).toBeGreaterThan(0);
  });
});
