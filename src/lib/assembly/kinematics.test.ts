/**
 * kinematics — W5-F 2차 drive-layer tests.
 *
 * Every expectation is HAND-COMPUTED (no golden values pulled from the
 * implementation):
 *   - gear ratio 2, drive +90° → partner −45° (external mesh, opposite
 *     sense): witness x̂ → (cos45°, −sin45°, 0) = (√2/2, −√2/2, 0)
 *   - reverse (internal mesh) → partner +45°
 *   - train a→b (ratio 2) → b→c (ratio 3): +90° → −45° → +15°
 *   - rack: pinionRadius 10, drive 90° → rack slides r·θ = 10·π/2
 *     = 15.707963267948966 mm
 *   - hinge: absolute swing target measured via zeroAngleRef
 * Tolerance: 1e-9 unless noted (quaternion round-off is ~1e-15).
 */
import { describe, it, expect } from 'vitest';
import { applyDrives, KinematicsError, measureHingeSwingRad } from './kinematics';
import { iterativeSolve, type GeometryResolver, type ResolvedGeometry } from './iterativeSolver';
import { partInstance, IDENTITY_QUAT, type AssemblyState, type PartInstance } from './assemblyState';
import type { Mate, MateRef } from './mate';
import { rotateVec } from './mateSolver';
import { vec3, type Vec3 } from '@/lib/sketch/sketchPlane';

const SQ2 = Math.SQRT1_2; // √2/2

function part(id: string, pos: Vec3, fixed = false): PartInstance {
  return partInstance({
    id, name: id, partTemplateId: id,
    position: pos, orientation: IDENTITY_QUAT, fixed,
  });
}

/** Every part exposes 'spin' = +Z axis through its own origin (body frame). */
const spinResolver: GeometryResolver = (ref: MateRef, p): ResolvedGeometry | null => {
  if (ref.refId === 'spin') {
    return {
      kind: 'axis',
      world: { origin: p.position, direction: rotateVec(vec3(0, 0, 1), p.orientation) },
    };
  }
  if (ref.refId === 'rack_edge') {
    // rack edge: +X through world origin, rigid with the rack part.
    return {
      kind: 'axis',
      world: {
        origin: p.position,
        direction: rotateVec(vec3(1, 0, 0), p.orientation),
      },
    };
  }
  if (ref.refId === 'spin_y') {
    return {
      kind: 'axis',
      world: { origin: p.position, direction: rotateVec(vec3(0, 1, 0), p.orientation) },
    };
  }
  return null;
};

function gearMate(id: string, aPart: string, bPart: string, ratio: number, reverse?: boolean): Mate {
  return {
    id, kind: 'gear', ratio, ...(reverse !== undefined ? { reverse } : {}),
    a: { partId: aPart, refId: 'spin', refKind: 'axis' },
    b: { partId: bPart, refId: 'spin', refKind: 'axis' },
  };
}

function xWitness(p: PartInstance): Vec3 {
  return rotateVec(vec3(1, 0, 0), p.orientation);
}

