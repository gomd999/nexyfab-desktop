#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const worklistPath = path.resolve(arg('worklist') || 'docs/evidence/complex-holdout-review-260806/review-worklist.json');
const validationPath = path.resolve(arg('validation') || 'docs/evidence/complex-holdout-review-260806/freecad-all-validation.json');
const output = path.resolve(arg('output') || 'docs/evidence/complex-holdout-review-260806/review-worklist-v2.json');
const worklist = JSON.parse(await readFile(worklistPath, 'utf8')), validation = JSON.parse(await readFile(validationPath, 'utf8')), byCase = new Map(validation.cases.map(item => [item.caseId, item]));
const updated = worklist.tasks.map(task => {
  const native = byCase.get(task.caseId), axes = new Map((native?.axes ?? []).map(item => [item.axis, item]));
  const assertions = task.assertions.map(assertion => { const candidate = axes.get(assertion.axis); if (!candidate || candidate.status === 'not_run') return assertion; const automaticEvidence = { status: candidate.status, reason: candidate.reason, measured: candidate.measured ?? null, artifactHashes: candidate.artifactHashes, source: 'validated-native-extraction' }; return { ...assertion, automaticEvidence, reviewerRequired: candidate.status !== 'pass' || ['requirements', 'dimensions', 'features', 'body_membership', 'joints', 'motion', 'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair'].includes(assertion.axis) }; });
  return { ...task, automaticPasses: assertions.filter(item => item.automaticEvidence?.status === 'pass').length, reviewerRequired: assertions.filter(item => item.reviewerRequired).length, nativeExtractionStatus: native?.status ?? 'not_run', assertions };
});
const byFamily = Object.fromEntries([...new Set(updated.map(item => item.family))].map(family => { const selected = updated.filter(item => item.family === family); return [family, { cases: selected.length, nativeResults: selected.filter(item => byCase.get(item.caseId)?.axes?.some(axis => axis.artifactHashes?.length)).length, automaticAssertionPasses: selected.reduce((sum, item) => sum + item.automaticPasses, 0), reviewerActions: selected.reduce((sum, item) => sum + item.reviewerRequired + 2, 0) }]; }));
await writeFile(output, `${JSON.stringify({ ...worklist, schema: 'nexyfab.complex-review-worklist.v2', mergedEvidence: path.basename(validationPath), byFamily, tasks: updated }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, cases: updated.length, byFamily })}\n`);
