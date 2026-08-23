import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAdminAccessEmails: vi.fn(),
  sendEmail: vi.fn(),
  executeRaw: vi.fn(),
  execute: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/admin-email-auth', () => ({
  listAdminAccessEmails: mocks.listAdminAccessEmails,
}));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    backend: 'sqlite',
    executeRaw: mocks.executeRaw,
    execute: mocks.execute,
    queryOne: mocks.queryOne,
  }),
}));

import {
  AI_FAILURE_ALERT_INTERVAL_MS,
  _resetAiFailureAlertStateForTests,
  notifyAiProviderFailure,
} from './providerFailureAlert';

describe('AI provider failure email alerts', () => {
  const rows = new Map<string, { next: number }>();

  beforeEach(() => {
    rows.clear();
    delete process.env.AI_FAILURE_ALERT_EMAIL;
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.NEXYFAB_ADMIN_EMAIL;
    delete process.env.ADMIN_EMAIL;
    _resetAiFailureAlertStateForTests();
    vi.clearAllMocks();
    mocks.listAdminAccessEmails.mockResolvedValue([
      { id: '1', email: 'owner@example.com', active: true },
      { id: '2', email: 'disabled@example.com', active: false },
    ]);
    mocks.sendEmail.mockResolvedValue({ ok: true, messageId: 'mail-1' });
    mocks.executeRaw.mockResolvedValue(undefined);
    mocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT OR IGNORE')) {
        const [key, , , , next] = params as [string, string, string, number, number];
        if (rows.has(key)) return { changes: 0 };
        rows.set(key, { next });
        return { changes: 1 };
      }
      if (sql.includes('SET next_alert_at = ?')) {
        const [next, key] = params as [number, string, number];
        const row = rows.get(key);
        if (!row) return { changes: 0 };
        row.next = next;
        return { changes: 1 };
      }
      if (sql.includes('UPDATE nf_ai_failure_alert_leases')) {
        const [, next, , , key, now] = params as [number, number, string, string, string, number];
        const row = rows.get(key);
        if (!row || row.next > now) return { changes: 0 };
        row.next = next;
        return { changes: 1 };
      }
      return { changes: 0 };
    });
    mocks.queryOne.mockImplementation(async (_sql: string, key: string) => {
      const row = rows.get(key);
      return row ? { next_alert_at: row.next } : undefined;
    });
  });

  afterEach(() => {
    delete process.env.AI_FAILURE_ALERT_EMAIL;
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.NEXYFAB_ADMIN_EMAIL;
    delete process.env.ADMIN_EMAIL;
  });

  it('sends immediately, suppresses repeats, and sends again after 24 hours', async () => {
    const event = {
      provider: 'qwen' as const,
      model: 'qwen3.7-max',
      status: 503,
      errorMessage: 'temporarily unavailable',
      task: 'cad-feature-program',
      attemptedProviders: ['qwen', 'deepseek'] as const,
      recoveredBy: { provider: 'deepseek' as const, model: 'deepseek-chat' },
    };
    const first = await notifyAiProviderFailure(event, 1_000);
    const repeated = await notifyAiProviderFailure(event, 2_000);
    const afterWindow = await notifyAiProviderFailure(event, 1_000 + AI_FAILURE_ALERT_INTERVAL_MS);

    expect(first.status).toBe('sent');
    expect(repeated.status).toBe('suppressed');
    expect(afterWindow.status).toBe('sent');
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }));
  });

  it('deduplicates across tasks and redacts secrets, email addresses, and URLs', async () => {
    await notifyAiProviderFailure({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      errorMessage: 'Bearer sk-secret-token-123456789 owner@private.test https://private.test/path',
      task: 'vision',
    }, 10_000);
    const repeated = await notifyAiProviderFailure({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      errorMessage: 'different route failure',
      task: 'scad-agent',
    }, 20_000);

    expect(repeated.status).toBe('suppressed');
    const sent = mocks.sendEmail.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).not.toContain('sk-secret-token');
    expect(sent.text).not.toContain('owner@private.test');
    expect(sent.text).not.toContain('https://private.test');
    expect(sent.text).toContain('[redacted]');
  });

  it('uses configured env recipients together with active admin emails only', async () => {
    process.env.AI_FAILURE_ALERT_EMAIL = 'ops@example.com,owner@example.com';
    const result = await notifyAiProviderFailure({
      provider: 'deepseek',
      errorMessage: 'timeout',
    }, 30_000);

    expect(result).toMatchObject({ status: 'sent', recipients: 2 });
    const recipients = mocks.sendEmail.mock.calls.map(call => call[0].to);
    expect(recipients.sort()).toEqual(['ops@example.com', 'owner@example.com']);
    expect(recipients).not.toContain('disabled@example.com');
  });

  it('releases the lease when every email delivery fails so the next failure can retry', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ ok: false, error: 'smtp down' });
    const event = { provider: 'gemini' as const, model: 'gemini-2.5-flash', errorMessage: '503' };
    const failed = await notifyAiProviderFailure(event, 40_000);
    mocks.sendEmail.mockResolvedValueOnce({ ok: true, messageId: 'recovered-mail' });
    const retried = await notifyAiProviderFailure(event, 40_001);

    expect(failed.status).toBe('delivery_failed');
    expect(retried.status).toBe('sent');
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });
});
