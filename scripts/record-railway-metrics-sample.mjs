#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const serviceArg = process.argv.find(value => value.startsWith('--service='));
const service = serviceArg?.slice('--service='.length)?.trim();
if (!service || !/^[A-Za-z0-9._-]+$/.test(service)) throw new Error('--service=<safe-name> is required');

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const metrics = JSON.parse(raw);
if (!metrics.window?.since || !metrics.window?.until || !metrics.memory || !metrics.cpu) {
  throw new Error('Invalid Railway metrics payload');
}
const sample = {
  schema: 'nexyfab.railway-operations-sample.v1',
  capturedAt: new Date().toISOString(),
  service,
  sourceService: metrics.service,
  environment: metrics.environment,
  window: metrics.window,
  deploymentIds: (metrics.deployments ?? []).filter(item => item.status === 'SUCCESS').map(item => item.id),
  cpu: metrics.cpu,
  memory: metrics.memory,
  http: metrics.http ?? null,
  volumes: metrics.volumes ?? [],
};
const stamp = new Date(metrics.window.until).toISOString().replace(/[:.]/g, '-');
const output = path.resolve('docs/evidence/operations/samples', `${service}-${stamp}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(sample, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, output })}\n`);
