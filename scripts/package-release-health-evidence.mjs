#!/usr/bin/env node
/**
 * Copy the fixed receipts consumed by /api/health/release into a standalone
 * image. A qualified seven-day receipt is useful only when its exact source
 * bytes are also available for runtime re-verification, so those bindings are
 * copied from one narrow operations-evidence prefix. Do not turn this into a
 * docs directory copy: that tree contains private/development material.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_RECEIPT_BYTES = 2_000_000;
const MAX_BOUND_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_BOUND_EVIDENCE_FILES = 128;
const OPERATIONS_EVIDENCE_PREFIX = 'docs/evidence/operations/';
const SHA256 = /^[a-f0-9]{64}$/;

export const RELEASE_HEALTH_EVIDENCE = Object.freeze([
  Object.freeze({
    relativePath: 'docs/evidence/release/commercial-i18n-release-receipt.json',
    schema: 'nexyfab.commercial-i18n-release-receipt.v2',
  }),
  Object.freeze({
    relativePath: 'docs/evidence/release/seven-day-operations-receipt.json',
    schema: 'nexyfab.seven-day-operations-receipt.v3',
    // v1 is an older, still public-safe receipt shape. The health helper will
    // correctly report it as HOLD; packaging it keeps that fail-closed signal
    // observable instead of turning a stale receipt into a missing file.
    allowedSchemas: Object.freeze([
      'nexyfab.seven-day-operations-receipt.v1',
      'nexyfab.seven-day-operations-receipt.v3',
    ]),
  }),
  Object.freeze({
    relativePath: 'docs/evidence/release/commercial-precision-runtime-evidence.json',
    schema: 'nexyfab.commercial-precision-runtime-evidence.v3',
  }),
]);

function inside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`refusing ${label} outside ${resolvedRoot}: ${resolved}`);
  }
  // A lexical path check is not sufficient when an attacker can prepare a
  // symlinked directory below the generated output. Reject symlinks in every
  // existing component before any copy or mkdir follows one.
  const relative = path.relative(resolvedRoot, resolved);
  let current = resolvedRoot;
  for (const component of relative ? relative.split(path.sep) : []) {
    current = path.join(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`refusing ${label} through symlink: ${current}`);
    }
  }
  return resolved;
}

function regularFile(file, label, maxBytes = MAX_RECEIPT_BYTES) {
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) {
    throw new Error(`required release-health evidence is not a regular file (${label}): ${file}`);
  }
  if (statSync(file).size > maxBytes) {
    throw new Error(`release-health evidence exceeds ${maxBytes} bytes (${label}): ${file}`);
  }
}

function validateReceipt(file, expectedSchema, allowedSchemas = [expectedSchema]) {
  regularFile(file, expectedSchema);
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`release-health evidence is not valid JSON (${expectedSchema}): ${file}`, { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !allowedSchemas.includes(value.schema)) {
    throw new Error(`release-health evidence schema mismatch (expected ${allowedSchemas.join(' or ')}): ${file}`);
  }
  return value;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function normalizedBinding(binding) {
  const relativePath = typeof binding?.file === 'string' ? binding.file.replaceAll('\\', '/') : '';
  if (!relativePath.startsWith(OPERATIONS_EVIDENCE_PREFIX)
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').includes('..')
    || !SHA256.test(String(binding?.sha256 ?? ''))) {
    throw new Error(`qualified seven-day evidence binding is outside ${OPERATIONS_EVIDENCE_PREFIX}`);
  }
  return { relativePath, sha256: binding.sha256 };
}

function sevenDaySourceBindings(receipt) {
  if (receipt?.schema !== 'nexyfab.seven-day-operations-receipt.v3' || receipt?.ok !== true) return [];
  const evidence = receipt?.evidenceBindings;
  if (!evidence?.release || !evidence?.policy || !Array.isArray(evidence.samples) || !Array.isArray(evidence.costSnapshots)) {
    throw new Error('qualified seven-day receipt is missing source bindings');
  }
  const bindings = [evidence.release, evidence.policy, ...evidence.samples, ...evidence.costSnapshots].map(normalizedBinding);
  if (bindings.length > MAX_BOUND_EVIDENCE_FILES) throw new Error('qualified seven-day evidence file count exceeds limit');
  const paths = bindings.map(binding => binding.relativePath);
  if (new Set(paths).size !== paths.length) throw new Error('qualified seven-day evidence bindings must be unique');
  return bindings;
}

function copyVerifiedFile({ source, standalone, relativePath, expectedSha256 = null, maxBytes = MAX_RECEIPT_BYTES }) {
  const sourceFile = inside(source, path.join(source, ...relativePath.split('/')), 'release-health evidence source file');
  const destinationFile = inside(standalone, path.join(standalone, ...relativePath.split('/')), 'release-health evidence destination file');
  regularFile(sourceFile, relativePath, maxBytes);
  const sourceBytes = statSync(sourceFile).size;
  if (sourceBytes > maxBytes) throw new Error(`release-health bound evidence exceeds ${maxBytes} bytes: ${relativePath}`);
  const sourceSha256 = sha256(sourceFile);
  if (expectedSha256 && sourceSha256 !== expectedSha256) throw new Error(`release-health source binding hash mismatch: ${relativePath}`);
  mkdirSync(path.dirname(destinationFile), { recursive: true });
  copyFileSync(sourceFile, destinationFile);
  regularFile(destinationFile, relativePath, maxBytes);
  const destinationSha256 = sha256(destinationFile);
  if (sourceSha256 !== destinationSha256) throw new Error(`release-health evidence copy verification failed (${relativePath})`);
  return { relativePath, bytes: statSync(destinationFile).size, sha256: destinationSha256 };
}

function validateSourceFile({ source, relativePath, expectedSha256 = null, maxBytes = MAX_RECEIPT_BYTES }) {
  const sourceFile = inside(source, path.join(source, ...relativePath.split('/')), 'release-health evidence source file');
  regularFile(sourceFile, relativePath, maxBytes);
  const bytes = statSync(sourceFile).size;
  const actualSha256 = sha256(sourceFile);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`release-health source binding hash mismatch: ${relativePath}`);
  }
  return { relativePath, bytes, sha256: actualSha256, maxBytes };
}

/**
 * Validate every source byte consumed by standalone release-health packaging
 * without creating a build artifact.
 */
