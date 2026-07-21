/**
 * DOGFOOD 07 — mate 실구현 심화 (W5-F 2차): the transmission mates DO
 * something now, reproduced through the public `solveMates` facade.
 *
 * Pre-fix reality (measured in this session, gauss/newton engines):
 *   - gear: ratio 2 vs 5 vs reverse → byte-identical placements
 *     (a=(0,0,3), b=(30,0,-2), identity quats) — ratio consumed NOWHERE.
 *   - rack_pinion: no θ↔rθ coupling; travel proxy penalized rotations
 *     about UNRELATED axes (60° tilt ⊥ pinion axis → +5.47 spurious).
 *   - newton + coincident(plane): FALSE convergence at x≈15.914 (expected
 *     20) — residual measured only the gap, not normal alignment.
 *   - newton slot: slotLength limit absent from its residual (gauss said
 *     10, newton said 0 for the same out-of-range pin).
 *
 * Post-fix, all of the above is exercised here with hand-computed values.
 */
import { describe, it, expect } from 'vitest';
import {
  solveMates,
  rotateVec,
  KinematicsError,
  measureHingeSwingRad,
} from '@/lib/assembly/mateSolver';
import type { SolveMateSpec, SolvePartSpec } from '@/lib/assembly/mateSolver';
import { runMotionSweep } from '@/lib/assembly/motionStudy';
import { partInstance, IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { Mate } from '@/lib/assembly/mate';
import type { GeometryResolver, ResolvedGeometry } from '@/lib/assembly/iterativeSolver';
import type { Quat } from '@/lib/assembly/assemblyState';

const SQ2 = Math.SQRT1_2;

function xWitness(q: Quat) {
  return rotateVec({ x: 1, y: 0, z: 0 }, q);
}

// ── shared gear-pair fixture (hinged onto a fixed frame) ─────────────────

const gearPairParts = (): SolvePartSpec[] => [
  {
    partId: 'frame',
    fixed: true,
    refs: {
      shaft_a: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
      shaft_b: { kind: 'axis', origin: { x: 30, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
    },
  },
  { partId: 'gear_a', position: { x: 1, y: 2, z: 3 } },
  { partId: 'gear_b', position: { x: 28, y: 1, z: -2 } },
];

const gearPairMates = (ratio: number, reverse?: boolean): SolveMateSpec[] => [
  { id: 'h_a', kind: 'hinge', a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_a' } },
  { id: 'h_b', kind: 'hinge', a: { partId: 'gear_b', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_b' } },
  {
    id: 'g', kind: 'gear', ratio, ...(reverse !== undefined ? { reverse } : {}),
    a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'gear_b', refId: 'z_axis' },
  },
];

describe('DOGFOOD 07 — gear drive through solveMates (ratio finally consumed)', () => {
  it('A: ratio 2, drive gear mate +90° → gear_a +90°, gear_b −45° (hand-computed)', () => {
    const r = solveMates(gearPairParts(), gearPairMates(2), {
      tolerance: 1e-9,
      drives: [{ mateId: 'g', angleDeg: 90 }],
    });
    expect(r.converged).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-9);
    const a = r.part('gear_a');
    const b = r.part('gear_b');
    // Statics placed the gears on their shafts (unchanged from 1차):
    expect(Math.abs(a.position.x)).toBeLessThan(1e-6);
    expect(Math.abs(a.position.y)).toBeLessThan(1e-6);
    expect(Math.abs(b.position.x - 30)).toBeLessThan(1e-6);
    // Drive: gear_a x̂ → ŷ (+90° about +Z).
    const wa = xWitness(a.orientation);
    expect(Math.abs(wa.x)).toBeLessThan(1e-9);
    expect(Math.abs(wa.y - 1)).toBeLessThan(1e-9);
    // Coupling: gear_b x̂ → (√2/2, −√2/2, 0) (−45°, external mesh).
    const wb = xWitness(b.orientation);
    expect(Math.abs(wb.x - SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.y - -SQ2)).toBeLessThan(1e-9);
    // Effects ledger: +90 on gear_a, −45 on gear_b via mate 'g'.
    expect(r.driveEffects).toHaveLength(2);
    expect(Math.abs(r.driveEffects[0]!.amount - 90)).toBeLessThan(1e-9);
    expect(Math.abs(r.driveEffects[1]!.amount - -45)).toBeLessThan(1e-9);
    expect(r.driveEffects[1]!.viaMateId).toBe('g');
  });

  it('B: ratio ACTUALLY matters now — ratio 5 → −18°, reverse → +45°', () => {
    const r5 = solveMates(gearPairParts(), gearPairMates(5), {
      tolerance: 1e-9, drives: [{ mateId: 'g', angleDeg: 90 }],
    });
    const w5 = xWitness(r5.part('gear_b').orientation);
    const deg5 = (Math.atan2(w5.y, w5.x) * 180) / Math.PI;
    expect(Math.abs(deg5 - -18)).toBeLessThan(1e-9);

    const rRev = solveMates(gearPairParts(), gearPairMates(2, true), {
      tolerance: 1e-9, drives: [{ mateId: 'g', angleDeg: 90 }],
    });
    const wRev = xWitness(rRev.part('gear_b').orientation);
    const degRev = (Math.atan2(wRev.y, wRev.x) * 180) / Math.PI;
    expect(Math.abs(degRev - 45)).toBeLessThan(1e-9);
  });
});

describe('DOGFOOD 07 — rack & pinion drive (θ ↔ rθ coupling)', () => {
  it('C: pinionRadius 10, drive +90° → rack slides 10·π/2 = 15.707963267948966 mm', () => {
    const r = solveMates(
      [
        { partId: 'bed', fixed: true },
        {
          partId: 'pinion',
          position: { x: 0, y: 0, z: 10 },
          refs: { ax: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } } },
        },
        {
          partId: 'rack',
          refs: { edge: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } } },
        },
      ],
      [
        {
          id: 'rp', kind: 'rack_pinion', pinionRadius: 10,
          a: { partId: 'pinion', refId: 'ax' },
          // rack edge declared as an axis ref, typed as 'edge' for the IR combo:
          b: { partId: 'rack', refId: 'edge', refKind: 'edge' },
        },
      ],
      { tolerance: 1e-9, drives: [{ mateId: 'rp', angleDeg: 90 }] },
    );
    expect(r.converged).toBe(true);
    const rack = r.part('rack');
    expect(Math.abs(rack.position.x - (10 * Math.PI) / 2)).toBeLessThan(1e-9);
    expect(Math.abs(rack.position.y)).toBeLessThan(1e-9);
    expect(Math.abs(rack.position.z)).toBeLessThan(1e-9);
    const eff = r.driveEffects.find((e) => e.partId === 'rack')!;
    expect(eff.kind).toBe('translation');
    expect(Math.abs(eff.amount - 15.707963267948966)).toBeLessThan(1e-9);
  });
});

