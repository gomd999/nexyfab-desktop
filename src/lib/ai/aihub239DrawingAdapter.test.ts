import { describe, expect, it } from 'vitest';
import { adaptAihub239Track, mergeAihub239Tracks } from './aihub239DrawingAdapter';

const categories = [{ id: 11, name: '구조_벽체' }, { id: 21, name: 'OCR' }];
function document(track: string, categoryId = 11) {
  return {
    categories,
    images: [{ id: 1, width: 100, height: 80, file_name: `APT_FP_${track}_123.PNG` }],
    annotations: [{ id: 7, image_id: 1, category_id: categoryId, segmentation: [[1, 2, 20, 2, 20, 10]], bbox: [1, 2, 19, 8], attributes: categoryId === 21 ? { OCR: 'A-A' } : {} }],
  };
}

describe('AI Hub 239 drawing adapter', () => {
  it('adapts one audited COCO track with provenance', () => {
    const result = adaptAihub239Track(document('STR'), 'STR', 'VL_STR.zip:/APT_FP_STR_123.json');
    expect(result.issues).toEqual([]);
    expect(result.drawingKey).toBe('APT_FP_TRACK_123');
    expect(result.annotations[0]).toMatchObject({ id: 'str-7', track: 'STR', sourceRef: 'VL_STR.zip:/APT_FP_STR_123.json' });
  });

  it('marks quarantined source references without deleting them', () => {
    const source = 'bad.json';
    const result = adaptAihub239Track(document('STR'), 'STR', source, new Set([source]));
    expect(result.annotations[0]?.quarantined).toBe(true);
  });

  it('refuses to merge different drawings', () => {
    const tracks = [
      adaptAihub239Track(document('STR'), 'STR', 'str'),
      adaptAihub239Track(document('SPA'), 'SPA', 'spa'),
      adaptAihub239Track(document('OBJ'), 'OBJ', 'obj'),
      adaptAihub239Track(document('OCR', 21), 'OCR', 'ocr'),
    ];
    tracks[1]!.drawingKey = 'OTHER_TRACK_999';
    const merged = mergeAihub239Tracks(tracks);
    expect(merged.annotations).toEqual([]);
    expect(merged.issues.join(' ')).toContain('do not share one drawing key');
  });
});
