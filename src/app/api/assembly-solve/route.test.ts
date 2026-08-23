/**
 * /api/assembly-solve — validation + Phase 4 real-solve tests.
 *
 * Two response modes:
 *   - 'stub' (no featureTrees in body) → zero residuals, kept for backward
 *     compat with the existing UI client.
 *   - 'real' (featureTrees provided) → iterativeSolve runs end-to-end with
 *     a featureTreeGeometryResolver built from the per-part FeatureTrees.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/assembly-solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/assembly-solve - bounded JSON ingress', () => {
  it('rejects declared input beyond the assembly and feature-tree envelope', async () => {
    const r = await POST(new Request('http://localhost/api/assembly-solve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(32 * 1024 * 1024 + 1) },
      body: '{}',
    }) as never);
    expect(r.status).toBe(413);
    await expect(r.json()).resolves.toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });
});

const validState: AssemblyState = {
  parts: [
    {
      id: 'p_base',
      name: 'Base',
      partTemplateId: 'tpl_base',
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
      fixed: true,
    },
    {
      id: 'p_arm',
      name: 'Arm',
      partTemplateId: 'tpl_arm',
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
    },
  ],
  mates: [
    {
      id: 'm1',
      kind: 'coincident',
      a: { partId: 'p_base', refId: 'face_top', refKind: 'face' },
      b: { partId: 'p_arm', refId: 'face_bot', refKind: 'face' },
    },
  ],
};

describe('POST /api/assembly-solve — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(
      new Request('http://localhost/api/assembly-solve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects missing state', async () => {
    const r = await POST(makeReq({}) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/state\.parts/);
  });

  it('rejects state with non-array parts', async () => {
    const r = await POST(makeReq({ state: { parts: 'nope', mates: [] } }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects state that floats (parts > 0 but no fixed part)', async () => {
    const floating: AssemblyState = {
      ...validState,
      parts: validState.parts.map((p) => ({ ...p, fixed: false })),
    };
    const r = await POST(makeReq({ state: floating }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('INVALID_ASSEMBLY');
    expect(data.message).toMatch(/fixed/i);
  });

  it('rejects state with duplicate part ids', async () => {
    const dupes: AssemblyState = {
      parts: [
        { ...validState.parts[0]! },
        { ...validState.parts[0]! }, // duplicate id
      ],
      mates: [],
    };
    const r = await POST(makeReq({ state: dupes }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('INVALID_ASSEMBLY');
    expect(data.message).toMatch(/duplicate/i);
  });

  it('rejects state with a mate referencing an unknown part', async () => {
    const orphan: AssemblyState = {
      parts: validState.parts,
      mates: [
        {
          id: 'm_orphan',
          kind: 'coincident',
          a: { partId: 'ghost', refId: 'r', refKind: 'face' },
          b: { partId: 'p_arm', refId: 'r', refKind: 'face' },
        },
      ],
    };
    const r = await POST(makeReq({ state: orphan }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('INVALID_ASSEMBLY');
    expect(data.message).toMatch(/ghost|unknown/i);
  });

  it('rejects an assembly that exceeds the part cap', async () => {
    const tooMany: AssemblyState = {
      parts: Array.from({ length: 1001 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        partTemplateId: 't',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        fixed: i === 0,
      })),
      mates: [],
    };
    const r = await POST(makeReq({ state: tooMany }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('valid state returns ok=true with Phase 1 stub residuals and DoF', async () => {
    const r = await POST(makeReq({ state: validState }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.iterations).toBe(0);
    expect(data.finalMaxResidual).toBe(0);
    expect(typeof data.dof).toBe('number');
    expect(Array.isArray(data.residuals)).toBe(true);
    expect(data.residuals).toHaveLength(1);
    expect(data.residuals[0]).toEqual({
      mateId: 'm1',
      residual: 0,
      supported: true,
    });
    expect(data.phase).toBe('stub');
  });
});

// ─── Phase 4 real-solve tests ────────────────────────────────────────────

/**
 * Build a minimal "cylinder-like" tree so the resolver exposes the
 * concentric ref pair the test mate uses. The feature payload contents
 * don't matter for the resolver's always-on z_axis ref — they just need to
 * be valid.
 */
