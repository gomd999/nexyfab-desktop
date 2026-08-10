#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import IORedis from 'ioredis';

const execFileAsync = promisify(execFile);

const OPENSCAD_QUEUE_KEY = 'nf:openscad:queue';
const OPENSCAD_PROCESSING_KEY = 'nf:openscad:processing';
const OPENSCAD_JOB_PREFIX = 'nf:openscad:job:';
const CAD_QUEUE_KEY = 'nf:cad-runtime:queue';
const CAD_PROCESSING_KEY = 'nf:cad-runtime:processing';
const CAD_JOB_PREFIX = 'nf:cad-runtime:job:';

const MAX_SCAD_BYTES = Number(process.env.OPENSCAD_MAX_SCAD_BYTES ?? 512 * 1024);
const MAX_IMPORT_BYTES = Number(process.env.OPENSCAD_MAX_IMPORT_BYTES ?? 20 * 1024 * 1024);
const MAX_OUTPUT_BYTES = Number(process.env.OPENSCAD_JOB_MAX_OUTPUT_BYTES ?? 16 * 1024 * 1024);
const OPENSCAD_TIMEOUT_MS = Number(process.env.OPENSCAD_DEFAULT_TIMEOUT_MS ?? 90_000);
const JOB_TTL_SECONDS = Math.max(60, Number(process.env.OPENSCAD_JOB_TTL_SECONDS ?? 3600));
const OPENSCAD_CONCURRENCY = Math.min(4, Math.max(1, Number(process.env.OPENSCAD_WORKER_CONCURRENCY ?? 1)));
const CAD_CONCURRENCY = Math.min(2, Math.max(1, Number(process.env.CAD_RUNTIME_WORKER_CONCURRENCY ?? 1)));
const PORT = Number(process.env.PORT ?? 8080);

const state = {
  startedAt: Date.now(),
  active: 0,
  completed: 0,
  failed: 0,
  recovered: 0,
  cadActive: 0,
  cadCompleted: 0,
  cadFailed: 0,
  cadRecovered: 0,
};
let shuttingDown = false;

function openScadJobKey(id) { return `${OPENSCAD_JOB_PREFIX}${id}`; }
function cadJobKey(id) { return `${CAD_JOB_PREFIX}${id}`; }

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\r\n]*/g, '$1');
}

