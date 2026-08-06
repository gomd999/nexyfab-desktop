#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('input') || 'docs/evidence/complex-holdout-review-260806');
const casesPath = path.resolve(arg('cases') || 'docs/evidence/complex-corpus-v2-draft/cases.json');
const output = path.resolve(arg('output') || path.join(root, 'review-worklist.json'));
const cases = JSON.parse(await readFile(casesPath, 'utf8')), preflight = JSON.parse(await readFile(path.join(root, 'preflight.json'), 'utf8')), structure = JSON.parse(await readFile(path.join(root, 'structure-evidence.json'), 'utf8'));
const preflightById = new Map(preflight.results.map(item => [item.caseId, item])), structureById = new Map(structure.results.map(item => [item.caseId, item]));
const STRUCTURE_AXIS = { part_definitions: 'part_definitions', occurrences: 'occurrences', hierarchy: 'hierarchy' };
const tasks = cases.map(caseValue => {
  const source = preflightById.get(caseValue.caseId), measured = structureById.get(caseValue.caseId), measuredByAxis = new Map((measured?.checks ?? []).map(item => [item.axis, item]));
  const assertions = caseValue.assertions.map(assertion => { const evidenceAxis = STRUCTURE_AXIS[assertion.axis], automaticEvidence = evidenceAxis ? measuredByAxis.get(evidenceAxis) ?? null : null; return { assertionId: assertion.id, axis: assertion.axis, artifactHashes: assertion.artifactHashes, tolerancePolicy: assertion.tolerancePolicy, automaticEvidence, reviewerRequired: automaticEvidence?.status !== 'pass' || assertion.axis === 'dimensions' || assertion.axis === 'features' || ['transforms', 'joints', 'motion', 'collision_clearance', 'manufacturing', 'step_roundtrip', 'requirements', 'body_membership', 'repair'].includes(assertion.axis), decision: null, reviewerId: null, note: null }; });
  const sourceHashPassed = source?.checks?.some(item => item.id === 'source-hash' && item.status === 'pass') === true, automaticPasses = assertions.filter(item => item.automaticEvidence?.status === 'pass').length, reviewerRequired = assertions.filter(item => item.reviewerRequired).length;
  return { caseId: caseValue.caseId, family: caseValue.family, tier: caseValue.tier, sourceHash: caseValue.sourceHash, sourceHashPassed, licenseDecision: null, holdoutIsolationDecision: null, automaticPasses, reviewerRequired, assertions };
});
const byFamily = Object.fromEntries([...new Set(tasks.map(item => item.family))].map(family => { const selected = tasks.filter(item => item.family === family); return [family, { cases: selected.length, sourceHashPassed: selected.filter(item => item.sourceHashPassed).length, automaticAssertionPasses: selected.reduce((sum, item) => sum + item.automaticPasses, 0), reviewerActions: selected.reduce((sum, item) => sum + item.reviewerRequired + 2, 0) }]; }));
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-review-worklist.v1', policy: { grantsApproval: false, scoreEligible: false, nullDecisionMeansPending: true, automaticEvidenceDoesNotApproveLicense: true }, cases: tasks.length, byFamily, tasks }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, cases: tasks.length, byFamily })}\n`);
