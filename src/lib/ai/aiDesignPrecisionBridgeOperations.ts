import 'server-only';

import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { assertAiPrecisionBridgeMigration, type AiPrecisionBridgeStatus } from './aiDesignPrecisionBridgeJobStore';

export const AI_PRECISION_BRIDGE_OPERATIONS_SCHEMA = 'nexyfab.ai-precision-bridge-operations.v1' as const;

const STATUSES: AiPrecisionBridgeStatus[] = [
  'PENDING', 'CLAIMED', 'SENT', 'COMPLETED', 'HOLD', 'VERIFIED_UNKNOWN',
];
const ERROR_CODE = /[^A-Za-z0-9_.:-]/g;

type SummaryRow = {
  status: string;
  count: number | string;
  oldest_created_at: number | string | null;
  oldest_updated_at: number | string | null;
};

type ExceptionRow = {
  job_id: string;
  status: string;
  attempt: number | string;
  lease_generation: number | string;
  lease_expires_at: number | string | null;
  last_error: string | null;
  created_at: number | string;
  updated_at: number | string;
};

export type AiPrecisionBridgeOperationalAlert = {
  code: string;
  severity: 'warning' | 'critical';
  count: number;
  oldestAgeMs: number | null;
};

export type AiPrecisionBridgeOperationalSnapshot = {
  schema: typeof AI_PRECISION_BRIDGE_OPERATIONS_SCHEMA;
  generatedAt: string;
  status: 'READY' | 'DEGRADED' | 'ACTION_REQUIRED';
  manufacturingReleaseReady: false;
  counts: Record<AiPrecisionBridgeStatus, number>;
  oldestAgeMs: Record<AiPrecisionBridgeStatus, number | null>;
  throughput24h: { completed: number; held: number; receiptsAccepted: number };
  leases: { active: number; expired: number };
  alerts: AiPrecisionBridgeOperationalAlert[];
  exceptions: Array<{
    jobId: string;
    status: 'HOLD' | 'VERIFIED_UNKNOWN' | 'CLAIMED' | 'SENT';
    attempt: number;
    leaseGeneration: number;
    ageMs: number;
    leaseExpired: boolean;
    lastErrorCode: string | null;
    updatedAt: string;
  }>;
};

function finiteInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function timestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function ageMs(now: number, value: unknown): number | null {
  const parsed = timestamp(value);
  return parsed === null ? null : Math.max(0, now - parsed);
}

function safeErrorCode(value: string | null): string | null {
  if (!value) return null;
  const safe = value.slice(0, 128).replace(ERROR_CODE, '_');
  return safe || null;
}

function statusOf(value: string): AiPrecisionBridgeStatus | null {
  return STATUSES.includes(value as AiPrecisionBridgeStatus) ? value as AiPrecisionBridgeStatus : null;
}

function checkedThreshold(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 7 * 24 * 60 * 60_000) {
    throw new Error(`AI_PRECISION_OPERATIONS_${label}_INVALID`);
  }
  return value;
}

