#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyReleasePath } from './build-release-baseline.mjs';

const DEFAULT_BASELINE = 'docs/evidence/release/commercial-release-baseline-current.json';
const DEFAULT_SUPPLEMENTAL_EVIDENCE = 'docs/evidence/release/commercialization-readiness-full-product-current.json';
const SELECTED_GROUPS = ['deployable', 'documentation', 'evidence'];
const ALL_GROUPS = [...SELECTED_GROUPS, 'protected', 'temporary'];

const normalize = value => value.replaceAll('\\', '/');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestRows = rows => createHash('sha256')
  .update(rows.map(row => `${row.path}\0${row.bytes}\0${row.sha256}`).join('\n'))
  .digest('hex');

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  fail('manifest_canonicalization_unsupported_value');
}

function fail(code, detail = '') {
  throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

function isReparseOrLink(stat) {
  // Node exposes reparsePoint/isJunction only on some Windows versions. A
  // realpath containment check below remains the authoritative escape guard.
  return stat.isSymbolicLink() || stat.reparsePoint === true || stat.isJunction === true;
}

function ensureInside(root, candidate, code = 'path_outside_root') {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(code, candidate);
  }
}

function assertSafeRelativePath(input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('invalid_baseline_path');
  const value = normalize(input);
  if (value !== input.replaceAll('\\', '/') || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    fail('unsafe_baseline_path', input);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('unsafe_baseline_path', input);
  return value;
}

function assertDirectoryNotLink(absolute, code) {
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('missing_directory', absolute);
    throw error;
  }
  if (!stat.isDirectory()) fail('not_a_directory', absolute);
  if (isReparseOrLink(stat)) fail(code, absolute);
}

function resolveSourceFile(root, rootReal, relative) {
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') fail('source_file_missing', relative);
      throw error;
    }
    if (isReparseOrLink(stat)) fail('source_symlink_or_junction_rejected', relative);
    const real = fs.realpathSync.native(current);
    ensureInside(rootReal, real, 'source_path_escaped_root');
    if (index < parts.length - 1 && !stat.isDirectory()) fail('source_parent_not_directory', relative);
    if (index === parts.length - 1 && !stat.isFile()) fail('source_not_regular_file', relative);
  }
  return current;
}

function readJsonAndBinding(absolute, relative, invalidJsonCode = 'invalid_baseline_json') {
  const bytes = fs.readFileSync(absolute);
  try {
    return {
      value: JSON.parse(bytes.toString('utf8')),
      binding: { path: relative, bytes: bytes.length, sha256: sha256(bytes) },
    };
  } catch (error) {
    if (error instanceof SyntaxError) fail(invalidJsonCode, absolute);
    throw error;
  }
}

function verifyBaselineSourceBinding(sourceRoot, rootReal, binding) {
  const absolute = resolveSourceFile(sourceRoot, rootReal, binding.path);
  const bytes = fs.readFileSync(absolute);
  if (bytes.length !== binding.bytes || sha256(bytes) !== binding.sha256) {
    fail('baseline_source_changed_during_export', binding.path);
  }
}

function verifySupplementalSourceBinding(sourceRoot, rootReal, binding) {
  const absolute = resolveSourceFile(sourceRoot, rootReal, binding.path);
  const bytes = fs.readFileSync(absolute);
  if (bytes.length !== binding.bytes || sha256(bytes) !== binding.sha256) {
    fail('supplemental_source_changed_during_export', binding.path);
  }
}

function validateSupplementalEvidence(report, reportBinding, baselineBinding, rowsByGroup) {
  if (reportBinding.path !== DEFAULT_SUPPLEMENTAL_EVIDENCE) {
    fail('supplemental_report_path_invalid', reportBinding.path);
  }
  if (report?.schema !== 'nexyfab.commercialization-readiness.v4') {
    fail('supplemental_report_schema_invalid');
  }
  const evaluated = report.evaluatedReleaseBaseline;
  if (!evaluated || evaluated.path !== baselineBinding.path
    || evaluated.bytes !== baselineBinding.bytes
    || evaluated.sha256 !== baselineBinding.sha256) {
    fail('supplemental_report_stale_baseline_binding');
  }
  const collisionKey = process.platform === 'win32' ? reportBinding.path.toLowerCase() : reportBinding.path;
  if (ALL_GROUPS.some(group => rowsByGroup[group].some(row => (
    process.platform === 'win32' ? row.path.toLowerCase() : row.path
  ) === collisionKey))) {
    fail('supplemental_report_must_be_excluded_from_baseline', reportBinding.path);
  }
  return {
    group: 'supplemental-evidence',
    role: 'FULL_PRODUCT_READINESS_REPORT',
    path: reportBinding.path,
    bytes: reportBinding.bytes,
    sourceSha256: reportBinding.sha256,
    destinationSha256: reportBinding.sha256,
    schema: report.schema,
    evaluatedReleaseBaseline: { ...baselineBinding },
  };
}

