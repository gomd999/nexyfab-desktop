import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootDockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const workerDockerfile = await readFile(new URL('../services/openscad-worker/Dockerfile', import.meta.url), 'utf8');
const railwayJson = JSON.parse(await readFile(new URL('../railway.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const standaloneSync = await readFile(new URL('./sync-standalone-static.mjs', import.meta.url), 'utf8');
const preflightCheck = await readFile(new URL('./preflight-check.ts', import.meta.url), 'utf8');

test('public web image has no native CAD executable installation', () => {
  assert.doesNotMatch(rootDockerfile, /apt-get install[\s\S]{0,240}\b(?:openscad|gmsh)\b/i);
  assert.doesNotMatch(rootDockerfile, /FROM\s+debian:[^\n]+\s+AS\s+radiance-builder/i);
  assert.doesNotMatch(rootDockerfile, /COPY\s+--from=radiance-builder/i);
  assert.doesNotMatch(rootDockerfile, /services\/openscad-worker/);
  assert.match(rootDockerfile, /OPENSCAD_EXTERNAL_WORKER=1/);
  assert.match(rootDockerfile, /CAD_RUNTIME_EXTERNAL_WORKER=1/);
});

test('production dependencies are lockfile-exact', () => {
  assert.match(rootDockerfile, /RUN npm ci --legacy-peer-deps --no-audit --no-fund/);
  assert.doesNotMatch(rootDockerfile, /RUN npm install/);
});

test('standalone web image includes webpack-ignored exact CAD runtimes', () => {
  assert.match(rootDockerfile, /node_modules\/replicad-opencascadejs/);
  assert.match(rootDockerfile, /node_modules\/opencascade\.js/);
  assert.match(rootDockerfile, /node_modules\/replicad/);
});

test('native CAD tools live in the isolated worker image', () => {
  assert.match(workerDockerfile, /AS radiance-builder/);
  assert.match(workerDockerfile, /openscad gmsh/);
  assert.match(workerDockerfile, /CAD_RUNTIME_WORKER_ISOLATED=1/);
  assert.match(workerDockerfile, /FROM cad-runtime-base AS worker/);
  assert.match(workerDockerfile, /npm ci --omit=dev/);
  assert.match(workerDockerfile, /ARG BOSL2_COMMIT=[0-9a-f]{40}/);
  assert.doesNotMatch(workerDockerfile, /git clone --depth 1/);
});

test('web Railway service has a single-purpose start command', () => {
  assert.equal(railwayJson.deploy.startCommand, 'node server.js');
  assert.doesNotMatch(railwayJson.deploy.startCommand, /NEXYFAB_PROCESS_ROLE|openscad-worker/);
});

test('production preflight enforces external CAD workers without requiring Docker in the web image', () => {
  assert.match(preflightCheck, /commercialReadinessIssues\(process\.env\)/);
  assert.doesNotMatch(preflightCheck, /process\.env\.OPENSCAD_USE_DOCKER/);
  assert.match(preflightCheck, /railwayEnvironmentInjected/);
  assert.match(preflightCheck, /RAILWAY_ENVIRONMENT_ID/);
  assert.doesNotMatch(preflightCheck, /\{ key: 'TOSS_SECRET_KEY'/);
});

test('postbuild prunes mutable state and repairs the standalone runtime', () => {
  assert.match(packageJson.scripts.postbuild, /prune-standalone-artifacts\.mjs/);
  assert.match(packageJson.scripts.postbuild, /sync-standalone-static\.mjs/);
  assert.match(standaloneSync, /node_modules.*next.*dist.*lib/s);
});
