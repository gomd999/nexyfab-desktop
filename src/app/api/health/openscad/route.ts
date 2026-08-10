/**
 * GET /api/health/openscad
 *
 * Verifies the OpenSCAD CLI + BOSL2 library are reachable in the runtime
 * environment. Catches deploy-time mistakes where the Dockerfile changed
 * but didn't get rebuilt, or where a non-Docker deploy path forgot to
 * install the binary.
 *
 * Three checks:
 *   1. `openscad --version` runs and reports a version string
 *   2. BOSL2 directory exists at OPENSCADPATH
 *   3. A trivial render (`cube(1)`) compiles end-to-end into a non-empty STL
 *
 * The render check uses the same `runOpenScadCli` helper the user-facing
 * routes use, so a green health check means the agent path will work.
 *
 * Auth: ADMIN_SECRET header — keep this off public scrapers since the
 * version banner can be a fingerprint attackers use.
 *
 * Returns 200 with full report on success, 503 on any failure.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveOpenScadExecutable } from '@/lib/openscad-render/resolveOpenScadExecutable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

interface CheckResult {
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
}

interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  binary: CheckResult;
  bosl2: CheckResult;
  render: CheckResult;
  env: {
    OPENSCAD_BIN?: string;
    OPENSCADPATH?: string;
    OPENSCAD_USE_DOCKER?: string;
    OPENSCAD_EXTERNAL_WORKER?: string;
  };
}

async function checkBinary(): Promise<CheckResult> {
  const start = Date.now();
  const bin = resolveOpenScadExecutable();
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['--version'], { timeout: 5_000 });
    const text = (stdout || stderr || '').trim();
    return { ok: true, ms: Date.now() - start, detail: text.split('\n')[0] };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message };
  }
}

async function checkBosl2(): Promise<CheckResult> {
  const start = Date.now();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = process.env.OPENSCADPATH || '/opt/openscad-libs';
  const stdPath = path.join(root, 'BOSL2', 'std.scad');
  try {
    const stat = fs.statSync(stdPath);
    return {
      ok: stat.isFile() && stat.size > 0,
      ms: Date.now() - start,
      detail: `${stdPath} (${stat.size} bytes)`,
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: `${stdPath}: ${(e as Error).message}` };
  }
}

async function checkRender(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { runOpenScadCli } = await import('@/lib/openscad-render/runOpenScadCli');
    const result = await runOpenScadCli({
      scadSource: 'cube([1, 1, 1]);',
      format: 'stl',
      timeoutMs: 10_000,
    });
    if (!result.ok) {
      return { ok: false, ms: Date.now() - start, error: `render failed: ${result.code} ${result.message}` };
    }
    if (result.buffer.length < 84) {
      return { ok: false, ms: Date.now() - start, error: `STL too small (${result.buffer.length} bytes)` };
    }
    // Read triangle count from binary STL header.
    const triangles = result.buffer.readUInt32LE(80);
    return { ok: true, ms: Date.now() - start, detail: `${result.buffer.length} bytes, ${triangles} triangles` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message };
  }
}

async function checkExternalWorkerRender(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { enqueueOpenScadJob, getOpenScadJobAsync } = await import('@/lib/openscad-render/jobQueue');
    const userId = `openscad-health-${Date.now()}`;
    const job = await enqueueOpenScadJob({
      userId,
      scad: 'include <BOSL2/std.scad>\ncuboid([1, 1, 1]);',
      format: 'stl',
    });
    if (job.status === 'failed') {
      return { ok: false, ms: Date.now() - start, error: job.errorMessage ?? 'external worker enqueue failed' };
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const current = await getOpenScadJobAsync(job.id, userId);
      if (current?.status === 'failed') {
        return { ok: false, ms: Date.now() - start, error: current.errorMessage ?? 'external worker render failed' };
      }
      if (current?.status === 'complete' && current.resultBase64) {
        const bytes = Buffer.from(current.resultBase64, 'base64').length;
        if (bytes < 84) return { ok: false, ms: Date.now() - start, error: `STL too small (${bytes} bytes)` };
        return { ok: true, ms: Date.now() - start, detail: `${bytes} bytes via isolated Redis worker` };
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ok: false, ms: Date.now() - start, error: 'external worker render timed out' };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message };
  }
}

export async function GET(req: NextRequest) {
  // Lightweight admin gate. We don't want this scraped by bots since the
  // OpenSCAD version banner is a (mild) fingerprint vector.
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const provided = req.headers.get('x-admin-secret') ?? new URL(req.url).searchParams.get('secret');
    if (provided !== adminSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const externalWorker = process.env.OPENSCAD_EXTERNAL_WORKER === '1';
  let binary: CheckResult;
  let bosl2: CheckResult;
  let render: CheckResult;
  if (externalWorker) {
    render = await checkExternalWorkerRender();
    const delegated = render.ok
      ? { ok: true, ms: render.ms, detail: 'verified by isolated BOSL2 render' }
      : { ok: false, ms: render.ms, error: render.error };
    binary = delegated;
    bosl2 = delegated;
  } else {
    [binary, bosl2, render] = await Promise.all([
      checkBinary(),
      checkBosl2(),
      checkRender(),
    ]);
  }

  let status: HealthReport['status'] = 'ok';
  if (!binary.ok || !render.ok) status = 'error';
  else if (!bosl2.ok) status = 'degraded'; // BOSL2 missing = no gear/screw, but agent still works

  const report: HealthReport = {
    status,
    timestamp: new Date().toISOString(),
    binary,
    bosl2,
    render,
    env: {
      OPENSCAD_BIN: process.env.OPENSCAD_BIN,
      OPENSCADPATH: process.env.OPENSCADPATH,
      OPENSCAD_USE_DOCKER: process.env.OPENSCAD_USE_DOCKER,
      OPENSCAD_EXTERNAL_WORKER: process.env.OPENSCAD_EXTERNAL_WORKER,
    },
  };

  const httpStatus = status === 'error' ? 503 : status === 'degraded' ? 207 : 200;
  return NextResponse.json(report, { status: httpStatus });
}
