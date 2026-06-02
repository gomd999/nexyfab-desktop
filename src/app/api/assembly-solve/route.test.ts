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
