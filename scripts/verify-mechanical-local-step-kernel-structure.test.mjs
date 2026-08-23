import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inspectStandaloneStep } from './standalone-step-ts-adapter.mjs';
import {
  assessKernelStructure,
  PRODUCT_STRUCTURE_CAPABILITY,
} from './verify-mechanical-local-step-kernel-structure.mjs';

const ROOT = process.cwd();
const EVIDENCE_ROOT = path.join(ROOT, 'docs/evidence/cad-independent/local/mechanical-step-c4-260814');
const source = inspectStandaloneStep(fs.readFileSync(path.join(EVIDENCE_ROOT, 'source.step'), 'utf8'));
const returned = inspectStandaloneStep(fs.readFileSync(path.join(EVIDENCE_ROOT, 'nexyfab-kernel-returned.step'), 'utf8'));

test('separates preserved occurrence geometry from lost semantic identifiers', () => {
  const assessment = assessKernelStructure(source, returned);
  assert.equal(assessment.geometryStructurePreserved, 'PASS_LOCAL');
  assert.equal(assessment.semanticIdentityPreserved, 'FAIL_LOCAL');
  assert.equal(assessment.localStatus, 'FAIL_LOCAL');
  assert.equal(assessment.checks.filter(item => item.status === 'FAIL_LOCAL').length, 3);
});

test('passes local structure and semantics only when both are independently equal', () => {
  const assessment = assessKernelStructure(source, structuredClone(source));
  assert.equal(assessment.localStatus, 'PASS_LOCAL');
  assert.ok(assessment.checks.every(item => item.status === 'PASS_LOCAL'));
});

test('fails local geometry when an occurrence transform is changed', () => {
  const changed = structuredClone(returned);
  changed.parts[1].translationMm[0] += 1;
  const assessment = assessKernelStructure(source, changed);
  assert.equal(assessment.geometryStructurePreserved, 'FAIL_LOCAL');
  assert.equal(assessment.localStatus, 'FAIL_LOCAL');
});

test('holds product identity when the local binding has no XCAF STEP reader', () => {
  assert.equal(PRODUCT_STRUCTURE_CAPABILITY.status, 'HOLD');
  assert.equal(PRODUCT_STRUCTURE_CAPABILITY.code, 'XCAF_STEP_READER_UNAVAILABLE');
  assert.match(PRODUCT_STRUCTURE_CAPABILITY.reason, /STEPCAFControl_Reader/);
  const assessment = assessKernelStructure(source, structuredClone(source));
  assert.deepEqual(assessment.productStructureCapability, PRODUCT_STRUCTURE_CAPABILITY);
});
