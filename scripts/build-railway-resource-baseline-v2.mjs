#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { attachReceiptSha256 } from './immutable-receipt-binding.mjs';

const SCHEMA = 'nexyfab.railway-resource-baseline.v2';
const DEFAULT_TARGET_MB = 768;
const DEFAULT_WINDOW_HOURS = 6;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const RESOURCE_METRICS_SCHEMA = 'nexyfab.railway-resource-metrics.v1';

// These are measurement fields, rather than assessment/policy fields. In
// particular, never include runtimeMemoryTargetMb or currentMaxWithinTarget
// when deriving maxMb: those values are claims made by an evidence packet.
const MAX_MEMORY_KEYS = new Set(['maxmb', 'max_mb', 'maxmemorymb', 'max_memory_mb']);
const MEMORY_SAMPLE_KEYS = new Set([
  'memorymb', 'memory_mb', 'currentmb', 'current_mb', 'rssmb', 'rss_mb',
  'usedmb', 'used_mb', 'residentmb', 'resident_mb',
]);
const LIMIT_MEMORY_KEYS = new Set(['limitmb', 'limit_mb', 'memorylimitmb', 'memory_limit_mb']);

function normalizedKey(key) {
  return String(key).replaceAll('-', '_').toLowerCase();
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function walkMemoryMeasurements(value, state) {
  if (Array.isArray(value)) {
    for (const item of value) walkMemoryMeasurements(item, state);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [rawKey, child] of Object.entries(value)) {
    const normalized = normalizedKey(rawKey);
    if (typeof child === 'number' && finiteNonNegative(child)) {
      if (MAX_MEMORY_KEYS.has(normalized)) state.max.push(child);
      else if (MEMORY_SAMPLE_KEYS.has(normalized) || normalized === 'memory') state.samples.push(child);
      else if (LIMIT_MEMORY_KEYS.has(normalized)) state.limits.push(child);
    }
    // A nested `memory: { ... }` object is traversed just like a sample row.
    walkMemoryMeasurements(child, state);
  }
}

function firstTimestamp(value, keys = new Set(['capturedat', 'captured_at', 'sampledat', 'sampled_at', 'observedat', 'observed_at'])) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTimestamp(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [rawKey, child] of Object.entries(value)) {
    const key = normalizedKey(rawKey);
    if (keys.has(key) && typeof child === 'string' && Number.isFinite(Date.parse(child))) return child;
    const found = firstTimestamp(child, keys);
    if (found) return found;
  }
  return null;
}

