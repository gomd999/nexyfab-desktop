#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SERVICES = 'web:nexyfab.com,openscad-worker:nexyfab-openscad-worker,fea-worker:nexyfab-fea-worker';
const DEFAULT_COST_SERVICES = 'nexyfab.com,nexyfab-openscad-worker,nexyfab-fea-worker,Postgres-KN2x,Redis-IrVt';

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

export function parseServiceMap(value) {
  const entries = String(value ?? '').split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf(':');
    if (separator <= 0 || separator === item.length - 1) throw new Error(`Invalid service mapping: ${item}`);
    return { alias: item.slice(0, separator), source: item.slice(separator + 1) };
  });
  if (!entries.length) throw new Error('At least one service mapping is required');
  for (const entry of entries) {
    if (!/^[A-Za-z0-9._-]+$/.test(entry.alias) || !/^[A-Za-z0-9._-]+$/.test(entry.source)) {
      throw new Error(`Unsafe service mapping: ${entry.alias}:${entry.source}`);
    }
  }
  if (new Set(entries.map(entry => entry.alias)).size !== entries.length) throw new Error('Service aliases must be unique');
  if (new Set(entries.map(entry => entry.source)).size !== entries.length) throw new Error('Railway source services must be unique');
  return entries;
}

export function projectReference(explicit, status) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const linked = status && typeof status === 'object' ? status : null;
  const value = linked?.id ?? linked?.project?.id ?? linked?.name ?? linked?.project?.name;
  if (typeof value !== 'string' || !value.trim()) throw new Error('A Railway project ID/name or a valid linked project is required');
  return value.trim();
}

export function buildWindows(until, windowHours, count) {
  const end = Date.parse(until);
  if (!Number.isFinite(end) || !Number.isInteger(windowHours) || windowHours <= 0 || !Number.isInteger(count) || count <= 0) {
    throw new Error('Invalid observation window configuration');
  }
  const width = windowHours * 3_600_000;
  return Array.from({ length: count }, (_, index) => {
    const windowEnd = end - (count - index - 1) * width;
    return {
      since: new Date(windowEnd - width).toISOString(),
      until: new Date(windowEnd).toISOString(),
    };
  });
}

