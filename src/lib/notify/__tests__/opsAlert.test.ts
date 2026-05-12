import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the mailer so we don't need SMTP. Track calls so we can assert routing.
const emailCalls: Array<{ to: string; subject: string; body: string }> = [];
vi.mock('@/app/lib/mailer', () => ({
  sendNotificationEmail: vi.fn(async (to: string, subject: string, body: string) => {
    emailCalls.push({ to, subject, body });
  }),
}));

// Mock fetch to capture Slack webhook posts.
const slackCalls: Array<{ url: string; body: string }> = [];
let slackOk = true;
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  slackCalls.push({ url, body: typeof init.body === 'string' ? init.body : '' });
  return new Response(slackOk ? 'ok' : 'fail', { status: slackOk ? 200 : 500 });
});

import { sendOpsAlert } from '../opsAlert';

describe('opsAlert', () => {
  let origFetch: typeof fetch;
  beforeEach(() => {
    emailCalls.length = 0;
    slackCalls.length = 0;
    slackOk = true;
    origFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.OPS_ALERT_EMAIL;
  });
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('falls back to console only when no channel configured', async () => {
    const r = await sendOpsAlert({
      severity: 'warning',
      title: 'no channels',
      bodyLines: ['line 1'],
      source: 'test',
    });
    expect(r.channels).toEqual([]);
    expect(slackCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(0);
  });

  it('posts to Slack when SLACK_WEBHOOK_URL is set', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
    const r = await sendOpsAlert({
      severity: 'critical',
      title: 'fire',
      bodyLines: ['everything is broken'],
      context: { count: 42 },
      source: 'test',
    });
    expect(r.channels).toContain('slack');
    expect(slackCalls).toHaveLength(1);
    const payload = JSON.parse(slackCalls[0].body) as { text: string };
    expect(payload.text).toContain('fire');
    expect(payload.text).toContain('everything is broken');
    expect(payload.text).toContain('count: 42');
    expect(payload.text).toContain('rotating_light'); // critical emoji
  });

  it('emails admins when OPS_ALERT_EMAIL is set', async () => {
    process.env.OPS_ALERT_EMAIL = 'a@x.com,b@x.com';
    const r = await sendOpsAlert({
      severity: 'warning',
      title: 'warn',
      bodyLines: ['bodyline'],
      source: 'test',
    });
    expect(r.channels).toContain('email');
    expect(emailCalls).toHaveLength(2);
    expect(emailCalls[0].to).toBe('a@x.com');
    expect(emailCalls[1].to).toBe('b@x.com');
    expect(emailCalls[0].subject).toContain('WARNING');
    expect(emailCalls[0].body).toContain('bodyline');
  });

  it('returns both channels when both configured', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
    process.env.OPS_ALERT_EMAIL = 'a@x.com';
    const r = await sendOpsAlert({
      severity: 'info',
      title: 'both',
      bodyLines: [],
      source: 'test',
    });
    expect(r.channels.sort()).toEqual(['email', 'slack']);
  });

  it('isolates failures — broken slack does not break email path', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/broken';
    process.env.OPS_ALERT_EMAIL = 'a@x.com';
    slackOk = false;
    const r = await sendOpsAlert({
      severity: 'warning',
      title: 'partial',
      bodyLines: [],
      source: 'test',
    });
    expect(r.channels).toEqual(['email']);
    expect(emailCalls).toHaveLength(1);
  });

  it('handles fetch throwing without crashing', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/throws';
    global.fetch = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    const r = await sendOpsAlert({
      severity: 'critical',
      title: 'should not throw',
      bodyLines: [],
      source: 'test',
    });
    expect(r.channels).toEqual([]);
  });
});
