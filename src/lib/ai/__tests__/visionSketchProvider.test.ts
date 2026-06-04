/**
 * visionSketchProvider — the seam binding the pure sketch detector to the real
 * provider vision call (A3, ADR-013). The vision call is injected so we test the
 * adapter without a network round-trip.
 */
import { describe, it, expect, vi } from 'vitest';
import { anthropicVisionComplete, createRealVisionSketchDetector } from '../visionSketchProvider';
import type { VisionRequest, VisionResponse } from '../vision';

function fakeResponse(text: string): VisionResponse {
  return { text, provider: 'anthropic', model: 'claude-test', latencyMs: 1 };
}

const SAMPLE_REPLY = JSON.stringify({
  lines: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
  circles: [{ cx: 5, cy: 5, r: 3 }],
  arcs: [],
});

describe('anthropicVisionComplete', () => {
  it('forwards the image + prompt as a one-image request and returns the text', async () => {
    const complete = vi.fn<(req: VisionRequest) => Promise<VisionResponse>>(async () => fakeResponse('hello'));
    const vc = anthropicVisionComplete({ complete });
    const img = new Uint8Array([1, 2, 3]);
    const out = await vc(img, 'detect the sketch');

    expect(out).toBe('hello');
    expect(complete).toHaveBeenCalledTimes(1);
    const req = complete.mock.calls[0][0];
    expect(req.prompt).toBe('detect the sketch');
    expect(req.images).toHaveLength(1);
    expect(req.images[0].bytes).toBe(img);
    expect(req.maxTokens).toBe(1500); // sketch-JSON default, larger than a critique
  });

  it('passes provider / model / token overrides through', async () => {
    const complete = vi.fn<(req: VisionRequest) => Promise<VisionResponse>>(async () => fakeResponse('x'));
    const vc = anthropicVisionComplete({ complete, provider: 'openai', model: 'gpt-4o', maxTokens: 800 });
    await vc(new Uint8Array([0]), 'p');
    const req = complete.mock.calls[0][0];
    expect(req.provider).toBe('openai');
    expect(req.model).toBe('gpt-4o');
    expect(req.maxTokens).toBe(800);
  });
});

describe('createRealVisionSketchDetector', () => {
  it('parses the model reply into SketchEntities (end-to-end through the seam)', async () => {
    const complete = vi.fn<(req: VisionRequest) => Promise<VisionResponse>>(async () => fakeResponse(SAMPLE_REPLY));
    const detect = createRealVisionSketchDetector({ complete });
    const entities = await detect(new Uint8Array([9, 9, 9]));

    expect(entities.lines).toHaveLength(1);
    expect(entities.lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(entities.points).toHaveLength(2); // both line endpoints interned
    expect(entities.circles).toHaveLength(1);
    expect(entities.circles[0]).toMatchObject({ cx: 5, cy: 5, radius: 3 });
  });

  it('propagates a vision-call failure (caller falls back to the grid detector)', async () => {
    const complete = vi.fn<(req: VisionRequest) => Promise<VisionResponse>>(async () => {
      throw new Error('no provider key');
    });
    const detect = createRealVisionSketchDetector({ complete });
    await expect(detect(new Uint8Array([1]))).rejects.toThrow(/no provider key/);
  });
});