function validateRows(baseline) {
  if (baseline?.schema !== 'nexyfab.commercial-release-baseline.v1') fail('unsupported_baseline_schema');
  if (!baseline.groups || typeof baseline.groups !== 'object') fail('baseline_groups_missing');
  const rowsByGroup = {};
  const seen = new Map();
  for (const group of ALL_GROUPS) {
    const rows = baseline.groups[group];
    if (!Array.isArray(rows)) fail('baseline_group_missing', group);
    rowsByGroup[group] = rows.map(row => {
      if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.bytes) || row.bytes < 0
        || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(row.sha256)) {
        fail('invalid_baseline_file_record', group);
      }
      const relative = assertSafeRelativePath(row.path);
      const classifiedGroup = classifyReleasePath(relative);
      if (classifiedGroup !== group) fail('baseline_group_classification_mismatch', `${relative},${group},${classifiedGroup}`);
      const collisionKey = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (seen.has(collisionKey)) fail('baseline_file_in_multiple_groups', `${relative},${seen.get(collisionKey)},${group}`);
      seen.set(collisionKey, group);
      return { path: relative, bytes: row.bytes, sha256: row.sha256.toLowerCase() };
    });
    const summary = baseline.summary?.[group];
    if (!summary || typeof summary.sha256 !== 'string' || summary.files !== rows.length
      || summary.bytes !== rows.reduce((total, row) => total + row.bytes, 0)
      || summary.sha256?.toLowerCase() !== digestRows(rows)) {
      fail('baseline_summary_mismatch', group);
    }
  }
  return rowsByGroup;
}

function verifyPolicy(rowsByGroup, baseline) {
  const excludedRoots = Array.isArray(baseline.policy?.excludedRuntimeRoots)
    ? baseline.policy.excludedRuntimeRoots.map(value => assertSafeRelativePath(value).toLowerCase())
    : [];
  for (const row of rowsByGroup.deployable) {
    const lower = row.path.toLowerCase();
    if (excludedRoots.some(root => lower === root || lower.startsWith(`${root}/`))) {
      fail('runtime_excluded_file_marked_deployable', row.path);
    }
  }
  if (baseline.policy?.protectedNeverDeploy !== true
    || baseline.policy?.referenceEvidenceExcludedFromRuntime !== true) {
    fail('baseline_policy_not_fail_closed');
  }
}

