/**
 * meshFallbackHandleHygiene — every OCCT-capable feature whose mesh fallback
 * CLONES the input must (a) drop the now-stale `userData.occtHandle` from its
 * output (THREE clones share userData by reference, so the handle of the
 * PRE-op solid used to ride along and silently diverge from the mesh) and
 * (b) leave the upstream geometry's own userData untouched.
 *
 * Kernel-free: OCCT is never ready in this suite, so applyAsync always takes
 * the mesh-fallback branch — exactly the path under test. The notice side
 * (downgrade banner) is asserted with the global B-rep intent toggled on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { setOcctGlobalMode } from './occtEngine';
import { collectDowngrades } from './downgradeNotice';
import { draftFeature } from './draft';
import { scaleFeature } from './scale';
import { moveCopyFeature } from './moveCopy';
import { mirrorFeature } from './mirror';
import { linearPatternFeature } from './linearPattern';
import { circularPatternFeature } from './circularPattern';

function boxWithStaleHandle(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(20, 20, 20);
  g.computeVertexNormals();
  g.userData.occtHandle = 'occt:stale-99'; // pretend an upstream B-rep solid
  return g;
}

const CASES: Array<{
  name: string;
  feature: { applyAsync?: (g: THREE.BufferGeometry, p: Record<string, number>) => Promise<THREE.BufferGeometry> };
  params: Record<string, number>;
}> = [
  { name: 'draft', feature: draftFeature, params: { angle: 5, direction: 0 } },
  { name: 'scale', feature: scaleFeature, params: { scaleX: 2, scaleY: 1, scaleZ: 1 } },
  { name: 'moveCopy (move)', feature: moveCopyFeature, params: { offsetX: 10, offsetY: 0, offsetZ: 0, operation: 0 } },
  { name: 'moveCopy (copy)', feature: moveCopyFeature, params: { offsetX: 50, offsetY: 0, offsetZ: 0, operation: 1 } },
  { name: 'mirror', feature: mirrorFeature, params: { plane: 0 } },
  { name: 'linearPattern', feature: linearPatternFeature, params: { axis: 0, count: 2, spacing: 40 } },
  { name: 'circularPattern', feature: circularPatternFeature, params: { axis: 1, count: 2, totalAngle: 180 } },
];

afterEach(() => {
  setOcctGlobalMode(false);
});

describe('mesh fallback drops the stale B-rep handle (B-rep intent ON)', () => {
  for (const c of CASES) {
    it(`${c.name}: output has no occtHandle; upstream keeps its own`, async () => {
      setOcctGlobalMode(true); // wants B-rep, but the kernel is not ready → mesh fallback
      const input = boxWithStaleHandle();
      const out = await c.feature.applyAsync!(input, c.params);
      expect(out.attributes.position.count).toBeGreaterThan(0);
      expect(out.userData?.occtHandle).toBeUndefined();
      // The upstream geometry (pipeline cache) must not have been mutated
      // through THREE's shared-userData clone aliasing.
      expect(input.userData.occtHandle).toBe('occt:stale-99');
    });

    it(`${c.name}: stamps an 'approximated' downgrade notice (never silent)`, async () => {
      setOcctGlobalMode(true);
      const input = boxWithStaleHandle();
      const out = await c.feature.applyAsync!(input, c.params);
      const notices = collectDowngrades(out);
      expect(notices.some(n => n.severity === 'approximated')).toBe(true);
      // ...and the notice never leaks back into the upstream geometry.
      expect(collectDowngrades(input)).toHaveLength(0);
    });
  }

  it('draft (mesh intent, global OFF): handle still cleared, but NO notice', async () => {
    const input = boxWithStaleHandle();
    const out = await draftFeature.applyAsync!(input, { angle: 5, direction: 0 });
    expect(out.userData?.occtHandle).toBeUndefined();
    expect(collectDowngrades(out)).toHaveLength(0);
    expect(input.userData.occtHandle).toBe('occt:stale-99');
  });
});
