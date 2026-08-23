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
} from './qualify-architecture-interior-golden-lineage.mjs';
import {
  buildArchitectureInteriorLineageOperationsReport,
} from './build-architecture-interior-lineage-operations-report.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-lineage-ops-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roots = Object.fromEntries(['example73', 'manuals', 'operator_refs'].map(alias => {
    const value = path.join(root, alias); fs.mkdirSync(value, { recursive: true }); return [alias, value];
  }));
  const evidenceRoot = path.join(root, 'evidence'); fs.mkdirSync(evidenceRoot);
  const sourcePaths = [
    'office/office.ifc',
    'apartment/apartment.ifc',
    'cafe/cafe.ifc',
    'mep/sprinkler-design.ifc',
    'residential/las-vegas-dream-home.ifc',
    'ifc/ifc4.3-georeference.ifc',
  ];
  const sources = sourcePaths.map((sourcePath, index) => ({ alias: 'operator_refs', path: sourcePath, bytes: Buffer.from(`${ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS[index]}-source`) }));
  const files = sources.map(item => {
    const target = path.join(roots[item.alias], item.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, item.bytes);
    return { alias: item.alias, path: item.path, bytes: item.bytes.length, sha256: sha256(item.bytes), extension: '.ifc' };
  });
  const inventoryPath = path.join(root, 'inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify({ schema: 'nexyfab.architecture-interior.reference-inventory.v1', files, rootSha256: 'a'.repeat(64) }));
  const operatorManifestPath = path.join(root, 'operator-manifest.json');
  fs.writeFileSync(operatorManifestPath, JSON.stringify({ artifacts: files.map(item => ({ sha256: item.sha256, lineageId: item.path })) }));
  const manualIndexPath = path.join(root, 'manual-index.json'); fs.writeFileSync(manualIndexPath, JSON.stringify({ documents: [] }));
  const binding = (name, value) => {
    const target = path.join(evidenceRoot, name); const bytes = Buffer.from(JSON.stringify(value)); fs.writeFileSync(target, bytes);
    return { path: name, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  };
  const assignments = { scenarios: Object.fromEntries(files.map((item, index) => {
    const scenarioId = ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS[index];
    return [scenarioId, [{ alias: item.alias, path: item.path, role: ['reference', 'regression', 'holdout'][index % 3],
      licenseEvidence: binding(`${scenarioId}-license.json`, { schema: 'nexyfab.architecture-interior.license-attestation.v1', sourceSha256: item.sha256, decision: 'approved', allowedUses: ['commercial-golden-evaluation'], reviewerId: `license-${scenarioId}`, reviewedAt: '2026-08-22T00:00:00.000Z' }),
      scenarioEvidence: binding(`${scenarioId}-fit.json`, { schema: 'nexyfab.architecture-interior.scenario-fit-attestation.v1', sourceSha256: item.sha256, scenarioId, decision: 'approved', reviewerId: `domain-${scenarioId}`, reviewedAt: '2026-08-22T00:00:00.000Z' }),
    }]];
  })) };
  return { root, roots, evidenceRoot, inventoryPath, operatorManifestPath, manualIndexPath, assignments, files };
}

function makeReceipt(value, assignments) {
  return qualifyArchitectureInteriorGoldenLineage({
    inventoryPath: value.inventoryPath,
    roots: value.roots,
    operatorManifestPath: value.operatorManifestPath,
    manualIndexPath: value.manualIndexPath,
    evidenceRoot: value.evidenceRoot,
    assignments,
    cwd: value.root,
    generatedAt: '2026-08-22T01:00:00.000Z',
    candidateLimit: 3,
  });
}

function report(value, receipt) {
  const manifestPath = path.join(value.root, 'golden-manifest.json'); fs.writeFileSync(manifestPath, JSON.stringify(receipt));
  return buildArchitectureInteriorLineageOperationsReport({
    inventoryPath: value.inventoryPath,
    goldenManifestPath: manifestPath,
    roots: value.roots,
    cwd: value.root,
    now: Date.parse('2026-08-23T00:00:00.000Z'),
  });
}

test('reports all scenario operations as qualified only with explicit assignment, source hash, license, and independent reviewers', t => {
  const value = fixture(t);
  const receipt = makeReceipt(value, value.assignments);
  const result = report(value, receipt);
  assert.equal(result.status, 'QUALIFIED');
  assert.equal(result.scoreEligible, true);
  assert.equal(Object.keys(result.scenarios).length, 6);
  assert.ok(Object.values(result.scenarios).every(item => item.status === 'QUALIFIED'));
  for (const scenario of Object.values(result.scenarios)) {
    assert.equal(scenario.assignment.status, 'assigned');
    assert.equal(scenario.pathHash.status, 'PASS');
    assert.equal(scenario.license.decision, 'approved');
    assert.equal(scenario.independentReviewer.status, 'approved');
  }
});

test('keeps missing assignments and absent approvals on HOLD with explicit scenario blockers', t => {
  const value = fixture(t);
  const result = report(value, makeReceipt(value, null));
  assert.equal(result.status, 'HOLD');
  for (const scenario of Object.values(result.scenarios)) {
    assert.equal(scenario.assignment.status, 'unassigned');
    assert.equal(scenario.license.decision, 'HOLD');
    assert.equal(scenario.independentReviewer.status, 'HOLD');
    assert.ok(scenario.blockers.includes('assignment_missing'));
  }
});

test('detects source path/hash drift after a qualified golden manifest was produced', t => {
  const value = fixture(t);
  const receipt = makeReceipt(value, value.assignments);
  fs.appendFileSync(path.join(value.roots.operator_refs, value.files[0].path), '-tampered');
  const result = report(value, receipt);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.scenarios.office.pathHash.status, 'HOLD');
  assert.ok(result.scenarios.office.blockers.includes('source_path_hash_inconsistent'));
});
