/**
 * X1 (B-rep parallel) — verify_spec_brep tool executor tests.
 *
 * Mirrors verifySpecTool.test.ts but drives the verification chain from a
 * B-rep handle through a mock BrepAdapter that ships positions back as if
 * OCCT had tessellated the part. Locks the SSE bridge contract by
 * asserting the result.meta carries the same field names as verify_spec.
 */

import { describe, it, expect } from 'vitest';
import { makeTools, type ToolHostAdapters, type BrepAdapter } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';

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

/**
 * Build a non-indexed cube of side `s` centred at the origin (12 tris,
 * 36 verts). Matches the convention faceInspection consumes: each triangle
 * occupies 9 consecutive floats with consistent outward winding so genus,
 * surface area, and volume math all return the textbook values.
 */
function cubePositions(s: number): Float32Array {
  const h = s / 2;
  // 8 corners
  const c = [
    [-h, -h, -h], [ h, -h, -h], [ h,  h, -h], [-h,  h, -h], // 0..3 bottom
    [-h, -h,  h], [ h, -h,  h], [ h,  h,  h], [-h,  h,  h], // 4..7 top
  ];
  // 12 triangles (CCW outward).
  const tris: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], // bottom (−Z)
    [4, 5, 6], [4, 6, 7], // top    (+Z)
    [0, 1, 5], [0, 5, 4], // front  (−Y)
    [2, 3, 7], [2, 7, 6], // back   (+Y)
    [1, 2, 6], [1, 6, 5], // right  (+X)
    [3, 0, 4], [3, 4, 7], // left   (−X)
  ];
  const positions = new Float32Array(tris.length * 9);
  for (let t = 0; t < tris.length; t++) {
    for (let v = 0; v < 3; v++) {
      const vi = tris[t]![v]!;
      positions[t * 9 + v * 3 + 0] = c[vi]![0]!;
      positions[t * 9 + v * 3 + 1] = c[vi]![1]!;
      positions[t * 9 + v * 3 + 2] = c[vi]![2]!;
    }
  }
  return positions;
}

/**
 * Mock BrepAdapter that returns the given positions/bbox for whatever
 * handle is asked. When `withMeshGeometry` is false the toMeshGeometry
 * method is omitted entirely so the tool exercises the NO_BREP_MESH path.
 */
function mockBrepAdapter(opts: {
  positions?: Float32Array;
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  withMeshGeometry?: boolean;
}): BrepAdapter {
  const base: BrepAdapter = {
    async ensureReady() { /* noop */ },
    async primitive(args) {
      return { ok: true, handle: 'mock:1', kind: `${args.shape}:mock` };
    },
    async boolean(args) {
      return { ok: true, handle: 'mock:2', kind: `boolean(${args.op})` };
    },
    async fillet() {
      return { ok: true, handle: 'mock:3', kind: 'fillet' };
    },
    async chamfer() {
      return { ok: true, handle: 'mock:4', kind: 'chamfer' };
    },
    async shell() {
      return { ok: true, handle: 'mock:5', kind: 'shell' };
    },
    async toMesh() {
      return { ok: true, triangleCount: 12, bbox: opts.bbox ?? { min: [-25, -25, -25], max: [25, 25, 25] } };
    },
    async exportStep() {
      return { ok: true, bytes: 8192 };
    },
  };
  if (opts.withMeshGeometry !== false) {
    base.toMeshGeometry = async () => {
      const positions = opts.positions ?? cubePositions(50);
      const bbox = opts.bbox ?? { min: [-25, -25, -25] as [number, number, number], max: [25, 25, 25] as [number, number, number] };
      return {
        ok: true,
        positions,
        triangleCount: positions.length / 9,
        bbox,
      };
    };
  }
  return base;
}

function hostWith(brep: BrepAdapter): ToolHostAdapters {
  return {
    render: async () => ({ ok: true, errors: [], stlBytes: 100, triangles: 12, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12 }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
    brep,
  };
}

function tool(
  tools: ReturnType<typeof makeTools>,
  name: 'verify_spec_brep',
): ToolExecutor {
  return tools[name]!;
}

function asErr(r: ToolResult): { ok: false; error: string; code?: string } {
  if (r.ok) throw new Error('expected error result');
  return r;
}
function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}

