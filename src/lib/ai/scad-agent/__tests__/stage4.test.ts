/**
 * Stage 4 (G/H/I/J) — sweep/loft/draft/helix + sketch+solver + mates + drawing.
 *
 * Mock adapters drive the test; real implementations live in
 * serverAdapters / Solvespace WASM bindings (separate task).
 */
import { describe, it, expect } from 'vitest';
import { makeTools, type BrepAdapter, type SolverAdapter, type MateAdapter, type DrawingStudioAdapter } from '../tools';
import type { AgentSession } from '../types';
import { serverMateAdapter } from '../serverMate';

let nextHandleSeq = 0;
const newHandle = () => `mock:${++nextHandleSeq}`;

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

function fullBrep(): BrepAdapter {
  return {
    async ensureReady() { /* noop */ },
    async primitive(args) { return { ok: true, handle: newHandle(), kind: `${args.shape}:mock` }; },
    async boolean(args) { return { ok: true, handle: newHandle(), kind: `boolean(${args.op})` }; },
    async fillet() { return { ok: true, handle: newHandle(), kind: 'fillet' }; },
    async chamfer() { return { ok: true, handle: newHandle(), kind: 'chamfer' }; },
    async shell() { return { ok: true, handle: newHandle(), kind: 'shell' }; },
    async toMesh() { return { ok: true, triangleCount: 100 }; },
    async exportStep() { return { ok: true, bytes: 4096 }; },
    async sweep(args) { return { ok: true, handle: newHandle(), kind: `sweep(${args.path.length}pts)` }; },
    async loft(args) { return { ok: true, handle: newHandle(), kind: `loft(${args.sections.length}sec)` }; },
    async draft(args) { return { ok: true, handle: newHandle(), kind: `draft(${args.angleDeg}°)` }; },
    async helix(args) { return { ok: true, handle: newHandle(), kind: `helix(p=${args.pitch})` }; },
  };
}

function host(opts: {
  brep?: BrepAdapter; solver?: SolverAdapter; mateSolver?: MateAdapter; drawingStudio?: DrawingStudioAdapter;
} = {}) {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 100, triangles: 12, ts: Date.now() }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    brep: opts.brep,
    solver: opts.solver,
    mateSolver: opts.mateSolver,
    drawingStudio: opts.drawingStudio,
  };
}

// ─── G — sweep / loft / draft / helix ────────────────────────────────────

describe('G — sweep/loft/draft/helix tools', () => {
  it('brep_sweep validates profile and path', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const r = await tools.brep_sweep!({ profile: [[0, 0]], path: [[0, 0, 0], [0, 0, 10]] }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('brep_sweep success creates a brepEntry', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    const r = await tools.brep_sweep!({
      profile: [[0, 0], [10, 0], [10, 10], [0, 10]],
      path: [[0, 0, 0], [0, 0, 50]],
    }, session);
    expect(r.ok).toBe(true);
    expect(session.brepEntries.length).toBe(1);
    expect(session.brepEntries[0].kind).toContain('sweep');
  });

  it('brep_loft requires ≥2 sections', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const r = await tools.brep_loft!({ sections: [{ z: 0, polygon: [[0, 0]] }] }, blankSession());
    expect(r.ok).toBe(false);
  });

  it('brep_helix validates numeric args', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const r1 = await tools.brep_helix!({}, blankSession());
    expect(r1.ok).toBe(false);
    const r2 = await tools.brep_helix!({ pitch: 2, height: 20, radius: 5 }, blankSession());
    expect(r2.ok).toBe(true);
  });

  it('returns BREP_NOT_IMPL when adapter lacks the method', async () => {
    const minimalBrep: BrepAdapter = {
      ...fullBrep(),
      sweep: undefined,
    };
    const tools = makeTools(host({ brep: minimalBrep }));
    const r = await tools.brep_sweep!({
      profile: [[0, 0], [1, 0], [1, 1]], path: [[0, 0, 0], [0, 0, 1]],
    }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BREP_NOT_IMPL');
  });
});

// ─── H — sketch + solver ────────────────────────────────────────────────

function mockSolver(): SolverAdapter {
  return {
    isAvailable: () => true,
    async solve(sketch) {
      return { ok: true, updatedEntities: sketch.entities, residual: 1e-9 };
    },
  };
}

describe('H — sketch + constraint solver', () => {
  it('sketch_create stores the sketch on session', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    const r = await tools.sketch_create!({
      name: 'plate',
      entities: [
        { id: 'p1', kind: 'point', points: [[0, 0]] },
        { id: 'p2', kind: 'point', points: [[50, 0]] },
        { id: 'l1', kind: 'line', points: [[0, 0], [50, 0]] },
      ],
    }, session);
    expect(r.ok).toBe(true);
    expect(session.sketches.plate).toBeDefined();
    expect(session.sketches.plate.entities.length).toBe(3);
  });

  it('sketch_add_constraint appends to the named sketch', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    await tools.sketch_create!({ name: 'a', entities: [{ id: 'l1', kind: 'line', points: [[0, 0], [10, 0]] }] }, session);
    await tools.sketch_add_constraint!({
      sketchName: 'a',
      constraint: { id: 'c1', kind: 'horizontal', entityIds: ['l1'] },
    }, session);
    expect(session.sketches.a.constraints.length).toBe(1);
  });

  it('sketch_solve returns NO_SOLVER without adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    await tools.sketch_create!({ name: 'a', entities: [{ id: 'p', kind: 'point', points: [[0, 0]] }] }, session);
    const r = await tools.sketch_solve!({ sketchName: 'a' }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_SOLVER');
  });

  it('sketch_solve marks sketch as solved with adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep(), solver: mockSolver() }));
    const session = blankSession();
    await tools.sketch_create!({ name: 'a', entities: [{ id: 'p', kind: 'point', points: [[0, 0]] }] }, session);
    const r = await tools.sketch_solve!({ sketchName: 'a' }, session);
    expect(r.ok).toBe(true);
    expect(session.sketches.a.solved).toBe(true);
  });

  it('sketch_to_brep_extrude requires solved sketch', async () => {
    const tools = makeTools(host({ brep: fullBrep(), solver: mockSolver() }));
    const session = blankSession();
    await tools.sketch_create!({
      name: 'a',
      entities: [{ id: 'l1', kind: 'line', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
    }, session);
    const r1 = await tools.sketch_to_brep_extrude!({ sketchName: 'a', height: 5 }, session);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('NOT_SOLVED');

    await tools.sketch_solve!({ sketchName: 'a' }, session);
    const r2 = await tools.sketch_to_brep_extrude!({ sketchName: 'a', height: 5 }, session);
    expect(r2.ok).toBe(true);
    expect(session.brepEntries.length).toBe(1);
  });
});

