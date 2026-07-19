/**
 * occtEngineSelection.probe — the WASM-init + perf-guard end-to-end probe (F1).
 *
 * The F1 ADR (016) says a default-ON flip is gated on TWO things being proven:
 *   1. the in-process replicad kernel actually initialises (ensureOcctReady), and
 *   2. the engineSelection perf guard actually keeps a slider DRAG on the fast
 *      mesh path while routing a COMMIT to the exact kernel.
 *
 * Both are asserted here against the REAL kernel (not a mock): with OCCT loaded
 * and global mode on, a boolean at commit phase carries an `occtHandle` (it ran
 * the B-rep path), and the SAME boolean during a drag does NOT (the guard kept it
 * on mesh). That is the safety property a default-ON depends on — a drag can
 * never trigger the slow kernel.
 *
 * Gated by RUN_OCCT_FEASIBILITY=1 (10 MB WASM + multi-second init), same as the
 * other OCCT feasibility suites; runs in the occt-burnin CI job.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { booleanFeature } from '../features/boolean';
import { ensureOcctReady, isOcctReady, setOcctGlobalMode } from '../features/occtEngine';
import { setInteractionPhase } from '../features/engineSelection';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

function subtractParams(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of booleanFeature.params) p[sp.key] = sp.default;
  p.operation = 1; // subtract
  p.toolShape = 1; // cylinder
  p.toolWidth = 20;
  p.toolHeight = 80;
  p.engine = 1; // explicit OCCT intent
  return p;
}

function box(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(60, 40, 30);
  g.computeVertexNormals();
  return g;
}

const hasHandle = (g: THREE.BufferGeometry) =>
  typeof g.userData?.occtHandle === 'string' && g.userData.occtHandle.length > 0;

describeMaybe('OCCT engine-selection probe (F1 WASM init + perf guard)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
    setInteractionPhase('commit');
  }, 60_000);

  afterAll(() => {
    setOcctGlobalMode(false);
    setInteractionPhase('commit');
  });

  it('the in-process replicad kernel initialises', () => {
    expect(isOcctReady()).toBe(true);
  });

  it('COMMIT phase routes the boolean through the real B-rep kernel (occtHandle present)', () => {
    setInteractionPhase('commit');
    const out = booleanFeature.apply(box(), subtractParams());
    expect(out.attributes.position.count).toBeGreaterThan(0);
    expect(hasHandle(out)).toBe(true);
  });

  it('DRAG phase keeps the SAME boolean on the fast mesh path (no occtHandle)', () => {
    setInteractionPhase('drag');
    const out = booleanFeature.apply(box(), subtractParams());
    // Still a valid solid — just produced by the mesh approximator, not the kernel.
    expect(out.attributes.position.count).toBeGreaterThan(0);
    expect(hasHandle(out)).toBe(false);
  });

  it('returning to COMMIT re-engages the kernel (guard is not sticky)', () => {
    setInteractionPhase('drag');
    booleanFeature.apply(box(), subtractParams());
    setInteractionPhase('commit');
    const out = booleanFeature.apply(box(), subtractParams());
    expect(hasHandle(out)).toBe(true);
  });
});
