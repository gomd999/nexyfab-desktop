/**
 * draftAnalysis — geometry-coupled verification of the injection-molding draft-angle
 * analysis (face normals vs the mold pull direction). Checked against meshes with KNOWN
 * draft:
 *
 *   box, pull +Y:   top face draft +90° (ejectable), bottom −90° (undercut), sides 0°
 *                   (vertical) ⇒ counts 2 positive / 8 vertical / 2 undercut
 *   frustum:        a cone taper of (r_bottom−r_top) over height h gives side draft
 *                   = atan((r_b−r_t)/h) (exact for the slant; sub-degree faceting error)
 *   reverse pull:   flips undercut ↔ positive (a face ejectable from one half is an
 *                   undercut for the other)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeDraft, PULL_AXES } from './draftAnalysis';

describe('draftAnalysis — moldability (verified vs known draft)', () => {
  it('classifies a box: top ejectable (+90°), bottom undercut (−90°), sides vertical (0°)', () => {
    const r = analyzeDraft(new THREE.BoxGeometry(20, 20, 20), { pullDirection: PULL_AXES['+y'], minDraftDeg: 3 });
    expect(r.maxAngle).toBeCloseTo(90, 4);
    expect(r.minAngle).toBeCloseTo(-90, 4);
    expect(r.counts.positive).toBe(2);   // +Y top (2 tris)
    expect(r.counts.undercut).toBe(2);   // −Y bottom
    expect(r.counts.vertical).toBe(8);   // four side faces
    expect(r.counts.total).toBe(12);
  });

  it('measures a frustum side draft = atan((r_b−r_t)/h)', () => {
    const rT = 8, rB = 10, h = 20;
    const g = new THREE.CylinderGeometry(rT, rB, h, 48);
    const r = analyzeDraft(g, { pullDirection: PULL_AXES['+y'], minDraftDeg: 3 });
    const expDraft = (Math.atan((rB - rT) / h) * 180) / Math.PI; // 5.71°
    // average the side-wall triangles (exclude the ±90° caps)
    let sum = 0, n = 0;
    for (let i = 0; i < r.faceAngles.length; i++) {
      const a = r.faceAngles[i];
      if (Math.abs(Math.abs(a) - 90) > 5) { sum += a; n++; }
    }
    expect(n).toBeGreaterThan(0);
    expect(sum / n).toBeCloseTo(expDraft, 1);          // within ~0.1° of the slant draft
    expect(r.maxAngle).toBeCloseTo(90, 2);             // top cap
    expect(r.minAngle).toBeCloseTo(-90, 2);            // bottom cap
  });

  it('flips undercut ↔ positive when the pull direction reverses', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const up = analyzeDraft(box, { pullDirection: PULL_AXES['+y'], minDraftDeg: 3 });
    const dn = analyzeDraft(box, { pullDirection: PULL_AXES['-y'], minDraftDeg: 3 });
    // the faces that are undercuts pulling +Y are exactly the ejectable faces pulling −Y
    expect([...up.undercutFaces].sort()).toEqual([...dn.positiveFaces].sort());
    expect([...up.positiveFaces].sort()).toEqual([...dn.undercutFaces].sort());
  });

  it('moves side walls between vertical and positive as the min-draft threshold changes', () => {
    const g = new THREE.CylinderGeometry(8, 10, 20, 48); // ~5.71° side draft
    const strict = analyzeDraft(g, { pullDirection: PULL_AXES['+y'], minDraftDeg: 8 }); // 5.71 < 8 ⇒ vertical
    const lax = analyzeDraft(g, { pullDirection: PULL_AXES['+y'], minDraftDeg: 3 });    // 5.71 > 3 ⇒ positive
    expect(lax.counts.positive).toBeGreaterThan(strict.counts.positive);
    expect(strict.counts.vertical).toBeGreaterThan(lax.counts.vertical);
  });
});