/** Privacy-minimized operational view. It never reads job JSON, owner keys, prompts, or CAD artifacts. */
export async function readAiPrecisionBridgeOperationalSnapshot(input: {
  db?: DbAdapter;
  now?: number;
  pendingWarningMs?: number;
  pendingCriticalMs?: number;
  unknownCriticalMs?: number;
  exceptionLimit?: number;
} = {}): Promise<AiPrecisionBridgeOperationalSnapshot> {
  const db = input.db ?? getDbAdapter();
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('AI_PRECISION_OPERATIONS_NOW_INVALID');
  const pendingWarningMs = checkedThreshold(input.pendingWarningMs ?? 5 * 60_000, 'PENDING_WARNING');
  const pendingCriticalMs = checkedThreshold(input.pendingCriticalMs ?? 30 * 60_000, 'PENDING_CRITICAL');
  const unknownCriticalMs = checkedThreshold(input.unknownCriticalMs ?? 5 * 60_000, 'UNKNOWN_CRITICAL');
  if (pendingCriticalMs <= pendingWarningMs) throw new Error('AI_PRECISION_OPERATIONS_PENDING_THRESHOLDS_INVALID');
  const exceptionLimit = input.exceptionLimit ?? 30;
  if (!Number.isSafeInteger(exceptionLimit) || exceptionLimit < 1 || exceptionLimit > 100) {
    throw new Error('AI_PRECISION_OPERATIONS_EXCEPTION_LIMIT_INVALID');
  }

  await assertAiPrecisionBridgeMigration(db);
  const [summaryRows, expiredRow, throughputRows, receiptRow, exceptionRows] = await Promise.all([
    db.queryAll<SummaryRow>(
      `SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest_created_at,
              MIN(updated_at) AS oldest_updated_at
       FROM nf_ai_precision_bridge_outbox GROUP BY status`,
    ),
    db.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM nf_ai_precision_bridge_outbox
       WHERE status IN (?, ?) AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
      'CLAIMED', 'SENT', now,
    ),
    db.queryAll<{ status: string; count: number | string }>(
      `SELECT status, COUNT(*) AS count FROM nf_ai_precision_bridge_outbox
       WHERE status IN (?, ?) AND updated_at >= ? GROUP BY status`,
      'COMPLETED', 'HOLD', now - 24 * 60 * 60_000,
    ),
    db.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM nf_ai_precision_bridge_receipts
       WHERE accepted_at >= ?`,
      now - 24 * 60 * 60_000,
    ),
    db.queryAll<ExceptionRow>(
      `SELECT job_id, status, attempt, lease_generation, lease_expires_at,
              last_error, created_at, updated_at
       FROM nf_ai_precision_bridge_outbox
       WHERE status IN (?, ?) OR (
         status IN (?, ?) AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
       )
       ORDER BY updated_at ASC, created_at ASC LIMIT ?`,
      'HOLD', 'VERIFIED_UNKNOWN', 'CLAIMED', 'SENT', now, exceptionLimit,
    ),
  ]);

  const counts = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<AiPrecisionBridgeStatus, number>;
  const oldestAge = Object.fromEntries(STATUSES.map(status => [status, null])) as Record<AiPrecisionBridgeStatus, number | null>;
  for (const row of summaryRows) {
    const status = statusOf(row.status);
    if (!status) throw new Error('AI_PRECISION_OPERATIONS_STATUS_INVALID');
    counts[status] = finiteInteger(row.count);
    oldestAge[status] = ageMs(now, row.oldest_created_at);
  }
  const throughput = Object.fromEntries(throughputRows.flatMap(row => {
    const status = statusOf(row.status);
    return status === 'COMPLETED' || status === 'HOLD' ? [[status, finiteInteger(row.count)]] : [];
  })) as Partial<Record<'COMPLETED' | 'HOLD', number>>;
  const expired = finiteInteger(expiredRow?.count);
  const active = counts.CLAIMED + counts.SENT;
  const alerts: AiPrecisionBridgeOperationalAlert[] = [];
  if (expired > 0) alerts.push({ code: 'AI_PRECISION_EXPIRED_LEASE', severity: 'critical', count: expired, oldestAgeMs: null });
  if (counts.VERIFIED_UNKNOWN > 0) alerts.push({
    code: oldestAge.VERIFIED_UNKNOWN !== null && oldestAge.VERIFIED_UNKNOWN >= unknownCriticalMs
      ? 'AI_PRECISION_UNKNOWN_RECONCILIATION_REQUIRED' : 'AI_PRECISION_UNKNOWN_PRESENT',
    severity: oldestAge.VERIFIED_UNKNOWN !== null && oldestAge.VERIFIED_UNKNOWN >= unknownCriticalMs ? 'critical' : 'warning',
    count: counts.VERIFIED_UNKNOWN, oldestAgeMs: oldestAge.VERIFIED_UNKNOWN,
  });
  if (counts.PENDING > 0 && oldestAge.PENDING !== null && oldestAge.PENDING >= pendingWarningMs) alerts.push({
    code: oldestAge.PENDING >= pendingCriticalMs ? 'AI_PRECISION_PENDING_SLA_CRITICAL' : 'AI_PRECISION_PENDING_SLA_WARNING',
    severity: oldestAge.PENDING >= pendingCriticalMs ? 'critical' : 'warning',
    count: counts.PENDING, oldestAgeMs: oldestAge.PENDING,
  });
  if ((throughput.HOLD ?? 0) > 0) alerts.push({
    code: 'AI_PRECISION_HOLD_REVIEW_REQUIRED', severity: 'warning',
    count: throughput.HOLD ?? 0, oldestAgeMs: oldestAge.HOLD,
  });
  if (counts.PENDING > 0 && (throughput.COMPLETED ?? 0) === 0) alerts.push({
    code: 'AI_PRECISION_NO_COMPLETION_WITH_BACKLOG', severity: 'warning',
    count: counts.PENDING, oldestAgeMs: oldestAge.PENDING,
  });

  const status = alerts.some(alert => alert.severity === 'critical')
    ? 'ACTION_REQUIRED' : alerts.length ? 'DEGRADED' : 'READY';
  return {
    schema: AI_PRECISION_BRIDGE_OPERATIONS_SCHEMA,
    generatedAt: new Date(now).toISOString(), status,
    manufacturingReleaseReady: false,
    counts, oldestAgeMs: oldestAge,
    throughput24h: {
      completed: throughput.COMPLETED ?? 0,
      held: throughput.HOLD ?? 0,
      receiptsAccepted: finiteInteger(receiptRow?.count),
    },
    leases: { active, expired }, alerts,
    exceptions: exceptionRows.flatMap(row => {
      if (!['HOLD', 'VERIFIED_UNKNOWN', 'CLAIMED', 'SENT'].includes(row.status)) return [];
      const createdAt = timestamp(row.created_at);
      const updatedAt = timestamp(row.updated_at);
      if (createdAt === null || updatedAt === null) return [];
      const leaseExpiresAt = timestamp(row.lease_expires_at);
      return [{
        jobId: String(row.job_id).slice(0, 96),
        status: row.status as 'HOLD' | 'VERIFIED_UNKNOWN' | 'CLAIMED' | 'SENT',
        attempt: finiteInteger(row.attempt),
        leaseGeneration: finiteInteger(row.lease_generation),
        ageMs: Math.max(0, now - createdAt),
        leaseExpired: leaseExpiresAt !== null && leaseExpiresAt <= now,
        lastErrorCode: safeErrorCode(row.last_error),
        updatedAt: new Date(updatedAt).toISOString(),
      }];
    }),
  };
}
