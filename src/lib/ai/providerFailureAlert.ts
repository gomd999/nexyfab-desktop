import { createHash } from 'node:crypto';
import { listAdminAccessEmails } from '@/lib/admin-email-auth';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/email';
import type { ProviderName } from './types';

export const AI_FAILURE_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AiProviderFailureAlert {
  provider: ProviderName;
  model?: string;
  status?: number;
  errorMessage: string;
  task?: string;
  attemptedProviders?: readonly ProviderName[];
  recoveredBy?: { provider: ProviderName; model: string };
}

export type AiFailureAlertResult =
  | { status: 'sent'; recipients: number; nextEligibleAt: number }
  | { status: 'suppressed'; nextEligibleAt?: number }
  | { status: 'not_configured' }
  | { status: 'delivery_failed' };

let tableReady = false;
const localLeases = new Map<string, number>();

function normalizedModel(event: AiProviderFailureAlert): string {
  return event.model?.trim() || `${event.provider}-default`;
}

function incidentKey(event: AiProviderFailureAlert): string {
  // Deliberately exclude task and raw error text: one broken model must create
  // one incident, not one email per route, prompt, status wording, or user.
  return createHash('sha256')
    .update(`${event.provider}\n${normalizedModel(event)}`)
    .digest('hex');
}

