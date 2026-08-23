#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildCommercialLiveSmokeReceipt,
  observationFromResponse,
  writeSmokeObservationArtifact,
} from './build-commercial-live-smoke-receipt-v2.mjs';

const args = process.argv.slice(2);
const value = name => args.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseUrl = (value('url') ?? process.env.NEXYFAB_SMOKE_URL ?? 'https://nexyfab.com').replace(/\/+$/, '');
const output = path.resolve(value('output') ?? 'docs/evidence/deployment-ai-cad-smoke-260806/latest.json');
const runAi = args.includes('--ai');
const timeoutMs = Number(value('timeout-ms') ?? 20_000);
const auth = process.env.NEXYFAB_SMOKE_AUTH?.trim();
const cookie = process.env.NEXYFAB_SMOKE_COOKIE?.trim();
const adminSecret = process.env.ADMIN_SECRET?.trim();
const requiredChecks = ['live', 'ready', 'capabilities', 'scad-agent-route', 'openscad'];

const headers = { accept: 'application/json', ...(auth ? { authorization: auth } : {}), ...(cookie ? { cookie } : {}) };
const request = async (id, pathname, init = {}, acceptedStatuses = null) => {
  const started = Date.now(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'follow', ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const bodyBytes = Buffer.from(text, 'utf8');
    let summary = null;
    if (contentType.includes('application/json')) {
      try {
        const body = JSON.parse(text);
        const safeCheck = value => value && typeof value === 'object' ? {
          ok: value.ok === true,
          ms: Number.isFinite(value.ms) ? value.ms : null,
          detail: typeof value.detail === 'string' ? value.detail.slice(0, 300) : null,
          error: typeof value.error === 'string' ? value.error.slice(0, 500) : null,
        } : null;
        const safeComponent = value => value && typeof value === 'object' ? {
          status: value.status ?? null,
          required: value.required === true,
          backend: value.backend ?? null,
        } : null;
        summary = {
          status: body.status ?? null,
          build: body.build ?? null,
          code: body.code ?? null,
          error: body.error ?? null,
          dbStatus: body.db?.status ?? null,
          checks: body.binary || body.bosl2 || body.render ? {
            binary: safeCheck(body.binary), bosl2: safeCheck(body.bosl2), render: safeCheck(body.render),
          } : null,
          ready: id === 'ready' ? {
            status: body.status ?? null,
            db: safeComponent(body.db),
            redis: safeComponent(body.redis),
            commercialBoundary: safeComponent(body.commercialBoundary),
          } : null,
        };
      } catch { summary = { parseError: true }; }
    } else if (contentType.includes('text/event-stream')) {
      const events = text.split(/\n\n+/).filter(Boolean).map(block => block.match(/^data:\s*(.*)$/m)?.[1]).filter(Boolean);
      const types = events.flatMap(event => { try { return [JSON.parse(event).type ?? 'unknown']; } catch { return ['invalid_json']; } });
      summary = { eventCount: events.length, eventTypes: [...new Set(types)], hasDone: types.includes('done'), hasError: types.includes('error') };
    }
    const accepted = acceptedStatuses?.includes(response.status) ?? response.ok;
    return {
      id,
      status: accepted ? 'pass' : response.status === 401 || response.status === 403 ? 'not_run' : 'fail',
      httpStatus: response.status,
      redirected: response.redirected,
      latencyMs: Date.now() - started,
      contentType,
      summary,
      observation: observationFromResponse({ id, pathname, method: init.method ?? 'GET', responseBody: bodyBytes, httpStatus: response.status, contentType }),
    };
  } catch (error) {
    return {
      id,
      status: 'fail',
      httpStatus: null,
      latencyMs: Date.now() - started,
      contentType: null,
      summary: { errorClass: error instanceof Error ? error.name : 'unknown' },
      observation: observationFromResponse({ id, pathname, method: init.method ?? 'GET', responseBody: Buffer.alloc(0), httpStatus: 599, contentType: '' }),
    };
  } finally { clearTimeout(timer); }
};

const results = [];
results.push(await request('live', '/api/health/live'));
results.push(await request('ready', '/api/health/ready'));
results.push(await request('capabilities', '/api/cad/v1/capabilities'));
results.push(await request('scad-agent-route', '/api/nexyfab/scad-agent', { method: 'HEAD' }, [405]));
results.push(await request('openscad', '/api/health/openscad', { headers: adminSecret ? { 'x-admin-secret': adminSecret } : {} }));
if (runAi) {
  if (!auth && !cookie) results.push({ id: 'scad-agent-sse', status: 'not_run', httpStatus: null, latencyMs: 0, contentType: null, summary: { code: 'SMOKE_AUTH_MISSING' } });
  else results.push(await request('scad-agent-sse', '/api/nexyfab/scad-agent', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ userPrompt: 'Create one 30 mm cube and finish after verification.' }) }));
}
const sanitizedTarget = new URL(baseUrl); sanitizedTarget.username = ''; sanitizedTarget.password = '';
const liveResult = results.find(item => item.id === 'live');
const readyResult = results.find(item => item.id === 'ready');
const release = {
  buildId: value('build-id') ?? process.env.NEXYFAB_SMOKE_BUILD_ID?.trim() ?? liveResult?.summary?.build ?? '',
  deploymentId: value('deployment-id') ?? process.env.NEXYFAB_SMOKE_DEPLOYMENT_ID?.trim() ?? '',
  gitHead: value('git-head') ?? process.env.NEXYFAB_SMOKE_GIT_HEAD?.trim() ?? '',
};
const bindingComplete = sanitizedTarget.origin === 'https://nexyfab.com'
  && release.buildId.length > 0
  && release.deploymentId.length > 0
  && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(release.gitHead);
const generatedAt = new Date().toISOString();
const status = results.some(item => item.status === 'fail') || !bindingComplete ? 'fail' : results.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
let artifact;
if (status === 'pass') {
  const observationOutput = `${output}.observations.json`;
  const observation = writeSmokeObservationArtifact({
    root: process.cwd(), artifactPath: path.relative(process.cwd(), observationOutput),
    target: sanitizedTarget.origin, generatedAt, observations: results.map(item => item.observation),
  });
  artifact = buildCommercialLiveSmokeReceipt({
    results,
    observations: results.map(item => item.observation),
    sourceBindings: [observation.binding],
    target: sanitizedTarget.origin,
    release: { buildId: release.buildId, deploymentId: release.deploymentId, gitHead: release.gitHead },
    generatedAt,
    ready: readyResult?.summary?.ready ?? null,
    credentials: { applicationAuthPresent: Boolean(auth || cookie), adminSecretPresent: Boolean(adminSecret) },
  });
} else {
  artifact = {
    schema: 'nexyfab.deployment-ai-cad-smoke.v2', generatedAt, target: sanitizedTarget.origin,
    release, requiredChecks, ready: readyResult?.summary?.ready ?? null, status,
    credentials: { applicationAuthPresent: Boolean(auth || cookie), adminSecretPresent: Boolean(adminSecret) }, results,
    observations: results.map(item => item.observation), sourceBindings: [],
    freshness: { generatedAt, maxAgeMs: 24 * 60 * 60_000 },
  };
  artifact.sha256 = createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
}
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ status: artifact.status, target: artifact.target, results: results.map(item => ({ id: item.id, status: item.status, httpStatus: item.httpStatus, latencyMs: item.latencyMs })) }));
if (artifact.status === 'fail') process.exitCode = 1;
