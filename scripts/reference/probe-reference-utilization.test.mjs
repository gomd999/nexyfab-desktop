import assert from 'node:assert/strict';
import test from 'node:test';
import { admitReferenceImport, probeReferenceSignature, referenceProbeFailureReason } from './probe-reference-utilization.mjs';

const bytes = value => new TextEncoder().encode(value);

test('accepts standard STEP and numeric-header SAT without granting deeper accuracy', () => {
  assert.equal(probeReferenceSignature('step', bytes('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;'), 40), true);
  assert.equal(probeReferenceSignature('sat', bytes('700 0 15 0\r\n19 Autodesk Revit 2019 20 ASM 224.4'), 50), true);
});
test('identifies common files masquerading as STEP', () => {
  const stl = bytes('STL file generated from eDrawings');
  const creo = bytes('#UGC:2 PART 2552 2120');
  assert.equal(probeReferenceSignature('step', stl, stl.length), false);
  assert.equal(referenceProbeFailureReason('step', stl), 'extension_mismatch_detected_stl');
  assert.equal(referenceProbeFailureReason('step', creo), 'extension_mismatch_detected_creo_native');
  assert.deepEqual(admitReferenceImport('step', stl), { admitted: false, reason: 'extension_mismatch_detected_stl' });
  assert.deepEqual(admitReferenceImport('step', creo), { admitted: false, reason: 'extension_mismatch_detected_creo_native' });
});

test('rejects a binary STL masquerading as STEP before importer admission', () => {
  const triangleCount = 1;
  const binaryStl = new Uint8Array(84 + triangleCount * 50);
  new DataView(binaryStl.buffer).setUint32(80, triangleCount, true);
  assert.equal(probeReferenceSignature('step', binaryStl, binaryStl.length), false);
  assert.deepEqual(admitReferenceImport('.step', binaryStl), { admitted: false, reason: 'extension_mismatch_detected_stl' });
  assert.deepEqual(admitReferenceImport('step', binaryStl.subarray(0, 84), binaryStl.length), { admitted: false, reason: 'extension_mismatch_detected_stl' });
});
