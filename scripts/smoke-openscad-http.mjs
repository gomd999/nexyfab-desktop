#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = (process.env.NEXYFAB_SMOKE_URL ?? 'https://nexyfab.com').replace(/\/+$/, '');
const output = path.resolve(process.env.NEXYFAB_SMOKE_OUTPUT ?? 'docs/evidence/release/openscad-http-smoke-260810.json');
const startedAt = new Date().toISOString();
const started = Date.now();

const submit = await fetch(`${baseUrl}/api/nexyfab/openscad-render/`, {
  method: 'POST',
  redirect: 'follow',
  headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'NexyFab-OpenSCAD-Smoke/1.0' },
  body: JSON.stringify({
    scad: 'include <BOSL2/std.scad>\ncuboid([2, 3, 4]);',
    format: 'stl',
    async: true,
  }),
});
const submitted = await submit.json().catch(() => ({}));
if (submit.status !== 200 || submitted.mode !== 'async' || !submitted.pollUrl) {
  throw new Error(`submit failed: HTTP ${submit.status} ${String(submitted.code ?? submitted.error ?? '')}`);
}

const deadline = Date.now() + 60_000;
let completed;
while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}${submitted.pollUrl}`, {
    redirect: 'follow',
    headers: { accept: 'application/json', 'user-agent': 'NexyFab-OpenSCAD-Smoke/1.0' },
  });
  const job = await response.json().catch(() => ({}));
  if (response.status !== 200) throw new Error(`poll failed: HTTP ${response.status}`);
  if (job.status === 'failed') throw new Error(`worker failed: ${String(job.error ?? '')}`);
  if (job.status === 'complete') {
    completed = job;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!completed?.dataBase64) throw new Error('OpenSCAD HTTP smoke timed out without inline STL data');
const result = Buffer.from(completed.dataBase64, 'base64');
if (result.length < 84) throw new Error(`unexpectedly small STL: ${result.length} bytes`);

const receipt = {
  schema: 'nexyfab.openscad-http-smoke.v1',
  generatedAt: new Date().toISOString(),
  startedAt,
  target: new URL(baseUrl).origin,
  ok: true,
  mode: submitted.mode,
  format: completed.format,
  outputBytes: result.length,
  outputSha256: createHash('sha256').update(result).digest('hex'),
  durationMs: Date.now() - started,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