export function validateScadSource(source, hasImportStl = false) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_SCAD_BYTES) {
    return { ok: false, reason: 'TOO_LARGE' };
  }
  let code = withoutComments(source);
  const includeToken = /\b(include|use)\b\s*<([^>\r\n]+)>/gi;
  for (const match of code.matchAll(includeToken)) {
    const target = match[2].trim().replace(/\\/g, '/');
    if (!/^BOSL2\/[A-Za-z0-9_-]+\.scad$/.test(target)) return { ok: false, reason: 'UNTRUSTED_INCLUDE' };
  }
  code = code.replace(includeToken, '');
  if (/\b(?:include|use)\b/i.test(code)) return { ok: false, reason: 'MALFORMED_INCLUDE' };

  const trustedImport = /\bimport\s*\(\s*(?:file\s*=\s*)?["']model\.stl["']\s*(?:,\s*convexity\s*=\s*\d+\s*)?\)/gi;
  const importMatches = [...code.matchAll(trustedImport)];
  if (importMatches.length > 0 && !hasImportStl) return { ok: false, reason: 'MISSING_IMPORT_PAYLOAD' };
  code = code.replace(trustedImport, '');
  if (/\bimport\s*\(/i.test(code) || /\bsurface\s*\(/i.test(code)) return { ok: false, reason: 'EXTERNAL_FILE_ACCESS' };
  return { ok: true };
}

export function validateOpenScadRenderArgs(args, format) {
  if (!Array.isArray(args) || args.length > 4 || args.some(value => typeof value !== 'string' || value.length > 256)) {
    return { ok: false, reason: 'RENDER_ARGS_INVALID' };
  }
  for (const value of args) {
    if (value === '--export-format=binstl' && format === 'stl') continue;
    if (format === 'png' && /^--imgsize=\d{2,4},\d{2,4}$/.test(value)) {
      const [width, height] = value.slice('--imgsize='.length).split(',').map(Number);
      if (width >= 64 && width <= 4096 && height >= 64 && height <= 4096) continue;
    }
    if (format === 'png' && /^--camera=-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){6}$/.test(value)) continue;
    if (format === 'png' && /^--colorscheme=[A-Za-z0-9 _-]{1,40}$/.test(value)) continue;
    return { ok: false, reason: 'RENDER_ARG_BLOCKED' };
  }
  return { ok: true };
}

async function renderOpenScad(job) {
  const importBuffer = job.importStlBase64 ? Buffer.from(job.importStlBase64, 'base64') : null;
  if (importBuffer && (importBuffer.length === 0 || importBuffer.length > MAX_IMPORT_BYTES)) {
    throw new Error('SCAD_BLOCKED:IMPORT_TOO_LARGE');
  }
  const validation = validateScadSource(job.scad ?? '', Boolean(importBuffer));
  if (!validation.ok) throw new Error(`SCAD_BLOCKED:${validation.reason}`);
  if (!['stl', 'off', '3mf', 'dxf', 'png'].includes(job.format)) throw new Error('UNSUPPORTED_FORMAT');
  const renderArgs = validateOpenScadRenderArgs(job.renderArgs ?? [], job.format);
  if (!renderArgs.ok) throw new Error(`SCAD_BLOCKED:${renderArgs.reason}`);
  const id = randomBytes(12).toString('hex');
  const workDir = join(tmpdir(), `nexyfab-openscad-worker-${id}`);
  const sourcePath = join(workDir, 'model.scad');
  const outputPath = join(workDir, `output.${job.format}`);
  await mkdir(workDir, { recursive: true });
  try {
    await writeFile(sourcePath, job.scad, 'utf8');
    if (importBuffer) await writeFile(join(workDir, 'model.stl'), importBuffer);
    const { stderr = '' } = await execFileAsync(
      process.env.OPENSCAD_BIN?.trim() || '/usr/bin/openscad',
      [sourcePath, '-o', outputPath, ...(job.renderArgs ?? [])],
      {
        cwd: workDir,
        timeout: OPENSCAD_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, XDG_CONFIG_HOME: workDir, XDG_CACHE_HOME: workDir },
      },
    );
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) throw new Error('EMPTY_OUTPUT');
    if (buffer.length > MAX_OUTPUT_BYTES) throw new Error(`OUTPUT_TOO_LARGE:${buffer.length}`);
    return { resultBase64: buffer.toString('base64'), stderr: String(stderr).slice(-4000) };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function saveOpenScad(redis, job) {
  await redis.set(openScadJobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
}

async function recover(redis, processingKey, queueKey, counter) {
  for (;;) {
    const id = await redis.lmove(processingKey, queueKey, 'LEFT', 'RIGHT');
    if (!id) break;
    state[counter] += 1;
  }
}

async function claim(redis, queueKey, processingKey) {
  return redis.blmove(queueKey, processingKey, 'LEFT', 'RIGHT', 5);
}

async function processOpenScad(redis, id) {
  state.active += 1;
  try {
    const raw = await redis.get(openScadJobKey(id));
    if (!raw) return;
    const job = JSON.parse(raw);
    if (!job.scad || job.status === 'complete') return;
    job.status = 'processing';
    job.updatedAt = Date.now();
    await saveOpenScad(redis, job);
    try {
      const output = await renderOpenScad(job);
      job.status = 'complete';
      job.resultBase64 = output.resultBase64;
      job.errorMessage = undefined;
      state.completed += 1;
    } catch (error) {
      job.status = 'failed';
      job.resultBase64 = undefined;
      job.errorMessage = error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000);
      state.failed += 1;
    }
    delete job.scad;
    delete job.importStlBase64;
    delete job.renderArgs;
    job.updatedAt = Date.now();
    await saveOpenScad(redis, job);
  } finally {
    await redis.lrem(OPENSCAD_PROCESSING_KEY, 1, id).catch(() => {});
    state.active -= 1;
  }
}

export function validateGmshGeo(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 64 * 1024 || source.includes('\0')) {
    return { ok: false, reason: 'INVALID_GEO_SIZE' };
  }
  if (/\b(?:SystemCall|OnelabRun|Include|Open|Save|Plugin|Solver|Remote)\b/i.test(source)) {
    return { ok: false, reason: 'GEO_COMMAND_BLOCKED' };
  }
  for (const match of source.matchAll(/["']([^"']*)["']/g)) {
    if (match[1] !== 'surf.stl') return { ok: false, reason: 'GEO_FILE_BLOCKED' };
  }
  if (!/\bMerge\s*["']surf\.stl["']\s*;/i.test(source)) return { ok: false, reason: 'GEO_INPUT_MISSING' };
  return { ok: true };
}

async function runProcess(path, args, cwd, stdin, timeoutMs, maxOutputBytes) {
  return new Promise(resolveRun => {
    const child = spawn(path, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: -1, stdout: Buffer.alloc(0), stderr: '', error: 'execution_timeout' });
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        child.kill();
        finish({ exitCode: -1, stdout: Buffer.alloc(0), stderr: '', error: 'output_limit_exceeded' });
      } else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.on('error', error => finish({ exitCode: -1, stdout: Buffer.alloc(0), stderr: '', error: `spawn_error:${error.message}` }));
    child.on('close', code => finish({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') }));
    if (stdin) child.stdin.end(stdin); else child.stdin.end();
  });
}

async function runGmshJob(request) {
  const validation = validateGmshGeo(request.geoText);
  if (!validation.ok) throw new Error(`GMSH_BLOCKED:${validation.reason}`);
  const stl = Buffer.from(request.stlBase64 ?? '', 'base64');
  if (stl.length < 84 || stl.length > 24 * 1024 * 1024) throw new Error('GMSH_STL_SIZE_INVALID');
  const timeoutMs = Math.min(120_000, Math.max(1000, Number(request.timeoutMs ?? 10_000)));
  const maxOutputBytes = Math.min(128 * 1024 * 1024, Math.max(1024, Number(request.maxOutputBytes ?? 64 * 1024 * 1024)));
  const workDir = join(tmpdir(), `nexyfab-gmsh-worker-${randomBytes(12).toString('hex')}`);
  await mkdir(workDir, { recursive: true });
  try {
    await writeFile(join(workDir, 'surf.stl'), stl);
    await writeFile(join(workDir, 'model.geo'), request.geoText, 'utf8');
    const outputPath = join(workDir, 'output.msh');
    const result = await runProcess(
      process.env.GMSH_BIN?.trim() || '/usr/bin/gmsh',
      ['model.geo', '-3', '-format', 'msh2', '-nopopup', '-v', '3', '-o', 'output.msh'],
      workDir,
      undefined,
      timeoutMs,
      4 * 1024 * 1024,
    );
    const log = `${result.stdout.toString('utf8')}\n${result.stderr}`.slice(-64 * 1024);
    if (result.error || result.exitCode !== 0) {
      return { kind: 'gmsh', exitCode: result.exitCode, log, error: result.error };
    }
    const msh = await readFile(outputPath);
    if (!msh.length || msh.length > maxOutputBytes) throw new Error(`GMSH_OUTPUT_SIZE_INVALID:${msh.length}`);
    return { kind: 'gmsh', exitCode: 0, log, mshBase64: msh.toString('base64') };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const RADIANCE_EXECUTABLES = ['oconv', 'rtrace', 'rfluxmtx', 'gendaymtx', 'dctimestep', 'rmtxop'];
const RADIANCE_ARTIFACT = /^(?:scene\.rad|sky\.rad|sensors\.pts|weather\.wea|scene\.oct|sky\.mtx|daylight-coefficients\.mtx|annual-rgb\.mtx|annual-illuminance\.mtx|illuminance\.rgb)$/;
const RADIANCE_PLANS = {
  point_in_time: [
    { executable: 'oconv', args: ['scene.rad', 'sky.rad'], stdoutArtifact: 'scene.oct' },
    { executable: 'rtrace', args: ['-I+', '-h', '-ab', '5', '-ad', '2048', '-as', '512', '-aa', '0.1', 'scene.oct'], stdinArtifact: 'sensors.pts', stdoutArtifact: 'illuminance.rgb' },
  ],
  annual: [
    { executable: 'oconv', args: ['scene.rad'], stdoutArtifact: 'scene.oct' },
    { executable: 'gendaymtx', args: ['-m', '1', 'weather.wea'], stdoutArtifact: 'sky.mtx' },
    { executable: 'rfluxmtx', args: ['-I+', '-ab', '5', '-ad', '4096', '-lw', '1e-5', 'scene.oct'], stdinArtifact: 'sensors.pts', stdoutArtifact: 'daylight-coefficients.mtx' },
    { executable: 'dctimestep', args: ['daylight-coefficients.mtx', 'sky.mtx'], stdoutArtifact: 'annual-rgb.mtx' },
    { executable: 'rmtxop', args: ['-h', '-fa', '-c', '47.435', '119.93', '11.635', 'annual-rgb.mtx'], stdoutArtifact: 'annual-illuminance.mtx' },
  ],
};

function canonicalRadiancePlan(kind) {
  const commands = RADIANCE_PLANS[kind];
  if (!commands) return null;
  return { kind, commands, requiredExecutables: [...new Set(commands.map(command => command.executable))] };
}

export function validateRadianceRequest(request) {
  const canonical = canonicalRadiancePlan(request?.plan?.kind);
  if (!canonical || JSON.stringify(request.plan) !== JSON.stringify(canonical)) return { ok: false, reason: 'PLAN_NOT_CANONICAL' };
  for (const [name, artifact] of Object.entries(request.artifacts ?? {})) {
    if (!RADIANCE_ARTIFACT.test(name)) return { ok: false, reason: `ARTIFACT_NAME:${name}` };
    if (!artifact || !['utf8', 'base64'].includes(artifact.encoding) || typeof artifact.data !== 'string') return { ok: false, reason: `ARTIFACT_ENCODING:${name}` };
    const bytes = artifact.encoding === 'base64' ? Buffer.from(artifact.data, 'base64') : Buffer.from(artifact.data, 'utf8');
    if (bytes.length > 64 * 1024 * 1024) return { ok: false, reason: `ARTIFACT_SIZE:${name}` };
    const text = artifact.encoding === 'utf8' ? artifact.data : '';
    if (text.includes('\0')) return { ok: false, reason: `ARTIFACT_NUL:${name}` };
    if ((name.endsWith('.rad') || name.endsWith('.wea') || name.endsWith('.pts')) && /(^|\r?\n)\s*!/.test(text)) {
      return { ok: false, reason: `SHELL_ESCAPE:${name}` };
    }
  }
  return { ok: true, canonical };
}

async function runRadianceJob(request) {
  const validation = validateRadianceRequest(request);
  if (!validation.ok) throw new Error(`RADIANCE_BLOCKED:${validation.reason}`);
  const timeoutMs = Math.min(600_000, Math.max(100, Number(request.timeoutMs ?? 120_000)));
  const maxOutputBytes = Math.min(512 * 1024 * 1024, Math.max(1024, Number(request.maxOutputBytes ?? 64 * 1024 * 1024)));
  const workDir = join(tmpdir(), `nexyfab-radiance-worker-${randomBytes(12).toString('hex')}`);
  const outputs = {};
  await mkdir(workDir, { recursive: true });
  try {
    for (const [name, artifact] of Object.entries(request.artifacts)) {
      const value = artifact.encoding === 'base64' ? Buffer.from(artifact.data, 'base64') : artifact.data;
      await writeFile(join(workDir, name), value);
    }
    for (const command of validation.canonical.commands) {
      const stdin = command.stdinArtifact ? await readFile(join(workDir, command.stdinArtifact)) : undefined;
      const result = await runProcess(
        `/opt/radiance/bin/${command.executable}`,
        command.args,
        workDir,
        stdin,
        timeoutMs,
        maxOutputBytes,
      );
      if (result.error || result.exitCode !== 0) {
        return { kind: 'radiance', status: 'fail', outputs, errors: [result.error ?? `${command.executable}:exit_${result.exitCode}`, ...(result.stderr.trim() ? [result.stderr.trim()] : [])] };
      }
      outputs[command.stdoutArtifact] = result.stdout.toString('base64');
      await writeFile(join(workDir, command.stdoutArtifact), result.stdout);
    }
    return { kind: 'radiance', status: 'pass', outputs, errors: [] };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function inspectTool(tool) {
  if (tool === 'gmsh') {
    try {
      const { stdout, stderr } = await execFileAsync(process.env.GMSH_BIN?.trim() || '/usr/bin/gmsh', ['--version'], { timeout: 5000 });
      return { kind: 'tool-readiness', tool, ready: true, detail: String(stdout || stderr).trim().slice(0, 2048) };
    } catch (error) {
      return { kind: 'tool-readiness', tool, ready: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    const version = await runProcess('/opt/radiance/bin/rtrace', ['-version'], tmpdir(), undefined, 10_000, 1024 * 1024);
    const features = await runProcess('/opt/radiance/bin/rtrace', ['-features'], tmpdir(), undefined, 10_000, 1024 * 1024);
    const detail = `${version.stdout.toString('utf8')}\n${version.stderr}\n${features.stdout.toString('utf8')}\n${features.stderr}`.trim();
    const ready = version.exitCode === 0 && features.exitCode === 0 && /RADIANCE|rtrace/i.test(detail);
    return { kind: 'tool-readiness', tool: 'radiance', ready, detail: detail.slice(0, 16 * 1024), ...(ready ? {} : { error: version.error ?? features.error ?? 'radiance_readiness_failed' }) };
  } catch (error) {
    return { kind: 'tool-readiness', tool: 'radiance', ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function saveCadJob(redis, job) {
  const ttl = Math.max(60, Number(process.env.CAD_RUNTIME_JOB_TTL_SECONDS ?? 3600));
  await redis.set(cadJobKey(job.id), JSON.stringify(job), 'EX', ttl);
}

async function processCadRuntime(redis, id) {
  state.cadActive += 1;
  try {
    const raw = await redis.get(cadJobKey(id));
    if (!raw) return;
    const job = JSON.parse(raw);
    if (!job.request || job.status === 'complete') return;
    job.status = 'processing';
    job.updatedAt = Date.now();
    await saveCadJob(redis, job);
    try {
      const request = job.request;
      if (request.kind === 'gmsh') job.result = await runGmshJob(request);
      else if (request.kind === 'radiance') job.result = await runRadianceJob(request);
      else if (request.kind === 'tool-readiness' && ['gmsh', 'radiance'].includes(request.tool)) job.result = await inspectTool(request.tool);
      else throw new Error('CAD_RUNTIME_KIND_UNSUPPORTED');
      job.status = 'complete';
      job.errorMessage = undefined;
      state.cadCompleted += 1;
    } catch (error) {
      job.status = 'failed';
      job.result = undefined;
      job.errorMessage = error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000);
      state.cadFailed += 1;
    }
    delete job.request;
    job.updatedAt = Date.now();
    await saveCadJob(redis, job);
  } finally {
    await redis.lrem(CAD_PROCESSING_KEY, 1, id).catch(() => {});
    state.cadActive -= 1;
  }
}

async function workerLoop(redis, queueKey, processingKey, processor, label) {
  while (!shuttingDown) {
    const id = await claim(redis, queueKey, processingKey).catch(error => {
      console.error(`[${label}] queue claim failed:`, error.message);
      return null;
    });
    if (id) await processor(redis, id);
  }
}

export async function main() {
  if (!process.env.REDIS_URL?.trim()) throw new Error('REDIS_URL is required');
  if (process.env.OPENSCAD_WORKER_ISOLATED !== '1' || process.env.CAD_RUNTIME_WORKER_ISOLATED !== '1') {
    throw new Error('OPENSCAD_WORKER_ISOLATED=1 and CAD_RUNTIME_WORKER_ISOLATED=1 are required');
  }
  const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 5000 });
  await redis.ping();
  await recover(redis, OPENSCAD_PROCESSING_KEY, OPENSCAD_QUEUE_KEY, 'recovered');
  await recover(redis, CAD_PROCESSING_KEY, CAD_QUEUE_KEY, 'cadRecovered');
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/health' && request.url !== '/api/health/live') { response.writeHead(404).end(); return; }
    const [openScadQueue, cadQueue] = await Promise.all([
      redis.llen(OPENSCAD_QUEUE_KEY).catch(() => -1),
      redis.llen(CAD_QUEUE_KEY).catch(() => -1),
    ]);
    const ok = openScadQueue >= 0 && cadQueue >= 0;
    response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok, queue: openScadQueue, cadQueue, ...state, uptimeMs: Date.now() - state.startedAt }));
  });
  server.listen(PORT, '0.0.0.0');
  const stop = () => { shuttingDown = true; server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await Promise.all([
    ...Array.from({ length: OPENSCAD_CONCURRENCY }, () => workerLoop(redis, OPENSCAD_QUEUE_KEY, OPENSCAD_PROCESSING_KEY, processOpenScad, 'openscad-worker')),
    ...Array.from({ length: CAD_CONCURRENCY }, () => workerLoop(redis, CAD_QUEUE_KEY, CAD_PROCESSING_KEY, processCadRuntime, 'cad-runtime-worker')),
  ]);
  await redis.quit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`[cad-runtime-worker] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
