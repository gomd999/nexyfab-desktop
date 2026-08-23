#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReferenceUtilizationManifest } from './build-reference-utilization-manifest.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = option('input');
const output = option('output');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pick = item => ({
  artifactId: digest([item.relativePath, item.sha256]),
  ...(item.sourceId ? { sourceId: item.sourceId, sourceRelativePath: item.sourceRelativePath } : {}),
  relativePath: item.relativePath,
  lineageId: item.lineageId,
  extension: item.extension,
  sizeBytes: item.sizeBytes,
  sha256: item.sha256,
  check: item.automatedCheck,
  fidelity: item.fidelity,
  roles: item.roles,
});

export function buildReferenceUtilizationQueues(manifest) {
  const validation = validateReferenceUtilizationManifest(manifest);
  if (!validation.ok) throw new Error(`manifest_invalid:${validation.errors.join(',')}`);
  const selected = lane => manifest.artifacts.filter(item => lane.includes(item.lane)).map(pick);
  const automated = selected(['exact_exchange_regression', 'governed_automated_regression', 'bounded_geometry_regression'])
    .map(item => ({ ...item, status: 'format_probe_pending', accuracyGranted: false }));
  const nativeReview = selected(['native_semantics_review_queue'])
    .map(item => ({ ...item, status: 'authoritative_extraction_or_expert_review_pending', nativeSemanticsMustNotBeGuessed: true }));
  const humanContext = selected(['visual_reference', 'motion_reference', 'document_reference', 'metadata_reference', 'archive_lineage_container'])
    .map(item => ({ ...item, status: 'lineage_pairing_ready', dimensionalGroundTruth: false }));
  const derivedReuse = selected(['derived_ir_reuse', 'derived_result_reuse'])
    .map(item => ({ ...item, status: 'schema_and_lineage_validation_pending', independentGroundTruth: false }));
  const backlog = selected(['catalog_only', 'security_quarantine'])
    .map(item => ({ ...item, status: item.fidelity === 'never_executed' ? 'quarantined' : 'adapter_backlog' }));
  const p0Patterns = [/robot-5-dof-1/i, /robotic-arm-466/i, /truck-loading-conveyor-4/i, /1-cylinder-horizontal-mill-steam-engine/i, /w140-mercedes-benz-coupe/i];
  const p0 = manifest.lineages.filter(lineage => p0Patterns.some(rule => rule.test(lineage.lineageId)))
    .map(lineage => ({ ...lineage, workflow: ['ai_generate_or_import', 'manual_parameter_or_placement_change', 'ai_refine_with_user_locks', 'expert_handoff_if_needed', 'step_roundtrip_and_evidence'] }));
  const queued = automated.length + nativeReview.length + humanContext.length + derivedReuse.length + backlog.length;
  const queuedIds = [...automated, ...nativeReview, ...humanContext, ...derivedReuse, ...backlog].map(item => item.artifactId);
  const expectedIds = new Set(manifest.artifacts.map(item => digest([item.relativePath, item.sha256])));
  if (queuedIds.length !== expectedIds.size || new Set(queuedIds).size !== queuedIds.length || queuedIds.some(id => !expectedIds.has(id))) throw new Error('queue_coverage_mismatch');
  return {
    schema: 'nexyfab.reference-utilization-queues.v1',
    generatedAt: new Date().toISOString(),
    sourceManifestSchema: manifest.schema,
    sourceManifestArtifactHash: digest(manifest.artifacts.map(item => [item.relativePath, item.sha256, item.lane])),
    policy: {
      sourceReadOnly: true,
      sourceBytesCopied: false,
      allAssignedArtifactsQueued: queued === manifest.artifacts.length,
      trainingUseAllowed: false,
      commercialScoreRequiresApproval: true,
      externalCadRequiredForEndUser: false,
      nativeSemanticsMustNotBeGuessed: true,
    },
    summary: { queued, automated: automated.length, nativeReview: nativeReview.length, humanContext: humanContext.length, derivedReuse: derivedReuse.length, backlog: backlog.length, p0Lineages: p0.length },
    p0HybridRegression: p0,
    automated,
    nativeReview,
    humanContext,
    derivedReuse,
    backlog,
  };
}
export function validateReferenceUtilizationQueues(value) {
  const arrays = ['automated', 'nativeReview', 'humanContext', 'derivedReuse', 'backlog'];
  const missingArrays = arrays.filter(key => !Array.isArray(value?.[key]));
  const items = arrays.flatMap(key => Array.isArray(value?.[key]) ? value[key] : []);
  const ids = new Set(items.map(item => item.artifactId));
  const paths = new Set(items.map(item => item.relativePath));
  const errors = [];
  if (value?.schema !== 'nexyfab.reference-utilization-queues.v1') errors.push('schema_invalid');
  if (value?.sourceManifestSchema !== 'nexyfab.reference-utilization-manifest.v1'
    || !/^[a-f0-9]{64}$/.test(value?.sourceManifestArtifactHash ?? '')) errors.push('source_manifest_binding_invalid');
  if (missingArrays.length > 0) errors.push('queue_arrays_missing');
  if (value?.policy?.sourceReadOnly !== true || value?.policy?.allAssignedArtifactsQueued !== true) errors.push('coverage_policy_invalid');
  if (items.length !== value?.summary?.queued || ids.size !== items.length || paths.size !== items.length) errors.push('queue_count_or_identity_invalid');
  if (items.some(item => !item.relativePath || path.isAbsolute(item.relativePath)
    || item.relativePath.replaceAll('\\', '/').split('/').some(segment => !segment || segment === '.' || segment === '..')
    || (item.sha256 !== null && !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) || !item.status
    || item.artifactId !== digest([item.relativePath, item.sha256]))) errors.push('queue_item_incomplete');
  if (items.some(item => (item.sourceId === undefined) !== (item.sourceRelativePath === undefined)
    || (item.sourceId !== undefined && (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(item.sourceId)
      || item.relativePath !== `${item.sourceId}/${item.sourceRelativePath}`)))) errors.push('queue_source_binding_invalid');
  const expectedSummary = Object.fromEntries(arrays.map(key => [key, Array.isArray(value?.[key]) ? value[key].length : 0]));
  if (expectedSummary.automated !== value?.summary?.automated || expectedSummary.nativeReview !== value?.summary?.nativeReview
    || expectedSummary.humanContext !== value?.summary?.humanContext || expectedSummary.derivedReuse !== value?.summary?.derivedReuse
    || expectedSummary.backlog !== value?.summary?.backlog) errors.push('queue_summary_mismatch');
  return { ok: errors.length === 0, errors, queued: items.length };
}

async function main() {
  if (!input || !output) throw new Error('usage: --input=MANIFEST --output=QUEUES');
  const manifest = JSON.parse(await readFile(path.resolve(input), 'utf8'));
  const queues = buildReferenceUtilizationQueues(manifest);
  const validation = validateReferenceUtilizationQueues(queues);
  if (!validation.ok) throw new Error(`queues_invalid:${validation.errors.join(',')}`);
  const target = path.resolve(output); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(queues, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: target, ...queues.summary, validation })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
