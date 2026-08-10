#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { feaFromStlAsync, feaReportHtml } from '../../src/app/[lang]/shape-generator/analysis/feaPackage';
import { validateFeaJobRequest, type FeaJobRequest, type FeaJobResult, type FeaResultGrade } from '../../src/lib/fea-jobs/contracts';

function progress(percent: number, stage: string, message?: string): void {
  process.stderr.write(`NEXYFAB_FEA_PROGRESS:${JSON.stringify({ percent, stage, message })}\n`);
}

async function readRequest(): Promise<FeaJobRequest> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 30 * 1024 * 1024) throw new Error('FEA_REQUEST_TRANSPORT_LIMIT');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as FeaJobRequest;
}

async function renderScad(source: string): Promise<Uint8Array> {
  const dir = join(process.cwd(), 'public', 'openscad');
  const moduleUrl = pathToFileURL(join(dir, 'openscad.js')).href;
  const mod = await import(/* webpackIgnore: true */ moduleUrl) as {
    default: (options: Record<string, unknown>) => Promise<{
      FS: { writeFile: (path: string, value: string) => void; readFile: (path: string, options: { encoding: string }) => Uint8Array };
      callMain: (args: string[]) => number;
    }>;
  };
  const instance = await mod.default({
    noInitialRun: true,
    wasmBinary: readFileSync(join(dir, 'openscad.wasm')),
    print: () => undefined,
    printErr: () => undefined,
  });
  instance.FS.writeFile('/in.scad', source);
  const exitCode = instance.callMain(['/in.scad', '-o', '/out.stl', '--backend=manifold', '--export-format=binstl']);
  const stl = instance.FS.readFile('/out.stl', { encoding: 'binary' });
  if (!stl?.byteLength) throw new Error(`SCAD_RENDER_EMPTY:${exitCode}`);
  return stl;
}

function resultGrade(out: Awaited<ReturnType<typeof feaFromStlAsync>>): FeaResultGrade {
  // Never promote a solver result beyond its own self-assessed grade. Expert
  // approval is a distinct workflow and cannot be inferred in this worker.
  return out.raiser?.grade ?? out.result.grade ?? 'screening';
}

export async function solveFeaJob(request: FeaJobRequest): Promise<FeaJobResult> {
  progress(5, 'preparing');
  let stl: Uint8Array;
  if (request.source.kind === 'stl') {
    stl = Uint8Array.from(Buffer.from(request.source.dataBase64, 'base64'));
  } else {
    progress(10, 'rendering');
    stl = await renderScad(request.source.source);
  }
  progress(20, 'solving');
  const out = await feaFromStlAsync({
    stl,
    materialKey: request.materialKey,
    loadN: request.loadN,
    loadNote: request.loadNote,
    precise: request.precise,
  });
  if (out.result.dofCount > request.limits.maxDof) {
    throw new Error(`FEA_DOF_LIMIT_EXCEEDED:${out.result.dofCount}:${request.limits.maxDof}`);
  }
  progress(92, 'packaging');
  const r = out.result;
  return {
    method: r.method,
    grade: resultGrade(out),
    maxStressMPa: r.maxStress,
    minStressMPa: r.minStress,
    maxDisplacementMm: r.maxDisplacement,
    safetyFactor: Number.isFinite(r.safetyFactor) ? r.safetyFactor : null,
    elementCount: r.elementCount,
    dofCount: r.dofCount,
    converged: r.converged,
    material: { key: out.materialKey, label: out.material.label, yieldMPa: out.material.yieldStrength },
    mesh: out.mesh,
    refined: out.refined ?? null,
    raiser: out.raiser ?? null,
    reportHtml: feaReportHtml(out, { title: 'Asynchronous precision FEA' }),
    expertApproval: null,
    manufacturingReady: false,
    completedAt: Date.now(),
  };
}

async function main(): Promise<void> {
  try {
    const untrusted = await readRequest();
    const validation = validateFeaJobRequest(untrusted);
    if (!validation.ok) throw new Error(`${validation.code}:${validation.message}`);
    const result = await solveFeaJob(validation.request);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /(?:ENOMEM|timeout|temporar|connection|CAD_RUNTIME_JOB)/i.test(message);
    process.stdout.write(JSON.stringify({ ok: false, errorCode: message.split(':', 1)[0], errorMessage: message.slice(0, 4000), retryable }));
    process.exitCode = 2;
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/solver.mjs')) void main();
