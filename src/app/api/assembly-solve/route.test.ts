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
