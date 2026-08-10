#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_SERVICES = ['web', 'openscad-worker'];

function unionHours(samples) {
  const ranges = samples
    .map(sample => [Date.parse(sample.window.since), Date.parse(sample.window.until)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (!last || range[0] > last[1]) merged.push([...range]);
    else last[1] = Math.max(last[1], range[1]);
  }
  return merged.reduce((sum, [start, end]) => sum + end - start, 0) / 3_600_000;
}

export function evaluateSevenDayOperations(samples) {
  const blockers = [];
  const services = {};
  for (const service of REQUIRED_SERVICES) {
    const rows = samples.filter(sample => sample.service === service);
    const coverageHours = unionHours(rows);
    const maxMemoryMb = Math.max(0, ...rows.map(row => Number(row.memory?.max_mb ?? 0)));
    const totalRequests = rows.reduce((sum, row) => sum + Number(row.http?.total ?? 0), 0);
    const total5xx = rows.reduce((sum, row) => sum + Number(row.http?.['5xx'] ?? 0), 0);
    const errorRatePercent = totalRequests > 0 ? total5xx / totalRequests * 100 : 0;
    const memoryLimit = service === 'web' ? 768 : 512;
    if (coverageHours < 162) blockers.push(`coverage_short:${service}:${coverageHours.toFixed(1)}h`);
    if (rows.length < 28) blockers.push(`sample_count_short:${service}:${rows.length}`);
    if (maxMemoryMb > memoryLimit) blockers.push(`memory_target_failed:${service}:${maxMemoryMb.toFixed(1)}mb`);
    if (service === 'web' && errorRatePercent > 1) blockers.push(`http_5xx_target_failed:${errorRatePercent.toFixed(2)}pct`);
    services[service] = { samples: rows.length, coverageHours, maxMemoryMb, memoryLimitMb: memoryLimit, totalRequests, total5xx, errorRatePercent };
  }
  return {
    schema: 'nexyfab.seven-day-operations-receipt.v1',
    generatedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    services,
    blockers,
  };
}

function main() {
  const directory = path.resolve(process.env.OPERATIONS_SAMPLE_DIR ?? 'docs/evidence/operations/samples');
  const samples = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
    : [];
  const receipt = evaluateSevenDayOperations(samples);
  const output = path.resolve(process.env.SEVEN_DAY_OPERATIONS_OUTPUT ?? 'docs/evidence/release/seven-day-operations-receipt.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
