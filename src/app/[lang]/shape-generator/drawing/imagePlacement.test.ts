import { describe, it, expect } from 'vitest';
import {
  placeImages,
  summarize,
  type ImageInput,
  type BBox,
} from './imagePlacement';

const sheet: BBox = { min: { x: 0, y: 0 }, max: { x: 297, y: 210 } };

function image(id: string, anchor: ImageInput['anchor'], w: number = 100, h: number = 100, maxW?: number): ImageInput {
  const img: ImageInput = { id, src: `data:${id}`, naturalWidthPx: w, naturalHeightPx: h, anchor };
  if (maxW !== undefined) img.maxWidthMm = maxW;
  return img;
}

describe('placeImages', () => {
  it('empty input → empty output', () => {
    const r = placeImages([]);
    expect(r.placed).toEqual([]);
  });

  it('top-right anchored image placed in top-right corner', () => {
    const r = placeImages([image('logo', 'top-right', 100, 50, 50)], { sheetBBox: sheet });
    const p = r.placed[0]!;
    expect(p.origin.x).toBeGreaterThan(sheet.max.x / 2);
    expect(p.origin.y).toBeGreaterThan(sheet.max.y / 2);
  });

  it('center anchored image centered', () => {
    const r = placeImages([image('logo', 'center', 100, 100, 50)], { sheetBBox: sheet });
    const p = r.placed[0]!;
    const centerX = (sheet.min.x + sheet.max.x) / 2;
    expect(p.origin.x + p.widthMm / 2).toBeCloseTo(centerX, 1);
  });

  it('aspect ratio preserved', () => {
    const r = placeImages([image('img', 'top-left', 200, 100, 50)], { sheetBBox: sheet });
    const p = r.placed[0]!;
    expect(p.widthMm / p.heightMm).toBeCloseTo(2, 2);
  });

  it('overlap detection rejects overlapping image', () => {
    const r = placeImages([
      image('a', 'center', 100, 100, 100),
      image('b', 'center', 100, 100, 100),
    ], { sheetBBox: sheet, avoidOverlap: true });
    expect(r.placed).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });

  it('avoidOverlap=false allows overlap', () => {
    const r = placeImages([
      image('a', 'center', 100, 100, 100),
      image('b', 'center', 100, 100, 100),
    ], { sheetBBox: sheet, avoidOverlap: false });
    expect(r.placed).toHaveLength(2);
  });

  it('invalid dimensions rejected', () => {
    const r = placeImages([image('bad', 'center', 0, 0)]);
    expect(r.rejected).toHaveLength(1);
    expect(r.placed).toHaveLength(0);
  });

  it('zOrder higher placed first', () => {
    const a: ImageInput = { id: 'low', src: 'a', naturalWidthPx: 100, naturalHeightPx: 100, anchor: 'top-left', zOrder: 1 };
    const b: ImageInput = { id: 'high', src: 'b', naturalWidthPx: 100, naturalHeightPx: 100, anchor: 'top-right', zOrder: 10 };
    const r = placeImages([a, b]);
    expect(r.placed[0]!.id).toBe('high');
  });

  it('all 9 anchors place at distinct positions', () => {
    const anchors: ImageInput['anchor'][] = [
      'top-left', 'top-center', 'top-right',
      'middle-left', 'center', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ];
    const images = anchors.map((a, i) => image(`img-${i}`, a, 50, 50, 20));
    const r = placeImages(images, { sheetBBox: sheet, avoidOverlap: false });
    expect(r.placed).toHaveLength(9);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ placed: [], rejected: [] }, sheet);
    expect(s.placedCount).toBe(0);
    expect(s.sheetAreaCoveredFraction).toBe(0);
  });

  it('reports counts and coverage', () => {
    const r = placeImages([image('a', 'top-left', 100, 100, 50)], { sheetBBox: sheet });
    const s = summarize(r, sheet);
    expect(s.placedCount).toBe(1);
    expect(s.sheetAreaCoveredFraction).toBeGreaterThan(0);
    expect(s.sheetAreaCoveredFraction).toBeLessThan(0.5);
  });
});
