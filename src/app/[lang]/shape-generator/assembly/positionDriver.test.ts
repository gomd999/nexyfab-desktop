import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyDriver, restoreDriver } from './positionDriver';
import { solveAssembly, type AssemblyBody, type AssemblyState, type Mate, type MateSelection } from './matesSolver';

function body(name: string, x = 0, y = 0, z = 0, fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(x, y, z),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  };
}
function sel(idx: number, lp: [number, number, number], ln: [number, number, number] = [0, 1, 0], axis?: [number, number, number]): MateSelection {
  return {
    bodyIndex: idx,
    type: 'point',
    localPoint: new THREE.Vector3(...lp),
    localNormal: new THREE.Vector3(...ln),
    localAxis: axis ? new THREE.Vector3(...axis) : undefined,
  };
}
function mate(id: string, type: Mate['type'], s0: MateSelection, s1: MateSelection, extra: Partial<Mate> = {}): Mate {
  return { id, type, selections: [s0, s1], enabled: true, ...extra };
}

describe('applyDriver · hinge-angle', () => {
  it('rotates the driven body to the requested angle around the hinge axis', () => {
    const state: AssemblyState = {
      bodies: [body('ref', 0, 0, 0, true), body('arm', 50, 0, 0)],
      mates: [mate('h', 'hinge',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const app = applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 90 });
    expect(app.ok).toBe(true);
    expect(app.drivenBodyIndex).toBe(1);
    // Driven body rotation should be ~90° around its hinge axis (+Y).
    const q = new THREE.Quaternion().setFromEuler(state.bodies[1].rotation);
    const angle = 2 * Math.atan2(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z), q.w);
    expect(Math.abs(angle - Math.PI / 2)).toBeLessThan(0.01);
  });

  it('pins the driven body (fixed=true) for downstream solving', () => {
    const state: AssemblyState = {
      bodies: [body('ref', 0, 0, 0, true), body('arm', 50, 0, 0)],
      mates: [mate('h', 'hinge',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 45 });
    expect(state.bodies[1].fixed).toBe(true);
  });

  it('idempotent — same driver value produces same pose regardless of prior state', () => {
    const state: AssemblyState = {
      bodies: [body('ref', 0, 0, 0, true), body('arm', 50, 0, 0)],
      mates: [mate('h', 'hinge',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    // Apply 90° twice → should still be 90° (not 180°).
    applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 90 });
    applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 90 });
    const q = new THREE.Quaternion().setFromEuler(state.bodies[1].rotation);
    const angle = 2 * Math.atan2(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z), q.w);
    expect(Math.abs(angle - Math.PI / 2)).toBeLessThan(0.01);
  });
});

describe('applyDriver · slider-distance', () => {
  it('translates the driven body along the slider axis by the given distance', () => {
    const state: AssemblyState = {
      bodies: [body('rail', 0, 0, 0, true), body('block', 0, 0, 0)],
      mates: [mate('s', 'slider',
        sel(0, [0, 0, 0], [0, 1, 0], [1, 0, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [1, 0, 0])),
      ],
    };
    applyDriver(state, { type: 'slider-distance', mateId: 's', value: 25 });
    expect(state.bodies[1].position.x).toBeCloseTo(25, 1);
  });

  it('honours negative distance (slides backwards)', () => {
    const state: AssemblyState = {
      bodies: [body('rail', 0, 0, 0, true), body('block', 0, 0, 0)],
      mates: [mate('s', 'slider',
        sel(0, [0, 0, 0], [0, 1, 0], [1, 0, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [1, 0, 0])),
      ],
    };
    applyDriver(state, { type: 'slider-distance', mateId: 's', value: -10 });
    expect(state.bodies[1].position.x).toBeCloseTo(-10, 1);
  });
});

describe('applyDriver · error reporting', () => {
  it('returns mate-not-found for unknown mate id', () => {
    const state: AssemblyState = { bodies: [body('a')], mates: [] };
    const r = applyDriver(state, { type: 'hinge-angle', mateId: 'ghost', value: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mate-not-found');
  });

  it('returns mate-disabled for disabled mates', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('b')],
      mates: [{ ...mate('h', 'hinge', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])), enabled: false }],
    };
    const r = applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 0 });
    expect(r.reason).toBe('mate-disabled');
  });

  it('returns mate-type-mismatch when driver type doesn`t match mate type', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('b')],
      mates: [mate('s', 'slider', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = applyDriver(state, { type: 'hinge-angle', mateId: 's', value: 0 });
    expect(r.reason).toBe('mate-type-mismatch');
  });
});

describe('restoreDriver', () => {
  it('restores the driven body`s original fixed flag', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 0, 0, 0, /* free */ false)],
      mates: [mate('h', 'hinge',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const app = applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 45 });
    expect(state.bodies[1].fixed).toBe(true);
    restoreDriver(state, app);
    expect(state.bodies[1].fixed).toBe(false);
  });

  it('no-op when driver application failed', () => {
    const state: AssemblyState = { bodies: [body('a')], mates: [] };
    const app = applyDriver(state, { type: 'hinge-angle', mateId: 'ghost', value: 0 });
    expect(() => restoreDriver(state, app)).not.toThrow();
  });
});

describe('integration · driver + gear coupling', () => {
  it('hinge driver at 60° propagates to gear-coupled body with ratio 1:1', () => {
    // Body 0 = reference (fixed). Body 1 = hinge child. Body 2 = gear-coupled.
    const state: AssemblyState = {
      bodies: [body('ref', 0, 0, 0, true), body('arm', 50, 0, 0), body('gear', 100, 0, 0)],
      mates: [
        mate('h', 'hinge',
          sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
          sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
        mate('g', 'gear',
          sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
          sel(2, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
          { gearRatio: 1 }),
      ],
    };
    const app = applyDriver(state, { type: 'hinge-angle', mateId: 'h', value: 60 });
    expect(app.ok).toBe(true);
    // Now solve: gear constraint should propagate arm's rotation to the gear body.
    const r = solveAssembly(state, 100);
    const qGear = new THREE.Quaternion().setFromEuler(r.bodies[2].rotation);
    const yAngle = 2 * Math.atan2(qGear.y, qGear.w);
    expect(Math.abs(yAngle - Math.PI / 3)).toBeLessThan(0.05); // 60° propagated
  });
});
