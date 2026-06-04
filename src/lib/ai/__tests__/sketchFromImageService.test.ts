/**
 * sketchFromImageService — decode/validate/infer core for the image→sketch
 * endpoint. Detector injected so no vision round-trip.
 */
import { describe, it, expect, vi } from 'vitest';
import { runSketchFromImage } from '../sketchFromImageService';
import type { SketchEntities } from '../../sketch/sketchSvgExport';

const emptyEntities = (): SketchEntities => ({ points: [], lines: [], circles: [], arcs: [] });
const oneLine = (): SketchEntities => ({
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
  lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 10, y2: 0 }],
  circles: [],
  arcs: [],
});

// A tiny valid base64 (3 bytes).
const tinyB64 = Buffer.from([1, 2, 3]).toString('base64');

describe('runSketchFromImage', () => {
  it('rejects a missing image', async () => {
    const r = await runSketchFromImage({ imageBase64: '' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('IMAGE_REQUIRED');
  });

  it('rejects an undecodable image (decodes to zero bytes)', async () => {
    // '@@@@' has no valid base64 chars → Buffer.from yields 0 bytes → decode null.
    const r = await runSketchFromImage({ imageBase64: '@@@@', detector: async () => emptyEntities() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('rejects an oversized image', async () => {
    const r = await runSketchFromImage({ imageBase64: tinyB64, maxBytes: 1, detector: async () => emptyEntities() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('IMAGE_TOO_LARGE');
    expect(r.imageBytes).toBe(3);
  });

  it('runs the injected detector and returns its entities', async () => {
    const detector = vi.fn<(image: Uint8Array) => Promise<SketchEntities>>(async () => oneLine());
    const r = await runSketchFromImage({ imageBase64: tinyB64, detector });
    expect(r.ok).toBe(true);
    expect(detector).toHaveBeenCalledTimes(1);
    expect(detector.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(r.entities!.lines).toHaveLength(1);
    expect(r.imageBytes).toBe(3);
  });

  it('surfaces a detector failure as INFER_FAILED (does not throw)', async () => {
    const detector = vi.fn<(image: Uint8Array) => Promise<SketchEntities>>(async () => {
      throw new Error('vision provider down');
    });
    const r = await runSketchFromImage({ imageBase64: tinyB64, detector });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INFER_FAILED');
    expect(r.error).toMatch(/vision provider down|inference/i);
  });

  it('accepts a data-URL prefixed image', async () => {
    const detector = vi.fn<(image: Uint8Array) => Promise<SketchEntities>>(async () => oneLine());
    const r = await runSketchFromImage({ imageBase64: `data:image/png;base64,${tinyB64}`, detector });
    expect(r.ok).toBe(true);
    expect(r.entities!.lines).toHaveLength(1);
  });
});
