import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDrawingKey, classify239Zip, validate239LabelDocument } from './audit-239-drawing-corpus.mjs';

test('classifies the fixed 239 archive naming convention', () => {
  assert.deepEqual(classify239Zip('TS_STR_2.zip'), { split: 'training', kind: 'source', track: 'STR' });
  assert.deepEqual(classify239Zip('VL_OCR.zip'), { split: 'validation', kind: 'label', track: 'OCR' });
  assert.equal(classify239Zip('random.zip'), null);
});

test('canonicalizes tracks for split-leakage checks', () => {
  assert.equal(canonicalDrawingKey('APT_CS_STR_091444865.PNG'), 'APT_CS_TRACK_091444865');
  assert.equal(canonicalDrawingKey('/x/APT_CS_OCR_091444865.png'), 'APT_CS_TRACK_091444865');
});

test('accepts a valid track-specific COCO label', () => {
  const document = {
    categories: [{ id: 11, name: '구조_벽체' }],
    images: [{ id: 1, width: 100, height: 100, file_name: 'APT_FP_STR_1.PNG' }],
    annotations: [{ id: 1, image_id: 1, category_id: 11, bbox: [1, 2, 20, 30], segmentation: [[1, 2, 21, 2, 21, 32]], attributes: {} }],
  };
  assert.deepEqual(validate239LabelDocument(document, 'STR'), { issues: [], imageFileNames: ['APT_FP_STR_1.PNG'] });
});

test('rejects cross-track labels and geometry outside the image', () => {
  const document = {
    categories: [{ id: 4, name: '객체_변기' }],
    images: [{ id: 1, width: 100, height: 100, file_name: 'APT_FP_STR_1.PNG' }],
    annotations: [{ id: 1, image_id: 1, category_id: 4, bbox: [90, 90, 20, 20], segmentation: [[1, 2, 3]], attributes: {} }],
  };
  const issues = validate239LabelDocument(document, 'STR').issues.join(' ');
  assert.match(issues, /bbox outside image/);
  assert.match(issues, /invalid polygon/);
  assert.match(issues, /does not belong to STR/);
});
