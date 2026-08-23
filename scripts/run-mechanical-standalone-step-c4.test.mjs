import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runMechanicalStandaloneStepC4 } from './run-mechanical-standalone-step-c4.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-step-c4-'));
  const source = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#1=PRODUCT('assembly','ASM-1','',());\n#2=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#1,#1,$);\nENDSEC;\nEND-ISO-10303-21;\n");
  fs.writeFileSync(path.join(root, 'source.step'), source);
  const workbook = {
    schema: 'nexyfab.mechanical-standalone-step-c4-workbook.v1', releaseChannel: 'mechanical-core',
    designRevisionSha256: 'a'.repeat(64), source: { path: 'source.step', sha256: hash(source) },
  };
  const checks = [
    'opened', 'schema_conformance', 'valid_brep', 'body_count', 'units', 'bounding_box', 'volume', 'surface_area',
    'product_structure', 'occurrence_transforms', 'component_names', 'part_numbers', 'attributes',
    'returned_reimport', 'geometry_diff', 'revision_binding',
  ].map(id => ({ id, status: 'pass' }));
  const execute = async ({ sourceSha256, designRevisionSha256 }) => {
    const opened = Buffer.from('{"assembly":"ASM-1"}\n');
    const returned = Buffer.from(source);
    const measured = {
      bodyCount: 2, occurrenceCount: 2, units: 'mm', boundingBox: [0, 0, 0, 100, 50, 20],
      volume: 25000, surfaceArea: 7200, componentNames: ['base', 'bracket'], partNumbers: ['P-001', 'P-002'],
      attributes: { material: 'SUS304', revision: 'A' },
    };
    const report = {
      schema: 'nexyfab.independent-step-c4-report.v1', protocol: 'AP242', modelKind: 'assembly',
      sourceArtifactSha256: sourceSha256, designRevisionSha256, checks,
      measurements: { source: measured, returned: structuredClone(measured) },
    };
    const reportBytes = Buffer.from(JSON.stringify(report));
    fs.writeFileSync(path.join(root, 'opened.json'), opened);
    fs.writeFileSync(path.join(root, 'returned.step'), returned);
    fs.writeFileSync(path.join(root, 'report.json'), reportBytes);
    return {
      engine: { family: 'stepcode', identity: 'STEPcode', version: '0.8' }, report,
      opened: { path: 'opened.json', sha256: hash(opened) },
      returned: { path: 'returned.step', sha256: hash(returned) },
      reportArtifact: { path: 'report.json', sha256: hash(reportBytes) },
    };
  };
  return { root, workbook, execute, checks };
}

test('produces an unsigned C4 candidate from a genuinely separate parser family', async () => {
  const value = fixture();
  try {
    const result = await runMechanicalStandaloneStepC4({ workbook: value.workbook, evidenceRoot: value.root, executeIndependentParser: value.execute, executedAt: '2026-08-13T00:00:00.000Z' });
    assert.equal(result.eligibleForSignedReceipt, true);
    assert.equal(result.commerciallyVerified, false);
    assert.equal(result.engine.family, 'stepcode');
    assert.equal(result.checks.length, 16);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('rejects OCCT/replicad self-roundtrip presented as independent evidence', async () => {
  const value = fixture();
  try {
    await assert.rejects(() => runMechanicalStandaloneStepC4({
      workbook: value.workbook, evidenceRoot: value.root,
      executeIndependentParser: async input => ({ ...(await value.execute(input)), engine: { family: 'opencascade', identity: 'occt-import-js', version: '0.0.23' } }),
    }), /ENGINE_NOT_INDEPENDENT/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('rejects missing checks, changed hashes, and paths outside the evidence root', async () => {
  const value = fixture();
  try {
    await assert.rejects(() => runMechanicalStandaloneStepC4({
      workbook: value.workbook, evidenceRoot: value.root,
      executeIndependentParser: async input => {
        const execution = await value.execute(input);
        execution.report.checks = execution.report.checks.filter(item => item.id !== 'geometry_diff');
        return execution;
      },
    }), /CHECK_NOT_PASS:geometry_diff/);
    await assert.rejects(() => runMechanicalStandaloneStepC4({
      workbook: { ...value.workbook, source: { ...value.workbook.source, sha256: 'b'.repeat(64) } },
      evidenceRoot: value.root, executeIndependentParser: value.execute,
    }), /ARTIFACT_HASH_MISMATCH/);
    await assert.rejects(() => runMechanicalStandaloneStepC4({
      workbook: value.workbook, evidenceRoot: value.root,
      executeIndependentParser: async input => ({ ...(await value.execute(input)), returned: { path: '../outside.step', sha256: 'c'.repeat(64) } }),
    }), /ARTIFACT_MISSING/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('rejects a self-reported PASS when measured roundtrip geometry differs', async () => {
  const value = fixture();
  try {
    await assert.rejects(() => runMechanicalStandaloneStepC4({
      workbook: value.workbook, evidenceRoot: value.root,
      executeIndependentParser: async input => {
        const execution = await value.execute(input);
        execution.report.measurements.returned.volume *= 1.01;
        const reportBytes = Buffer.from(JSON.stringify(execution.report));
        fs.writeFileSync(path.join(value.root, 'report.json'), reportBytes);
        execution.reportArtifact.sha256 = hash(reportBytes);
        return execution;
      },
    }), /VOLUME_MISMATCH/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
