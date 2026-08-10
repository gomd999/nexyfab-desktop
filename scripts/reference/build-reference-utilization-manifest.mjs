#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReferenceArtifact, extensionOf, isSecretLikePath, referenceLineage } from './reference-utilization-policy.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const rootInput = option('root') ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
const outputInput = option('output');
const validateInput = option('validate');
const hashPolicy = option('hash') ?? 'all';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function measureExcluded(directory) {
  let files = 0, bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) { const nested = await measureExcluded(absolutePath); files += nested.files; bytes += nested.bytes; }
    else if (entry.isFile()) { files++; bytes += (await stat(absolutePath)).size; }
  }
  return { files, bytes };
}

async function walk(root, directory = root, files = [], securityExcluded = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
    if (isSecretLikePath(relativePath)) {
      const measured = entry.isDirectory() ? await measureExcluded(absolutePath) : { files: 1, bytes: (await stat(absolutePath)).size };
      securityExcluded.push({ pathHash: createHash('sha256').update(relativePath).digest('hex'), ...measured });
      continue;
    }
    if (entry.isDirectory()) await walk(root, absolutePath, files, securityExcluded);
    else if (entry.isFile()) files.push({ absolutePath, relativePath });
  }
  return { files, securityExcluded };
}

const increment = (record, key, amount = 1) => { record[key] = (record[key] ?? 0) + amount; };