function cleanError(message: string): string {
  return message
    .replace(/(?:sk|pk|api)[-_][a-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .slice(0, 500);
}

function envRecipients(): string[] {
  return [
    process.env.AI_FAILURE_ALERT_EMAIL,
    process.env.OPS_ALERT_EMAIL,
    process.env.NEXYFAB_ADMIN_EMAIL,
    process.env.ADMIN_EMAIL,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap(value => value.split(','))
    .map(value => value.trim().toLowerCase())
    .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function resolveAdminRecipients(): Promise<string[]> {
  const recipients = new Set(envRecipients());
  try {
    const access = await listAdminAccessEmails();
    for (const entry of access) {
      if (entry.active) recipients.add(entry.email.trim().toLowerCase());
    }
  } catch (error) {
    console.warn('[ai-failure-alert] admin email allowlist unavailable:', error);
  }
  return [...recipients];
}

async function ensureTable(db: DbAdapter): Promise<void> {
  if (tableReady) return;
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_ai_failure_alert_leases (
      incident_key TEXT NOT NULL PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      last_alert_at BIGINT NOT NULL,
      next_alert_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nf_ai_failure_alert_next
      ON nf_ai_failure_alert_leases(next_alert_at);
  `);
  tableReady = true;
}

async function claimPersistentLease(
  event: AiProviderFailureAlert,
  now: number,
  db: DbAdapter = getDbAdapter(),
): Promise<{ claimed: boolean; nextEligibleAt: number }> {
  await ensureTable(db);
  const key = incidentKey(event);
  const nextEligibleAt = now + AI_FAILURE_ALERT_INTERVAL_MS;
  const inserted = await db.execute(
    `INSERT OR IGNORE INTO nf_ai_failure_alert_leases
       (incident_key, provider, model, last_alert_at, next_alert_at)
     VALUES (?, ?, ?, ?, ?)`,
    key, event.provider, normalizedModel(event), now, nextEligibleAt,
  );
  if (inserted.changes > 0) return { claimed: true, nextEligibleAt };

  // The WHERE predicate makes renewal atomic across multiple app instances:
  // once one instance advances next_alert_at, every peer gets changes=0.
  const renewed = await db.execute(
    `UPDATE nf_ai_failure_alert_leases
        SET last_alert_at = ?, next_alert_at = ?, provider = ?, model = ?
      WHERE incident_key = ? AND next_alert_at <= ?`,
    now, nextEligibleAt, event.provider, normalizedModel(event), key, now,
  );
  if (renewed.changes > 0) return { claimed: true, nextEligibleAt };

  const row = await db.queryOne<{ next_alert_at: number | string }>(
    'SELECT next_alert_at FROM nf_ai_failure_alert_leases WHERE incident_key = ?',
    key,
  );
  return {
    claimed: false,
    nextEligibleAt: Number(row?.next_alert_at ?? nextEligibleAt),
  };
}

function claimLocalLease(event: AiProviderFailureAlert, now: number): { claimed: boolean; nextEligibleAt: number } {
  const key = incidentKey(event);
  const existing = localLeases.get(key) ?? 0;
  if (existing > now) return { claimed: false, nextEligibleAt: existing };
  const nextEligibleAt = now + AI_FAILURE_ALERT_INTERVAL_MS;
  localLeases.set(key, nextEligibleAt);
  return { claimed: true, nextEligibleAt };
}

async function claimLease(event: AiProviderFailureAlert, now: number) {
  try {
    return await claimPersistentLease(event, now);
  } catch (error) {
    // Keep alerts useful during a DB incident while retaining per-process
    // suppression. This fallback never throws into the user's AI request.
    console.warn('[ai-failure-alert] persistent dedupe unavailable; using local lease:', error);
    return claimLocalLease(event, now);
  }
}

async function releaseFailedDeliveryLease(event: AiProviderFailureAlert, claimedAt: number): Promise<void> {
  const key = incidentKey(event);
  localLeases.delete(key);
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    await db.execute(
      `UPDATE nf_ai_failure_alert_leases
          SET next_alert_at = ?
        WHERE incident_key = ? AND last_alert_at = ?`,
      claimedAt, key, claimedAt,
    );
  } catch {
    // Delivery already failed; the next failure event will retry via the local
    // lease even if the persistent store is unavailable as well.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

/**
 * First failure sends immediately. Further failures for the same
 * provider+model are suppressed until 24 hours after the last sent alert.
 * A new failure after that boundary sends the next reminder.
 */
export async function notifyAiProviderFailure(
  event: AiProviderFailureAlert,
  now = Date.now(),
): Promise<AiFailureAlertResult> {
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) {
    console.warn('[ai-failure-alert] no administrator recipient configured');
    return { status: 'not_configured' };
  }

  const lease = await claimLease(event, now);
  if (!lease.claimed) {
    return { status: 'suppressed', nextEligibleAt: lease.nextEligibleAt };
  }

  const model = normalizedModel(event);
  const recovered = event.recoveredBy
    ? `${event.recoveredBy.provider} / ${event.recoveredBy.model}`
    : '없음 (요청 실패)';
  const attempted = [...new Set(event.attemptedProviders ?? [event.provider])].join(' → ');
  const error = cleanError(event.errorMessage);
  const subject = `[NexyFab AI 장애] ${event.provider} / ${model}`;
  const text = [
    'NexyFab AI 모델 호출 장애가 감지되었습니다.',
    '',
    `발생 시각: ${new Date(now).toISOString()}`,
    `공급자: ${event.provider}`,
    `모델: ${model}`,
    `작업 유형: ${event.task || 'unknown'}`,
    `상태 코드: ${event.status ?? 'unknown'}`,
    `시도 체인: ${attempted}`,
    `대체 처리: ${recovered}`,
    `오류: ${error}`,
    '',
    `같은 공급자·모델 장애 알림은 ${new Date(lease.nextEligibleAt).toISOString()} 이후 새 실패가 발생할 때 다시 발송됩니다.`,
    '보안상 사용자 프롬프트, 파일 내용, API 키는 포함하지 않았습니다.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#111827">
    <h2 style="margin:0 0 16px">NexyFab AI 모델 호출 장애</h2>
    <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:16px;border-radius:8px">${escapeHtml(text)}</pre>
  </div>`;

  const results = await Promise.all(recipients.map(to => sendEmail({ to, subject, text, html })));
  const delivered = results.filter(result => result.ok).length;
  if (delivered === 0) {
    await releaseFailedDeliveryLease(event, now);
    console.warn('[ai-failure-alert] email delivery failed for every administrator');
    return { status: 'delivery_failed' };
  }
  return { status: 'sent', recipients: delivered, nextEligibleAt: lease.nextEligibleAt };
}

export function _resetAiFailureAlertStateForTests(): void {
  tableReady = false;
  localLeases.clear();
}
