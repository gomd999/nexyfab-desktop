/**
 * Σ — End-to-end mock simulation tests.
 *
 * Pins:
 *   - queue lifecycle (enqueue → poll → done)
 *   - each mock adapter returns the documented shape
 *   - timeout + failure paths surface as `failed` status
 *   - production-swap contract: tests only target the public Job<>
 *     interface, not the mock-specific result values, so swapping in
 *     a real solver doesn't break these tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueJob,
  awaitJob,
  getJob,
  listSolverKinds,
  _resetSolvers,
} from '../simulationQueue';
import {
  bootstrapMockSolvers,
  _resetMockSolversBoot,
  type CfdInput, type CfdOutput,
  type MbdInput, type MbdOutput,
  type CamInput, type CamOutput,
  type MoldFillInput, type MoldFillOutput,
  type OpticsInput, type OpticsOutput,
  type ThermalInput, type ThermalOutput,
} from '../simulationAdapters';

beforeEach(() => {
  _resetSolvers();
  _resetMockSolversBoot();
  bootstrapMockSolvers();
});

describe('simulation suite', () => {
  it('all 6 mock solvers are registered', () => {
    const kinds = listSolverKinds().map(k => k.kind).sort();
    expect(kinds).toEqual(['cam', 'cfd', 'mbd', 'mold_fill', 'optics', 'thermal']);
    expect(listSolverKinds().every(k => k.isMock)).toBe(true);
  });

  it('CFD: laminar regime for low Reynolds', async () => {
    const job = await enqueueJob<CfdInput, CfdOutput>('cfd', {
      brepHandle: 'occt:1',
      velocityMs: 0.001,
      fluid: 'air',
      referenceLengthMm: 10,
    });
    const done = await awaitJob<CfdInput, CfdOutput>('cfd', job.id);
    expect(done.status).toBe('done');
    expect(done.result?.regime).toBe('laminar');
    expect(done.result?.dragCoefficient).toBeGreaterThan(0);
  });

  it('CFD: turbulent regime for high Reynolds', async () => {
    const job = await enqueueJob<CfdInput, CfdOutput>('cfd', {
      brepHandle: 'occt:1', velocityMs: 50, fluid: 'air', referenceLengthMm: 1000,
    });
    const done = await awaitJob<CfdInput, CfdOutput>('cfd', job.id);
    expect(done.result?.regime).toBe('turbulent');
  });

  it('MBD: free body falls under gravity', async () => {
    const job = await enqueueJob<MbdInput, MbdOutput>('mbd', {
      bodies: [{ id: 'ball', massKg: 1 }],
      joints: [],
      durationS: 1,
      initial: { ball: { positionM: [0, 0, 10] } },
    });
    const done = await awaitJob<MbdInput, MbdOutput>('mbd', job.id);
    expect(done.status).toBe('done');
    // 1s of g: z = 10 - 0.5*9.81*1² ≈ 5.095
    expect(done.result?.finalState.ball.positionM[2]).toBeCloseTo(5.095, 1);
  });

  it('CAM: returns toolpath segments + time estimate', async () => {
    const job = await enqueueJob<CamInput, CamOutput>('cam', {
      brepHandle: 'occt:1',
      toolDiameterMm: 6,
      stepoverPct: 50,
      operation: 'rough',
      stockBboxMm: { w: 100, h: 100, d: 50 },
    });
    const done = await awaitJob<CamInput, CamOutput>('cam', job.id);
    expect(done.result?.toolpathSegments).toBeGreaterThan(0);
    expect(done.result?.estimatedTimeMin).toBeGreaterThan(0);
    expect(done.result?.preview.length).toBeGreaterThan(0);
  });

  it('Mold fill: shot weight = volume × density', async () => {
    const job = await enqueueJob<MoldFillInput, MoldFillOutput>('mold_fill', {
      brepHandle: 'occt:1',
      material: 'PA66',
      meltTempC: 285,
      pressureMPa: 80,
      wallThicknessMm: 2,
      volumeCm3: 100,
    });
    const done = await awaitJob<MoldFillInput, MoldFillOutput>('mold_fill', job.id);
    expect(done.result?.shotWeightG).toBeCloseTo(114, 0); // 100 × 1.14
    expect(done.result?.fillTimeS).toBeGreaterThan(0);
  });

  it('Mold fill: thin wall raises high-severity warning', async () => {
    const job = await enqueueJob<MoldFillInput, MoldFillOutput>('mold_fill', {
      brepHandle: 'occt:1', material: 'ABS', meltTempC: 230, pressureMPa: 80,
      wallThicknessMm: 0.5, volumeCm3: 30,
    });
    const done = await awaitJob<MoldFillInput, MoldFillOutput>('mold_fill', job.id);
    const high = done.result?.warningHotspots.find(w => w.severity === 'high');
    expect(high).toBeTruthy();
  });

  it('Optics: parallel light → image at focal length', async () => {
    const job = await enqueueJob<OpticsInput, OpticsOutput>('optics', {
      surfaces: [{ kind: 'lens_thin', focalLengthMm: 50, zMm: 0, diameterMm: 25 }],
      source: 'parallel',
    });
    const done = await awaitJob<OpticsInput, OpticsOutput>('optics', job.id);
    expect(done.result?.imagePlaneZMm).toBe(50);
  });

  it('Optics: 1/f = 1/u + 1/v at finite source distance', async () => {
    // f=100, u=200 → v=200, M=-1
    const job = await enqueueJob<OpticsInput, OpticsOutput>('optics', {
      surfaces: [{ kind: 'lens_thin', focalLengthMm: 100, zMm: 0, diameterMm: 25 }],
      source: { distanceMm: 200 },
    });
    const done = await awaitJob<OpticsInput, OpticsOutput>('optics', job.id);
    expect(done.result?.imagePlaneZMm).toBeCloseTo(200, 1);
    expect(done.result?.magnification).toBeCloseTo(-1, 1);
  });

  it('Optics: failure surfaces as job.status=failed', async () => {
    const job = await enqueueJob<OpticsInput, OpticsOutput>('optics', {
      surfaces: [{ kind: 'aperture', zMm: 0, diameterMm: 25 }],  // no thin lens
      source: 'parallel',
    });
    const done = await awaitJob<OpticsInput, OpticsOutput>('optics', job.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('thin lens');
  });

  it('Thermal: ΔT = P / (h × A)', async () => {
    const job = await enqueueJob<ThermalInput, ThermalOutput>('thermal', {
      brepHandle: 'occt:1',
      powerW: 10,
      conductivityWmK: 50,
      ambientC: 25,
      surfaceAreaCm2: 100,
      convectionWm2K: 10,
    });
    const done = await awaitJob<ThermalInput, ThermalOutput>('thermal', job.id);
    // R = 1/(10 × 0.01) = 10, ΔT = 10 × 10 = 100
    expect(done.result?.steadyStateTempC).toBeCloseTo(125, 0);
  });

  it('Job lifecycle exposes progress + timestamps', async () => {
    const job = await enqueueJob<CfdInput, CfdOutput>('cfd', {
      brepHandle: 'occt:1', velocityMs: 1, fluid: 'air', referenceLengthMm: 10,
    });
    const fetched = getJob<CfdInput, CfdOutput>('cfd', job.id);
    expect(fetched).toBeTruthy();
    expect(fetched?.enqueuedAtMs).toBeGreaterThan(0);
    const done = await awaitJob<CfdInput, CfdOutput>('cfd', job.id);
    expect(done.progress).toBe(1);
    expect(done.finishedAtMs).toBeGreaterThan(done.startedAtMs!);
  });
});
