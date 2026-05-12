/**
 * Σ — Simulation enqueue endpoint.
 *
 * POST /api/sim/{kind}    — enqueue a job, returns { jobId }
 * GET  /api/sim/{kind}/job/{id} — poll status (separate route file)
 *
 * Currently runs against in-process mock adapters. For production:
 *   1. Replace `bootstrapMockSolvers()` with `bootstrapDockerSolvers()`
 *   2. Each Docker adapter spawns/queues against the corresponding container.
 *
 * Plan-gating + rate-limit are deliberately light here — the heavy
 * compute will gate via the Docker queue's resource limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueJob, listSolverKinds } from '@/lib/ai/scad-agent/simulationQueue';
import { bootstrapSolversForEnv } from '@/lib/ai/scad-agent/dockerSolverAdapter';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set(['cfd', 'mbd', 'cam', 'mold_fill', 'optics', 'thermal']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  await bootstrapSolversForEnv();
  const { kind } = await params;
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: `unknown sim kind "${kind}". Valid: ${Array.from(VALID_KINDS).join(', ')}` }, { status: 400 });
  }

  // L1 — plan gate. Free tier hard-blocked (sim_run = -2). Pro+ gets a
  // monthly quota; consume the slot atomically so parallel posts can't
  // overshoot. We treat all sim kinds as a single 'sim_run' bucket —
  // simpler quota model and matches the pricing page presentation.
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;
  const slot = await consumeMonthlyMetricSlot(planCheck.userId, planCheck.plan, 'sim_run', { kind });
  if (!slot.ok) {
    if (slot.limit === -2) {
      return NextResponse.json({
        ok: false,
        error: 'Simulation suite is a Pro+ feature. Upgrade to run CFD/MBD/CAM/mold/optics/thermal simulations.',
        code: 'PLAN_LOCKED',
        upgradeRequired: 'pro',
      }, { status: 403 });
    }
    return NextResponse.json({
      ok: false,
      error: `Monthly simulation limit reached (${slot.used}/${slot.limit}).`,
      code: 'MONTHLY_LIMIT',
      used: slot.used,
      limit: slot.limit,
    }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const job = await enqueueJob(kind, body);
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      kind: job.kind,
      status: job.status,
      pollUrl: `/api/sim/${kind}/job/${job.id}`,
      quotaRemaining: slot.limit === -1 ? null : slot.limit - slot.used - 1,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET() {
  // Diagnostic: list registered solvers + active job count.
  await bootstrapSolversForEnv();
  return NextResponse.json({ kinds: listSolverKinds() });
}
