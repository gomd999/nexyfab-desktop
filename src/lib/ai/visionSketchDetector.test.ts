/**
 * visionSketchDetector — JSON→SketchEntities parsing + detector wiring.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSketchEntities,
  createVisionSketchDetector,
  VISION_SKETCH_PROMPT,
} from './visionSketchDetector';

describe('parseSketchEntities', () => {
  it('parses lines + circles + arcs into entities', () => {
    const e = parseSketchEntities(JSON.stringify({
      lines: [{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 10, y1: 0, x2: 10, y2: 10 }],
      circles: [{ cx: 5, cy: 5, r: 3 }],
      arcs: [{ cx: 0, cy: 0, r: 4, startDeg: 0, endDeg: 90 }],
    }));
    expect(e.lines).toHaveLength(2);
    expect(e.circles).toHaveLength(1);
    expect(e.circles[0]).toMatchObject({ cx: 5, cy: 5, radius: 3 });
    expect(e.arcs).toHaveLength(1);
    expect(e.arcs[0].startAngle).toBeCloseTo(0);
    expect(e.arcs[0].endAngle).toBeCloseTo(Math.PI / 2);
  });

  it('dedupes shared line endpoints into one point id', () => {
    // Two lines meeting at (10,0) → 3 unique points, and the shared corner
    // is the same point id on both lines.
    const e = parseSketchEntities(JSON.stringify({
      lines: [{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 10, y1: 0, x2: 10, y2: 10 }],
    }));
    expect(e.points).toHaveLength(3);
    expect(e.lines[0].p2).toBe(e.lines[1].p1); // shared corner
  });

  it('tolerates markdown fences + surrounding prose', () => {
    const reply = 'Here is the sketch:\n```json\n{"circles":[{"cx":1,"cy":2,"r":5}]}\n```\nDone.';
    const e = parseSketchEntities(reply);
    expect(e.circles).toHaveLength(1);
  });

  it('accepts radius/startAngle aliases (radians)', () => {
    const e = parseSketchEntities(JSON.stringify({
      circles: [{ cx: 0, cy: 0, radius: 2 }],
      arcs: [{ cx: 0, cy: 0, radius: 3, startAngle: 0, endAngle: Math.PI }],
    }));
    expect(e.circles[0].radius).toBe(2);
    expect(e.arcs[0].endAngle).toBeCloseTo(Math.PI);
  });

  it('skips invalid primitives (non-finite, zero-length, non-positive radius)', () => {
    const e = parseSketchEntities(JSON.stringify({
      lines: [{ x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 0, y1: 0, x2: 'x', y2: 1 }],
      circles: [{ cx: 0, cy: 0, r: -2 }, { cx: 1, cy: 1, r: 4 }],
    }));
    expect(e.lines).toHaveLength(0); // zero-length + bad coord both skipped
    expect(e.circles).toHaveLength(1); // negative radius skipped
  });

  it('throws on a reply with no JSON object', () => {
    expect(() => parseSketchEntities('I cannot see any shapes.')).toThrow(/no JSON/);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseSketchEntities('{ lines: [ }')).toThrow(/invalid JSON/);
  });
});

describe('createVisionSketchDetector', () => {
  it('passes the prompt to visionComplete and parses its reply', async () => {
    let seenPrompt = '';
    const detector = createVisionSketchDetector(async (_img, prompt) => {
      seenPrompt = prompt;
      return JSON.stringify({ circles: [{ cx: 0, cy: 0, r: 7 }] });
    });
    const e = await detector(new Uint8Array([1, 2, 3]));
    expect(seenPrompt).toBe(VISION_SKETCH_PROMPT);
    expect(e.circles[0].radius).toBe(7);
  });

  it('matches the sketchInferenceFromImage realDetector signature', async () => {
    const detector: (img: Uint8Array) => Promise<unknown> = createVisionSketchDetector(
      async () => '{"points":[{"x":1,"y":2}]}',
    );
    const e = (await detector(new Uint8Array())) as { points: unknown[] };
    expect(e.points).toHaveLength(1);
  });
});
