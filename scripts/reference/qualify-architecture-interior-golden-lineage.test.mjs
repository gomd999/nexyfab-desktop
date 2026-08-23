import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS,
  qualifyArchitectureInteriorGoldenLineage,
  sha256,
  validateArchitectureInteriorGoldenLineageReceipt,
} from './qualify-architecture-interior-golden-lineage.mjs';

function fixture(t, { duplicateBytes = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-golden-lineage-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const roots = Object.fromEntries(['example73', 'manuals', 'operator_refs'].map(alias => {
    const value = path.join(root, alias);
    fs.mkdirSync(value, { recursive: true });
    return [alias, value];
  }));
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(evidenceRoot);
  const sources = [
    { alias: 'operator_refs', path: 'office/office.ifc', bytes: Buffer.from('office-source') },
    { alias: 'operator_refs', path: 'apartment/apartment.ifc', bytes: Buffer.from(duplicateBytes ? 'office-source' : 'apartment-source') },
    { alias: 'operator_refs', path: 'cafe/cafe.ifc', bytes: Buffer.from('cafe-source') },
    { alias: 'operator_refs', path: 'mep/sprinkler-design.ifc', bytes: Buffer.from('mep-companion-source') },
    { alias: 'operator_refs', path: 'residential/las-vegas-dream-home.ifc', bytes: Buffer.from('comprehensive-residential-source') },
    { alias: 'operator_refs', path: 'ifc/ifc4.3-georeference.ifc', bytes: Buffer.from('ifc-regression-source') },
  ];
  const files = sources.map(source => {
    const target = path.join(roots[source.alias], source.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source.bytes);
    return { alias: source.alias, path: source.path, sha256: sha256(source.bytes), bytes: source.bytes.length, extension: '.ifc' };
  });
  const inventoryPath = path.join(root, 'inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify({ schema: 'nexyfab.architecture-interior.reference-inventory.v1', files, counts: { files: files.length }, rootSha256: 'a'.repeat(64) }));
  const operatorManifestPath = path.join(root, 'operator-manifest.json');
  fs.writeFileSync(operatorManifestPath, JSON.stringify({ schema: 'nexyfab.reference-utilization-manifest.v1', artifacts: files.map((item, index) => ({
    relativePath: item.path, sha256: item.sha256, lineageId: `lineage-${index}`, trainingEligible: false,
    commercialScoreEligible: false, licenseReviewRequired: true,
  })) }));
  const manualIndexPath = path.join(root, 'manual-index.json');
  fs.writeFileSync(manualIndexPath, JSON.stringify({ schemaVersion: 1, documents: [] }));
  return { root, roots, evidenceRoot, files, inventoryPath, operatorManifestPath, manualIndexPath };
}

function binding(root, name, value) {
  const file = path.join(root, name);
  const bytes = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(file, bytes);
  return { path: name, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function approvedAssignments(value, roles = {}) {
  const roleSequence = ['reference', 'regression', 'holdout'];
  return {
    scenarios: Object.fromEntries(value.files.map((file, index) => {
      const scenarioId = ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS[index];
      const licenseEvidence = binding(value.evidenceRoot, `${scenarioId}-license.json`, {
        schema: 'nexyfab.architecture-interior.license-attestation.v1', sourceSha256: file.sha256,
        decision: 'approved', allowedUses: ['commercial-golden-evaluation'], reviewerId: 'license-reviewer', reviewedAt: '2026-08-22T00:00:00.000Z',
      });
      const scenarioEvidence = binding(value.evidenceRoot, `${scenarioId}-fit.json`, {
        schema: 'nexyfab.architecture-interior.scenario-fit-attestation.v1', sourceSha256: file.sha256,
        scenarioId, decision: 'approved', reviewerId: 'domain-reviewer', reviewedAt: '2026-08-22T00:00:00.000Z',
      });
      return [scenarioId, [{ alias: file.alias, path: file.path, role: roles[scenarioId] ?? roleSequence[index % roleSequence.length], licenseEvidence, scenarioEvidence }]];
    })),
  };
}

function qualify(value, assignments = null) {
  return qualifyArchitectureInteriorGoldenLineage({
    inventoryPath: value.inventoryPath, roots: value.roots, operatorManifestPath: value.operatorManifestPath,
    manualIndexPath: value.manualIndexPath, evidenceRoot: value.evidenceRoot, assignments, cwd: value.root,
    generatedAt: '2026-08-22T01:00:00.000Z', candidateLimit: 3,
  });
}

test('qualifies only real contained files with explicit license and scenario approvals', t => {
  const value = fixture(t);
  const receipt = qualify(value, approvedAssignments(value));
  assert.equal(receipt.status, 'QUALIFIED');
  assert.equal(Object.keys(receipt.scenarios).length, 6);
  assert.ok(Object.values(receipt.scenarios).every(item => item.status === 'QUALIFIED'));
  assert.equal(validateArchitectureInteriorGoldenLineageReceipt(receipt, { now: Date.parse('2026-08-23T00:00:00Z'), cwd: value.root }).valid, true);
  for (const scenario of Object.values(receipt.scenarios)) {
    assert.equal(scenario.selected[0].containmentVerified, true);
    assert.equal(scenario.selected[0].inventoryMatch, true);
    assert.equal(scenario.selected[0].tuningExclusion, true);
  }
});

test('keeps a ranked candidate on HOLD when license evidence is missing', t => {
  const value = fixture(t);
  const assignments = approvedAssignments(value);
  delete assignments.scenarios.office[0].licenseEvidence;
  const receipt = qualify(value, assignments);
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.scenarios.office.status, 'HOLD');
  assert.ok(receipt.scenarios.office.selected[0].rejectionReasons.includes('license_attestation_missing'));
});

test('requires independent license and scenario-fit reviewers', t => {
  const value = fixture(t);
  const assignments = approvedAssignments(value);
  const fitPath = path.join(value.evidenceRoot, assignments.scenarios.office[0].scenarioEvidence.path);
  const fit = JSON.parse(fs.readFileSync(fitPath, 'utf8'));
  fit.reviewerId = 'license-reviewer';
  assignments.scenarios.office[0].scenarioEvidence = binding(value.evidenceRoot, 'office-fit-same-reviewer.json', fit);
  const receipt = qualify(value, assignments);
  assert.equal(receipt.scenarios.office.status, 'HOLD');
  assert.ok(receipt.scenarios.office.selected[0].rejectionReasons.includes('independent_reviewer_required'));
});

test('does not rank images or derived JSON as exact CAD lineage candidates', t => {
  const value = fixture(t);
  const inventory = JSON.parse(fs.readFileSync(value.inventoryPath));
  for (const [name, extension] of [['office-preview.png', '.png'], ['office-derived.ir.json', '.json']]) {
    const bytes = Buffer.from(name);
    const relativePath = `office/${name}`;
    fs.writeFileSync(path.join(value.roots.operator_refs, relativePath), bytes);
    inventory.files.push({ alias: 'operator_refs', path: relativePath, sha256: sha256(bytes), bytes: bytes.length, extension });
  }
  fs.writeFileSync(value.inventoryPath, JSON.stringify(inventory));
  const receipt = qualify(value, null);
  assert.ok(receipt.scenarios.office.candidates.length > 0);
  assert.ok(receipt.scenarios.office.candidates.every(item => item.relativePath.endsWith('.ifc')));
});

test('blocks path traversal before reading outside a source root', t => {
  const value = fixture(t);
  const outside = path.join(value.root, 'outside.ifc');
  fs.writeFileSync(outside, 'outside');
  const item = { alias: 'operator_refs', path: '../outside.ifc', sha256: sha256(Buffer.from('outside')), bytes: 7, extension: '.ifc' };
  const inventory = JSON.parse(fs.readFileSync(value.inventoryPath));
  inventory.files.push(item);
  fs.writeFileSync(value.inventoryPath, JSON.stringify(inventory));
  const receipt = qualify(value, { scenarios: { office: [{ alias: item.alias, path: item.path, role: 'holdout' }] } });
  assert.ok(receipt.scenarios.office.selected[0].rejectionReasons.includes('path_traversal_or_absolute_path'));
});

test('blocks a symlink or junction that escapes the declared root', t => {
  const value = fixture(t);
  const outside = path.join(value.root, 'outside-dir');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'escape.ifc'), 'escape');
  const link = path.join(value.roots.operator_refs, 'escape-link');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const item = { alias: 'operator_refs', path: 'escape-link/escape.ifc', sha256: sha256(Buffer.from('escape')), bytes: 6, extension: '.ifc' };
  const inventory = JSON.parse(fs.readFileSync(value.inventoryPath));
  inventory.files.push(item);
  fs.writeFileSync(value.inventoryPath, JSON.stringify(inventory));
  const receipt = qualify(value, { scenarios: { office: [{ alias: item.alias, path: item.path, role: 'holdout' }] } });
  assert.ok(receipt.scenarios.office.selected[0].rejectionReasons.includes('realpath_escape'));
});

test('blocks duplicate content and same-hash reuse across roles', t => {
  const value = fixture(t, { duplicateBytes: true });
  const receipt = qualify(value, approvedAssignments(value));
  assert.equal(receipt.status, 'HOLD');
  assert.ok(receipt.blockers.some(item => item.startsWith('duplicate_selected_hash:')));
  assert.ok(receipt.blockers.some(item => item.startsWith('same_hash_role_reuse:')));
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, { now: Date.parse('2026-08-23T00:00:00Z'), cwd: value.root });
  assert.ok(validation.issues.some(item => item.startsWith('duplicate_selected_hash:')));
  assert.ok(validation.issues.some(item => item.startsWith('same_hash_role_reuse:')));
});