describe('DOGFOOD 07 — slider (slot) limit residual, both engines', () => {
  const slotSystem = (): { parts: SolvePartSpec[]; mates: SolveMateSpec[] } => ({
    parts: [
      {
        partId: 'plate',
        fixed: true,
        refs: { slot_edge: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } } },
      },
      {
        partId: 'pin',
        position: { x: 60, y: 2, z: 5 },
        refs: { pin_ax: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } } },
      },
    ],
    mates: [
      {
        id: 's', kind: 'slot', slotLength: 50,
        a: { partId: 'plate', refId: 'slot_edge', refKind: 'edge' },
        b: { partId: 'pin', refId: 'pin_ax' },
      },
    ],
  });

  it('D1: gauss — pin at t=60 on a 50 mm slot → NOT converged, residual = 10 exactly', () => {
    const { parts, mates } = slotSystem();
    const r = solveMates(parts, mates, { tolerance: 1e-6 });
    // Placement snaps the pin onto the slot line (y → 0) but PRESERVES the
    // slide coordinate t = 60; the segment penalty t − slotLength = 10
    // remains and is reported honestly.
    expect(r.converged).toBe(false);
    expect(Math.abs(r.finalMaxResidual - 10)).toBeLessThan(1e-9);
    const pin = r.part('pin');
    expect(Math.abs(pin.position.y)).toBeLessThan(1e-9); // on the slot line
    expect(Math.abs(pin.position.x - 60)).toBeLessThan(1e-9); // t preserved
  });

  it('D2: newton — same system now REPORTS the violation (pre-fix: false convergence at residual 0)', () => {
    const { parts, mates } = slotSystem();
    const r = solveMates(parts, mates, { engine: 'newton', tolerance: 1e-6, maxIterations: 200 });
    // Pre-fix the newton residual had no slotLength term at all — measured
    // on this exact system: gauss residual 10, newton residual 0 with
    // converged=true. Now both engines share one residual: the newton path
    // (via its documented LM-saturation → Gauss-Seidel fallback) lands on
    // the slot line with the slide coordinate preserved and reports the
    // 10 mm segment violation honestly.
    expect(r.converged).toBe(false);
    expect(Math.abs(r.finalMaxResidual - 10)).toBeLessThan(1e-9);
    const pin = r.part('pin');
    expect(Math.abs(pin.position.y)).toBeLessThan(1e-9);
    expect(Math.abs(pin.position.x - 60)).toBeLessThan(1e-9);
  });
});

