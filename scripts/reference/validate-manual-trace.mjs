#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const reqPath = path.resolve('docs/cad-program/requirements/manual-requirements.json');
const indexPath = path.resolve('docs/cad-program/requirements/manual-index.json');
const req = JSON.parse(readFileSync(reqPath, 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const issues = [];
if (index.count !== 20) issues.push(`expected 20 manuals, got ${index.count}`);
const manualIds = new Set(index.documents.map(item => item.documentId));
const atomicContract = req.atomicRequirementContract;
const allowedVerificationKinds = new Set(atomicContract?.verificationKinds ?? []);
if (req.schemaVersion < 2 || !atomicContract || atomicContract.schemaVersion !== 1) issues.push('atomic requirement contract is missing or invalid');
const ids = new Set();
let atomicCount = 0;
const scenarioContract = req.architectureInteriorScenarioRequirementContract;
const hashPattern = /^[a-f0-9]{64}$/;
if (!scenarioContract || scenarioContract.schemaVersion !== 1 || !Array.isArray(scenarioContract.requirements) || !Array.isArray(scenarioContract.requiredFields)) issues.push('architecture/interior scenario requirement contract is missing or invalid');
const scenarioManualById = new Map(index.documents.map(item => [item.documentId, item]));
const scenarioStableIds = new Set();
for (const item of scenarioContract?.requirements ?? []) {
  for (const field of scenarioContract.requiredFields ?? []) if (!(field in item)) issues.push(`scenario atomic requirement missing ${field}: ${item.id}`);
  if (item.atomic !== true || typeof item.id !== 'string' || !/^AISC-[A-Z]+-[A-Z0-9-]+$/.test(item.id)) issues.push(`invalid scenario atomic id: ${item.id}`);
  if (scenarioStableIds.has(item.stableId)) issues.push(`duplicate scenario stableId: ${item.stableId}`);
  scenarioStableIds.add(item.stableId);
  if (!item.domain?.startsWith('architecture_') && !item.domain?.startsWith('interior_')) issues.push(`scenario requirement outside architecture/interior: ${item.id}`);
  if (item.implementationStatus !== item.status || !['partial', 'blocked_external', 'not_implemented'].includes(item.status)) issues.push(`scenario requirement status is not fail-closed: ${item.id}`);
  if (!['architecture-office', 'interior-apartment', 'interior-cafe'].includes(item.goldenScenario)) issues.push(`invalid scenario golden scenario: ${item.id}`);
  if (!Array.isArray(item.sourceManualIds) || item.sourceManualIds.length === 0 || !item.sourceManualIds.every(id => scenarioManualById.has(id))) issues.push(`invalid scenario source manuals: ${item.id}`);
  if (!item.sourceHashes || Object.keys(item.sourceHashes).sort().join(',') !== [...item.sourceManualIds].sort().join(',') || item.sourceManualIds.some(id => item.sourceHashes[id] !== scenarioManualById.get(id)?.sha256 || !hashPattern.test(item.sourceHashes[id]))) issues.push(`scenario source hash mismatch: ${item.id}`);
  for (const modulePath of item.coreModules ?? []) if (!existsSync(path.resolve(modulePath))) issues.push(`missing scenario module ${item.id}:${modulePath}`);
  const lineage = item.lineage;
  if (!lineage || !Array.isArray(lineage.parentStableIds) || lineage.parentStableIds.some(parent => !scenarioStableIds.has(parent)) || lineage.bindingStatus !== 'HOLD' || lineage.workspaceRevisionId !== null || lineage.workspaceContentHash !== null || lineage.architectureRevision !== null || lineage.architectureContentHash !== null || lineage.interiorRevision !== null || lineage.interiorContentHash !== null) issues.push(`scenario lineage is not fail-closed: ${item.id}`);
  if (item.license?.status !== 'HOLD' || item.license?.evidenceRef !== null || item.provenance?.status !== 'HOLD' || item.provenance?.evidenceRef !== null || item.reviewerEligibility?.status !== 'HOLD' || item.reviewerEligibility?.receiptRef !== null || item.scoreEligible !== false) issues.push(`scenario evidence truth is promoted: ${item.id}`);
}
if ((scenarioContract?.requirements?.length ?? 0) < 6) issues.push(`expected at least 6 architecture/interior scenario requirements, got ${scenarioContract?.requirements?.length ?? 0}`);
if (!(scenarioContract?.requirements ?? []).some(item => item.goldenScenario === 'architecture-office') || !(scenarioContract?.requirements ?? []).some(item => item.goldenScenario === 'interior-apartment') || !(scenarioContract?.requirements ?? []).some(item => item.goldenScenario === 'interior-cafe')) issues.push('architecture/interior scenario coverage is incomplete');
for (const item of req.requirements) {
  if (ids.has(item.id)) issues.push(`duplicate requirement ${item.id}`);
  ids.add(item.id);
  if (!req.statusVocabulary.includes(item.status)) issues.push(`invalid status ${item.id}:${item.status}`);
  if (item.status === 'implemented_verified' && (!item.coreModules?.length || !item.goldenScenario)) issues.push(`verified requirement lacks evidence links: ${item.id}`);
  for (const modulePath of item.coreModules || []) if (!existsSync(path.resolve(modulePath))) issues.push(`missing module ${item.id}:${modulePath}`);
  if (item.atomic === true) {
    atomicCount += 1;
    for (const field of atomicContract?.requiredFields ?? []) if (!(field in item)) issues.push(`atomic requirement missing ${field}: ${item.id}`);
    if (item.implementationStatus !== item.status) issues.push(`atomic implementationStatus/status mismatch: ${item.id}`);
    if (!Array.isArray(item.sourceManualIds) || item.sourceManualIds.length === 0) issues.push(`atomic requirement lacks source manuals: ${item.id}`);
    for (const manualId of item.sourceManualIds ?? []) if (!manualIds.has(manualId)) issues.push(`unknown source manual ${item.id}:${manualId}`);
    if (!allowedVerificationKinds.has(item.verificationKind)) issues.push(`invalid verification kind ${item.id}:${item.verificationKind}`);
    if (item.status === 'implemented_verified' && item.verificationKind === 'not_run') issues.push(`verified atomic requirement is not run: ${item.id}`);
  }
}
if (atomicCount < 20) issues.push(`expected at least 20 atomic requirements, got ${atomicCount}`);
if (!req.requirements.some(item => item.atomic === true && item.domain.startsWith('architecture_'))) issues.push('no atomic architecture requirements found');
if (!req.requirements.some(item => item.atomic === true && item.domain.startsWith('interior_'))) issues.push('no atomic interior requirements found');
if (issues.length) { process.stderr.write(`${issues.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`trace valid: ${index.count} manuals, ${req.requirements.length} baseline requirements\n`);