describe('applyDrives — gear coupling (hand-computed)', () => {
  const baseState = (): AssemblyState => ({
    parts: [
      part('frame', vec3(0, 0, 0), true),
      part('gear_a', vec3(0, 0, 0)),
      part('gear_b', vec3(30, 0, 0)),
    ],
    mates: [gearMate('g', 'gear_a', 'gear_b', 2)],
  });

  it('ratio 2, drive side a by +90° → a spins +90°, b spins −45°', () => {
    const r = applyDrives(baseState(), spinResolver, [{ mateId: 'g', angleDeg: 90 }]);
    const a = r.state.parts.find((p) => p.id === 'gear_a')!;
    const b = r.state.parts.find((p) => p.id === 'gear_b')!;
    const wa = xWitness(a);
    const wb = xWitness(b);
    // a: x̂ → ŷ
    expect(Math.abs(wa.x - 0)).toBeLessThan(1e-9);
    expect(Math.abs(wa.y - 1)).toBeLessThan(1e-9);
    expect(Math.abs(wa.z)).toBeLessThan(1e-9);
    // b: x̂ → (cos(−45°), sin(−45°), 0) = (√2/2, −√2/2, 0)
    expect(Math.abs(wb.x - SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.y - -SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.z)).toBeLessThan(1e-9);
    // Positions on their own axes → unchanged.
    expect(b.position).toEqual({ x: 30, y: 0, z: 0 });
    // Effects report: +90 and −45 degrees.
    expect(r.effects).toHaveLength(2);
    expect(r.effects[0]).toMatchObject({ partId: 'gear_a', kind: 'rotation' });
    expect(Math.abs(r.effects[0]!.amount - 90)).toBeLessThan(1e-9);
    expect(r.effects[1]).toMatchObject({ partId: 'gear_b', kind: 'rotation', viaMateId: 'g' });
    expect(Math.abs(r.effects[1]!.amount - -45)).toBeLessThan(1e-9);
  });

  it('reverse (internal mesh): drive +90° → b spins +45°', () => {
    const st = baseState();
    const r = applyDrives(
      { ...st, mates: [gearMate('g', 'gear_a', 'gear_b', 2, true)] },
      spinResolver,
      [{ mateId: 'g', angleDeg: 90 }],
    );
    const wb = xWitness(r.state.parts.find((p) => p.id === 'gear_b')!);
    expect(Math.abs(wb.x - SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.y - SQ2)).toBeLessThan(1e-9);
  });

  it('ratio 5: drive +90° → b spins −18°', () => {
    const st = baseState();
    const r = applyDrives(
      { ...st, mates: [gearMate('g', 'gear_a', 'gear_b', 5)] },
      spinResolver,
      [{ mateId: 'g', angleDeg: 90 }],
    );
    const wb = xWitness(r.state.parts.find((p) => p.id === 'gear_b')!);
    const deg = (Math.atan2(wb.y, wb.x) * 180) / Math.PI;
    expect(Math.abs(deg - -18)).toBeLessThan(1e-9);
  });

  it("drive side b by +90° → a spins −180° (rot_a = s·ratio·rot_b)", () => {
    const r = applyDrives(baseState(), spinResolver, [{ mateId: 'g', angleDeg: 90, side: 'b' }]);
    const wa = xWitness(r.state.parts.find((p) => p.id === 'gear_a')!);
    // −180°: x̂ → −x̂
    expect(Math.abs(wa.x - -1)).toBeLessThan(1e-9);
    expect(Math.abs(wa.y)).toBeLessThan(1e-9);
  });

  it('gear train a→b (ratio 2) →c (ratio 3): +90° → −45° → +15°', () => {
    const st: AssemblyState = {
      parts: [
        part('frame', vec3(0, 0, 0), true),
        part('gear_a', vec3(0, 0, 0)),
        part('gear_b', vec3(30, 0, 0)),
        part('gear_c', vec3(60, 0, 0)),
      ],
      mates: [
        gearMate('g1', 'gear_a', 'gear_b', 2),
        gearMate('g2', 'gear_b', 'gear_c', 3),
      ],
    };
    const r = applyDrives(st, spinResolver, [{ mateId: 'g1', angleDeg: 90 }]);
    const wc = xWitness(r.state.parts.find((p) => p.id === 'gear_c')!);
    // +15°: (cos15°, sin15°, 0) = (0.96592582628…, 0.25881904510…, 0)
    expect(Math.abs(wc.x - Math.cos((15 * Math.PI) / 180))).toBeLessThan(1e-9);
    expect(Math.abs(wc.y - Math.sin((15 * Math.PI) / 180))).toBeLessThan(1e-9);
  });
});