describe('DOGFOOD 07 — hinge angle drive (axis lock + angle parameter)', () => {
  const hingeSystem = (limit?: { minAngleDeg: number; maxAngleDeg: number }) => ({
    parts: [
      {
        partId: 'frame',
        fixed: true,
        refs: { shaft: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } } },
      } as SolvePartSpec,
      { partId: 'door', position: { x: 2, y: -1, z: 0 } } as SolvePartSpec,
    ],
    mates: [
      {
        id: 'h', kind: 'hinge' as const,
        a: { partId: 'door', refId: 'z_axis' },
        b: { partId: 'frame', refId: 'shaft' },
        ...(limit ? { limit } : {}),
        zeroAngleRef: {
          a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 },
          axisA: { x: 0, y: 0, z: 1 }, axisB: { x: 0, y: 0, z: 1 },
        },
      } as SolveMateSpec,
    ],
  });

  it('E1: drive to swing 90° → statics hold AND measured swing = 90° (1e-9)', () => {
    const { parts, mates } = hingeSystem({ minAngleDeg: 0, maxAngleDeg: 120 });
    const r = solveMates(parts, mates, { tolerance: 1e-9, drives: [{ mateId: 'h', angleDeg: 90 }] });
    expect(r.converged).toBe(true);
    const door = r.state.parts.find((p) => p.id === 'door')!;
    const frame = r.state.parts.find((p) => p.id === 'frame')!;
    // Statics: door axis locked onto the shaft (perpendicular offset gone).
    expect(Math.abs(door.position.x)).toBeLessThan(1e-6);
    expect(Math.abs(door.position.y)).toBeLessThan(1e-6);
    // Angle parameter: signed swing measured via zeroAngleRef.
    const mate = r.state.mates[0] as Extract<Mate, { kind: 'hinge' }>;
    const swing = measureHingeSwingRad(mate, door, frame, { x: 0, y: 0, z: 1 });
    expect(Math.abs(swing - Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('E2: drive beyond the limit (150° > 120°) is REFUSED with the numbers', () => {
    const { parts, mates } = hingeSystem({ minAngleDeg: 0, maxAngleDeg: 120 });
    expect(() =>
      solveMates(parts, mates, { tolerance: 1e-9, drives: [{ mateId: 'h', angleDeg: 150 }] }),
    ).toThrow(KinematicsError);
    expect(() =>
      solveMates(parts, mates, { tolerance: 1e-9, drives: [{ mateId: 'h', angleDeg: 150 }] }),
    ).toThrow(/150.*outside the hinge limit.*\[0°, 120°\]/);
  });

  it('E3: engine parity — in-limit swing +30° gives ZERO limit residual on BOTH engines', () => {
    // Pre-fix discriminator: the newton residual used the unsigned
    // quaternion proxy, which false-flagged an in-limit +30° swing as a
    // 30° violation (0.5236 rad) whenever min = 0. The shared residual's
    // signed branch reports 0 on both engines.
    const rad = (30 * Math.PI) / 180;
    const q: Quat = { x: 0, y: 0, z: Math.sin(rad / 2), w: Math.cos(rad / 2) };
    const { parts, mates } = hingeSystem({ minAngleDeg: 0, maxAngleDeg: 90 });
    // door pre-rotated so that swing(A→B) = +30°: rotate door by −30°.
    const qNeg: Quat = { x: 0, y: 0, z: -q.z, w: q.w };
    const partsRot = parts.map((p) =>
      p.partId === 'door' ? { ...p, position: { x: 0, y: 0, z: 0 }, orientation: qNeg } : p,
    );
    const gs = solveMates(partsRot, mates, { tolerance: 1e-9 });
    const nw = solveMates(partsRot, mates, { engine: 'newton', tolerance: 1e-9 });
    expect(gs.residuals[0]!.residual).toBeLessThan(1e-9);
    expect(nw.residuals[0]!.residual).toBeLessThan(1e-9);
  });
});

describe('DOGFOOD 07 — newton plane-coincident regression (the 15.91 case)', () => {
  it('F: expected-20 system now reaches x=20 with aligned normals (was 15.914, falsely converged)', () => {
    const parts: SolvePartSpec[] = [
      {
        partId: 'base',
        fixed: true,
        refs: {
          wall: { kind: 'plane', origin: { x: 20, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } },
          anchor: { kind: 'point', origin: { x: 20, y: 0, z: 0 } },
        },
      },
      { partId: 'block', position: { x: 5, y: 6, z: 8 } },
    ];
    const mates: SolveMateSpec[] = [
      { id: 'on_wall', kind: 'coincident', a: { partId: 'block', refId: 'yz_plane' }, b: { partId: 'base', refId: 'wall' } },
      { id: 'stand_off', kind: 'distance', value: 5, a: { partId: 'block', refId: 'origin' }, b: { partId: 'base', refId: 'anchor' } },
    ];
    const r = solveMates(parts, mates, { engine: 'newton', tolerance: 1e-6, maxIterations: 100 });
    expect(r.converged).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-6);
    const block = r.part('block');
    // THE fix: the plane constraint pins x to the wall.
    expect(Math.abs(block.position.x - 20)).toBeLessThan(1e-6);
    // Distance mate: 5 mm from the anchor (y/z free on the circle).
    const dy = block.position.y;
    const dz = block.position.z;
    expect(Math.abs(Math.hypot(block.position.x - 20, dy, dz) - 5)).toBeLessThan(1e-6);
    // Normal alignment: block local +X stays a world ±X direction —
    // no tilt-cheat (pre-fix it converged with x̂ at (0.576, 0.490, 0.654)).
    const xw = xWitness(block.orientation);
    expect(Math.abs(Math.abs(xw.x) - 1)).toBeLessThan(1e-6);
  });
});

describe('DOGFOOD 07 — motionStudy gear sweep (drive path)', () => {
  it('G: sweep gear drive 0→90° in 3 steps → cumulative −45° on the partner, all frames converged', () => {
    // Direct AssemblyState + resolver (motionStudy takes the engine-level
    // contract, not the facade).
    const state: AssemblyState = {
      parts: [
        partInstance({ id: 'frame', name: 'frame', partTemplateId: 'frame', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true }),
        partInstance({ id: 'gear_a', name: 'gear_a', partTemplateId: 'g', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT }),
        partInstance({ id: 'gear_b', name: 'gear_b', partTemplateId: 'g', position: { x: 30, y: 0, z: 0 }, orientation: IDENTITY_QUAT }),
      ],
      mates: [
        {
          id: 'g', kind: 'gear', ratio: 2,
          a: { partId: 'gear_a', refId: 'spin', refKind: 'axis' },
          b: { partId: 'gear_b', refId: 'spin', refKind: 'axis' },
        } as Mate,
      ],
    };
    const resolve: GeometryResolver = (ref, p): ResolvedGeometry | null => {
      if (ref.refId !== 'spin') return null;
      return {
        kind: 'axis',
        world: { origin: p.position, direction: rotateVec({ x: 0, y: 0, z: 1 }, p.orientation) },
      };
    };
    const study = runMotionSweep(state, resolve, {
      mateId: 'g', fromValue: 0, toValue: 90, steps: 3, solverOptions: { tolerance: 1e-9 },
    });
    expect(study.allConverged).toBe(true);
    expect(study.frames).toHaveLength(4);
    expect(study.frames.map((f) => f.parameterValue)).toEqual([0, 30, 60, 90]);
    // Final frame: gear_a at +90° (x̂ → ŷ), gear_b at −45°.
    const last = study.frames[3]!.solve.state;
    const wa = xWitness(last.parts.find((p) => p.id === 'gear_a')!.orientation);
    const wb = xWitness(last.parts.find((p) => p.id === 'gear_b')!.orientation);
    expect(Math.abs(wa.y - 1)).toBeLessThan(1e-9);
    expect(Math.abs(wb.x - SQ2)).toBeLessThan(1e-9);
    expect(Math.abs(wb.y - -SQ2)).toBeLessThan(1e-9);
    // Mid frame (60° cumulative): gear_b at −30°.
    const mid = study.frames[2]!.solve.state;
    const wbMid = xWitness(mid.parts.find((p) => p.id === 'gear_b')!.orientation);
    const degMid = (Math.atan2(wbMid.y, wbMid.x) * 180) / Math.PI;
    expect(Math.abs(degMid - -30)).toBeLessThan(1e-9);
  });
});

// ── W5-F3: 잔여 2건 해소 — distance plane 법선정렬 + hinge 프록시 정직화 ──
//
// W5-F2 커밋(4aa838b5)이 정직 기록으로 남긴 두 한계의 해소를 공개
// facade(solveMates) 레벨에서 고정한다:
//   1. distance plane/plane: 법선 30° 어긋남 + 갭 수치 일치 → 종전엔 양
//      엔진 모두 converged=true·residual≈0 (가짜 수렴, 실측). 이제 gauss는
//      회전 정렬로 진짜 수렴(z=20·tilt 0°), 잔차는 어긋남을 벌점한다.
//   2. hinge limit(zeroAngleRef 無): in-limit +30°가 0.5236 rad 허위
//      벌점 — 유지되되(하위호환) 결과에 'hinge-unsigned-proxy' 근사
//      마커가 명시된다. zeroAngleRef 공급 시 벌점 정확히 0.

describe('DOGFOOD 07 — W5-F3 distance plane/plane 법선정렬', () => {
  const s30 = Math.sin(Math.PI / 6);
  const c30 = Math.cos(Math.PI / 6);
  const tiltedParts = (): SolvePartSpec[] => [
    {
      partId: 'base',
      fixed: true,
      refs: { top: { kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } } },
    },
    {
      partId: 'block',
      position: { x: 0, y: 0, z: 5 },
      refs: { bottom: { kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: s30, y: 0, z: c30 } } },
    },
  ];
  const gapMate: SolveMateSpec[] = [
    { id: 'gap', kind: 'distance', value: 20, a: { partId: 'base', refId: 'top' }, b: { partId: 'block', refId: 'bottom' } },
  ];

  it('gauss: 30° 어긋난 블록을 회전 정렬해 진짜 수렴 (z=20, tilt 0°)', () => {
    const r = solveMates(tiltedParts(), gapMate, { tolerance: 1e-6 });
    expect(r.converged).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-6);
    const block = r.part('block');
    expect(Math.abs(block.position.z - 20)).toBeLessThan(1e-3);
    const nWorld = rotateVec({ x: s30, y: 0, z: c30 }, block.orientation);
    expect(Math.abs(nWorld.z - 1)).toBeLessThan(1e-6); // tilt ≈ 0
  });

  it('newton: 가짜 수렴 없음 — 기본 예산 정직 실패 or 정렬 자세 수렴, 확장 예산 진짜 수렴', () => {
    // 기본 예산(100회): 실측 converged=false·residual≈14.6 (정직 실패 —
    // 종전의 converged=true·tilt 30°가짜 수렴이 사라졌다는 것이 요점).
    const rDefault = solveMates(tiltedParts(), gapMate, { engine: 'newton', tolerance: 1e-6 });
    const blockD = rDefault.part('block');
    const nD = rotateVec({ x: s30, y: 0, z: c30 }, blockD.orientation);
    if (rDefault.converged) {
      expect(Math.abs(Math.abs(nD.z) - 1)).toBeLessThan(1e-3);
    } else {
      expect(rDefault.finalMaxResidual).toBeGreaterThan(0.01);
    }
    // 확장 예산(1000회): 실측 converged=true·z=20.000000·tilt 0.000°.
    const r = solveMates(tiltedParts(), gapMate, { engine: 'newton', tolerance: 1e-6, maxIterations: 1000 });
    expect(r.converged).toBe(true);
    const block = r.part('block');
    expect(Math.abs(block.position.z - 20)).toBeLessThan(1e-3);
    const nWorld = rotateVec({ x: s30, y: 0, z: c30 }, block.orientation);
    expect(Math.abs(nWorld.z - 1)).toBeLessThan(1e-4);
  });
});