describe('verify_spec_brep tool', () => {
  it('returns NO_BREP when the handle is not in session.brepEntries', async () => {
    const tools = makeTools(hostWith(mockBrepAdapter({})));
    const session = blankSession();
    const out = asErr(
      await tool(tools, 'verify_spec_brep')(
        {
          brepHandle: 'unknown-handle',
          intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        },
        session,
      ),
    );
    expect(out.code).toBe('NO_BREP');
  });

  it('returns NO_BREP_MESH when the adapter has no toMeshGeometry method', async () => {
    const adapter = mockBrepAdapter({ withMeshGeometry: false });
    const tools = makeTools(hostWith(adapter));
    const session = blankSession();
    session.brepEntries.push({ handle: 'mock:1', kind: 'box:mock', ts: Date.now() });
    const out = asErr(
      await tool(tools, 'verify_spec_brep')(
        {
          brepHandle: 'mock:1',
          intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        },
        session,
      ),
    );
    expect(out.code).toBe('NO_BREP_MESH');
  });

  it('returns BAD_ARGS when intent is missing or malformed', async () => {
    const tools = makeTools(hostWith(mockBrepAdapter({})));
    const session = blankSession();
    session.brepEntries.push({ handle: 'mock:1', kind: 'box:mock', ts: Date.now() });
    const missing = asErr(
      await tool(tools, 'verify_spec_brep')({ brepHandle: 'mock:1' }, session),
    );
    expect(missing.code).toBe('BAD_ARGS');
    const badShape = asErr(
      await tool(tools, 'verify_spec_brep')(
        { brepHandle: 'mock:1', intent: { params: { width: 50 } } },
        session,
      ),
    );
    expect(badShape.code).toBe('BAD_ARGS');
    const missingHandle = asErr(
      await tool(tools, 'verify_spec_brep')(
        { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
        session,
      ),
    );
    expect(missingHandle.code).toBe('BAD_ARGS');
  });

  it('happy path: clean cube intent vs clean cube mesh → ok, verifiable, passed', async () => {
    const tools = makeTools(hostWith(mockBrepAdapter({})));
    const session = blankSession();
    session.brepEntries.push({ handle: 'mock:1', kind: 'box:mock', ts: Date.now() });
    const out = asOk(
      await tool(tools, 'verify_spec_brep')(
        {
          brepHandle: 'mock:1',
          intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        },
        session,
      ),
    );
    expect(out.meta?.verifiable).toBe(true);
    expect(out.meta?.passed).toBe(true);
    expect(session.verifiedBrepHandles?.['mock:1']).toBe(true);
    expect(out.meta?.mismatchCount).toBe(0);
    expect(out.output).toMatch(/spec ok/);
  });

  it('failure path: cube intent (50³) vs mesh that is actually 25³ → bbox mismatches reported', async () => {
    const tools = makeTools(
      hostWith(
        mockBrepAdapter({
          positions: cubePositions(25),
          bbox: { min: [-12.5, -12.5, -12.5], max: [12.5, 12.5, 12.5] },
        }),
      ),
    );
    const session = blankSession();
    session.brepEntries.push({ handle: 'mock:1', kind: 'box:mock', ts: Date.now() });
    const out = asOk(
      await tool(tools, 'verify_spec_brep')(
        {
          brepHandle: 'mock:1',
          intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        },
        session,
      ),
    );
    expect(out.meta?.passed).toBe(false);
    expect(out.meta?.mismatchCount).toBe(3); // width / height / depth all off
    expect(out.output).toMatch(/spec mismatch/);
    expect(out.output).toMatch(/width.*expected 50\.00.*measured 25\.00/);
  });

  it('result.meta matches the verify_spec SSE bridge contract (same field names)', async () => {
    const tools = makeTools(hostWith(mockBrepAdapter({})));
    const session = blankSession();
    session.brepEntries.push({ handle: 'mock:1', kind: 'box:mock', ts: Date.now() });
    const out = asOk(
      await tool(tools, 'verify_spec_brep')(
        {
          brepHandle: 'mock:1',
          intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } },
        },
        session,
      ),
    );
    // These exact names are what the ScadAgentPanel SSE bridge inspects
    // when forwarding the critique to OpenScadPanel — locking them here
    // keeps the B-rep path interchangeable with the SCAD-path verify_spec.
    const meta = out.meta!;
    expect(meta).toHaveProperty('verifiable');
    expect(meta).toHaveProperty('passed');
    expect(meta).toHaveProperty('mismatchCount');
    expect(meta).toHaveProperty('expected');
    expect(meta).toHaveProperty('measured');
    // Brep-only extras for traceability — present but optional.
    expect(meta.brepHandle).toBe('mock:1');
    expect(meta.brepKind).toBe('box:mock');
    expect(typeof meta.triangleCount).toBe('number');
  });
});
