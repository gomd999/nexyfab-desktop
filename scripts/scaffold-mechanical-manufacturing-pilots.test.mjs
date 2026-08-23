import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMechanicalManufacturingPilotWorkbook, main } from './scaffold-mechanical-manufacturing-pilots.mjs';

test('creates exactly the three required process work slots without fabricated evidence', () => {
  const workbook = buildMechanicalManufacturingPilotWorkbook('2026-08-11T00:00:00.000Z');
  assert.deepEqual(workbook.cases.map(item => item.process), ['cnc_machining', 'sheet_metal', 'additive_manufacturing']);
  assert.equal(workbook.cases.every(item => item.status === 'evidence_required' && item.releaseEligible === false), true);
  assert.equal(workbook.cases.every(item => item.designRevision === null && item.measurements.length === 0), true);
});

test('writes only to an external root and refuses to overwrite the workbook', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-pilot-scaffold-'));
  const root = path.join(parent, 'controlled');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  assert.equal(main([`--root=${root}`]), 0);
  assert.equal(fs.existsSync(path.join(root, 'mechanical-manufacturing-pilot-workbook.json')), true);
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('pilot-')).length, 3);
  assert.throws(() => main([`--root=${root}`]), /ALREADY_EXISTS/);
});