export function normalizeMetricsSample(alias, metrics, capturedAt = new Date().toISOString(), expected = {}) {
  if (!metrics?.window?.since || !metrics?.window?.until || !metrics?.memory || !metrics?.cpu) {
    throw new Error(`Invalid Railway metrics payload for ${alias}`);
  }
  if (expected.source && metrics.service !== expected.source) throw new Error(`Railway metrics service mismatch for ${alias}`);
  if (expected.environment && metrics.environment !== expected.environment) throw new Error(`Railway metrics environment mismatch for ${alias}`);
  const since = Date.parse(metrics.window.since), until = Date.parse(metrics.window.until);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) throw new Error(`Invalid Railway metrics window for ${alias}`);
  if (expected.window) {
    const requestedSince = Date.parse(expected.window.since), requestedUntil = Date.parse(expected.window.until);
    if (Math.abs(since - requestedSince) > 1_000 || Math.abs(until - requestedUntil) > 1_000) {
      throw new Error(`Railway metrics window mismatch for ${alias}`);
    }
  }
  for (const [field, value] of [['cpu.max', metrics.cpu.max], ['memory.max_mb', metrics.memory.max_mb]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid Railway ${field} for ${alias}`);
  }
  if (alias === 'web' && (!metrics.http || typeof metrics.http.total !== 'number' || typeof metrics.http['5xx'] !== 'number')) {
    throw new Error('Web Railway HTTP metrics are required');
  }
  return {
    schema: 'nexyfab.railway-operations-sample.v1',
    capturedAt,
    service: alias,
    sourceService: metrics.service,
    environment: metrics.environment,
    window: metrics.window,
    // Preserve every deployment observed in the requested metric window. A
    // release-qualified campaign must be able to detect a window that spans a
    // removed predecessor and the current SUCCESS deployment; filtering here
    // used to make such mixed windows look release-pure.
    deploymentIds: [...new Set((metrics.deployments ?? []).map(item => item.id).filter(Boolean))],
    deploymentStatuses: (metrics.deployments ?? [])
      .filter(item => item?.id)
      .map(item => ({ id: item.id, status: item.status ?? 'UNKNOWN' })),
    cpu: metrics.cpu,
    memory: metrics.memory,
    http: metrics.http ?? null,
    volumes: metrics.volumes ?? [],
  };
}

export function scopeCostSnapshot(usage, serviceNames, capturedAt = new Date().toISOString()) {
  if (!usage?.project?.id || !usage?.billingPeriod?.start || !usage?.billingPeriod?.end || !Array.isArray(usage?.services)) {
    throw new Error('Railway service-level usage JSON is required; pass an explicit project');
  }
  if (!serviceNames.length || new Set(serviceNames).size !== serviceNames.length) throw new Error('Cost service names must be non-empty and unique');
  const wanted = new Set(serviceNames);
  const services = usage.services.filter(service => wanted.has(service.name));
  if (new Set(services.map(service => service.name)).size !== services.length) throw new Error('Railway usage contains duplicate service names');
  for (const service of services) {
    if (typeof service.totalDollars !== 'number' || !Number.isFinite(service.totalDollars) || service.totalDollars < 0) {
      throw new Error(`Invalid Railway cost for ${service.name}`);
    }
  }
  const missingServices = serviceNames.filter(name => !services.some(service => service.name === name));
  return {
    schema: 'nexyfab.railway-cost-snapshot.v1',
    capturedAt,
    billingPeriod: usage.billingPeriod,
    project: usage.project,
    scope: {
      services: services.map(service => service.name),
      missingServices,
      complete: missingServices.length === 0,
      totalDollars: services.reduce((sum, service) => sum + service.totalDollars, 0),
      breakdown: services,
    },
  };
}

export function resolveRailwayExecutable({
  platform = process.platform,
  pathValue = process.env.PATH,
} = {}) {
  if (platform !== 'win32') return 'railway';

  const where = spawnSync('where.exe', ['railway.cmd'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: pathValue },
  });
  const shim = where.status === 0
    ? String(where.stdout).split(/\r?\n/).map(value => value.trim()).find(Boolean)
    : null;
  const npmBinary = shim
    ? path.join(path.dirname(shim), 'node_modules', '@railway', 'cli', 'bin', 'railway.exe')
    : null;
  if (npmBinary && fs.existsSync(npmBinary)) return npmBinary;

  const standalone = spawnSync('where.exe', ['railway.exe'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: pathValue },
  });
  const executable = standalone.status === 0
    ? String(standalone.stdout).split(/\r?\n/).map(value => value.trim()).find(Boolean)
    : null;
  if (executable) return executable;
  throw new Error('Railway CLI executable not found (checked npm shim and standalone binary)');
}

function railwayJson(args) {
  const executable = resolveRailwayExecutable();
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`railway ${args[0]} failed: ${String(detail).trim()}`);
  }
  return JSON.parse(result.stdout);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function relativePortable(file) {
  return path.relative(process.cwd(), file).replaceAll('\\', '/');
}

function safeStamp(iso) {
  return new Date(iso).toISOString().replace(/[:.]/g, '-');
}

function main() {
  const requestedProject = arg('project') ?? process.env.RAILWAY_PROJECT_ID;
  const project = projectReference(requestedProject, requestedProject ? null : railwayJson(['status', '--json']));
  const environment = arg('environment') ?? process.env.RAILWAY_ENVIRONMENT ?? 'production';
  const windowHours = Number(arg('window-hours') ?? 6);
  const windowCount = Number(arg('windows') ?? 1);
  const until = arg('until') ?? new Date().toISOString();
  const services = parseServiceMap(arg('services') ?? process.env.RAILWAY_OPERATIONS_SERVICES ?? DEFAULT_SERVICES);
  const costServices = String(arg('cost-services') ?? process.env.RAILWAY_COST_SERVICES ?? DEFAULT_COST_SERVICES)
    .split(',').map(value => value.trim()).filter(Boolean);
  const releaseBindingFile = process.env.OPERATIONS_RELEASE_BINDING_FILE
    ? path.resolve(process.env.OPERATIONS_RELEASE_BINDING_FILE)
    : null;
  const releaseBinding = releaseBindingFile
    ? JSON.parse(fs.readFileSync(releaseBindingFile, 'utf8'))
    : null;
  if (releaseBinding && releaseBinding.environment !== environment) {
    throw new Error(`Release binding environment mismatch: ${releaseBinding.environment} != ${environment}`);
  }
  const samplesDir = path.resolve(process.env.OPERATIONS_SAMPLE_DIR ?? 'docs/evidence/operations/samples');
  const costDir = path.resolve(process.env.OPERATIONS_COST_DIR ?? 'docs/evidence/operations/cost');
  const windows = buildWindows(until, windowHours, windowCount);
  const written = [];
  const failures = [];

  for (const service of services) {
    for (const window of windows) {
      try {
        const args = ['metrics', '--service', service.source, '--environment', environment, '--since', window.since, '--until', window.until, '--json'];
        if (project) args.push('--project', project);
        const metrics = railwayJson(args);
        const sample = normalizeMetricsSample(service.alias, metrics, new Date().toISOString(), {
          source: service.source,
          environment,
          window,
        });
        const output = path.join(samplesDir, `${service.alias}-${safeStamp(sample.window.until)}.json`);
        writeJson(output, sample);
        written.push(relativePortable(output));
      } catch (error) {
        failures.push({ service: service.alias, window, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  try {
    const args = ['usage', 'projects'];
    args.push('--project', project);
    args.push('--period', 'current', '--json');
    const cost = scopeCostSnapshot(railwayJson(args), costServices);
    const output = path.join(costDir, `railway-cost-${safeStamp(cost.capturedAt)}.json`);
    writeJson(output, cost);
    written.push(relativePortable(output));
    if (cost.scope.missingServices.length) {
      failures.push({ service: 'cost-scope', error: `Missing Railway services: ${cost.scope.missingServices.join(', ')}` });
    }
  } catch (error) {
    failures.push({ service: 'cost-scope', error: error instanceof Error ? error.message : String(error) });
  }

  const campaignPath = path.resolve(process.env.OPERATIONS_CAMPAIGN_FILE ?? 'docs/evidence/operations/campaign-current.json');
  const previous = fs.existsSync(campaignPath) ? JSON.parse(fs.readFileSync(campaignPath, 'utf8')) : null;
  const startedAt = previous?.startedAt ?? new Date().toISOString();
  const campaign = {
    schema: 'nexyfab.railway-operations-campaign.v1',
    startedAt,
    targetEndsAt: new Date(Date.parse(startedAt) + 7 * 24 * 3_600_000).toISOString(),
    lastCapturedAt: new Date().toISOString(),
    project,
    environment,
    windowHours,
    requiredServices: services,
    costServices,
    releaseBinding: releaseBinding ? {
      file: relativePortable(releaseBindingFile),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(releaseBindingFile)).digest('hex'),
      buildId: releaseBinding.buildId,
      qualifyingFrom: releaseBinding.qualifyingFrom,
    } : null,
    written,
    failures,
    status: failures.length ? 'capture_failed' : 'collecting',
  };
  writeJson(campaignPath, campaign);
  process.stdout.write(`${JSON.stringify(campaign, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