function asIso(value, field) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO-parseable timestamp`);
  return new Date(parsed).toISOString();
}

function sourceBinding(root, sourcePath, bytes) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('sourcePath is required');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, sourcePath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('sourcePath must be inside root');
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('sourcePath must not be a symbolic link');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('sourcePath resolves outside root');
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) throw new Error('sourcePath must be a regular file');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  return { path: relative.replaceAll('\\', '/'), bytes: bytes.byteLength, sha256: expected };
}

/** Read and parse the exact bytes that will be bound in sourceBindings. */
export function readBoundJsonSource(sourcePath, { root = process.cwd() } = {}) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, sourcePath);
  const bytes = fs.readFileSync(absolute);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`sourcePath must contain valid JSON: ${error.message}`);
  }
  return { value, bytes, binding: sourceBinding(resolvedRoot, sourcePath, bytes) };
}

function releaseBinding(input) {
  const release = input?.release ?? input ?? {};
  const buildId = release.buildId;
  const deploymentId = release.deploymentId;
  const gitHead = release.gitHead ?? release.head;
  if (typeof buildId !== 'string' || !buildId.trim()) throw new Error('release.buildId is required');
  if (typeof deploymentId !== 'string' || !deploymentId.trim()) throw new Error('release.deploymentId is required');
  if (typeof gitHead !== 'string' || !GIT_COMMIT_SHA.test(gitHead.trim())) {
    throw new Error('release.gitHead must be a real 40- or 64-character git SHA');
  }
  return { buildId: buildId.trim(), deploymentId: deploymentId.trim(), gitHead: gitHead.trim() };
}

function deriveMemory(source) {
  const state = { max: [], samples: [], limits: [] };
  walkMemoryMeasurements(source, state);
  const measurements = [...state.max, ...state.samples];
  if (!measurements.length) throw new Error('source JSON contains no memory measurements');
  const maxMb = Math.max(...measurements);
  const limitMb = state.limits.length ? Math.max(...state.limits) : undefined;
  return { maxMb, limitMb };
}

function positiveFinite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

/**
 * Keep only normalized resource measurements from a Railway metrics payload.
 * The raw payload is intentionally never copied: it may contain unrelated
 * fields such as deployment metadata or environment values.
 */
export function normalizeRailwayResourceMetrics({
  metrics,
  service = 'nexyfab.com',
  environment = 'production',
  capturedAt = new Date().toISOString(),
  windowHours = DEFAULT_WINDOW_HOURS,
} = {}) {
  if (!metrics || typeof metrics !== 'object') throw new Error('Railway metrics payload is required');
  if (typeof service !== 'string' || !/^[A-Za-z0-9._-]+$/.test(service.trim())) throw new Error('service must be a safe name');
  if (environment !== 'production') throw new Error('environment must be production');
  if (!Number.isFinite(windowHours) || windowHours <= 0) throw new Error('windowHours must be a positive finite number');
  const captured = asIso(capturedAt, 'capturedAt');
  const state = { max: [], samples: [], limits: [] };
  walkMemoryMeasurements(metrics.memory, state);
  const measurements = [...state.max, ...state.samples];
  if (!measurements.length) throw new Error('Railway metrics payload contains no memory measurements');
  const memory = {
    maxMb: Math.max(...measurements),
    samples: state.samples.map(value => ({ memoryMb: positiveFinite(value, 'memory sample') })),
    ...(state.limits.length ? { limitMb: Math.max(...state.limits) } : {}),
  };
  if (memory.maxMb === 0 && !state.samples.length) throw new Error('Railway metrics payload contains no usable memory measurements');
  return {
    schema: RESOURCE_METRICS_SCHEMA,
    capturedAt: captured,
    service: service.trim(),
    environment,
    windowHours,
    memory,
  };
}

function railwayCommand() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const script = path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js');
    if (fs.existsSync(script)) return { file: process.execPath, prefix: [script] };
  }
  return { file: 'railway', prefix: [] };
}

export function railwayResourceMetricsArguments(service, environment, { since, until, project } = {}) {
  if (typeof service !== 'string' || !/^[A-Za-z0-9._-]+$/.test(service.trim())) {
    throw new Error('service must be a safe name');
  }
  if (environment !== 'production') throw new Error('environment must be production');
  const args = ['metrics', '--service', service.trim(), '--environment', environment];
  if (since) args.push('--since', since);
  if (until) args.push('--until', until);
  if (project) args.push('--project', project);
  // Railway documents --memory as the memory resource selector and --raw as
  // the time-series form. Keep the JSON flag last for a machine-only payload.
  args.push('--memory', '--raw', '--json');
  return args;
}

function loadRailwayResourceMetrics(service, environment, { since, until, project } = {}) {
  const command = railwayCommand();
  const args = [...command.prefix, ...railwayResourceMetricsArguments(service, environment, { since, until, project })];
  const raw = execFileSync(command.file, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

function pathInside(parent, candidate, { allowSame = false } = {}) {
  const relative = path.relative(parent, candidate);
  return (allowSame && !relative) || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingDirectory(directory) {
  let current = path.resolve(directory);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('output parent directory does not exist');
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) throw new Error('output parent must resolve through a directory');
  return current;
}

function outputInsideRoot(root, outputPath, field = 'sourcePath') {
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error(`${field} is required`);
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, outputPath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!pathInside(resolvedRoot, absolute)) throw new Error(`${field} must be inside root`);

  const realRoot = fs.realpathSync.native(resolvedRoot);
  const existingParent = nearestExistingDirectory(path.dirname(absolute));
  const realExistingParent = fs.realpathSync.native(existingParent);
  if (!pathInside(realRoot, realExistingParent, { allowSame: true })) {
    throw new Error(`${field} parent resolves outside root`);
  }
  if (fs.existsSync(absolute)) {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`${field} must not be a symbolic link`);
    const realOutput = fs.realpathSync.native(absolute);
    if (!pathInside(realRoot, realOutput)) throw new Error(`${field} resolves outside root`);
    if (!fs.statSync(realOutput).isFile()) throw new Error(`${field} must be a regular file`);
  }
  return { absolute, relative: relative.replaceAll('\\', '/') };
}

function writeFileInsideRoot(root, outputPath, bytes, field = 'sourcePath') {
  const output = outputInsideRoot(root, outputPath, field);
  fs.mkdirSync(path.dirname(output.absolute), { recursive: true });
  // Re-resolve after mkdir so a pre-existing parent junction cannot redirect
  // the write outside the evidence root.
  const checked = outputInsideRoot(root, output.relative, field);
  fs.writeFileSync(checked.absolute, bytes);
  return checked;
}

/** Capture one Railway metrics response in memory, persist only its normalized
 * measurement source, then bind the baseline receipt to those exact bytes. */
export function captureRailwayResourceBaselineV2({
  metrics,
  loadMetrics = loadRailwayResourceMetrics,
  sourcePath,
  root = process.cwd(),
  service = 'nexyfab.com',
  environment = 'production',
  project,
  release,
  buildId,
  deploymentId,
  gitHead,
  runtimeMemoryTargetMb = DEFAULT_TARGET_MB,
  targetMb,
  windowHours = DEFAULT_WINDOW_HOURS,
  capturedAt = new Date().toISOString(),
  generatedAt,
  now = Date.now(),
} = {}) {
  if (!Number.isFinite(windowHours) || windowHours <= 0) throw new Error('windowHours must be a positive finite number');
  if (typeof service !== 'string' || !/^[A-Za-z0-9._-]+$/.test(service.trim())) throw new Error('service must be a safe name');
  if (environment !== 'production') throw new Error('environment must be production');
  const captureTime = asIso(capturedAt, 'capturedAt');
  const until = captureTime;
  const since = new Date(Date.parse(captureTime) - windowHours * 3_600_000).toISOString();
  const output = outputInsideRoot(root, sourcePath);
  const rawMetrics = metrics ?? loadMetrics(service, environment, { since, until, project });
  if (rawMetrics?.service !== undefined && rawMetrics.service !== service) {
    throw new Error('Railway metrics service mismatch');
  }
  if (rawMetrics?.environment !== undefined && rawMetrics.environment !== environment) {
    throw new Error('Railway metrics environment mismatch');
  }
  if (rawMetrics?.window?.since || rawMetrics?.window?.until) {
    const measuredSince = Date.parse(rawMetrics.window.since ?? '');
    const measuredUntil = Date.parse(rawMetrics.window.until ?? '');
    if (!Number.isFinite(measuredSince) || !Number.isFinite(measuredUntil)
      || Math.abs(measuredSince - Date.parse(since)) > 1_000
      || Math.abs(measuredUntil - Date.parse(until)) > 1_000) {
      throw new Error('Railway metrics window mismatch');
    }
  }
  const normalized = normalizeRailwayResourceMetrics({ metrics: rawMetrics, service, environment, capturedAt: captureTime, windowHours });
  const sourceBytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  writeFileInsideRoot(root, output.relative, sourceBytes);
  return buildRailwayResourceBaseline({
    root,
    sourcePath: output.relative,
    release: release ?? { buildId, deploymentId, gitHead },
    runtimeMemoryTargetMb,
    targetMb,
    windowHours,
    capturedAt: captureTime,
    generatedAt,
    now,
  });
}

export const captureRailwayResourceBaseline = captureRailwayResourceBaselineV2;

/**
 * Build a fresh, release-bound v2 receipt from a JSON measurement source.
 *
 * `sourcePath` is deliberately mandatory. The source is read from disk and
 * hashed before parsing, so callers cannot bind one set of bytes while using
 * another set to derive the memory result. `runtimeMemoryTargetMb` is policy
 * input; all assessment booleans are derived from the measured bytes.
 */
export function buildRailwayResourceBaseline({
  sourcePath,
  root = process.cwd(),
  release,
  buildId,
  deploymentId,
  gitHead,
  runtimeMemoryTargetMb = DEFAULT_TARGET_MB,
  targetMb,
  windowHours = DEFAULT_WINDOW_HOURS,
  service = 'nexyfab.com',
  environment = 'production',
  capturedAt,
  generatedAt,
  now = Date.now(),
} = {}) {
  const source = readBoundJsonSource(sourcePath, { root });
  const releaseValue = releaseBinding(release ?? { buildId, deploymentId, gitHead });
  const target = targetMb ?? runtimeMemoryTargetMb;
  if (!finiteNonNegative(target) || target <= 0) throw new Error('runtimeMemoryTargetMb must be a positive finite number');
  if (!Number.isFinite(windowHours) || windowHours <= 0) throw new Error('windowHours must be a positive finite number');
  if (typeof service !== 'string' || !service.trim()) throw new Error('service is required');
  if (environment !== 'production') throw new Error('environment must be production');
  if (!Number.isFinite(now)) throw new Error('now must be a finite epoch timestamp');

  const memory = deriveMemory(source.value);
  const generated = asIso(generatedAt ?? new Date(now).toISOString(), 'generatedAt');
  const capture = asIso(capturedAt ?? firstTimestamp(source.value) ?? generated, 'capturedAt');
  const receipt = {
    schema: SCHEMA,
    generatedAt: generated,
    capturedAt: capture,
    service: service.trim(),
    environment,
    windowHours,
    release: releaseValue,
    sourceBindings: [source.binding],
    memory: {
      maxMb: memory.maxMb,
      ...(memory.limitMb === undefined ? {} : { limitMb: memory.limitMb }),
    },
    assessment: {
      runtimeMemoryTargetMb: target,
      currentMaxWithinTarget: memory.maxMb <= target,
      sevenDayBaselineRequired: true,
    },
  };
  return attachReceiptSha256(receipt);
}

// Short alias for consumers that use the schema name as the operation.
export const buildResourceBaseline = buildRailwayResourceBaseline;

export function verifyRailwayResourceBaselineDerivation(receipt, { root = process.cwd() } = {}) {
  try {
    if (!Array.isArray(receipt?.sourceBindings) || receipt.sourceBindings.length !== 1) return false;
    const expectedBinding = receipt.sourceBindings[0];
    const source = readBoundJsonSource(expectedBinding?.path, { root });
    if (source.binding.path !== expectedBinding.path
      || source.binding.bytes !== expectedBinding.bytes
      || source.binding.sha256 !== expectedBinding.sha256) return false;
    const memory = deriveMemory(source.value);
    const capturedAt = asIso(firstTimestamp(source.value) ?? receipt.generatedAt, 'capturedAt');
    const limitMatches = memory.limitMb === undefined
      ? !Object.hasOwn(receipt?.memory ?? {}, 'limitMb')
      : receipt?.memory?.limitMb === memory.limitMb;
    return receipt?.memory?.maxMb === memory.maxMb
      && limitMatches
      && receipt?.capturedAt === capturedAt;
  } catch {
    return false;
  }
}

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(item => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function cli() {
  const root = path.resolve(argument('root', process.cwd()));
  const release = {
    buildId: argument('build-id'),
    deploymentId: argument('deployment-id'),
    gitHead: argument('git-head'),
  };
  const windowHours = Number(argument('window-hours', DEFAULT_WINDOW_HOURS));
  const now = argument('now') ? Date.parse(argument('now')) : Date.now();
  const metricsSourcePath = argument('metrics-source') ?? argument('metrics-fixture');
  const receipt = metricsSourcePath
    ? captureRailwayResourceBaselineV2({
      metrics: readBoundJsonSource(metricsSourcePath, { root }).value,
      sourcePath: argument('source-out', 'docs/evidence/release/railway-resource-metrics-capture.json'),
      root,
      service: argument('service', 'nexyfab.com'),
      environment: argument('environment', 'production'),
      project: argument('project'),
      release,
      runtimeMemoryTargetMb: Number(argument('target-mb', DEFAULT_TARGET_MB)),
      windowHours,
      capturedAt: argument('captured-at', new Date(now).toISOString()),
      generatedAt: argument('generated-at'),
      now,
    })
    : argument('source') || argument('input')
      ? buildRailwayResourceBaseline({
        sourcePath: argument('source') ?? argument('input'),
        root,
        release,
        runtimeMemoryTargetMb: Number(argument('target-mb', DEFAULT_TARGET_MB)),
        windowHours,
        capturedAt: argument('captured-at'),
        generatedAt: argument('generated-at'),
        now,
      })
      : captureRailwayResourceBaselineV2({
        sourcePath: argument('source-out', 'docs/evidence/release/railway-resource-metrics-capture.json'),
        root,
        service: argument('service', 'nexyfab.com'),
        environment: argument('environment', 'production'),
        project: argument('project'),
        release,
        runtimeMemoryTargetMb: Number(argument('target-mb', DEFAULT_TARGET_MB)),
        windowHours,
        capturedAt: argument('captured-at', new Date(now).toISOString()),
        generatedAt: argument('generated-at'),
        now,
      });
  const output = argument('out') ?? argument('output');
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (output) {
    writeFileInsideRoot(root, output, text, 'output');
  } else process.stdout.write(text);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)));
if (invoked) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
