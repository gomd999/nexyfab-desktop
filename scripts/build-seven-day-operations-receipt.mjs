#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_SERVICES = ['web', 'openscad-worker', 'fea-worker'];
const REQUIRED_SERVICE_SOURCES = {
  web: 'nexyfab.com',
  'openscad-worker': 'nexyfab-openscad-worker',
  'fea-worker': 'nexyfab-fea-worker',
};
const REQUIRED_COST_SERVICES = ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'];
const DEFAULT_MONTHLY_COST_BUDGET_USD = 50;
const REQUIRED_COVERAGE_HOURS = 168;
const DEFAULT_MEMORY_LIMITS_MB = {
  web: 768,
  'openscad-worker': 512,
  'fea-worker': 2048,
};

export function analyzeSampleWindows(samples, expectedWindowHours = 6) {
  const invalid = [];
  const ranges = [];
  for (const [index, sample] of samples.entries()) {
    const start = Date.parse(sample?.window?.since), end = Date.parse(sample?.window?.until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      invalid.push(index);
      continue;
    }
    ranges.push([start, end]);
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  let overlaps = 0, gaps = 0, durationMismatches = 0;
  const unique = new Set();
  for (const range of ranges) {
    const key = `${range[0]}:${range[1]}`;
    if (unique.has(key)) overlaps += 1;
    unique.add(key);
    if (Math.abs((range[1] - range[0]) / 3_600_000 - expectedWindowHours) > 1 / 60) durationMismatches += 1;
    const last = merged.at(-1);
    if (!last) merged.push([...range]);
    else if (range[0] > last[1]) { gaps += 1; merged.push([...range]); }
    else {
      if (range[0] < last[1] && key !== `${last[0]}:${last[1]}`) overlaps += 1;
      last[1] = Math.max(last[1], range[1]);
    }
  }
  const coverageHours = merged.reduce((sum, [start, end]) => sum + end - start, 0) / 3_600_000;
  const spanHours = ranges.length ? (ranges.at(-1)[1] - ranges[0][0]) / 3_600_000 : 0;
  return { coverageHours, spanHours, invalidWindows: invalid.length, uniqueWindows: unique.size, overlaps, gaps, durationMismatches };
}

export function evaluateCostCampaign(
  costSnapshots,
  monthlyBudgetDollars = DEFAULT_MONTHLY_COST_BUDGET_USD,
  requiredCostServices = REQUIRED_COST_SERVICES,
  requiredCoverageHours = REQUIRED_COVERAGE_HOURS,
) {
  const invalidRows = costSnapshots.filter(row => !Number.isFinite(Date.parse(row?.capturedAt))
    || typeof row?.scope?.totalDollars !== 'number' || !Number.isFinite(row.scope.totalDollars) || row.scope.totalDollars < 0);
  const rows = [...costSnapshots]
    .filter(row => !invalidRows.includes(row))
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const blockers = [];
  if (invalidRows.length) blockers.push(`cost_samples_invalid:${invalidRows.length}`);
  if (!requiredCostServices.length || new Set(requiredCostServices).size !== requiredCostServices.length) {
    blockers.push('cost_required_services_invalid');
  }
  if (rows.length < 2) {
    return { ok: false, blockers: [...blockers, 'cost_samples_short'], samples: rows.length };
  }
  const first = rows[0];
  const last = rows.at(-1);
  const coverageHours = (Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / 3_600_000;
  const deltaDollars = last.scope.totalDollars - first.scope.totalDollars;
  const periodStart = Date.parse(first.billingPeriod?.start), periodEnd = Date.parse(first.billingPeriod?.end);
  const billingPeriodHours = (periodEnd - periodStart) / 3_600_000;
  const billingPeriodStable = rows.every(row => row.billingPeriod?.start === first.billingPeriod?.start
    && row.billingPeriod?.end === first.billingPeriod?.end);
  const projectStable = rows.every(row => row.project?.id && row.project.id === first.project?.id);
  const required = new Set(requiredCostServices);
  const scopeComplete = rows.every(row => row.scope?.complete === true
    && Array.isArray(row.scope?.services)
    && Array.isArray(row.scope?.missingServices)
    && row.scope.missingServices.length === 0
    && [...required].every(name => row.scope.services.includes(name))
    && new Set(row.scope.services).size === row.scope.services.length
    && Array.isArray(row.scope.breakdown)
    && row.scope.breakdown.length === row.scope.services.length
    && row.scope.breakdown.every(service => row.scope.services.includes(service?.name)
      && typeof service?.totalDollars === 'number' && Number.isFinite(service.totalDollars) && service.totalDollars >= 0)
    && Math.abs(row.scope.breakdown.reduce((sum, service) => sum + service.totalDollars, 0) - row.scope.totalDollars) < 1e-6);
  const monotonic = rows.every((row, index) => index === 0 || row.scope.totalDollars >= rows[index - 1].scope.totalDollars);
  const projectedMonthlyDollars = coverageHours > 0 && deltaDollars >= 0
    && Number.isFinite(billingPeriodHours) && billingPeriodHours > 0
    ? deltaDollars / coverageHours * billingPeriodHours
    : null;
  if (coverageHours < requiredCoverageHours) blockers.push(`cost_coverage_short:${coverageHours.toFixed(1)}h`);
  if (!billingPeriodStable) blockers.push('cost_billing_period_changed');
  if (!projectStable) blockers.push('cost_project_changed_or_missing');
  if (!scopeComplete) blockers.push('cost_scope_incomplete');
  if (!monotonic || deltaDollars < 0) blockers.push('cost_counter_regressed');
  if (!Number.isFinite(monthlyBudgetDollars) || monthlyBudgetDollars <= 0) blockers.push('monthly_cost_budget_invalid');
  if (!Number.isFinite(billingPeriodHours) || billingPeriodHours < 24 * 27 || billingPeriodHours > 24 * 32) blockers.push('cost_billing_period_invalid');
  if (projectedMonthlyDollars === null) blockers.push('cost_projection_unavailable');
  else if (projectedMonthlyDollars > monthlyBudgetDollars) {
    blockers.push(`monthly_cost_target_failed:${projectedMonthlyDollars.toFixed(2)}usd`);
  }
  return {
    ok: blockers.length === 0,
    blockers,
    samples: rows.length,
    coverageHours,
    deltaDollars,
    billingPeriodHours,
    projectedMonthlyDollars,
    monthlyBudgetDollars,
    scopedServices: last.scope?.services ?? [],
  };
}

function releaseExclusionReason(sample, service, releaseBinding) {
  if (!releaseBinding) return null;
  const serviceBinding = releaseBinding.services?.[service];
  if (!serviceBinding) return 'service_not_bound';
  const windowStart = Date.parse(sample?.window?.since);
  const qualifyingFrom = Date.parse(releaseBinding.qualifyingFrom);
  if (!Number.isFinite(windowStart) || !Number.isFinite(qualifyingFrom) || windowStart < qualifyingFrom) {
    return 'window_before_qualifying_from';
  }
  const deploymentIds = Array.isArray(sample?.deploymentIds)
    ? [...new Set(sample.deploymentIds.filter(value => typeof value === 'string' && value))]
    : [];
  if (deploymentIds.length !== 1 || deploymentIds[0] !== serviceBinding.deploymentId) {
    return 'deployment_mismatch';
  }
  return null;
}

export function evaluateSevenDayOperations(samples, options = {}) {
  const blockers = [];
  const services = {};
  const requiredServices = options.requiredServices ?? REQUIRED_SERVICES;
  const requiredServiceSources = options.requiredServiceSources ?? REQUIRED_SERVICE_SOURCES;
  const requiredCoverageHours = options.requiredCoverageHours ?? REQUIRED_COVERAGE_HOURS;
  const requiredSampleCount = options.requiredSampleCount ?? 28;
  const expectedWindowHours = options.expectedWindowHours ?? 6;
  const http5xxMaxPercent = options.http5xxMaxPercent ?? 1;
  const memoryLimitsMb = { ...DEFAULT_MEMORY_LIMITS_MB, ...(options.memoryLimitsMb ?? {}) };
  const requireRuntimeMemoryLimitEvidence = options.requireRuntimeMemoryLimitEvidence === true;
  const releaseBinding = options.releaseBinding ?? null;
  if (new Set(requiredServices).size !== requiredServices.length) blockers.push('required_services_duplicate');
  if (releaseBinding) {
    if (releaseBinding.environment !== (options.environment ?? 'production')) blockers.push('release_binding_environment_mismatch');
    if (!Number.isFinite(Date.parse(releaseBinding.qualifyingFrom))) blockers.push('release_binding_qualifying_time_invalid');
    for (const service of requiredServices) {
      const bound = releaseBinding.services?.[service];
      if (!bound?.deploymentId || bound.sourceService !== requiredServiceSources[service]) {
        blockers.push(`release_binding_service_invalid:${service}`);
      }
    }
  }
  for (const service of requiredServices) {
    const allRows = samples.filter(sample => sample.service === service);
    const excluded = allRows.map(sample => ({ sample, reason: releaseExclusionReason(sample, service, releaseBinding) }))
      .filter(item => item.reason);
    const excludedSet = new Set(excluded.map(item => item.sample));
    const rows = allRows.filter(sample => !excludedSet.has(sample));
    const windows = analyzeSampleWindows(rows, expectedWindowHours);
    const invalidMetrics = rows.filter(row => row.schema !== 'nexyfab.railway-operations-sample.v1'
      || row.sourceService !== requiredServiceSources[service]
      || row.environment !== (options.environment ?? 'production')
      || !Number.isFinite(Date.parse(row.capturedAt))
      || !Array.isArray(row.deploymentIds) || !row.deploymentIds.length || row.deploymentIds.some(id => typeof id !== 'string' || !id)
      || typeof row.memory?.max_mb !== 'number' || !Number.isFinite(row.memory.max_mb)
      || typeof row.cpu?.max !== 'number' || !Number.isFinite(row.cpu.max));
    const maxMemoryMb = Math.max(0, ...rows.map(row => Number(row.memory?.max_mb ?? 0)));
    const totalRequests = rows.reduce((sum, row) => sum + Number(row.http?.total ?? 0), 0);
    const total5xx = rows.reduce((sum, row) => sum + Number(row.http?.['5xx'] ?? 0), 0);
    const errorRatePercent = totalRequests > 0 ? total5xx / totalRequests * 100 : 0;
    const memoryLimit = Number(memoryLimitsMb[service]);
    const runtimeMemoryLimits = rows.map(row => Number(row.memory?.limit_mb)).filter(Number.isFinite);
    const minimumRuntimeMemoryLimitMb = runtimeMemoryLimits.length ? Math.min(...runtimeMemoryLimits) : null;
    if (!Number.isFinite(memoryLimit) || memoryLimit <= 0) blockers.push(`memory_limit_invalid:${service}`);
    if (requireRuntimeMemoryLimitEvidence && rows.length > 0
      && (runtimeMemoryLimits.length !== rows.length || minimumRuntimeMemoryLimitMb < memoryLimit)) {
      blockers.push(`runtime_memory_limit_evidence_failed:${service}`);
    }
    if (windows.coverageHours < requiredCoverageHours) blockers.push(`coverage_short:${service}:${windows.coverageHours.toFixed(1)}h`);
    if (rows.length < requiredSampleCount) blockers.push(`sample_count_short:${service}:${rows.length}`);
    if (windows.uniqueWindows < requiredSampleCount) blockers.push(`unique_window_count_short:${service}:${windows.uniqueWindows}`);
    if (windows.invalidWindows) blockers.push(`window_invalid:${service}:${windows.invalidWindows}`);
    if (windows.overlaps) blockers.push(`window_overlap:${service}:${windows.overlaps}`);
    if (windows.gaps) blockers.push(`window_gap:${service}:${windows.gaps}`);
    if (windows.durationMismatches) blockers.push(`window_duration_mismatch:${service}:${windows.durationMismatches}`);
    if (invalidMetrics.length) blockers.push(`metrics_invalid:${service}:${invalidMetrics.length}`);
    if (Number.isFinite(memoryLimit) && maxMemoryMb > memoryLimit) blockers.push(`memory_target_failed:${service}:${maxMemoryMb.toFixed(1)}mb`);
    if (service === 'web' && (rows.some(row => !row.http || typeof row.http.total !== 'number' || typeof row.http['5xx'] !== 'number') || totalRequests <= 0)) {
      blockers.push('http_evidence_missing:web');
    }
    if (service === 'web' && errorRatePercent > http5xxMaxPercent) blockers.push(`http_5xx_target_failed:${errorRatePercent.toFixed(2)}pct`);
    services[service] = {
      samples: rows.length,
      observedSamples: allRows.length,
      excludedSamples: excluded.length,
      exclusionReasons: [...new Set(excluded.map(item => item.reason))],
      ...windows,
      maxMemoryMb,
      memoryLimitMb: memoryLimit,
      minimumRuntimeMemoryLimitMb,
      totalRequests,
      total5xx,
      errorRatePercent,
    };
  }
  const cost = evaluateCostCampaign(
    options.costSnapshots ?? [],
    options.monthlyCostBudgetUsd,
    options.requiredCostServices ?? REQUIRED_COST_SERVICES,
    requiredCoverageHours,
  );
  blockers.push(...cost.blockers);
  return {
    schema: 'nexyfab.seven-day-operations-receipt.v3',
    generatedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    services,
    cost,
    policy: {
      requiredCoverageHours,
      requiredSampleCount,
      expectedWindowHours,
      http5xxMaxPercent,
      memoryLimitsMb,
      requireRuntimeMemoryLimitEvidence,
      monthlyCostBudgetUsd: options.monthlyCostBudgetUsd ?? DEFAULT_MONTHLY_COST_BUDGET_USD,
    },
    release: releaseBinding ? {
      buildId: releaseBinding.buildId,
      qualifyingFrom: releaseBinding.qualifyingFrom,
      environment: releaseBinding.environment,
      deployments: Object.fromEntries(requiredServices.map(service => [service, releaseBinding.services?.[service]?.deploymentId ?? null])),
    } : null,
    blockers,
  };
}

function loadJsonEvidence(envName) {
  const configured = process.env[envName];
  if (!configured) return { value: null, evidence: null };
  const absolute = path.resolve(configured);
  const bytes = fs.readFileSync(absolute);
  return {
    value: JSON.parse(bytes.toString('utf8')),
    evidence: {
      file: path.relative(process.cwd(), absolute).replaceAll('\\', '/'),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function main() {
  const directory = path.resolve(process.env.OPERATIONS_SAMPLE_DIR ?? 'docs/evidence/operations/samples');
  const samples = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
    : [];
  const costDirectory = path.resolve(process.env.OPERATIONS_COST_DIR ?? 'docs/evidence/operations/cost');
  const costSnapshots = fs.existsSync(costDirectory)
    ? fs.readdirSync(costDirectory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(costDirectory, name), 'utf8')))
    : [];
  const requiredCostServices = String(process.env.RAILWAY_COST_SERVICES ?? REQUIRED_COST_SERVICES.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const release = loadJsonEvidence('OPERATIONS_RELEASE_BINDING_FILE');
  const policy = loadJsonEvidence('OPERATIONS_POLICY_FILE');
  const policyValue = policy.value ?? {};
  const receipt = evaluateSevenDayOperations(samples, {
    costSnapshots,
    environment: process.env.OPERATIONS_ENVIRONMENT ?? 'production',
    monthlyCostBudgetUsd: Number(process.env.RAILWAY_MONTHLY_COST_BUDGET_USD ?? policyValue.monthlyCostBudgetUsd ?? DEFAULT_MONTHLY_COST_BUDGET_USD),
    requiredCostServices,
    releaseBinding: release.value,
    requiredCoverageHours: policyValue.requiredCoverageHours,
    requiredSampleCount: policyValue.requiredSampleCount,
    expectedWindowHours: policyValue.expectedWindowHours,
    http5xxMaxPercent: policyValue.http5xxMaxPercent,
    memoryLimitsMb: policyValue.memoryLimitsMb,
    requireRuntimeMemoryLimitEvidence: policyValue.requireRuntimeMemoryLimitEvidence,
  });
  receipt.evidenceBindings = { release: release.evidence, policy: policy.evidence };
  const output = path.resolve(process.env.SEVEN_DAY_OPERATIONS_OUTPUT ?? 'docs/evidence/release/seven-day-operations-receipt.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
