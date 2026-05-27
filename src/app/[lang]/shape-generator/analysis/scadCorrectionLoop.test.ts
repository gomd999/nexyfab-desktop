import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { runScadCorrectionLoop } from './scadCorrectionLoop';

function box(s = 20): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s, s, s);
  g.computeVertexNormals();
  return g;
}
function openBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const pos = g.attributes.position.array as Float32Array;
  const kept = pos.slice(0, pos.length - 2 * 9); // drop a face → open boundary
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(kept, 3));
  o.computeVertexNormals();
  return o;
}
function twoBoxes(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const b = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
  b.translate(100, 0, 0); // far apart → two disjoint shells
  const ap = a.attributes.position.array as Float32Array;
  const bp = b.attributes.position.array as Float32Array;
  const merged = new Float32Array(ap.length + bp.length);
  merged.set(ap, 0);
  merged.set(bp, ap.length);
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  o.computeVertexNormals();
  return o;
}

describe('runScadCorrectionLoop', () => {
  it('passes on the first attempt when the model is sound', async () => {
    const generate = vi.fn(async () => 'cube(20);');
    const render = vi.fn(async () => box());
    const r = await runScadCorrectionLoop({ generate, render });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(r.geometry).toBeDefined();
  });

  it('feeds the critique back and converges once the model fixes it', async () => {
    // Attempt 1 renders an open mesh (verification error); attempt 2 a solid.
    const render = vi.fn()
      .mockResolvedValueOnce(openBox())
      .mockResolvedValueOnce(box());
    const generate = vi.fn(async () => 'code');
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 3 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    // Second generate call received the watertight critique.
    expect(generate).toHaveBeenNthCalledWith(2, 'code', expect.stringMatching(/not watertight/i), 2);
  });

  it('gives up after maxAttempts, returning the blocking critique', async () => {
    const generate = vi.fn(async () => 'bad');
    const render = vi.fn(async () => openBox()); // never watertight
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 2 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.finalCritique).toMatch(/not watertight/i);
    expect(r.history).toHaveLength(2);
  });

  it('treats a render exception as a blocking error fed back to the model', async () => {
    const render = vi.fn()
      .mockRejectedValueOnce(new Error('syntax error: line 3'))
      .mockResolvedValueOnce(box());
    const generate = vi.fn(async () => 'code');
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 3 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(generate).toHaveBeenNthCalledWith(2, 'code', expect.stringMatching(/RENDER ERROR: syntax error/), 2);
  });

  it('first generate call gets null prior + null critique', async () => {
    const generate = vi.fn(async () => 'cube(20);');
    await runScadCorrectionLoop({ generate, render: async () => box() });
    expect(generate).toHaveBeenNthCalledWith(1, null, null, 1);
  });

  it('honours size constraints in the verification gate', async () => {
    const generate = vi.fn(async () => 'big');
    const render = vi.fn(async () => box(500)); // 500mm
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 1, constraints: { maxSizeMm: 100 } });
    expect(r.ok).toBe(false);
    expect(r.finalCritique).toMatch(/exceeds the limit/);
  });

  // ─── New constraints + warning semantics ──────────────────────────────────

  it('requireSingleBody: rejects a multi-piece model and repairs it', async () => {
    // Attempt 1 renders two disjoint boxes (single-body ERROR); attempt 2 one box.
    const render = vi.fn()
      .mockResolvedValueOnce(twoBoxes())
      .mockResolvedValueOnce(box());
    const generate = vi.fn(async () => 'code');
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 3, constraints: { requireSingleBody: true } });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    // The single-body critique was fed back to the second generate call.
    expect(generate).toHaveBeenNthCalledWith(2, 'code', expect.stringMatching(/separate pieces/), 2);
  });

  it('requireSingleBody gives up after maxAttempts on a persistently split model', async () => {
    const generate = vi.fn(async () => 'bad');
    const render = vi.fn(async () => twoBoxes());
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 2, constraints: { requireSingleBody: true } });
    expect(r.ok).toBe(false);
    expect(r.finalCritique).toMatch(/separate pieces/);
  });

  it('maxTriangles is advisory: a heavy mesh still converges, surfaced as warnings', async () => {
    const generate = vi.fn(async () => 'cube(20);');
    const render = vi.fn(async () => box()); // 12 triangles
    const r = await runScadCorrectionLoop({ generate, render }, { maxAttempts: 2, constraints: { maxTriangles: 4 } });
    // Warning-only → accepted on the first attempt (no retry, no failure).
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.warnings).toMatch(/triangles/);
  });

  it('a clean model has empty warnings', async () => {
    const r = await runScadCorrectionLoop({ generate: async () => 'cube(20);', render: async () => box() });
    expect(r.ok).toBe(true);
    expect(r.warnings).toBe('');
  });
});