export async function buildReferenceUtilizationManifest(root, { hash = 'all' } = {}) {
  const resolvedRoot = path.resolve(root);
  if (!existsSync(resolvedRoot)) throw new Error('reference_corpus_root_missing');
  if (!['all', 'cad', 'none'].includes(hash)) throw new Error('invalid_hash_policy');
  const discovered = await walk(resolvedRoot);
  discovered.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const artifacts = [], byLane = {}, byExtension = {}, byLineage = new Map();
  let totalBytes = 0, hashedFiles = 0, hashedBytes = 0;
  for (let index = 0; index < discovered.files.length; index++) {
    const file = discovered.files[index];
    const info = await stat(file.absolutePath);
    const classification = classifyReferenceArtifact(file.relativePath);
    const extension = extensionOf(file.relativePath) || '(none)';
    const lineageId = referenceLineage(file.relativePath);
    const shouldHash = hash === 'all' || (hash === 'cad' && [
      'exact_exchange_regression', 'governed_automated_regression', 'bounded_geometry_regression',
      'native_semantics_review_queue', 'derived_ir_reuse',
    ].includes(classification.lane));
    const digest = shouldHash ? await sha256(file.absolutePath) : null;
    if (digest) { hashedFiles++; hashedBytes += info.size; }
    totalBytes += info.size;
    increment(byLane, classification.lane);
    increment(byExtension, extension);
    const lineage = byLineage.get(lineageId) ?? { lineageId, files: 0, bytes: 0, lanes: new Set(), formats: new Set() };
    lineage.files++; lineage.bytes += info.size; lineage.lanes.add(classification.lane); lineage.formats.add(extension); byLineage.set(lineageId, lineage);
    artifacts.push({
      relativePath: file.relativePath,
      lineageId,
      extension,
      sizeBytes: info.size,
      sha256: digest,
      ...classification,
    });
    if ((index + 1) % 250 === 0) process.stderr.write(`[reference-utilization] ${index + 1}/${discovered.files.length}\n`);
  }
  const lineages = [...byLineage.values()].map(item => ({ ...item, lanes: [...item.lanes].sort(), formats: [...item.formats].sort() }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
  const assignedFiles = Object.values(byLane).reduce((sum, value) => sum + value, 0);
  const securityExcludedFiles = discovered.securityExcluded.reduce((sum, item) => sum + item.files, 0);
  const securityExcludedBytes = discovered.securityExcluded.reduce((sum, item) => sum + item.bytes, 0);
  return {
    schema: 'nexyfab.reference-utilization-manifest.v1',
    generatedAt: new Date().toISOString(),
    rootLabel: path.basename(resolvedRoot),
    policy: {
      sourceReadOnly: true,
      sourceBytesCopied: false,
      sourceArchivesExtractedInPlace: false,
      everyNonSecretFileAssigned: assignedFiles === artifacts.length,
      localEvaluationOnlyUntilLicenseReview: true,
      trainingUseAllowed: false,
      commercialScoreRequiresApproval: true,
      derivedResultsAreNotIndependentGroundTruth: true,
      nativeSemanticsMustNotBeGuessed: true,
      endUserExternalCadRequired: false,
      hashPolicy: hash,
    },
    summary: {
      discoveredFiles: artifacts.length + securityExcludedFiles,
      assignedFiles,
      securityExcludedFiles,
      discoveredBytes: totalBytes + securityExcludedBytes,
      assignedBytes: totalBytes,
      securityExcludedBytes,
      hashedFiles,
      hashedBytes,
      lineages: lineages.length,
      byLane: Object.fromEntries(Object.entries(byLane).sort(([a], [b]) => a.localeCompare(b))),
      byExtension: Object.fromEntries(Object.entries(byExtension).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    },
    securityExcluded: discovered.securityExcluded,
    lineages,
    artifacts,
  };
}

export function validateReferenceUtilizationManifest(value) {
  const errors = [];
  if (value?.schema !== 'nexyfab.reference-utilization-manifest.v1') errors.push('schema_invalid');
  if (value?.policy?.sourceReadOnly !== true || value?.policy?.sourceBytesCopied !== false) errors.push('read_only_policy_invalid');
  if (value?.policy?.trainingUseAllowed !== false || value?.policy?.commercialScoreRequiresApproval !== true) errors.push('license_boundary_invalid');
  const artifacts = Array.isArray(value?.artifacts) ? value.artifacts : [];
  const paths = new Set(), lanes = {};
  for (const item of artifacts) {
    if (!item?.relativePath || paths.has(item.relativePath)) errors.push('artifact_path_missing_or_duplicate');
    paths.add(item?.relativePath);
    if (!item?.lane || !Array.isArray(item?.roles) || item.roles.length === 0) errors.push(`artifact_unassigned:${item?.relativePath ?? 'unknown'}`);
    increment(lanes, item?.lane ?? '');
    if (item?.commercialScoreEligible !== false || item?.trainingEligible !== false) errors.push(`artifact_boundary_invalid:${item?.relativePath ?? 'unknown'}`);
  }
  const assigned = Object.values(lanes).reduce((sum, count) => sum + count, 0);
  if (assigned !== value?.summary?.assignedFiles || assigned !== artifacts.length) errors.push('assigned_count_mismatch');
  if (assigned + (value?.summary?.securityExcludedFiles ?? 0) !== value?.summary?.discoveredFiles) errors.push('discovery_count_mismatch');
  if (JSON.stringify(lanes) !== JSON.stringify(value?.summary?.byLane ?? {})) {
    const sorted = Object.fromEntries(Object.entries(lanes).sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(sorted) !== JSON.stringify(value?.summary?.byLane ?? {})) errors.push('lane_summary_mismatch');
  }
  return { ok: errors.length === 0, errors, artifacts: artifacts.length, lineages: Array.isArray(value?.lineages) ? value.lineages.length : 0 };
}

async function main() {
  if (validateInput) {
    const value = JSON.parse(await readFile(path.resolve(validateInput), 'utf8'));
    const result = validateReferenceUtilizationManifest(value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 5;
    return;
  }
  if (!rootInput || !outputInput) throw new Error('usage: --root=PATH --output=PATH [--hash=all|cad|none]');
  const manifest = await buildReferenceUtilizationManifest(rootInput, { hash: hashPolicy });
  const validation = validateReferenceUtilizationManifest(manifest);
  if (!validation.ok) throw new Error(`manifest_invalid:${validation.errors.join(',')}`);
  const output = path.resolve(outputInput);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, ...manifest.summary, validation })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
