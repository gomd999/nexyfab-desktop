/**
 * Tests for sketchInferenceFromImage — Phase 1 mock-driven inference.
 *
 * Coverage targets:
 *   - input validation (empty, oversized, wrong type)
 *   - mockDetector delegation + tag synthesis for Uint8Array sources
 *   - realDetector delegation (with realDetector winning over mockDetector)
 *   - fallback grid (4 corner points) when no detector supplied
 *   - detectedShapes synthesis vs caller-supplied
 *   - detector throw / null-return semantics
 *   - entity-array normalization
 */
import { describe, it, expect, vi } from 'vitest';
import {
  inferSketchFromImage,
  IMAGE_INFERENCE_MAX_SIZE,
  type ImageInferenceOptions,
} from './sketchInferenceFromImage';
import type { SketchEntities } from '../sketch/sketchSvgExport';

const empty: SketchEntities = { points: [], lines: [], circles: [], arcs: [] };

describe('inferSketchFromImage — input validation', () => {
  it('rejects empty string source', async () => {
    const r = await inferSketchFromImage('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
    expect(r.entities).toBeUndefined();
  });

  it('rejects empty Uint8Array source', async () => {
    const r = await inferSketchFromImage(new Uint8Array(0));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });

  it('rejects oversized string source', async () => {
    const big = 'a'.repeat(IMAGE_INFERENCE_MAX_SIZE + 1);
    const r = await inferSketchFromImage(big);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/max size/);
  });

  it('rejects oversized Uint8Array source', async () => {
    const big = new Uint8Array(IMAGE_INFERENCE_MAX_SIZE + 1);
    const r = await inferSketchFromImage(big);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/max size/);
  });

  it('rejects non-string non-Uint8Array source', async () => {
    const r = await inferSketchFromImage(42 as unknown as string);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/string.*Uint8Array/);
  });

  it('rejects null source', async () => {
    const r = await inferSketchFromImage(null as unknown as string);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/null|undefined/);
  });
});

describe('inferSketchFromImage — mockDetector path', () => {
  it('calls mockDetector with the source string and returns its entities', async () => {
    const mockEntities: SketchEntities = {
      points: [{ id: 'mp1', x: 1, y: 2 }],
      lines: [],
      circles: [],
      arcs: [],
    };
    const mockDetector = vi.fn().mockReturnValue(mockEntities);
    const r = await inferSketchFromImage('data:image/png;base64,iVBOR', {
      mockDetector,
    });
    expect(r.ok).toBe(true);
    expect(mockDetector).toHaveBeenCalledOnce();
    expect(mockDetector).toHaveBeenCalledWith('data:image/png;base64,iVBOR');
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.points[0]).toEqual({ id: 'mp1', x: 1, y: 2 });
  });

  it('synthesizes <bytes:N> tag for Uint8Array sources', async () => {
    const mockDetector = vi.fn().mockReturnValue(empty);
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await inferSketchFromImage(bytes, { mockDetector });
    expect(mockDetector).toHaveBeenCalledWith('<bytes:4>');
  });

  it('returns error result when mockDetector throws', async () => {
    const mockDetector = vi.fn().mockImplementation(() => {
      throw new Error('detector boom');
    });
    const r = await inferSketchFromImage('img-data', { mockDetector });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mockDetector threw.*boom/);
    expect(r.entities).toBeUndefined();
  });

  it('treats mockDetector null return as empty entities (not error)', async () => {
    const mockDetector = vi.fn().mockReturnValue(null as unknown as SketchEntities);
    const r = await inferSketchFromImage('img-data', { mockDetector });
    expect(r.ok).toBe(true);
    expect(r.entities).toEqual(empty);
  });

  it('normalizes partial entity returns (fills missing arrays)', async () => {
    const mockDetector = vi.fn().mockReturnValue({
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 5 }],
      // intentionally omit points/lines/arcs
    } as unknown as SketchEntities);
    const r = await inferSketchFromImage('img', { mockDetector });
    expect(r.ok).toBe(true);
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.points).toEqual([]);
    expect(r.entities?.lines).toEqual([]);
    expect(r.entities?.arcs).toEqual([]);
  });
});

