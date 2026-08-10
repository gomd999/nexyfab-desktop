#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import IORedis from 'ioredis';

const execFileAsync = promisify(execFile);
const QUEUE_KEY = 'nf:openscad:queue';
const PROCESSING_KEY = 'nf:openscad:processing';
const JOB_PREFIX = 'nf:openscad:job:';
const MAX_SCAD_BYTES = Number(process.env.OPENSCAD_MAX_SCAD_BYTES ?? 512 * 1024);
const MAX_OUTPUT_BYTES = Number(process.env.OPENSCAD_JOB_MAX_OUTPUT_BYTES ?? 16 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.OPENSCAD_DEFAULT_TIMEOUT_MS ?? 90_000);
const JOB_TTL_SECONDS = Math.max(60, Number(process.env.OPENSCAD_JOB_TTL_SECONDS ?? 3600));
const CONCURRENCY = Math.min(4, Math.max(1, Number(process.env.OPENSCAD_WORKER_CONCURRENCY ?? 1)));
const PORT = Number(process.env.PORT ?? 8080);

const state = { startedAt: Date.now(), active: 0, completed: 0, failed: 0, recovered: 0 };
let shuttingDown = false;

function jobKey(id) { return `${JOB_PREFIX}${id}`; }

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\r\n]*/g, '$1');
}

export function validateScadSource(source) {
  if (Buffer.byteLength(source, 'utf8') > MAX_SCAD_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  const code = withoutComments(source);
  const includeToken = /\b(include|use)\b\s*<([^>\r\n]+)>/gi;
  for (const match of code.matchAll(includeToken)) {
    const target = match[2].trim().replace(/\\/g, '/');
    if (!/^BOSL2\/[A-Za-z0-9_-]+\.scad$/.test(target)) return { ok: false, reason: 'UNTRUSTED_INCLUDE' };
  }
  if (/\b(?:include|use)\b/i.test(code.replace(includeToken, ''))) return { ok: false, reason: 'MALFORMED_INCLUDE' };
  if (/\bimport\s*\(/i.test(code) || /\bsurface\s*\(/i.test(code)) return { ok: false, reason: 'EXTERNAL_FILE_ACCESS' };
  return { ok: true };
}

async function render(job) {
  const validation = validateScadSource(job.scad ?? '');
  if (!validation.ok) throw new Error(`SCAD_BLOCKED:${validation.reason}`);
  if (!['stl', 'off', '3mf'].includes(job.format)) throw new Error('UNSUPPORTED_FORMAT');
  const id = randomBytes(12).toString('hex');
  const workDir = join(tmpdir(), `nexyfab-openscad-worker-${id}`);
  const sourcePath = join(workDir, 'model.scad');
  const outputPath = join(workDir, `output.${job.format}`);
  await mkdir(workDir, { recursive: true });
  try {
    await writeFile(sourcePath, job.scad, 'utf8');
    const { stderr = '' } = await execFileAsync(
      process.env.OPENSCAD_BIN?.trim() || '/usr/bin/openscad',
      [sourcePath, '-o', outputPath],
      {
        cwd: workDir,
        timeout: TIMEOUT_MS,
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

async function save(redis, job) {
  await redis.set(jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
}

async function recoverInterrupted(redis) {
  for (;;) {
    const id = await redis.lmove(PROCESSING_KEY, QUEUE_KEY, 'LEFT', 'RIGHT');
    if (!id) break;
    state.recovered += 1;
  }
}

async function claim(redis) {
  return redis.blmove(QUEUE_KEY, PROCESSING_KEY, 'LEFT', 'RIGHT', 5);
}

async function processOne(redis, id) {
  state.active += 1;
  try {
    const raw = await redis.get(jobKey(id));
    if (!raw) return;
    const job = JSON.parse(raw);
    if (!job.scad || job.status === 'complete') return;
    job.status = 'processing';
    job.updatedAt = Date.now();
    await save(redis, job);
    try {
      const output = await render(job);
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
    job.updatedAt = Date.now();
    await save(redis, job);
  } finally {
    await redis.lrem(PROCESSING_KEY, 1, id).catch(() => {});
    state.active -= 1;
  }
}

async function workerLoop(redis) {
  while (!shuttingDown) {
    const id = await claim(redis).catch(error => {
      console.error('[openscad-worker] queue claim failed:', error.message);
      return null;
    });
    if (id) await processOne(redis, id);
  }
}

export async function main() {
  if (!process.env.REDIS_URL?.trim()) throw new Error('REDIS_URL is required');
  if (process.env.OPENSCAD_WORKER_ISOLATED !== '1') throw new Error('OPENSCAD_WORKER_ISOLATED=1 is required');
  const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 5000 });
  await redis.ping();
  await recoverInterrupted(redis);
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/health' && request.url !== '/api/health/live') { response.writeHead(404).end(); return; }
    const queue = await redis.llen(QUEUE_KEY).catch(() => -1);
    response.writeHead(queue >= 0 ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok: queue >= 0, queue, ...state, uptimeMs: Date.now() - state.startedAt }));
  });
  server.listen(PORT, '0.0.0.0');
  const stop = () => { shuttingDown = true; server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => workerLoop(redis)));
  await redis.quit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`[openscad-worker] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
