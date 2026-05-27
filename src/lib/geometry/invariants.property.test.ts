/**
 * Property-based PoC — random box dimensions must always produce a valid
 * solid. The real value of this pattern is in Wave 2 (B-rep Phase 3): a
 * fuzz over feature param ranges catches the kind of edge case a single
 * fixture never sees. This PoC proves the harness wiring works.
 *
 * Pattern to reuse for real features:
 *   it('feature.X preserves invariants under random params', () => {
 *     fc.assert(
 *       fc.property(<param generators>, (params) => {
 *         const out = applyFeature(...);
 *         assertValidSolid(out, { op: 'feature.X' });
 *       }),
 *       { numRuns: 200 }
 *     );
 *   });
 *
 * Note: we instantiate THREE.BoxGeometry directly here (not via the shape
 * registry) — importing `shapes/index.ts` pulls in STANDARD_PARTS, which
 * has a circular-import edge case under vitest. Feature-level tests
 * (Wave 2+) should hit the real registry once that's untangled.
 */

import { describe, it } from 'vitest';
import * as THREE from 'three';
import fc from 'fast-check';
import { assertValidSolid } from './invariants';

describe('box geometry (property)', () => {
  it('any dimension in [1, 500] mm produces a valid manifold solid', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        (width, height, depth) => {
          const geo = new THREE.BoxGeometry(width, height, depth);
          geo.computeVertexNormals();
          assertValidSolid(geo, { op: 'shape.box', width, height, depth });
        },
      ),
      { numRuns: 200, verbose: false },
    );
  });
});
