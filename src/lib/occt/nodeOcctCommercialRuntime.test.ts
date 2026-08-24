// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { loadNodeOcctCommercialRuntime, type NodeOcctCommercialRuntimeResult } from './nodeOcctCommercialRuntime';

let runtime: NodeOcctCommercialRuntimeResult;

beforeAll(async () => {
  runtime = await loadNodeOcctCommercialRuntime();
}, 60_000);

describe('trusted node OCCT commercial runtime', () => {
  it('derives identity and capabilities from the loaded real bridge', () => {
    expect(runtime.ok, runtime.ok ? undefined : runtime.reason).toBe(true);
    if (!runtime.ok) return;
    expect(runtime.identity.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.capabilities).toMatchObject({
      executor: 'REAL_OCCT',
      identitySha256: runtime.identity.runtimeIdentitySha256,
      stubFallback: false,
      verifierIds: ['part-exact-brep', 'part-step-roundtrip'],
    });
    expect(runtime.capabilities.handlerIds).toEqual(expect.arrayContaining([
      'occt.sketch.convex-line-loop-planar-face',
      'occt.sketchExtrude',
      'occt.revolve',
      'occt.hole',
      'occt.fillet',
      'occt.chamfer',
      'occt.variableFillet',
      'occt.draft',
      'occt.scale.uniform',
      'occt.move-copy.translation',
      'occt.mirror.plane',
      'occt.rib.single',
      'occt.offset-face.top',
      'occt.cut.through-rect',
      'occt.linear-pattern.connected-fused',
      'occt.circular-pattern.connected-fused',
      'occt.loft.ruled-convex',
      'occt.sweep.orthogonal-polyline-rect',
      'occt.sweep-path.orthogonal-polyline-rect.v1',
      'occt.split-body.keep-side-axis-plane',
      'occt.delete-face.blind-hole-cap',
      'occt.bend.single-rectangular-sheet',
      'occt.flange.single-positive-end',
      'occt.flat-pattern.single-bend-step-dxf',
      'occt.weldment.two-member-corner-cut-list',
      'occt.thread.cylindrical',
      'occt.shell.open',
      'occt.boolean.union',
      'occt.boolean.subtract',
      'occt.boolean.intersect',
    ]));
    expect(Object.isFrozen(runtime.capabilities.handlerIds)).toBe(true);
  });
});
