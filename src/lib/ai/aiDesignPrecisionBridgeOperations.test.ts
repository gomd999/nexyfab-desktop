import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { readAiPrecisionBridgeOperationalSnapshot } from './aiDesignPrecisionBridgeOperations';

const NOW = Date.parse('2026-08-24T14:00:00.000Z');
const MIGRATION_CHECKSUM = '6ca9f2a5156f0aa5ebffd39799cd6f93c6b470b30ba3a7b8caa189d7bcbf2ba0';

beforeEach(() => vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082403', MIGRATION_CHECKSUM));

function db(input: {
  summaries?: Array<Record<string, unknown>>;
  expired?: number;
  throughput?: Array<Record<string, unknown>>;
  receipts?: number;
  exceptions?: Array<Record<string, unknown>>;
} = {}): DbAdapter {
  return {
    backend: 'postgres',
    queryOne: async (sql: string) => {
      if (sql.includes('schema_migrations')) return { version: 2026082403, checksum: MIGRATION_CHECKSUM };
      if (sql.includes('lease_expires_at IS NOT NULL')) return { count: input.expired ?? 0 };
      if (sql.includes('nf_ai_precision_bridge_receipts')) return { count: input.receipts ?? 0 };
      return undefined;
    },
    queryAll: async (sql: string) => {
      if (sql.includes('MIN(created_at)')) return input.summaries ?? [];
      if (sql.includes('updated_at >= ?')) return input.throughput ?? [];
      if (sql.includes('last_error, created_at')) return input.exceptions ?? [];
      return [];
    },
    execute: async () => ({ changes: 0 }), executeRaw: async () => undefined,
    transaction: async fn => fn(db(input)), close: async () => undefined,
  } as DbAdapter;
}

describe('AI Precision bridge operational snapshot', () => {
  it('reports a privacy-minimized ready snapshot', async () => {
    const snapshot = await readAiPrecisionBridgeOperationalSnapshot({
      db: db({
        summaries: [{ status: 'COMPLETED', count: '3', oldest_created_at: NOW - 10_000, oldest_updated_at: NOW - 5_000 }],
        throughput: [{ status: 'COMPLETED', count: '3' }], receipts: 3,
      }), now: NOW,
    });
    expect(snapshot).toMatchObject({
      status: 'READY', manufacturingReleaseReady: false,
      counts: { COMPLETED: 3, PENDING: 0, VERIFIED_UNKNOWN: 0 },
      throughput24h: { completed: 3, held: 0, receiptsAccepted: 3 },
      leases: { active: 0, expired: 0 }, alerts: [], exceptions: [],
    });
  });

  it('degrades on backlog SLA and recent HOLD without exposing payload identity', async () => {
    const snapshot = await readAiPrecisionBridgeOperationalSnapshot({
      db: db({
        summaries: [
          { status: 'PENDING', count: 2, oldest_created_at: NOW - 10 * 60_000, oldest_updated_at: NOW - 1000 },
          { status: 'HOLD', count: 1, oldest_created_at: NOW - 20_000, oldest_updated_at: NOW - 10_000 },
        ],
        throughput: [{ status: 'HOLD', count: 1 }],
        exceptions: [{
          job_id: `ai-precision-job:${'a'.repeat(48)}`, status: 'HOLD', attempt: 1,
          lease_generation: 1, lease_expires_at: null,
          last_error: 'dangerous error with tenant@example.com', created_at: NOW - 20_000, updated_at: NOW - 10_000,
          owner_key_sha256: 'secret-owner', project_id: 'secret-project', job_json: 'secret-payload',
        }],
      }), now: NOW,
    });
    expect(snapshot.status).toBe('DEGRADED');
    expect(snapshot.alerts.map(alert => alert.code)).toEqual(expect.arrayContaining([
      'AI_PRECISION_PENDING_SLA_WARNING', 'AI_PRECISION_HOLD_REVIEW_REQUIRED',
      'AI_PRECISION_NO_COMPLETION_WITH_BACKLOG',
    ]));
    expect(snapshot.exceptions[0]?.lastErrorCode).toBe('dangerous_error_with_tenant_example.com');
    expect(JSON.stringify(snapshot)).not.toMatch(/secret-owner|secret-project|secret-payload|tenant@example/);
  });

  it('requires action for expired leases and aged verified-unknown work', async () => {
    const snapshot = await readAiPrecisionBridgeOperationalSnapshot({
      db: db({
        summaries: [
          { status: 'CLAIMED', count: 1, oldest_created_at: NOW - 60_000, oldest_updated_at: NOW - 50_000 },
          { status: 'VERIFIED_UNKNOWN', count: 1, oldest_created_at: NOW - 20 * 60_000, oldest_updated_at: NOW - 10 * 60_000 },
        ], expired: 1,
      }), now: NOW,
    });
    expect(snapshot.status).toBe('ACTION_REQUIRED');
    expect(snapshot.leases).toEqual({ active: 1, expired: 1 });
    expect(snapshot.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AI_PRECISION_EXPIRED_LEASE', severity: 'critical' }),
      expect.objectContaining({ code: 'AI_PRECISION_UNKNOWN_RECONCILIATION_REQUIRED', severity: 'critical' }),
    ]));
  });

  it('rejects invalid operational thresholds', async () => {
    await expect(readAiPrecisionBridgeOperationalSnapshot({
      db: db(), now: NOW, pendingWarningMs: 60_000, pendingCriticalMs: 60_000,
    })).rejects.toThrow('AI_PRECISION_OPERATIONS_PENDING_THRESHOLDS_INVALID');
  });
});