describe('applyDrives — rack & pinion coupling (hand-computed)', () => {
  // Pinion axis +Y through (0, 0, 10); rack edge +X through rack origin.
  // perpDist(pinion axis, rack edge) = 10 = pinionRadius → mount is exact.
  const rpState = (): AssemblyState => ({
    parts: [
      part('bed', vec3(0, 0, 0), true),
      part('pinion', vec3(0, 0, 10)),
      part('rack', vec3(0, 0, 0)),
    ],
    mates: [
      {
        id: 'rp', kind: 'rack_pinion', pinionRadius: 10,
        a: { partId: 'pinion', refId: 'spin_y', refKind: 'axis' },
        b: { partId: 'rack', refId: 'rack_edge', refKind: 'edge' },
      } as Mate,
    ],
  });

  it('drive pinion +90° → rack slides 10·π/2 = 15.707963267948966 mm along +X', () => {
    const r = applyDrives(rpState(), spinResolver, [{ mateId: 'rp', angleDeg: 90 }]);
    const rack = r.state.parts.find((p) => p.id === 'rack')!;
    expect(Math.abs(rack.position.x - (10 * Math.PI) / 2)).toBeLessThan(1e-9);
    expect(Math.abs(rack.position.y)).toBeLessThan(1e-9);
    expect(Math.abs(rack.position.z)).toBeLessThan(1e-9);
    const eff = r.effects.find((e) => e.partId === 'rack')!;
    expect(eff.kind).toBe('translation');
    expect(Math.abs(eff.amount - 15.707963267948966)).toBeLessThan(1e-9);
  });

  it('drive pinion −180° → rack slides −10π = −31.41592653589793 mm', () => {
    const r = applyDrives(rpState(), spinResolver, [{ mateId: 'rp', angleDeg: -180 }]);
    const rack = r.state.parts.find((p) => p.id === 'rack')!;
    expect(Math.abs(rack.position.x - -10 * Math.PI)).toBeLessThan(1e-9);
  });

  it('driving the rack side by ANGLE is refused with the reason', () => {
    expect(() =>
      applyDrives(rpState(), spinResolver, [{ mateId: 'rp', angleDeg: 90, side: 'b' }]),
    ).toThrow(/only the pinion \(side 'a'\)/);
  });
});

describe('applyDrives — hinge absolute angle (hand-computed)', () => {
  const hingeState = (opts: { limit?: { minAngleDeg: number; maxAngleDeg: number }; noRef?: boolean } = {}): AssemblyState => ({
    parts: [part('frame', vec3(0, 0, 0), true), part('door', vec3(0, 0, 0))],
    mates: [
      {
        id: 'h', kind: 'hinge',
        a: { partId: 'door', refId: 'spin', refKind: 'axis' },
        b: { partId: 'frame', refId: 'spin', refKind: 'axis' },
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.noRef
          ? {}
          : {
              zeroAngleRef: {
                a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 },
                axisA: { x: 0, y: 0, z: 1 }, axisB: { x: 0, y: 0, z: 1 },
              },
            }),
      } as Mate,
    ],
  });

  it('drive to swing 30° → measured swing = 30° (1e-9), door x̂ at −30°', () => {
    const st = hingeState();
    const r = applyDrives(st, spinResolver, [{ mateId: 'h', angleDeg: 30 }]);
    const door = r.state.parts.find((p) => p.id === 'door')!;
    const frame = r.state.parts.find((p) => p.id === 'frame')!;
    const mate = st.mates[0] as Extract<Mate, { kind: 'hinge' }>;
    const swing = measureHingeSwingRad(mate, door, frame, vec3(0, 0, 1));
    expect(Math.abs(swing - (30 * Math.PI) / 180)).toBeLessThan(1e-9);
    // swing = angle A→B; rotating the door (side a) by −30° gives swing +30°.
    const w = xWitness(door);
    expect(Math.abs(w.x - Math.cos((-30 * Math.PI) / 180))).toBeLessThan(1e-9);
    expect(Math.abs(w.y - Math.sin((-30 * Math.PI) / 180))).toBeLessThan(1e-9);
  });

  it('drive is ABSOLUTE: driving 30° twice lands at 30°, not 60°', () => {
    const st = hingeState();
    const r1 = applyDrives(st, spinResolver, [{ mateId: 'h', angleDeg: 30 }]);
    const r2 = applyDrives(r1.state, spinResolver, [{ mateId: 'h', angleDeg: 30 }]);
    const door = r2.state.parts.find((p) => p.id === 'door')!;
    const frame = r2.state.parts.find((p) => p.id === 'frame')!;
    const swing = measureHingeSwingRad(
      st.mates[0] as Extract<Mate, { kind: 'hinge' }>, door, frame, vec3(0, 0, 1),
    );
    expect(Math.abs(swing - (30 * Math.PI) / 180)).toBeLessThan(1e-9);
    // Second drive is a no-op rotation.
    expect(Math.abs(r2.effects[0]!.amount)).toBeLessThan(1e-9);
  });

  it('target outside limit is refused with the numbers', () => {
    expect(() =>
      applyDrives(hingeState({ limit: { minAngleDeg: 0, maxAngleDeg: 90 } }), spinResolver, [
        { mateId: 'h', angleDeg: 120 },
      ]),
    ).toThrow(/120.*outside the hinge limit.*\[0°, 90°\]/);
  });

  it('hinge without zeroAngleRef is refused', () => {
    expect(() =>
      applyDrives(hingeState({ noRef: true }), spinResolver, [{ mateId: 'h', angleDeg: 10 }]),
    ).toThrow(/requires zeroAngleRef/);
  });
});