describe('inferSketchFromImage — fallback (no detector)', () => {
  it('emits 4 corner points when no detector supplied', async () => {
    const r = await inferSketchFromImage('any-img-data');
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(4);
    expect(r.entities?.lines).toEqual([]);
    expect(r.entities?.circles).toEqual([]);
    expect(r.entities?.arcs).toEqual([]);
  });

  it('fallback points form a unit-square (10×10 mm)', async () => {
    const r = await inferSketchFromImage('img');
    const pts = r.entities?.points ?? [];
    const coords = pts.map((p) => [p.x, p.y]);
    expect(coords).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('emits a warning when fallback is used', async () => {
    const r = await inferSketchFromImage('img');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => /fallback|wishlist/.test(w))).toBe(true);
  });

  it('fallback works for Uint8Array source too', async () => {
    const r = await inferSketchFromImage(new Uint8Array([1, 2, 3]));
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(4);
  });
});

describe('inferSketchFromImage — detectedShapes', () => {
  it('synthesizes detectedShapes from entity content (mock path)', async () => {
    const mockDetector = vi.fn().mockReturnValue({
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b', x1: 0, y1: 0, x2: 1, y2: 1 },
      ],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 3 }],
      arcs: [],
    } satisfies SketchEntities);
    const r = await inferSketchFromImage('img', { mockDetector });
    expect(r.detectedShapes).toBeDefined();
    const kinds = (r.detectedShapes ?? []).map((s) => s.kind).sort();
    expect(kinds).toEqual(['circle', 'line', 'point']);
    expect((r.detectedShapes ?? []).every((s) => s.confidence === 1.0)).toBe(true);
  });

  it('caller-supplied detectedShapes wins over auto-derived', async () => {
    const supplied = [
      { kind: 'rectangle', confidence: 0.92 },
      { kind: 'circle', confidence: 0.81 },
    ];
    const r = await inferSketchFromImage('img', {
      detectedShapes: supplied,
    });
    expect(r.detectedShapes).toEqual(supplied);
  });

  it('detectedShapes is empty array when entities are empty and none supplied', async () => {
    const mockDetector = vi.fn().mockReturnValue(empty);
    const r = await inferSketchFromImage('img', { mockDetector });
    expect(r.detectedShapes).toEqual([]);
  });

  it('fallback path produces a "point" detectedShape entry', async () => {
    const r = await inferSketchFromImage('img');
    const kinds = (r.detectedShapes ?? []).map((s) => s.kind);
    expect(kinds).toContain('point');
  });
});

describe('inferSketchFromImage — realDetector (Phase 2 plumbing)', () => {
  it('calls realDetector with decoded bytes and returns its entities', async () => {
    const real = vi.fn().mockResolvedValue({
      points: [{ id: 'rp1', x: 5, y: 5 }],
      lines: [],
      circles: [],
      arcs: [],
    } satisfies SketchEntities);
    const r = await inferSketchFromImage('img-source', { realDetector: real });
    expect(r.ok).toBe(true);
    expect(real).toHaveBeenCalledOnce();
    const arg = real.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(r.entities?.points).toHaveLength(1);
  });

  it('passes Uint8Array source through unchanged to realDetector', async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const real = vi.fn().mockResolvedValue(empty);
    await inferSketchFromImage(bytes, { realDetector: real });
    expect(real).toHaveBeenCalledWith(bytes);
  });

  it('realDetector wins when both real and mock are supplied', async () => {
    const real = vi.fn().mockResolvedValue({
      points: [{ id: 'real', x: 0, y: 0 }],
      lines: [],
      circles: [],
      arcs: [],
    } satisfies SketchEntities);
    const mock = vi.fn().mockReturnValue({
      points: [{ id: 'mock', x: 99, y: 99 }],
      lines: [],
      circles: [],
      arcs: [],
    } satisfies SketchEntities);
    const opts: ImageInferenceOptions = { realDetector: real, mockDetector: mock };
    const r = await inferSketchFromImage('img', opts);
    expect(real).toHaveBeenCalledOnce();
    expect(mock).not.toHaveBeenCalled();
    expect(r.entities?.points[0].id).toBe('real');
  });

  it('returns error result when realDetector rejects', async () => {
    const real = vi.fn().mockRejectedValue(new Error('cv pipeline failed'));
    const r = await inferSketchFromImage('img', { realDetector: real });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/realDetector threw.*cv pipeline/);
  });
});

describe('inferSketchFromImage — option pass-through', () => {
  it('accepts lineThreshold / minCircleRadius without error (Phase 2 wishlist)', async () => {
    const r = await inferSketchFromImage('img', {
      lineThreshold: 120,
      minCircleRadius: 8,
    });
    expect(r.ok).toBe(true);
    // Options are recorded for the future CV pipeline; Phase 1 doesn't act
    // on them but must not reject them.
  });
});
