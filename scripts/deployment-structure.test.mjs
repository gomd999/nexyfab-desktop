import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootDockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const workerDockerfile = await readFile(new URL('../services/openscad-worker/Dockerfile', import.meta.url), 'utf8');
const railwayJson = JSON.parse(await readFile(new URL('../railway.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const standaloneSync = await readFile(new URL('./sync-standalone-static.mjs', import.meta.url), 'utf8');
const preflightCheck = await readFile(new URL('./preflight-check.ts', import.meta.url), 'utf8');
const readyRoute = await readFile(new URL('../src/app/api/health/ready/route.ts', import.meta.url), 'utf8');
const verifiedDeploy = await readFile(new URL('./deploy-railway-verified.mjs', import.meta.url), 'utf8');
const railwayToml = await readFile(new URL('../railway.toml', import.meta.url), 'utf8');
const railwayIgnore = await readFile(new URL('../.railwayignore', import.meta.url), 'utf8');
const releaseHealthPackaging = await readFile(new URL('./package-release-health-evidence.mjs', import.meta.url), 'utf8');

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

test('runner image preserves the exact build identity used by health and rollback checks', () => {
  assert.match(rootDockerfile, /FROM node:22-slim AS runner[\s\S]+ARG NEXYFAB_BUILD_ID/);
  assert.match(rootDockerfile, /ENV NEXYFAB_BUILD_TAG=\$\{CACHEBUST\}[\s\S]+NEXYFAB_BUILD_ID=\$\{NEXYFAB_BUILD_ID\}/);
});

test('production preflight enforces external CAD workers without requiring Docker in the web image', () => {
  assert.match(preflightCheck, /commercialReadinessIssues\(process\.env\)/);
  assert.doesNotMatch(preflightCheck, /process\.env\.OPENSCAD_USE_DOCKER/);
  assert.match(preflightCheck, /railwayEnvironmentInjected/);
  assert.match(preflightCheck, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(preflightCheck, /r\.relname = \$1[\s\S]+t\.tgname = \$2/);
  assert.match(preflightCheck, /commercial trigger \$\{table\}\.\$\{trigger\} missing/);
  assert.doesNotMatch(preflightCheck, /\{ key: 'TOSS_SECRET_KEY'/);
});

test('deploy preflight and live readiness share one commercial PostgreSQL contract', () => {
  for (const source of [preflightCheck, readyRoute]) {
    assert.match(source, /commercial-readiness/);
    assert.match(source, /COMMERCIAL_POSTGRES_MIGRATIONS/);
    assert.match(source, /COMMERCIAL_POSTGRES_TABLES/);
    assert.match(source, /COMMERCIAL_POSTGRES_CONSTRAINTS/);
    assert.match(source, /COMMERCIAL_POSTGRES_HARDENING_TRIGGERS/);
  }
});

test('postbuild prunes mutable state and repairs the standalone runtime', () => {
  assert.match(packageJson.scripts.postbuild, /prune-standalone-artifacts\.mjs/);
  assert.match(packageJson.scripts.postbuild, /sync-standalone-static\.mjs/);
  assert.match(standaloneSync, /node_modules.*next.*dist.*lib/s);
  assert.match(railwayIgnore, /^!docs\/evidence\/release\/commercial-i18n-release-receipt\.json$/m);
  assert.match(railwayIgnore, /^!docs\/evidence\/release\/seven-day-operations-receipt\.json$/m);
  assert.match(railwayIgnore, /^!docs\/evidence\/operations\/\*\*\/\*\.json$/m);
  assert.doesNotMatch(railwayIgnore, /^!docs\/?$/m);
  assert.match(releaseHealthPackaging, /OPERATIONS_EVIDENCE_PREFIX = 'docs\/evidence\/operations\/'/);
  assert.match(releaseHealthPackaging, /evidenceBindings/);
});

test('mechanical intent runtime run command writes a verifiable receipt', () => {
  assert.match(packageJson.scripts['mechanical:intents:runtime:run'], /mechanical-ai-intent-runtime-harness\.ts --write$/);
});

test('verified Railway deploy gates against target service variables and an exact build identity', () => {
  assert.match(verifiedDeploy, /\['variables', '--service', service, '--environment', environment, '--json'\]/);
  assert.match(verifiedDeploy, /targetGateEnvironment\(target\)/);
  assert.match(verifiedDeploy, /must define NEXYFAB_BUILD_ID/);
  assert.match(verifiedDeploy, /live build ID mismatch/);
  for (const key of [
    'DATABASE_URL', 'REDIS_URL', 'RECAPTCHA_ALLOWED_HOSTNAMES', 'SECURITY_GATE_MODE',
    'SCAD_AGENT_SESSION_SECRET', 'SMTP_USER', 'SMTP_PASS', 'NEXYFAB_DOMAIN_REVIEWER_KEYS',
    'SEVEN_DAY_OPERATIONS_RECEIPT', 'RELEASE_BASELINE', 'EXPERT_REVIEW_RECEIPT',
  ]) assert.match(verifiedDeploy, new RegExp(`'${key}'`), `target variable isolation missing ${key}`);
});

test('declared cron commands fail on missing auth and HTTP errors', () => {
  const commands = [...railwayToml.matchAll(/^command = "(.+)"$/gm)].map(match => match[1]);
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.match(command, /test -n \\"\$CRON_SECRET\\"/);
    assert.match(command, /curl --fail --silent --show-error/);
    assert.doesNotMatch(command, /-H '\S[^']*\$CRON_SECRET'/);
  }
});
