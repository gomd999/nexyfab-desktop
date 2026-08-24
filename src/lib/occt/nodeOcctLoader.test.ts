// @vitest-environment node
/**
 * nodeOcctLoader — K1b-real gate: the REAL opencascade.js runs headless in Node
 * and builds real B-rep. If the package/wasm isn't available the suite skips
 * (so CI without the 65 MB asset stays green) rather than failing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { __resetOcctNodeCache, loadOcctNode, type OcctModule } from './nodeOcctLoader';

let load: Awaited<ReturnType<typeof loadOcctNode>>;
let oc: OcctModule;

beforeAll(async () => {
  load = await loadOcctNode();
  if (load.ok && load.oc) oc = load.oc;
}, 60_000);

describe('loadOcctNode (real OCCT headless)', () => {
  it('loads the real module in Node', () => {
    if (!load.ok) {
      // Asset/package unavailable in this environment — document + skip.
      console.warn(`[occt] skipped — real module not loaded: ${load.reason}`);
      return;
    }
    expect(load.oc).toBeDefined();
    expect(typeof (oc as Record<string, unknown>).BRepPrimAPI_MakeBox_3).toBe('function');
    expect(load.identity).toMatchObject({ packageName: 'opencascade.js', packageVersion: '1.1.1' });
    expect(load.identity?.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds a 10×20×30 box and measures its volume = 6000 mm³', () => {
    if (!load.ok) return; // skipped per above
    const m = oc as Record<string, new (...a: unknown[]) => unknown> & Record<string, unknown>;
    const Pnt = m.gp_Pnt_3 as new (x: number, y: number, z: number) => unknown;
    const box = new (m.BRepPrimAPI_MakeBox_3 as new (a: unknown, b: unknown) => { Shape(): unknown })(
      new Pnt(0, 0, 0),
      new Pnt(10, 20, 30),
    );
    const shape = box.Shape();
    const props = new (m.GProp_GProps_1 as new () => { Mass(): number })();
    // VolumeProperties_1(shape, props, onlyClosed, skipShared, useTriangulation)
    const brepGProp = m.BRepGProp as unknown as { VolumeProperties_1(...a: unknown[]): void };
    brepGProp.VolumeProperties_1(shape, props, false, false, false);
    expect(props.Mass()).toBeCloseTo(6000, 1);
  });

  it('caches the module (second load is instant)', async () => {
    if (!load.ok) return;
    const again = await loadOcctNode();
    expect(again.ok).toBe(true);
    expect(again.loadMs).toBe(0);
    expect(again.identity).toEqual(load.identity);
  });

  it('coalesces concurrent first loads into one Emscripten runtime', async () => {
    if (!load.ok) return;
    const beforeUncaught = process.listenerCount('uncaughtException');
    const beforeRejection = process.listenerCount('unhandledRejection');
    __resetOcctNodeCache();
    const results = await Promise.all(Array.from({ length: 8 }, () => loadOcctNode()));
    expect(results.every(result => result.ok && result.oc)).toBe(true);
    expect(new Set(results.map(result => result.oc)).size).toBe(1);
    expect(process.listenerCount('uncaughtException') - beforeUncaught).toBeLessThanOrEqual(1);
    expect(process.listenerCount('unhandledRejection') - beforeRejection).toBeLessThanOrEqual(1);
  }, 60_000);
});