test('rejects a stale otherwise well-formed receipt', t => {
  const value = fixture(t);
  const receipt = qualify(value, approvedAssignments(value));
  receipt.generatedAt = '2025-01-01T00:00:00.000Z';
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, { now: Date.parse('2026-08-22T00:00:00Z'), maxAgeDays: 30, cwd: value.root });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes('receipt_stale_or_future'));
});

test('rejects a receipt that is not bound to the current reference-utilization manifest', t => {
  const value = fixture(t);
  const receipt = qualify(value, null);
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, {
    now: Date.parse('2026-08-23T00:00:00Z'),
    cwd: value.root,
    expectedReferenceManifestPath: 'docs/evidence/cad-independent/reference-utilization-manifest-260823.json',
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes('authoritative_reference_manifest_not_current'));
});

test('rejects a receipt after its bound inventory changes', t => {
  const value = fixture(t);
  const receipt = qualify(value, approvedAssignments(value));
  fs.appendFileSync(value.inventoryPath, ' ');
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, {
    now: Date.parse('2026-08-23T00:00:00Z'), cwd: value.root,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes('evidence_binding_stale_or_invalid:inventory'));
});

test('rejects a qualified receipt after a selected source changes', t => {
  const value = fixture(t);
  const receipt = qualify(value, approvedAssignments(value));
  fs.appendFileSync(path.join(value.roots.operator_refs, value.files[0].path), '-tampered');
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, {
    now: Date.parse('2026-08-23T00:00:00Z'), cwd: value.root,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(item => item.startsWith('qualified_source_stale_or_invalid:office:')));
});

test('rejects a qualified receipt after an approval attestation changes', t => {
  const value = fixture(t);
  const receipt = qualify(value, approvedAssignments(value));
  fs.appendFileSync(path.join(value.evidenceRoot, 'office-license.json'), ' ');
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, {
    now: Date.parse('2026-08-23T00:00:00Z'), cwd: value.root,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(item => item.startsWith('qualified_license_stale_or_invalid:office:')));
});
