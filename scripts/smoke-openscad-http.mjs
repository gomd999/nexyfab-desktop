#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildOpenScadHttpSmokeReceipt } from './build-openscad-http-smoke-v2.mjs';

const baseUrl = (process.env.NEXYFAB_SMOKE_URL ?? 'https://nexyfab.com').replace(/\/+$/, '');
const output = path.resolve(process.env.NEXYFAB_SMOKE_OUTPUT ?? 'docs/evidence/release/openscad-http-smoke-260810.json');
const artifactOutput = path.resolve(process.env.NEXYFAB_SMOKE_ARTIFACT ?? 'docs/evidence/release/artifacts/openscad-http-smoke.stl');
const startedAt = new Date().toISOString();
const smokeRequest = {
  scad: 'include <BOSL2/std.scad>\ncuboid([2, 3, 4]);',
  format: 'stl',
  async: true,
};

const submit = await fetch(`${baseUrl}/api/nexyfab/openscad-render/`, {
  method: 'POST',
  redirect: 'follow',
  headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'NexyFab-OpenSCAD-Smoke/1.0' },
  body: JSON.stringify(smokeRequest),
});
const submitted = await submit.json().catch(() => ({}));
if (submit.status !== 200 || submitted.mode !== 'async' || !submitted.pollUrl) {
  throw new Error(`submit failed: HTTP ${submit.status} ${String(submitted.code ?? submitted.error ?? '')}`);
}

const deadline = Date.now() + 60_000;
let completed;
let pollStatus = null;
while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}${submitted.pollUrl}`, {
    redirect: 'follow',
    headers: { accept: 'application/json', 'user-agent': 'NexyFab-OpenSCAD-Smoke/1.0' },
  });
  const job = await response.json().catch(() => ({}));
  pollStatus = response.status;
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
const completedAt = new Date().toISOString();

fs.mkdirSync(path.dirname(artifactOutput), { recursive: true });
fs.writeFileSync(artifactOutput, result);
const receipt = buildOpenScadHttpSmokeReceipt({
  root: process.cwd(),
  artifactPath: artifactOutput,
  request: smokeRequest,
  response: {
    startedAt,
    completedAt,
    submitStatus: submit.status,
    pollStatus,
    submitted,
    completed,
  },
  target: baseUrl,
  release: {
    buildId: process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID,
    deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? process.env.RAILWAY_DEPLOYMENT_ID,
    gitHead: process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  },
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