function validateDestination(outputDir, sourceRoot) {
  const sourceParent = path.dirname(sourceRoot);
  const outputParent = path.dirname(outputDir);
  assertDirectoryNotLink(sourceParent, 'source_parent_symlink_or_junction_rejected');
  assertDirectoryNotLink(outputParent, 'destination_parent_symlink_or_junction_rejected');
  const sourceParentReal = fs.realpathSync.native(sourceParent);
  const outputParentReal = fs.realpathSync.native(outputParent);
  if (sourceParentReal !== outputParentReal) fail('destination_not_sibling', outputDir);
  if (path.resolve(outputDir) === path.resolve(sourceRoot)) fail('destination_is_source_root');
  try {
    fs.lstatSync(outputDir);
    fail('destination_already_exists', outputDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function verifySourceRows(rowsByGroup, sourceRoot, rootReal) {
  const verified = [];
  for (const group of SELECTED_GROUPS) {
    for (const row of rowsByGroup[group]) {
      const sourcePath = resolveSourceFile(sourceRoot, rootReal, row.path);
      const bytes = fs.readFileSync(sourcePath);
      const actualSha256 = sha256(bytes);
      if (bytes.length !== row.bytes || actualSha256 !== row.sha256) {
        fail('source_exact_bytes_or_sha_mismatch', row.path);
      }
      verified.push({ group, ...row, sourcePath });
    }
  }
  return verified;
}

function removeOwnedDestination(outputDir) {
  try {
    const stat = fs.lstatSync(outputDir);
    if (stat.isDirectory() && !isReparseOrLink(stat)) fs.rmSync(outputDir, { recursive: true, force: true });
  } catch {
    // Preserve the original failure; never remove an unexpected path.
  }
}

function copyAndVerify(verified, outputDir, sourceRoot, rootReal) {
  const copied = [];
  for (const row of verified) {
    const destination = path.join(outputDir, ...row.path.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // Re-check the full source chain after the preflight pass so a symlink or
    // junction swap between verification and copy cannot escape the root.
    const currentSource = resolveSourceFile(sourceRoot, rootReal, row.path);
    const bytes = fs.readFileSync(currentSource);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) fail('source_changed_during_export', row.path);
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    const destinationBytes = fs.readFileSync(destination);
    const destinationSha256 = sha256(destinationBytes);
    if (destinationBytes.length !== row.bytes || destinationSha256 !== row.sha256) {
      fail('destination_exact_bytes_or_sha_mismatch', row.path);
    }
    copied.push({ group: row.group, path: row.path, bytes: row.bytes, sourceSha256: row.sha256, destinationSha256 });
  }
  return copied;
}

function copySupplementalEvidence(preflight, outputDir, sourceRoot, rootReal) {
  const source = resolveSourceFile(sourceRoot, rootReal, preflight.path);
  const bytes = fs.readFileSync(source);
  if (bytes.length !== preflight.bytes || sha256(bytes) !== preflight.sourceSha256) {
    fail('supplemental_source_changed_during_export', preflight.path);
  }
  const destination = path.join(outputDir, ...preflight.path.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  const destinationBytes = fs.readFileSync(destination);
  const destinationSha256 = sha256(destinationBytes);
  if (destinationBytes.length !== preflight.bytes || destinationSha256 !== preflight.sourceSha256) {
    fail('supplemental_destination_exact_bytes_or_sha_mismatch', preflight.path);
  }
  return { ...preflight, destinationSha256 };
}

function addManifestSelfHash(payload) {
  return {
    ...payload,
    integrity: {
      scheme: 'SHA256_CANONICAL_PAYLOAD_SELF_HASH_V1',
      canonicalization: 'NEXYFAB_SORTED_JSON_V1',
      scope: 'MANIFEST_WITHOUT_INTEGRITY',
      sha256: sha256(Buffer.from(canonicalJson(payload), 'utf8')),
      trustedSignature: false,
      releaseAuthorization: false,
    },
  };
}

export function verifyReleaseCandidateManifest(manifest, {
  expectedBaselineBinding,
  expectedSupplementalBinding,
} = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('invalid_manifest');
  if (manifest.schema !== 'nexyfab.clean-release-candidate-snapshot.v1'
    || manifest.status !== 'SNAPSHOT_ONLY'
    || manifest.releaseReady !== false
    || manifest.deploymentAuthorization !== 'NO_DEPLOY') {
    fail('manifest_fail_closed_contract_invalid');
  }
  const binding = manifest.baseline;
  if (!binding || typeof binding.path !== 'string' || !binding.path
    || normalize(binding.path) !== binding.path
    || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0
    || typeof binding.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.sha256)) {
    fail('manifest_baseline_binding_invalid');
  }
  assertSafeRelativePath(binding.path);
  if (expectedBaselineBinding
    && (binding.path !== expectedBaselineBinding.path
      || binding.bytes !== expectedBaselineBinding.bytes
      || binding.sha256 !== expectedBaselineBinding.sha256)) {
    fail('manifest_baseline_binding_mismatch');
  }
  const included = manifest.included;
  const supplementalContract = manifest.supplementalEvidence;
  const supplemental = supplementalContract?.artifacts?.[0];
  if (!included || !Number.isSafeInteger(included.files) || !Number.isSafeInteger(included.bytes)
    || !Number.isSafeInteger(included.baselineSelected?.files)
    || !Number.isSafeInteger(included.baselineSelected?.bytes)
    || included.supplemental?.files !== 1
    || !Number.isSafeInteger(included.supplemental?.bytes)
    || !Array.isArray(included.entries) || included.entries.length !== included.files
    || supplementalContract?.schema !== 'nexyfab.rc-supplemental-evidence.v1'
    || !Array.isArray(supplementalContract.artifacts) || supplementalContract.artifacts.length !== 1
    || supplemental?.group !== 'supplemental-evidence'
    || supplemental?.role !== 'FULL_PRODUCT_READINESS_REPORT'
    || supplemental?.schema !== 'nexyfab.commercialization-readiness.v4'
    || supplemental?.path !== DEFAULT_SUPPLEMENTAL_EVIDENCE
    || !Number.isSafeInteger(supplemental?.bytes) || supplemental.bytes < 0
    || typeof supplemental?.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(supplemental.sourceSha256)
    || supplemental.destinationSha256 !== supplemental.sourceSha256) {
    fail('manifest_supplemental_evidence_contract_invalid');
  }
  assertSafeRelativePath(supplemental.path);
  if (supplemental.evaluatedReleaseBaseline?.path !== binding.path
    || supplemental.evaluatedReleaseBaseline?.bytes !== binding.bytes
    || supplemental.evaluatedReleaseBaseline?.sha256 !== binding.sha256) {
    fail('manifest_supplemental_baseline_binding_mismatch');
  }
  if (expectedSupplementalBinding
    && (supplemental.path !== expectedSupplementalBinding.path
      || supplemental.bytes !== expectedSupplementalBinding.bytes
      || supplemental.sourceSha256 !== expectedSupplementalBinding.sha256)) {
    fail('manifest_supplemental_source_binding_mismatch');
  }
  const supplementalEntries = included.entries.filter(entry => entry?.group === 'supplemental-evidence');
  const baselineSelectedEntries = included.entries.filter(entry => entry?.group !== 'supplemental-evidence');
  if (supplementalEntries.length !== 1
    || canonicalJson(supplementalEntries[0]) !== canonicalJson(supplemental)
    || included.baselineSelected.files !== baselineSelectedEntries.length
    || included.baselineSelected.bytes !== baselineSelectedEntries.reduce((total, entry) => total + entry.bytes, 0)
    || included.supplemental.bytes !== supplemental.bytes
    || included.files !== included.baselineSelected.files + included.supplemental.files
    || included.bytes !== included.baselineSelected.bytes + included.supplemental.bytes) {
    fail('manifest_included_count_contract_invalid');
  }
  const integrity = manifest.integrity;
  if (!integrity
    || integrity.scheme !== 'SHA256_CANONICAL_PAYLOAD_SELF_HASH_V1'
    || integrity.canonicalization !== 'NEXYFAB_SORTED_JSON_V1'
    || integrity.scope !== 'MANIFEST_WITHOUT_INTEGRITY'
    || integrity.trustedSignature !== false
    || integrity.releaseAuthorization !== false
    || typeof integrity.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(integrity.sha256)) {
    fail('manifest_self_hash_contract_invalid');
  }
  const payload = { ...manifest };
  delete payload.integrity;
  const actualSha256 = sha256(Buffer.from(canonicalJson(payload), 'utf8'));
  if (actualSha256 !== integrity.sha256) fail('manifest_self_hash_mismatch');
  return true;
}

function buildManifest({ sourceRoot, baseline, baselineBinding, rowsByGroup, copied, supplemental, generatedAt }) {
  const excluded = Object.fromEntries(['protected', 'temporary'].map(group => [group, {
    files: rowsByGroup[group].length,
    bytes: rowsByGroup[group].reduce((total, row) => total + row.bytes, 0),
    paths: rowsByGroup[group].map(row => row.path),
  }]));
  const baselineSelectedBytes = copied.reduce((total, row) => total + row.bytes, 0);
  const entries = [...copied, supplemental];
  return addManifestSelfHash({
    schema: 'nexyfab.clean-release-candidate-snapshot.v1',
    status: 'SNAPSHOT_ONLY',
    releaseReady: false,
    deploymentAuthorization: 'NO_DEPLOY',
    generatedAt,
    sourceRoot: fs.realpathSync.native(sourceRoot),
    baseline: {
      ...baselineBinding,
      schema: baseline.schema,
      generatedAt: baseline.generatedAt ?? null,
      release: baseline.release ?? null,
    },
    safety: {
      destinationWasAbsentBeforeExport: true,
      existingDestinationRejected: true,
      pathTraversalRejected: true,
      symlinkAndJunctionEscapeRejected: true,
      includedExactBytesAndSha256Verified: true,
      protectedAndTemporaryNotCopied: true,
      selfHashIsNotTrustedSignature: true,
      gitInitialized: false,
      deploymentPerformed: false,
    },
    included: {
      files: entries.length,
      bytes: baselineSelectedBytes + supplemental.bytes,
      baselineSelected: { files: copied.length, bytes: baselineSelectedBytes },
      supplemental: { files: 1, bytes: supplemental.bytes },
      groups: [...SELECTED_GROUPS.map(group => ({
        group,
        files: copied.filter(row => row.group === group).length,
        bytes: copied.filter(row => row.group === group).reduce((total, row) => total + row.bytes, 0),
      })), { group: 'supplemental-evidence', files: 1, bytes: supplemental.bytes }],
      entries,
    },
    supplementalEvidence: {
      schema: 'nexyfab.rc-supplemental-evidence.v1',
      artifacts: [supplemental],
    },
    excluded,
    manifestFile: 'RC-SNAPSHOT-MANIFEST.json',
  });
}

export function exportCleanReleaseCandidate({
  sourceRoot = process.cwd(),
  baselinePath = DEFAULT_BASELINE,
  supplementalEvidencePath = DEFAULT_SUPPLEMENTAL_EVIDENCE,
  outputDir,
  generatedAt = new Date().toISOString(),
  dryRun = false,
} = {}) {
  const sourceAbsolute = path.resolve(sourceRoot);
  assertDirectoryNotLink(sourceAbsolute, 'source_root_symlink_or_junction_rejected');
  const sourceReal = fs.realpathSync.native(sourceAbsolute);
  if (typeof baselinePath !== 'string' || !baselinePath) fail('baseline_required');
  if (!path.isAbsolute(baselinePath)) assertSafeRelativePath(normalize(baselinePath));
  else if (normalize(baselinePath).split('/').some(part => part === '..' || part === '.')) fail('unsafe_baseline_path', baselinePath);
  const baselineAbsolute = path.resolve(sourceAbsolute, baselinePath);
  const baselineRelative = assertSafeRelativePath(path.relative(sourceAbsolute, baselineAbsolute).replaceAll(path.sep, '/'));
  const safeBaselineAbsolute = resolveSourceFile(sourceAbsolute, sourceReal, baselineRelative);
  const { value: baseline, binding: baselineBinding } = readJsonAndBinding(safeBaselineAbsolute, baselineRelative);
  const rowsByGroup = validateRows(baseline);
  verifyPolicy(rowsByGroup, baseline);
  const destination = outputDir ? path.resolve(outputDir) : null;
  if (!destination) fail('destination_required');
  validateDestination(destination, sourceAbsolute);
  const verified = verifySourceRows(rowsByGroup, sourceAbsolute, sourceReal);
  if (typeof supplementalEvidencePath !== 'string' || !supplementalEvidencePath) fail('supplemental_evidence_required');
  if (!path.isAbsolute(supplementalEvidencePath)) {
    const normalizedSupplemental = normalize(supplementalEvidencePath);
    const parts = normalizedSupplemental.split('/');
    if (normalizedSupplemental !== supplementalEvidencePath || normalizedSupplemental.startsWith('/')
      || /^[A-Za-z]:\//.test(normalizedSupplemental)
      || parts.some(part => !part || part === '.' || part === '..')) {
      fail('unsafe_supplemental_evidence_path', supplementalEvidencePath);
    }
  }
  else if (normalize(supplementalEvidencePath).split('/').some(part => part === '..' || part === '.')) {
    fail('unsafe_supplemental_evidence_path', supplementalEvidencePath);
  }
  const supplementalAbsolute = path.resolve(sourceAbsolute, supplementalEvidencePath);
  const candidateSupplementalRelative = path.relative(sourceAbsolute, supplementalAbsolute).replaceAll(path.sep, '/');
  if (!candidateSupplementalRelative || candidateSupplementalRelative === '..'
    || candidateSupplementalRelative.startsWith('../') || path.isAbsolute(candidateSupplementalRelative)) {
    fail('unsafe_supplemental_evidence_path', supplementalEvidencePath);
  }
  const supplementalRelative = assertSafeRelativePath(candidateSupplementalRelative);
  const safeSupplementalAbsolute = resolveSourceFile(sourceAbsolute, sourceReal, supplementalRelative);
  const { value: supplementalReport, binding: supplementalBinding } = readJsonAndBinding(
    safeSupplementalAbsolute,
    supplementalRelative,
    'invalid_supplemental_evidence_json',
  );
  const supplementalPreflight = validateSupplementalEvidence(
    supplementalReport,
    supplementalBinding,
    baselineBinding,
    rowsByGroup,
  );
  verifySupplementalSourceBinding(sourceAbsolute, sourceReal, supplementalBinding);
  const preflightEntries = verified.map(row => ({
    group: row.group,
    path: row.path,
    bytes: row.bytes,
    sourceSha256: row.sha256,
    destinationSha256: row.sha256,
  }));
  const manifest = buildManifest({
    sourceRoot: sourceAbsolute,
    baseline,
    baselineBinding,
    rowsByGroup,
    copied: preflightEntries,
    supplemental: supplementalPreflight,
    generatedAt,
  });
  verifyReleaseCandidateManifest(manifest, {
    expectedBaselineBinding: baselineBinding,
    expectedSupplementalBinding: supplementalBinding,
  });
  verifyBaselineSourceBinding(sourceAbsolute, sourceReal, baselineBinding);
  verifySupplementalSourceBinding(sourceAbsolute, sourceReal, supplementalBinding);
  if (dryRun) return { outputDir: destination, dryRun: true, manifest };
  try {
    fs.mkdirSync(destination);
    const copied = copyAndVerify(verified, destination, sourceAbsolute, sourceReal);
    const supplemental = copySupplementalEvidence(supplementalPreflight, destination, sourceAbsolute, sourceReal);
    verifyBaselineSourceBinding(sourceAbsolute, sourceReal, baselineBinding);
    verifySupplementalSourceBinding(sourceAbsolute, sourceReal, supplementalBinding);
    const finalManifest = buildManifest({
      sourceRoot: sourceAbsolute,
      baseline,
      baselineBinding,
      rowsByGroup,
      copied,
      supplemental,
      generatedAt,
    });
    const manifestPath = path.join(destination, 'RC-SNAPSHOT-MANIFEST.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`, { flag: 'wx' });
    const readback = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    verifyReleaseCandidateManifest(readback, {
      expectedBaselineBinding: baselineBinding,
      expectedSupplementalBinding: supplementalBinding,
    });
    if (canonicalJson(readback) !== canonicalJson(finalManifest)) fail('manifest_readback_mismatch');
    verifyBaselineSourceBinding(sourceAbsolute, sourceReal, baselineBinding);
    verifySupplementalSourceBinding(sourceAbsolute, sourceReal, supplementalBinding);
    return { outputDir: destination, dryRun: false, manifest: finalManifest };
  } catch (error) {
    removeOwnedDestination(destination);
    throw error;
  }
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)))) {
  try {
    const result = exportCleanReleaseCandidate({
      sourceRoot: valueAfter('--source-root') ?? process.cwd(),
      baselinePath: valueAfter('--baseline') ?? DEFAULT_BASELINE,
      supplementalEvidencePath: valueAfter('--supplemental-evidence') ?? DEFAULT_SUPPLEMENTAL_EVIDENCE,
      outputDir: valueAfter('--out'),
      dryRun: process.argv.includes('--dry-run'),
    });
    console.log(JSON.stringify({ outputDir: result.outputDir, dryRun: result.dryRun, included: result.manifest.included, excluded: result.manifest.excluded }, null, 2));
  } catch (error) {
    console.error(`clean-release-candidate-export-failed:${error.message}`);
    process.exitCode = 1;
  }
}
