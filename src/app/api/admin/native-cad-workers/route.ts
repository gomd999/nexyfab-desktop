import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import {
  evaluateNativeWorkerReadiness,
  type NativeWorkerCanaryEvidence,
  type NativeWorkerProbeEvidence,
} from '@/lib/reference/nativeWorkerReadiness';
import { NATIVE_WORKER_HOST_REQUIREMENTS, validateNativeWorkerHealth, type ExternalNativeWorkerKind, type NativeWorkerHealth } from '@/lib/reference/nativeWorkerHostContract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readEvidence(environment: string, schema: string, field: string): { observedAtMs: number; artifact: Record<string, unknown> } | null {
  const filename = process.env[environment]?.trim();
  if (!filename) return null;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size < 2 || stat.size > 2 * 1024 * 1024) return null;
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')) as Record<string, unknown>;
    const observedAtMs = typeof parsed.generatedAt === 'string' ? Date.parse(parsed.generatedAt) : Number.NaN;
    if (parsed.schema !== schema || !Array.isArray(parsed[field]) || !Number.isFinite(observedAtMs)) return null;
    return { observedAtMs, artifact: parsed };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const healthRaw = readEvidence(
    'NEXYFAB_NATIVE_WORKER_HEALTH_EVIDENCE',
    'nexyfab.native-worker-health-probe-batch.v1',
    'results',
  );
  const canaryRaw = readEvidence(
    'NEXYFAB_NATIVE_WORKER_CANARY_EVIDENCE',
    'nexyfab.native-worker-canary-gate.v1',
    'gates',
  );
  const health: NativeWorkerProbeEvidence | null = healthRaw ? {
    observedAtMs: healthRaw.observedAtMs,
    results: (healthRaw.artifact.results as Array<{ workerKind?: unknown; status?: unknown; health?: NativeWorkerHealth }>).flatMap((item) => {
      if (typeof item.workerKind !== 'string' || !(item.workerKind in NATIVE_WORKER_HOST_REQUIREMENTS)) return [];
      if (!['pass', 'fail', 'not_run'].includes(String(item.status))) return [];
      const workerKind = item.workerKind as ExternalNativeWorkerKind;
      const status = item.status as 'pass' | 'fail' | 'not_run';
      return [{ workerKind, status, validated: status === 'pass' && Boolean(item.health) && validateNativeWorkerHealth(workerKind, item.health!).ready }];
    }),
  } : null;
  const validUntilMs = canaryRaw && typeof canaryRaw.artifact.validUntil === 'string'
    ? Date.parse(canaryRaw.artifact.validUntil)
    : Number.NaN;
  const canary: NativeWorkerCanaryEvidence | null = canaryRaw ? {
    observedAtMs: canaryRaw.observedAtMs,
    validUntilMs,
    manifestSha256: typeof canaryRaw.artifact.manifestSha256 === 'string' ? canaryRaw.artifact.manifestSha256 : '',
    gates: (canaryRaw.artifact.gates as Array<{ workerKind?: unknown; status?: unknown; workerIdentitySha256?: unknown }>).flatMap((item) => {
      if (typeof item.workerKind !== 'string' || !(item.workerKind in NATIVE_WORKER_HOST_REQUIREMENTS)) return [];
      if (!['pass', 'ready_to_run', 'blocked_health'].includes(String(item.status))) return [];
      return [{
        workerKind: item.workerKind as ExternalNativeWorkerKind,
        status: item.status as 'pass' | 'ready_to_run' | 'blocked_health',
        workerIdentitySha256: typeof item.workerIdentitySha256 === 'string' ? item.workerIdentitySha256 : null,
      }];
    }),
  } : null;
  return NextResponse.json({
    ok: true,
    ...evaluateNativeWorkerReadiness(process.env, health, canary),
    evidence: { healthLoaded: Boolean(health), canaryLoaded: Boolean(canary) },
  });
}