export function validateReleaseHealthEvidenceSource({
  projectRoot = process.cwd(),
  sourceRoot = projectRoot,
} = {}) {
  const root = path.resolve(projectRoot);
  const source = inside(root, sourceRoot, 'release-health evidence source root');
  const receipts = [];
  const files = [];
  let sevenDayReceipt = null;
  for (const entry of RELEASE_HEALTH_EVIDENCE) {
    const sourceFile = inside(source, path.join(source, entry.relativePath), 'release-health evidence source file');
    const receipt = validateReceipt(sourceFile, entry.schema, entry.allowedSchemas);
    receipts.push({ path: entry.relativePath, schema: receipt.schema });
    files.push(validateSourceFile({ source, relativePath: entry.relativePath }));
    if (entry.relativePath.endsWith('/seven-day-operations-receipt.json')) sevenDayReceipt = receipt;
  }

  let boundBytes = 0;
  for (const binding of sevenDaySourceBindings(sevenDayReceipt)) {
    const file = validateSourceFile({
      source,
      relativePath: binding.relativePath,
      expectedSha256: binding.sha256,
      maxBytes: MAX_BOUND_EVIDENCE_BYTES,
    });
    boundBytes += file.bytes;
    if (boundBytes > MAX_BOUND_EVIDENCE_BYTES) throw new Error('qualified seven-day evidence total bytes exceed limit');
    files.push(file);
  }
  return { source, receipts, files, boundBytes };
}

/**
 * Copy and verify the fixed public-safe receipt set.
 *
 * `sourceRoot` is injectable for the Docker/build-context contract; by
 * default it is the repository root. Both source and destination paths are
 * constrained to their respective roots and symlinks are rejected.
 */
export function packageReleaseHealthEvidence({
  projectRoot = process.cwd(),
  standaloneRoot,
  sourceRoot = projectRoot,
} = {}) {
  const root = path.resolve(projectRoot);
  const source = inside(root, sourceRoot, 'release-health evidence source root');
  if (!standaloneRoot) throw new Error('standaloneRoot is required to package release-health evidence');
  const standalone = path.resolve(standaloneRoot);
  inside(root, standalone, 'standalone output');
  if (path.basename(standalone) !== 'standalone') {
    throw new Error(`refusing release-health evidence destination not named standalone: ${standalone}`);
  }

  const validation = validateReleaseHealthEvidenceSource({ projectRoot: root, sourceRoot: source });
  const copied = [];
  for (const file of validation.files) {
    copied.push(copyVerifiedFile({
      source,
      standalone,
      relativePath: file.relativePath,
      expectedSha256: file.sha256,
      maxBytes: file.maxBytes,
    }));
  }
  return { copied, standalone };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const projectRoot = path.resolve(process.env.RELEASE_HEALTH_EVIDENCE_PROJECT_ROOT ?? process.cwd());
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const standaloneRoot = path.resolve(projectRoot, distDir, 'standalone');
  const sourceRoot = process.env.RELEASE_HEALTH_EVIDENCE_SOURCE_DIR
    ? path.resolve(projectRoot, process.env.RELEASE_HEALTH_EVIDENCE_SOURCE_DIR)
    : projectRoot;
  const result = packageReleaseHealthEvidence({ projectRoot, standaloneRoot, sourceRoot });
  process.stdout.write(`${JSON.stringify({ event: 'release-health-evidence-packaged', ...result })}\n`);
}