describe('applyDrives — refusals carry reasons', () => {
  it('unknown mateId', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(0, 0, 0))],
      mates: [gearMate('g', 'g1', 'frame', 2)],
    };
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'nope', angleDeg: 10 }]))
      .toThrow(/mate 'nope' not found/);
  });

  it('non-drivable mate kind', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(5, 0, 0))],
      mates: [
        {
          id: 'c', kind: 'concentric',
          a: { partId: 'g1', refId: 'spin', refKind: 'axis' },
          b: { partId: 'frame', refId: 'spin', refKind: 'axis' },
        } as Mate,
      ],
    };
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'c', angleDeg: 10 }]))
      .toThrow(/kind 'concentric'.*drivable kinds/);
  });

  it('driven part fixed → refused', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(0, 0, 0), true), part('g2', vec3(30, 0, 0))],
      mates: [gearMate('g', 'g1', 'g2', 2)],
    };
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'g', angleDeg: 10 }]))
      .toThrow(/driven part 'g1' is fixed/);
  });

  it('propagation into a fixed partner → refused', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(0, 0, 0)), part('g2', vec3(30, 0, 0), true)],
      mates: [gearMate('g', 'g1', 'g2', 2)],
    };
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'g', angleDeg: 10 }]))
      .toThrow(/would move FIXED part 'g2'/);
  });

  it('inconsistent loop (two gear mates, ratio 2 vs 3, same pair) → refused', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(0, 0, 0)), part('g2', vec3(30, 0, 0))],
      mates: [gearMate('gA', 'g1', 'g2', 2), gearMate('gB', 'g1', 'g2', 3)],
    };
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'gA', angleDeg: 90 }]))
      .toThrow(/inconsistent loop/);
    expect(() => applyDrives(st, spinResolver, [{ mateId: 'gA', angleDeg: 90 }]))
      .toThrow(KinematicsError);
  });

  it('consistent loop (both mates ratio 2) → allowed, single application', () => {
    const st: AssemblyState = {
      parts: [part('frame', vec3(0, 0, 0), true), part('g1', vec3(0, 0, 0)), part('g2', vec3(30, 0, 0))],
      mates: [gearMate('gA', 'g1', 'g2', 2), gearMate('gB', 'g1', 'g2', 2)],
    };
    const r = applyDrives(st, spinResolver, [{ mateId: 'gA', angleDeg: 90 }]);
    const wb = xWitness(r.state.parts.find((p) => p.id === 'g2')!);
    expect(Math.abs(wb.x - SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.y - -SQ2)).toBeLessThan(1e-9);
  });
});

describe('drive + statics interplay', () => {
  it('driven gear pair still satisfies statics (iterativeSolve residual 0 after drive)', () => {
    const st: AssemblyState = {
      parts: [
        part('frame', vec3(0, 0, 0), true),
        part('gear_a', vec3(0, 0, 0)),
        part('gear_b', vec3(30, 0, 0)),
      ],
      mates: [gearMate('g', 'gear_a', 'gear_b', 2)],
    };
    const driven = applyDrives(st, spinResolver, [{ mateId: 'g', angleDeg: 37 }]);
    const solved = iterativeSolve(driven.state, spinResolver, { tolerance: 1e-9 });
    expect(solved.success).toBe(true);
    // The re-solve must NOT undo the spin.
    const wa = xWitness(solved.state.parts.find((p) => p.id === 'gear_a')!);
    const deg = (Math.atan2(wa.y, wa.x) * 180) / Math.PI;
    expect(Math.abs(deg - 37)).toBeLessThan(1e-9);
  });
});
