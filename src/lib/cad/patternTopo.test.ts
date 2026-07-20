/**
 * patternTopo — instance naming for linear/circular patterns (ADR-017 S5:
 * pattern coverage was 0%). TS anchor level ONLY — the OCCT plan layer reports
 * patterns unsupported and is deliberately untouched (see patternTopo.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  buildLinearPatternTopo, buildCircularPatternTopo,
  patternInstanceName, linearInstanceTransforms, circularInstanceTransforms,
} from './patternTopo';
import { buildLinearPattern, buildCircularPattern } from './pattern';
import { buildExtrudeTopo, edgeMidpoint, namesOf } from './topoNaming';
import { fromAnchors, type EdgeAnchorSource } from './composedTopo';
import type { ExtrudeFeature } from './extrudeProfile';
import type { Vec3 } from '@/lib/sketch/sketchPlane';

// ─── fixtures ───────────────────────────────────────────────────────────────

/** 10×10×5 box extrude → its real stable-name anchors (the pattern child). */
function boxAnchors(): EdgeAnchorSource {
  const feat: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5, direction: 'one_sided', mode: 'add',
  };
  const topo = buildExtrudeTopo(feat);
  const m = new Map<string, Vec3>();
  for (const n of namesOf(topo, 'edge')) {
    const mid = edgeMidpoint(topo, n);
    if (mid) m.set(n, mid);
  }
  return fromAnchors(m);
}

const linear = (count: number, spacing: number, direction = { x: 1, y: 0, z: 0 }) =>
  buildLinearPattern({ childScad: 'cube();', count, direction, spacing });

const circular = (count: number, totalAngleDegrees?: number) =>
  buildCircularPattern({
    childScad: 'cube();', count,
    axisOrigin: { x: 0, y: 0, z: 0 }, axisDirection: { x: 0, y: 0, z: 1 },
    totalAngleDegrees,
  });

const close = (a: Vec3 | null, b: Vec3, eps = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.hypot(a!.x - b.x, a!.y - b.y, a!.z - b.z)).toBeLessThan(eps);
};

// ─── linear ────────────────────────────────────────────────────────────────

describe('buildLinearPatternTopo', () => {
  it('names every child edge once per instance: {childName}@{k}', () => {
    const child = boxAnchors();
    const t = buildLinearPatternTopo(child, linear(3, 20));
    expect(t.names()).toHaveLength(child.names().length * 3);
    expect(t.names()).toContain('e.vert.0@0');
    expect(t.names()).toContain('e.vert.0@2');
    expect(patternInstanceName('e.vert.0', 2)).toBe('e.vert.0@2');
  });

  it('instance anchors are the child anchor pushed through k·spacing·direction', () => {
    const child = boxAnchors();
    const t = buildLinearPatternTopo(child, linear(3, 20));
    const base = child.anchor('e.vert.0')!;
    close(t.anchor('e.vert.0@0'), base);
    close(t.anchor('e.vert.0@2'), { x: base.x + 40, y: base.y, z: base.z });
  });

  it('W1-B insertion invariant: the bare child name stays an alias of @0', () => {
    const child = boxAnchors();
    const t = buildLinearPatternTopo(child, linear(4, 15));
    // A reference authored BEFORE the pattern insert resolves to the same edge.
    close(t.anchor('e.vert.3'), child.anchor('e.vert.3')!);
  });

  it('raising the count adds instances without MOVING existing ones', () => {
    const child = boxAnchors();
    const t3 = buildLinearPatternTopo(child, linear(3, 20));
    const t5 = buildLinearPatternTopo(child, linear(5, 20));
    for (const n of t3.names()) close(t5.anchor(n), t3.anchor(n)!);
  });

  it('spacing edits move an instance anchor by the generative rule, keeping the name', () => {
    const child = boxAnchors();
    const a20 = buildLinearPatternTopo(child, linear(3, 20)).anchor('e.top.0-1@2')!;
    const a35 = buildLinearPatternTopo(child, linear(3, 35)).anchor('e.top.0-1@2')!;
    expect(a35.x - a20.x).toBeCloseTo(2 * (35 - 20), 9);
  });

  it('out-of-range instance / unknown child name → explicit null, with lossReason', () => {
    const child = boxAnchors();
    const t = buildLinearPatternTopo(child, linear(3, 20));
    expect(t.anchor('e.vert.0@3')).toBeNull();  // k ≥ count
    expect(t.anchor('e.vert.0@-1')).toBeNull();
    expect(t.anchor('nope@1')).toBeNull();
    expect(t.lossReason?.('nope@1')).toBe('unknown');
  });
});

// ─── circular ──────────────────────────────────────────────────────────────

describe('buildCircularPatternTopo', () => {
  it('full 360°: step = 360/count — the EXACT circularPatternToScad rule', () => {
    const child = boxAnchors();
    const t = buildCircularPatternTopo(child, circular(4)); // 90° steps about +Z
    const base = child.anchor('e.vert.0')!; // (0,0,2.5)
    close(t.anchor('e.vert.0@0'), base);
    // vertex edge at (10,0,2.5) rotated +90° about Z → (0,10,2.5)
    const b = child.anchor('e.vert.1')!;
    close(t.anchor('e.vert.1@1'), { x: -b.y, y: b.x, z: b.z });
    // k=2 → 180°
    close(t.anchor('e.vert.1@2'), { x: -b.x, y: -b.y, z: b.z });
  });

  it('partial sweep: endpoint-inclusive step = total/(count−1)', () => {
    const child = boxAnchors();
    const t = buildCircularPatternTopo(child, circular(3, 180)); // steps 0°, 90°, 180°
    const b = child.anchor('e.vert.1')!;
    close(t.anchor('e.vert.1@2'), { x: -b.x, y: -b.y, z: b.z }); // 180°
  });

  it('rotation is about the axis LINE (origin offset honoured)', () => {
    const f = buildCircularPattern({
      childScad: 'cube();', count: 2,
      axisOrigin: { x: 5, y: 5, z: 0 }, axisDirection: { x: 0, y: 0, z: 1 },
      totalAngleDegrees: 180,
    });
    const tf = circularInstanceTransforms(f)[1]; // 180° about (5,5)
    const p = tf({ x: 10, y: 5, z: 3 });
    close(p, { x: 0, y: 5, z: 3 });
  });

  it('bare name aliases @0; unknown instances refuse', () => {
    const child = boxAnchors();
    const t = buildCircularPatternTopo(child, circular(4));
    close(t.anchor('e.bottom.0-1'), child.anchor('e.bottom.0-1')!);
    expect(t.anchor('e.bottom.0-1@4')).toBeNull();
  });

  it('nested patterns compose: name@j@k', () => {
    const child = boxAnchors();
    const inner = buildLinearPatternTopo(child, linear(2, 20));
    const outer = buildLinearPatternTopo(inner, buildLinearPattern({
      childScad: 'cube();', count: 2, direction: { x: 0, y: 1, z: 0 }, spacing: 50,
    }));
    const base = child.anchor('e.vert.0')!;
    close(outer.anchor('e.vert.0@1@1'), { x: base.x + 20, y: base.y + 50, z: base.z });
    expect(outer.names()).toContain('e.vert.0@1@1');
  });

  it('transform counts match the feature count', () => {
    expect(linearInstanceTransforms(linear(5, 10))).toHaveLength(5);
    expect(circularInstanceTransforms(circular(6))).toHaveLength(6);
  });
});