const TINY_TREE: FeatureTree = {
  nodes: [
    {
      id: 'e1',
      name: 'Extrude',
      dependencies: [],
      payload: {
        kind: 'extrude',
        loop: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        depth: 10,
        direction: 'one_sided',
        mode: 'add',
      },
    },
  ],
};

describe('POST /api/assembly-solve — real-solve phase', () => {
  it('returns phase=real with success=true for a satisfiable concentric mate', async () => {
    // Two parts; concentric on the z_axis of each. The free part starts
    // perpendicular-offset; the solver should snap it onto the base axis.
    const state: AssemblyState = {
      parts: [
        {
          id: 'p_base',
          name: 'Base',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'p_pin',
          name: 'Pin',
          partTemplateId: 'tpl',
          position: { x: 5, y: 3, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        {
          id: 'c1',
          kind: 'concentric',
          a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'p_pin', refId: 'z_axis', refKind: 'axis' },
        },
      ],
    };
    const r = await POST(
      makeReq({
        state,
        featureTrees: { p_base: TINY_TREE, p_pin: TINY_TREE },
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.phase).toBe('real');
    expect(data.success).toBe(true);
    expect(data.finalMaxResidual).toBeLessThan(1e-4);
    expect(data.state).toBeDefined();
    expect(Array.isArray(data.state.parts)).toBe(true);
    // The pin should have moved off its perpendicular offset (snapped to
    // base z_axis = world Z axis), so position x/y should both be ≈ 0.
    const pin = data.state.parts.find((p: { id: string }) => p.id === 'p_pin');
    expect(pin).toBeDefined();
    expect(Math.hypot(pin.position.x, pin.position.y)).toBeLessThan(1e-4);
  });

  it('round-trips explicit named axis/plane refs through the real API solver', async () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'block',
          name: 'Block',
          partTemplateId: 'block',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
          refs: {
            boss_axis: { kind: 'axis', origin: { x: 20, y: 20, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            top_plane: { kind: 'plane', origin: { x: 0, y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 } },
          },
        },
        {
          id: 'pin',
          name: 'Pin',
          partTemplateId: 'pin',
          position: { x: 5, y: -3, z: 2 },
          orientation: IDENTITY_QUAT,
          refs: {
            axis: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            base_plane: { kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
          },
        },
      ],
      mates: [
        {
          id: 'm_concentric',
          kind: 'concentric',
          a: { partId: 'pin', refId: 'axis', refKind: 'axis' },
          b: { partId: 'block', refId: 'boss_axis', refKind: 'axis' },
        },
        {
          id: 'm_seated',
          kind: 'coincident',
          a: { partId: 'pin', refId: 'base_plane', refKind: 'plane' },
          b: { partId: 'block', refId: 'top_plane', refKind: 'plane' },
        },
      ],
    };
    const r = await POST(makeReq({
      state,
      featureTrees: { block: TINY_TREE, pin: TINY_TREE },
      solver: 'gauss_seidel',
    }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.success).toBe(true);
    const pin = data.state.parts.find((part: { id: string }) => part.id === 'pin');
    expect(pin.position.x).toBeCloseTo(20, 6);
    expect(pin.position.y).toBeCloseTo(20, 6);
    expect(pin.position.z).toBeCloseTo(20, 6);
    expect(pin.refs.base_plane.kind).toBe('plane');
  });

  it('omitting featureTrees keeps the existing phase=stub path', async () => {
    // Re-uses the validState from above by inlining the same shape.
    const state: AssemblyState = {
      parts: [
        {
          id: 'p_base',
          name: 'Base',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'p_arm',
          name: 'Arm',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [],
    };
    const r = await POST(makeReq({ state }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('stub');
    expect(data.iterations).toBe(0);
  });

  it('rejects bad featureTrees shape with BAD_REQUEST', async () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'p',
          name: 'P',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };
    const r = await POST(
      makeReq({ state, featureTrees: { p: 'not-a-tree' } }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/featureTrees/i);
  });

  it('reports success=false + residuals > tol for an unsatisfiable system', async () => {
    // Two FIXED parts on a coincident point/point mate at different world
    // positions. Solver can't move either; residual = distance between the
    // two origin points = sqrt(100+0+0) = 10.
    const state: AssemblyState = {
      parts: [
        {
          id: 'a',
          name: 'A',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'b',
          name: 'B',
          partTemplateId: 'tpl',
          position: { x: 10, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [
        {
          id: 'co1',
          kind: 'coincident',
          a: { partId: 'a', refId: 'origin', refKind: 'point' },
          b: { partId: 'b', refId: 'origin', refKind: 'point' },
        },
      ],
    };
    const r = await POST(
      makeReq({
        state,
        featureTrees: { a: { nodes: [] }, b: { nodes: [] } },
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.success).toBe(false);
    expect(data.finalMaxResidual).toBeGreaterThan(0.01);
    // Per-mate residual matches the inter-origin distance.
    expect(data.residuals[0].residual).toBeCloseTo(10, 4);
  });

  it('respects maxIterations override (e.g., cap to 1)', async () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'p_base',
          name: 'Base',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'p_pin',
          name: 'Pin',
          partTemplateId: 'tpl',
          position: { x: 5, y: 3, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        {
          id: 'c1',
          kind: 'concentric',
          a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'p_pin', refId: 'z_axis', refKind: 'axis' },
        },
      ],
    };
    const r = await POST(
      makeReq({
        state,
        featureTrees: { p_base: { nodes: [] }, p_pin: { nodes: [] } },
        solverOptions: { maxIterations: 1 },
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    // Whether it converged in 1 iteration depends on the analytical
    // placement; the contract we care about is that iterations ≤ 1.
    expect(data.iterations).toBeLessThanOrEqual(1);
  });

  it('rejects invalid solverOptions (negative tolerance) with BAD_REQUEST', async () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'p',
          name: 'P',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };
    const r = await POST(
      makeReq({
        state,
        featureTrees: { p: { nodes: [] } },
        solverOptions: { tolerance: -1 },
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/solverOptions/i);
  });
});

// ─── Phase 3.2 solver-selection tests ────────────────────────────────────
//
// These tests exercise the solver dispatch + 'auto' decision tree. Rather
// than mocking the solver modules (which would couple the tests to the
// import topology), we run end-to-end on small fixtures and assert the
// `solverUsed` field the route reports.

/** Build a chain of N free parts pinned to a fixed base by N concentric
 *  mates on z_axis. Used to drive the 'auto' size threshold. */
function buildChain(n: number): { state: AssemblyState; trees: Record<string, FeatureTree> } {
  const parts = [
    {
      id: 'p0',
      name: 'P0',
      partTemplateId: 'tpl',
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
      fixed: true,
    },
    ...Array.from({ length: n - 1 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      partTemplateId: 'tpl',
      position: { x: (i + 1) * 2, y: (i + 1) * 1, z: 0 },
      orientation: IDENTITY_QUAT,
    })),
  ];
  const mates = Array.from({ length: n - 1 }, (_, i) => ({
    id: `m${i}`,
    kind: 'concentric' as const,
    a: { partId: `p${i}`, refId: 'z_axis', refKind: 'axis' as const },
    b: { partId: `p${i + 1}`, refId: 'z_axis', refKind: 'axis' as const },
  }));
  const trees: Record<string, FeatureTree> = {};
  for (const p of parts) trees[p.id] = { nodes: [] };
  return { state: { parts, mates }, trees };
}

describe('POST /api/assembly-solve — solver selection', () => {
  // Shared 2-part / 1-mate concentric fixture for "small system" tests.
  function twoPart(): { state: AssemblyState; trees: Record<string, FeatureTree> } {
    return {
      state: {
        parts: [
          {
            id: 'p_base',
            name: 'Base',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_pin',
            name: 'Pin',
            partTemplateId: 'tpl',
            position: { x: 5, y: 3, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'c1',
            kind: 'concentric',
            a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
            b: { partId: 'p_pin', refId: 'z_axis', refKind: 'axis' },
          },
        ],
      },
      trees: { p_base: { nodes: [] }, p_pin: { nodes: [] } },
    };
  }

  it("solver='gauss_seidel' runs iterativeSolve and reports solverUsed", async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'gauss_seidel' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.solverUsed).toBe('gauss_seidel');
    expect(data.success).toBe(true);
    expect(data.finalMaxResidual).toBeLessThan(1e-4);
    // Gauss-Seidel snaps the concentric in a single analytical sweep.
    expect(data.iterations).toBeLessThanOrEqual(2);
  });

  it("solver='lagrangian' runs lagrangianSolve and reports solverUsed", async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'lagrangian' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('lagrangian');
    expect(data.success).toBe(true);
    expect(data.finalMaxResidual).toBeLessThan(1e-4);
    // Newton-LM needs ≥ 1 actual Newton step for a non-trivial start;
    // distinguishes it from the Gauss-Seidel 1-shot.
    expect(data.iterations).toBeGreaterThanOrEqual(1);
  });

  it("solver='adaptive' runs lagrangianSolveAdaptive and reports solverUsed", async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'adaptive' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('adaptive');
    expect(data.success).toBe(true);
    expect(data.finalMaxResidual).toBeLessThan(1e-4);
  });

  it("solver='auto' on a 2-part single-concentric → resolves to 'gauss_seidel'", async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'auto' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    // recommendSolver returns 'gauss_seidel' (parts < 5, mates < 10, all
    // analytical, well-constrained) and the auto wrapper doesn't upgrade
    // (parts < 10, not over-constrained).
    expect(data.solverUsed).toBe('gauss_seidel');
    expect(data.success).toBe(true);
  });

  it("solver='auto' on a 10-part chain → upgrades to 'adaptive'", async () => {
    const { state, trees } = buildChain(10);
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'auto' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('adaptive');
  });

  it("solver='auto' on an over-constrained triangle → upgrades to 'adaptive'", async () => {
    // 3 cubes joined by a 3-mate cycle (a-b, b-c, c-a). One mate is
    // redundant given the other two → approximate DoF ≤ 0 → over-constrained.
    const state: AssemblyState = {
      parts: [
        {
          id: 'a',
          name: 'A',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'b',
          name: 'B',
          partTemplateId: 'tpl',
          position: { x: 5, y: 3, z: 0 },
          orientation: IDENTITY_QUAT,
        },
        {
          id: 'c',
          name: 'C',
          partTemplateId: 'tpl',
          position: { x: -4, y: 2, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        // 6 concentric mates on every axis pair so the DoF heuristic drops
        // below zero with only 3 parts — guaranteed over-constrained.
        { id: 'ab_z', kind: 'concentric',
          a: { partId: 'a', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'b', refId: 'z_axis', refKind: 'axis' } },
        { id: 'bc_z', kind: 'concentric',
          a: { partId: 'b', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'c', refId: 'z_axis', refKind: 'axis' } },
        { id: 'ca_z', kind: 'concentric',
          a: { partId: 'c', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'a', refId: 'z_axis', refKind: 'axis' } },
        { id: 'ab_x', kind: 'concentric',
          a: { partId: 'a', refId: 'x_axis', refKind: 'axis' },
          b: { partId: 'b', refId: 'x_axis', refKind: 'axis' } },
        { id: 'bc_x', kind: 'concentric',
          a: { partId: 'b', refId: 'x_axis', refKind: 'axis' },
          b: { partId: 'c', refId: 'x_axis', refKind: 'axis' } },
        { id: 'ca_x', kind: 'concentric',
          a: { partId: 'c', refId: 'x_axis', refKind: 'axis' },
          b: { partId: 'a', refId: 'x_axis', refKind: 'axis' } },
      ],
    };
    const trees: Record<string, FeatureTree> = {
      a: { nodes: [] }, b: { nodes: [] }, c: { nodes: [] },
    };
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'auto' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    // parts = 3 (< 10) but DoF ≤ 0 with mates > 0 → 'adaptive' upgrade.
    expect(data.solverUsed).toBe('adaptive');
  });

  it('omitting solver defaults to gauss_seidel (back-compat)', async () => {
    const { state, trees } = twoPart();
    // No `solver` field at all — matches the pre-Phase-3.2 client contract.
    const r = await POST(makeReq({ state, featureTrees: trees }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.solverUsed).toBe('gauss_seidel');
    expect(data.success).toBe(true);
  });

  it('response always includes the solverUsed field (real phase)', async () => {
    const { state, trees } = twoPart();
    const r = await POST(makeReq({ state, featureTrees: trees }) as never);
    const data = await r.json();
    expect(Object.prototype.hasOwnProperty.call(data, 'solverUsed')).toBe(true);
    expect(typeof data.solverUsed).toBe('string');
    expect(['gauss_seidel', 'lagrangian', 'adaptive']).toContain(data.solverUsed);
  });

  it('response includes solverUsed on the stub phase too (echo of request)', async () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'p_base',
          name: 'Base',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
      ],
      mates: [],
    };
    const r = await POST(makeReq({ state, solver: 'lagrangian' }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('stub');
    expect(data.solverUsed).toBe('lagrangian');
  });

  it('rejects an unknown solver value with BAD_REQUEST', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'newton_raphson' }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/solver/i);
  });

  it('rejects a non-string solver value with BAD_REQUEST', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 42 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/solver/i);
  });

  it("solver='auto' on a 6-part chain → resolves to 'lagrangian' (no adaptive upgrade)", async () => {
    // recommendSolver picks 'lagrangian' for ≥ 5 unfixed parts. buildChain(6)
    // has 1 fixed + 5 free = 5 unfixed → trips the size threshold. The auto
    // wrapper does NOT upgrade to 'adaptive' until total parts ≥ 10 OR
    // over-constrained — 6 parts well-constrained passes through as
    // 'lagrangian'.
    const { state, trees } = buildChain(6);
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'auto' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('lagrangian');
  });

  it("solver='auto' with advanced mate kind (gear) → resolves to 'lagrangian'", async () => {
    // recommendSolver returns 'lagrangian' for any mate kind outside the
    // Gauss-Seidel-analytical set (gear is one such kind). Auto wrapper
    // doesn't upgrade because parts < 10 and not over-constrained.
    const state: AssemblyState = {
      parts: [
        {
          id: 'p_base',
          name: 'Base',
          partTemplateId: 'tpl',
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
          fixed: true,
        },
        {
          id: 'p_gear',
          name: 'Gear',
          partTemplateId: 'tpl',
          position: { x: 5, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        {
          id: 'g1',
          kind: 'gear',
          a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
          b: { partId: 'p_gear', refId: 'z_axis', refKind: 'axis' },
          ratio: 2,
        },
      ],
    };
    const trees: Record<string, FeatureTree> = {
      p_base: { nodes: [] }, p_gear: { nodes: [] },
    };
    const r = await POST(
      makeReq({ state, featureTrees: trees, solver: 'auto' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('lagrangian');
  });

  it('passes solverOptions through to the lagrangian solver (maxIterations cap)', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({
        state,
        featureTrees: trees,
        solver: 'lagrangian',
        solverOptions: { maxIterations: 1 },
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('lagrangian');
    expect(data.iterations).toBeLessThanOrEqual(1);
  });
});

// ─── Phase 3.3.x grouped-solve tests ─────────────────────────────────────
//
// Verify that `useGroups: true` routes through partitionAssembly +
// solveByGroups and surfaces the new response fields (groups, groupResults,
// totalDurationMs) — while `useGroups` omitted preserves the existing
// single-solve response shape for full back-compat with pre-3.3.x clients.

/** Build N disjoint base+pin pairs joined by one concentric mate each.
 *  Each pair is its own connectivity island, so partitionAssembly returns
 *  N groups. Used to exercise multi-partition + maxParallel paths. */
function buildDisjointPairs(n: number): {
  state: AssemblyState;
  trees: Record<string, FeatureTree>;
} {
  const parts = [];
  const mates = [];
  const trees: Record<string, FeatureTree> = {};
  for (let i = 0; i < n; i++) {
    const baseId = `base_${i}`;
    const pinId = `pin_${i}`;
    parts.push({
      id: baseId,
      name: `Base ${i}`,
      partTemplateId: 'tpl',
      position: { x: i * 100, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
      fixed: true,
    });
    parts.push({
      id: pinId,
      name: `Pin ${i}`,
      partTemplateId: 'tpl',
      position: { x: i * 100 + 5, y: 3, z: 0 },
      orientation: IDENTITY_QUAT,
    });
    mates.push({
      id: `c_${i}`,
      kind: 'concentric' as const,
      a: { partId: baseId, refId: 'z_axis', refKind: 'axis' as const },
      b: { partId: pinId, refId: 'z_axis', refKind: 'axis' as const },
    });
    trees[baseId] = { nodes: [] };
    trees[pinId] = { nodes: [] };
  }
  return { state: { parts, mates }, trees };
}

describe('POST /api/assembly-solve — grouped-solve (useGroups)', () => {
  // Single connected concentric pair fixture — exactly 1 partition.
  function twoPart(): { state: AssemblyState; trees: Record<string, FeatureTree> } {
    return {
      state: {
        parts: [
          {
            id: 'p_base',
            name: 'Base',
            partTemplateId: 'tpl',
            position: { x: 0, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: true,
          },
          {
            id: 'p_pin',
            name: 'Pin',
            partTemplateId: 'tpl',
            position: { x: 5, y: 3, z: 0 },
            orientation: IDENTITY_QUAT,
          },
        ],
        mates: [
          {
            id: 'c1',
            kind: 'concentric',
            a: { partId: 'p_base', refId: 'z_axis', refKind: 'axis' },
            b: { partId: 'p_pin', refId: 'z_axis', refKind: 'axis' },
          },
        ],
      },
      trees: { p_base: { nodes: [] }, p_pin: { nodes: [] } },
    };
  }

  it('omitting useGroups → response shape unchanged (back-compat)', async () => {
    const { state, trees } = twoPart();
    const r = await POST(makeReq({ state, featureTrees: trees }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.solverUsed).toBe('gauss_seidel');
    expect(data.success).toBe(true);
    // The grouped-solve extras must NOT be present in the legacy path.
    expect(data).not.toHaveProperty('groups');
    expect(data).not.toHaveProperty('groupResults');
    expect(data).not.toHaveProperty('totalDurationMs');
  });

  it('useGroups=false (explicit) keeps response shape unchanged', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: false }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data).not.toHaveProperty('groups');
    expect(data).not.toHaveProperty('groupResults');
  });

  it('useGroups=true on a single-partition assembly → groups=1', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.success).toBe(true);
    expect(data.groups).toBe(1);
    expect(Array.isArray(data.groupResults)).toBe(true);
    expect(data.groupResults).toHaveLength(1);
    expect(typeof data.totalDurationMs).toBe('number');
    expect(data.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(data.finalMaxResidual).toBeLessThan(1e-4);
  });

  it('useGroups=true on multi-partition → groups>1, parallel solve', async () => {
    const { state, trees } = buildDisjointPairs(3);
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('real');
    expect(data.success).toBe(true);
    expect(data.groups).toBe(3);
    expect(data.groupResults).toHaveLength(3);
    // Each pin should have snapped onto its base's z_axis (x ≈ base.x, y ≈ 0).
    for (let i = 0; i < 3; i++) {
      const pin = data.state.parts.find((p: { id: string }) => p.id === `pin_${i}`);
      expect(pin).toBeDefined();
      expect(Math.abs(pin.position.x - i * 100)).toBeLessThan(1e-4);
      expect(Math.abs(pin.position.y)).toBeLessThan(1e-4);
    }
  });

  it('useGroups=true preserves original parts ordering in merged state', async () => {
    const { state, trees } = buildDisjointPairs(2);
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    const data = await r.json();
    const orderedIds = data.state.parts.map((p: { id: string }) => p.id);
    expect(orderedIds).toEqual(['base_0', 'pin_0', 'base_1', 'pin_1']);
  });

  it('maxParallel=1 forces sequential chunked execution but still solves all groups', async () => {
    // 5 disjoint pairs, maxParallel=1 → 5 sequential batches.
    const { state, trees } = buildDisjointPairs(5);
    const r = await POST(
      makeReq({
        state,
        featureTrees: trees,
        useGroups: true,
        maxParallel: 1,
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.success).toBe(true);
    expect(data.groups).toBe(5);
    expect(data.groupResults).toHaveLength(5);
  });

  it('maxParallel defaults to 4 when omitted (no explicit cap from client)', async () => {
    // Exercise the default-path branch by omitting maxParallel entirely.
    const { state, trees } = buildDisjointPairs(2);
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.groups).toBe(2);
    expect(data.success).toBe(true);
  });

  it('useGroups=true + solver=lagrangian passes solver-kind through to per-group dispatch', async () => {
    const { state, trees } = buildDisjointPairs(2);
    const r = await POST(
      makeReq({
        state,
        featureTrees: trees,
        useGroups: true,
        solver: 'lagrangian',
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('lagrangian');
    expect(data.groups).toBe(2);
    expect(data.success).toBe(true);
    // Newton-LM takes ≥ 1 iteration on a real Jacobian step.
    expect(data.iterations).toBeGreaterThanOrEqual(1);
  });

  it('useGroups=true + solver=adaptive routes to lagrangianSolveAdaptive per group', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({
        state,
        featureTrees: trees,
        useGroups: true,
        solver: 'adaptive',
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.solverUsed).toBe('adaptive');
    expect(data.groups).toBe(1);
    expect(data.success).toBe(true);
  });

  it('useGroups=true + solver=auto resolves auto BEFORE dispatching to per-group solver', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({
        state,
        featureTrees: trees,
        useGroups: true,
        solver: 'auto',
      }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    // 2-part / 1-concentric / well-constrained → auto = 'gauss_seidel'.
    expect(data.solverUsed).toBe('gauss_seidel');
    expect(data.groups).toBe(1);
  });

  it('rejects useGroups with a non-boolean value (BAD_REQUEST)', async () => {
    const { state, trees } = twoPart();
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: 'yes' }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/useGroups/i);
  });

  it('rejects maxParallel with a zero / negative / non-integer value', async () => {
    const { state, trees } = twoPart();
    for (const bad of [0, -1, 1.5, 'four', NaN]) {
      const r = await POST(
        makeReq({
          state,
          featureTrees: trees,
          useGroups: true,
          maxParallel: bad,
        }) as never,
      );
      expect(r.status).toBe(400);
      const data = await r.json();
      expect(data.code).toBe('BAD_REQUEST');
      expect(data.message).toMatch(/maxParallel/i);
    }
  });

  it('useGroups=true on a chain assembly (one big partition) → groups=1, all parts solved', async () => {
    // 4-part chain — all connected, so partition collapses to one group
    // regardless of how many parts/mates there are.
    const { state, trees } = buildChain(4);
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.groups).toBe(1);
    expect(data.success).toBe(true);
    expect(data.groupResults).toHaveLength(1);
  });

  it('useGroups=true on stub phase (no featureTrees) → stub path, no grouped-solve extras', async () => {
    // useGroups only takes effect on the real-solve path; the stub
    // response (deterministic zero-residual) is unchanged so pre-3.3.x
    // UIs see the exact same payload they always did.
    const { state } = twoPart();
    const r = await POST(
      makeReq({ state, useGroups: true }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.phase).toBe('stub');
    expect(data).not.toHaveProperty('groups');
    expect(data).not.toHaveProperty('groupResults');
    expect(data).not.toHaveProperty('totalDurationMs');
  });

  it('useGroups=true reports per-group residuals flattened in the residuals array', async () => {
    const { state, trees } = buildDisjointPairs(3);
    const r = await POST(
      makeReq({ state, featureTrees: trees, useGroups: true }) as never,
    );
    const data = await r.json();
    // Three pairs, one concentric mate each → 3 residual entries total.
    expect(data.residuals).toHaveLength(3);
    const mateIds = data.residuals.map((r: { mateId: string }) => r.mateId).sort();
    expect(mateIds).toEqual(['c_0', 'c_1', 'c_2']);
  });
});