// ─── I — mate connectors ────────────────────────────────────────────────

function mockMateSolver(): MateAdapter {
  return {
    isAvailable: () => true,
    async solve(mates) {
      const transforms: Record<string, [number, number, number]> = {};
      for (const m of mates) transforms[m.handleB] = [0, 0, m.value ?? 0];
      return { ok: true, transforms, residual: 0 };
    },
  };
}

describe('I — mate connectors', () => {
  it('add_mate accumulates on session', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    await tools.add_mate!({ kind: 'concentric', handleA: 'a', handleB: 'b' }, session);
    await tools.add_mate!({ kind: 'distance', handleA: 'a', handleB: 'c', value: 10 }, session);
    expect(session.mates.length).toBe(2);
    expect(session.mates[0].id).toBe('mate_1');
    expect(session.mates[1].value).toBe(10);
  });

  it('list_mates reports the roster', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    await tools.add_mate!({ kind: 'coplanar', handleA: 'a', handleB: 'b' }, session);
    const r = await tools.list_mates!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('coplanar');
  });

  it('solve_mates returns NO_MATE_SOLVER without adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const session = blankSession();
    session.mates.push({ id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b' });
    const r = await tools.solve_mates!({}, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_MATE_SOLVER');
  });

  it('solve_mates returns transforms with adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep(), mateSolver: mockMateSolver() }));
    const session = blankSession();
    await tools.add_mate!({ kind: 'distance', handleA: 'a', handleB: 'b', value: 25 }, session);
    const r = await tools.solve_mates!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta?.transforms).toBeDefined();
  });

  it('add_composite_intent builds a non-whitelisted shape via primitive composition (W1/W2)', async () => {
    const tools = makeTools(host({}));
    const session = blankSession();
    const r = await tools.add_composite_intent!({
      parts: [
        { intent: { shapeId: 'box', params: { width: 40, height: 40, depth: 20 } } },
        { intent: { shapeId: 'cylinder', params: { diameter: 10, height: 30 } }, op: 'subtract' },
      ],
    }, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(session.scadSource).toMatch(/difference\(\)/);
      expect(session.lastIntent).toBeUndefined(); // composite ≠ single intent
      expect(r.meta?.expectedBbox).toMatchObject({ wMm: 40, hMm: 40, dMm: 20 });
    }
  });

  it('add_composite_intent rejects an unrenderable part', async () => {
    const tools = makeTools(host({}));
    const session = blankSession();
    const r = await tools.add_composite_intent!({ parts: [{ intent: { shapeId: 'nope', params: {} } }] }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('COMPOSITE_REJECTED');
  });

  it('end-to-end: real serverMateAdapter repositions a part from session placements', async () => {
    const tools = makeTools(host({ brep: fullBrep(), mateSolver: serverMateAdapter }));
    const session = blankSession();
    // Two cylinder-like parts off-axis; concentric should pull `pin` onto `base`.
    session.placements = {
      base: { position: [0, 0, 0], cylindrical: true },
      pin: { position: [12, 0, 0], cylindrical: true },
    };
    await tools.add_mate!({ kind: 'concentric', handleA: 'base', handleB: 'pin', faceTagA: 'side', faceTagB: 'side' }, session);
    const r = await tools.solve_mates!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta?.transforms).toBeDefined();
      // The solved delta was written back into the session placement.
      expect(session.placements!.pin.position[0]).toBeCloseTo(0, 2);
      expect(session.placements!.base.position[0]).toBe(0); // anchor unmoved
    }
  });
});

// ─── J — drawing studio ─────────────────────────────────────────────────

function mockDrawingStudio(): DrawingStudioAdapter {
  return {
    isAvailable: () => true,
    async generate() {
      return {
        ok: true,
        lineCount: { visible: 124, hidden: 36, center: 8 },
        dimensionCount: 12,
        sheetSize: { w: 297, h: 210 },
      };
    },
  };
}

describe('J — drawing studio', () => {
  it('returns NO_DRAWING without adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep() }));
    const r = await tools.brep_to_drawing!({ hostHandle: 'a' }, blankSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_DRAWING');
  });

  it('returns dimension+line counts with adapter', async () => {
    const tools = makeTools(host({ brep: fullBrep(), drawingStudio: mockDrawingStudio() }));
    const r = await tools.brep_to_drawing!({ hostHandle: 'a' }, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('124 visible');
      expect(r.output).toContain('12 dimensions');
    }
  });
});
