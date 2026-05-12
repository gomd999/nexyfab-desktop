/**
 * Σ — Simulation job polling endpoint.
 *
 * GET /api/sim/{kind}/job/{id} — returns job status + result (when done).
 * Status field shape mirrors `Job` from simulationQueue.ts so the client
 * can poll until status === 'done' | 'failed'.
 */

import { NextResponse } from 'next/server';
import { getJob } from '@/lib/ai/scad-agent/simulationQueue';
import { bootstrapSolversForEnv } from '@/lib/ai/scad-agent/dockerSolverAdapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  await bootstrapSolversForEnv();
  const { kind, id } = await params;
  const job = getJob(kind, id);
  if (!job) {
    return NextResponse.json({ ok: false, error: `job ${id} not found for kind ${kind}` }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      enqueuedAtMs: job.enqueuedAtMs,
      startedAtMs: job.startedAtMs,
      finishedAtMs: job.finishedAtMs,
    },
  });
}
