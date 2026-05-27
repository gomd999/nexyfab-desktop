import { describe, it, expect } from 'vitest';
import {
  preflightPhotoSet,
  estimateAverageOverlap,
  estimateAngularCoverage,
  estimateIntrinsics,
  parseExifMinimal,
  sharpnessFromGradient,
  type PhotoMetadata,
} from './photogrammetryPreflight';

function makePhoto(filename: string, overrides: Partial<PhotoMetadata> = {}): PhotoMetadata {
  return {
    filename,
    widthPx: 4000,
    heightPx: 3000,
    focalLengthMm: 35,
    sensorWidthMm: 36,
    iso: 400,
    ...overrides,
  };
}

describe('preflightPhotoSet — verdicts', () => {
  it('insufficient photos → fail', () => {
    const photos = Array.from({ length: 5 }, (_, i) => makePhoto(`p${i}.jpg`));
    const r = preflightPhotoSet(photos);
    expect(r.verdict).toBe('fail');
  });

  it('many quality photos around an orbit → pass', () => {
    const photos = Array.from({ length: 30 }, (_, i) => makePhoto(`p${i}.jpg`, {
      bearingDeg: (i / 30) * 360,
      sharpnessScore: 0.8,
    }));
    const r = preflightPhotoSet(photos);
    expect(r.verdict).toBe('pass');
  });

  it('reports per-photo issues for low resolution', () => {
    const photos = Array.from({ length: 25 }, (_, i) => makePhoto(`p${i}.jpg`, {
      widthPx: 800, heightPx: 600,
      bearingDeg: (i / 25) * 360,
    }));
    const r = preflightPhotoSet(photos);
    expect(r.photoIssues.length).toBeGreaterThan(0);
  });

  it('flags high ISO photos', () => {
    const photos = Array.from({ length: 25 }, (_, i) => makePhoto(`p${i}.jpg`, {
      iso: 6400, bearingDeg: (i / 25) * 360,
    }));
    const r = preflightPhotoSet(photos);
    expect(r.photoIssues.some(p => p.issues.some(i => i.includes('ISO')))).toBe(true);
  });
});

describe('estimateAverageOverlap', () => {
  it('photos spaced evenly across 360° give a sane fraction', () => {
    const photos = Array.from({ length: 36 }, (_, i) => makePhoto(`p${i}.jpg`, { bearingDeg: i * 10 }));
    const overlap = estimateAverageOverlap(photos);
    expect(overlap).toBeGreaterThan(0.7);
  });

  it('wide-spaced photos → low overlap', () => {
    const photos = Array.from({ length: 6 }, (_, i) => makePhoto(`p${i}.jpg`, { bearingDeg: i * 60 }));
    const overlap = estimateAverageOverlap(photos);
    expect(overlap).toBeLessThan(0.3);
  });

  it('< 2 photos → 0', () => {
    expect(estimateAverageOverlap([])).toBe(0);
  });
});

describe('estimateAngularCoverage', () => {
  it('full orbit → 360° coverage', () => {
    const photos = Array.from({ length: 36 }, (_, i) => makePhoto(`p${i}.jpg`, { bearingDeg: i * 10 }));
    const cov = estimateAngularCoverage(photos);
    expect(cov).toBeGreaterThan(340);
  });

  it('half orbit → ~180°', () => {
    const photos = Array.from({ length: 18 }, (_, i) => makePhoto(`p${i}.jpg`, { bearingDeg: i * 10 }));
    const cov = estimateAngularCoverage(photos);
    expect(cov).toBeLessThan(280);
  });
});

describe('estimateIntrinsics', () => {
  it('computes focalLengthPx', () => {
    const i = estimateIntrinsics(makePhoto('p.jpg', { focalLengthMm: 50, sensorWidthMm: 36, widthPx: 6000 }));
    expect(i?.focalLengthPx).toBeCloseTo(50 / 36 * 6000, 2);
  });

  it('null when EXIF missing', () => {
    expect(estimateIntrinsics(makePhoto('p.jpg', { focalLengthMm: undefined }))).toBeNull();
  });

  it('principal point at image center', () => {
    const i = estimateIntrinsics(makePhoto('p.jpg', { widthPx: 4000, heightPx: 3000 }));
    expect(i?.principalPointPx).toEqual([2000, 1500]);
  });
});

describe('parseExifMinimal', () => {
  it('rejects non-JPEG', () => {
    expect(parseExifMinimal(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  it('returns stub for valid JPEG header', () => {
    expect(parseExifMinimal(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).not.toBeNull();
  });
});

describe('sharpnessFromGradient', () => {
  it('high stddev → high sharpness', () => {
    expect(sharpnessFromGradient(10, 50)).toBeGreaterThan(0.5);
  });

  it('flat image → low sharpness', () => {
    expect(sharpnessFromGradient(10, 1)).toBeLessThan(0.5);
  });

  it('clamps to [0, 1]', () => {
    expect(sharpnessFromGradient(10, 1000)).toBeLessThanOrEqual(1);
  });
});
