/**
 * Slack ops alert — best-effort, fire-and-forget.
 *
 * 필요 env: SLACK_OPS_WEBHOOK_URL (Incoming Webhook URL)
 * 없으면 console.error 로 폴백. 절대 throw 하지 않는다 (caller 경로 보호).
 *
 * 사용 예:
 *   import { opsAlert } from '@/lib/ops-alert';
 *   await opsAlert('critical', 'RFQ 처리 실패', { rfqId, error: String(err) });
 */

type Severity = 'info' | 'warning' | 'critical';

interface AlertPayload {
  severity: Severity;
  title: string;
  context?: Record<string, unknown>;
  ts: number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  info:     '#2eb886',
  warning:  '#daa038',
  critical: '#d72b2b',
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  info:     ':information_source:',
  warning:  ':warning:',
  critical: ':rotating_light:',
};

/**
 * 최근 동일 키 알림 중복 억제 (5분 쿨다운). 프로세스 로컬이므로
 * Railway 멀티 인스턴스에서는 완벽하지 않지만 스팸은 대부분 억제됨.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const recentAlerts = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  recentAlerts.set(key, now);
  // 메모리 상한 — 256 키 이상 쌓이면 오래된 것 정리
  if (recentAlerts.size > 256) {
    for (const [k, t] of recentAlerts) {
      if (now - t > DEDUPE_WINDOW_MS) recentAlerts.delete(k);
    }
  }
  return true;
}

export async function opsAlert(
  severity: Severity,
  title: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const webhook = process.env.SLACK_OPS_WEBHOOK_URL;
  const payload: AlertPayload = { severity, title, context, ts: Date.now() };

  // 콘솔 로그는 항상 남김 (Railway logs 에서 추적 가능)
  const logFn = severity === 'critical' ? console.error : console.warn;
  logFn(`[ops-alert:${severity}] ${title}`, context ?? {});

  if (!webhook) return;

  const dedupeKey = `${severity}:${title}`;
  if (!shouldSend(dedupeKey)) return;

  const env = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'unknown';
  const contextLines = context
    ? Object.entries(context)
        .slice(0, 10)
        .map(([k, v]) => `• *${k}*: ${truncate(String(v), 500)}`)
        .join('\n')
    : '';

  const body = {
    attachments: [
      {
        color: SEVERITY_COLOR[severity],
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${SEVERITY_EMOJI[severity]} *[${env}] ${title}*`,
            },
          },
          ...(contextLines
            ? [{
                type: 'section' as const,
                text: { type: 'mrkdwn' as const, text: contextLines },
              }]
            : []),
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `nexyfab · ${new Date(payload.ts).toISOString()}` },
            ],
          },
        ],
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error('[ops-alert] slack delivery failed:', err);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
