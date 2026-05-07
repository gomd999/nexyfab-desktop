/**
 * `three-bvh-csg` TimeLogger uses `window.performance`. Web Workers expose
 * `globalThis` / `self` but not `window`, which throws when CSG runs off-thread.
 * Import this module first in any worker that loads three-bvh-csg.
 */
const g = globalThis as unknown as Record<string, unknown>;
if (g.window === undefined) {
  g.window = globalThis;
}
