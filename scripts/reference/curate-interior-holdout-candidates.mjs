#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = path.resolve(arg('input') || 'C:/tmp/nexyfab-complex-candidates.json');
const output = path.resolve(arg('output') || 'C:/tmp/nexyfab-interior-review-queue.json');
const limit = Number(arg('limit') || 20);
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');

const manifest = JSON.parse(await readFile(input, 'utf8'));
const interior = (manifest.candidates ?? []).filter(item => item.family === 'interior');
function lineage(locator) {
  const normalized = locator.replaceAll('\\', '/');
  const pcert = normalized.match(/PCERT-Sample-Scene\/([^/]+)\.ifc$/i);
  if (pcert) return `pcert:${pcert[1].toLowerCase()}`;
  const snapshot = normalized.match(/(?:^|\/)([^/]+\.snapshot\.\d+)(?:\/|$)/i);
  if (snapshot) return `snapshot:${snapshot[1].toLowerCase()}`;
  const model = normalized.match(/\/models\/([^/]+)\/([^/]+)\//i);
  if (model) return `ifc-sample:${model[1].toLowerCase()}:${model[2].toLowerCase()}`;
  return `path:${path.basename(normalized).toLowerCase()}`;
}
function scope(item) {
  if (item.bytes > 128 * 1024 * 1024) return 'oversize';
  if (/automatic-door-lock/i.test(item.localLocator)) return 'project_component';
  if (/IFC4\.3\.x-sample-models-main/i.test(item.localLocator)) return 'unit_fixture';
  if (item.bytes >= 1024 * 1024) return 'project';
  if (item.bytes >= 100 * 1024) return 'project_component';
  return 'unit_fixture';
}
const classified = interior.map(item => ({ ...item, lineageGroup: lineage(item.localLocator), scope: scope(item) }));
const rank = { project: 0, project_component: 1, unit_fixture: 2, oversize: 3 };
classified.sort((a, b) => rank[a.scope] - rank[b.scope] || b.bytes - a.bytes || a.sourceHash.localeCompare(b.sourceHash));
const selected = [], seen = new Set();
for (const item of classified) {
  if (item.scope !== 'project' || seen.has(item.lineageGroup)) continue;
  seen.add(item.lineageGroup);
  if (selected.length < limit) selected.push({ caseId: `interior-review-${String(selected.length + 1).padStart(2, '0')}`, family: 'interior', holdoutGroup: item.lineageGroup, sourceHash: item.sourceHash, sourceKind: /Sample-Test-Files|IFC4\.3\.x-sample-models-main/i.test(item.localLocator) ? 'standard_corpus' : 'internal_dogfood', split: 'holdout_candidate', scope: item.scope, extension: item.extension, bytes: item.bytes, localLocator: item.localLocator, groundTruthApproved: false, scoreEligible: false, reviewChecklist: ['provenance_and_license', 'product_lineage_unique', 'ifc_or_step_structure_measured', 'expected_counts_reviewed', 'spatial_and_placement_ground_truth', 'generation_prompt_redacted'] });
}
const scopeCounts = Object.fromEntries(['project', 'project_component', 'unit_fixture', 'oversize'].map(value => [value, classified.filter(item => item.scope === value).length]));
const queue = { schema: 'nexyfab.interior-holdout-review.v1', generatedAt: new Date().toISOString(), policy: { localOnly: true, selectedDoesNotMeanApproved: true, scoreEligible: false, maximumBytes: 128 * 1024 * 1024, oneCasePerLineage: true, projectScopeRequiredForPrimaryHoldout: true }, inputCandidates: interior.length, distinctLineages: new Set(classified.map(item => item.lineageGroup)).size, scopeCounts, selectedCount: selected.length, shortfall: Math.max(0, limit - selected.length), selected, auxiliaryRegressionPool: classified.filter(item => item.scope === 'project_component' || item.scope === 'unit_fixture').map(item => ({ sourceHash: item.sourceHash, bytes: item.bytes, scope: item.scope, lineageGroup: item.lineageGroup, localLocator: item.localLocator, scoreEligible: false })), quarantinedOversize: classified.filter(item => item.scope === 'oversize').map(item => ({ sourceHash: item.sourceHash, bytes: item.bytes, localLocator: item.localLocator, reason: 'exceeds_128_mib_review_budget' })) };
await writeFile(output, `${JSON.stringify(queue, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, inputCandidates: queue.inputCandidates, distinctLineages: queue.distinctLineages, scopeCounts, selectedCount: selected.length, shortfall: queue.shortfall, auxiliary: queue.auxiliaryRegressionPool.length, oversize: queue.quarantinedOversize.length })}\n`);