describe('DOGFOOD 07 — W5-F3 hinge limit 프록시 근사 명시 + signed 정확화', () => {
  const hingeParts = (yawDeg: number): SolvePartSpec[] => [
    {
      partId: 'frame',
      fixed: true,
      refs: { shaft: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } } },
    },
    {
      partId: 'door',
      fixed: true, // 자세 고정 — 잔차 측정 목적
      orientation: { x: 0, y: 0, z: Math.sin((yawDeg * Math.PI) / 360), w: Math.cos((yawDeg * Math.PI) / 360) },
    },
  ];
  const zeroRef = {
    a: { x: 1, y: 0, z: 0 },
    b: { x: 1, y: 0, z: 0 },
    axisA: { x: 0, y: 0, z: 1 },
    axisB: { x: 0, y: 0, z: 1 },
  };

  it('프록시(zeroAngleRef 無): in-limit +30°에 0.5236 rad 허위 벌점 + 근사 마커 (양 엔진)', () => {
    const mates: SolveMateSpec[] = [
      { id: 'h', kind: 'hinge', limit: { minAngleDeg: 0, maxAngleDeg: 90 }, a: { partId: 'frame', refId: 'shaft' }, b: { partId: 'door', refId: 'z_axis' } },
    ];
    for (const engine of ['gauss-seidel', 'newton'] as const) {
      const r = solveMates(hingeParts(30), mates, { engine });
      const res = r.residuals.find((x) => x.mateId === 'h')!;
      expect(Math.abs(res.residual - 0.523599)).toBeLessThan(1e-4);
      expect(res.approximation).toBe('hinge-unsigned-proxy');
    }
  });

  it('zeroAngleRef 공급: in-limit +30° 벌점 정확히 0·마커 없음, out-limit +120° 정확 벌점 0.5236', () => {
    const mkMates = (): SolveMateSpec[] => [
      { id: 'h', kind: 'hinge', limit: { minAngleDeg: 0, maxAngleDeg: 90 }, zeroAngleRef: zeroRef, a: { partId: 'frame', refId: 'shaft' }, b: { partId: 'door', refId: 'z_axis' } },
    ];
    const rIn = solveMates(hingeParts(30), mkMates());
    const resIn = rIn.residuals.find((x) => x.mateId === 'h')!;
    expect(resIn.residual).toBeLessThan(1e-9);
    expect(resIn.approximation).toBeUndefined();

    const rOut = solveMates(hingeParts(120), mkMates());
    const resOut = rOut.residuals.find((x) => x.mateId === 'h')!;
    expect(Math.abs(resOut.residual - 0.523599)).toBeLessThan(1e-4);
    expect(resOut.approximation).toBeUndefined();
  });
});
