import { getDbAdapter } from './db-adapter';

export type JobType = 'send_email' | 'stripe_reprocess';

export interface JobPayload {
  send_email: { to: string; subject: string; html: string };
  stripe_reprocess: { eventId: string };
}

export async function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayload[T],
  opts?: { maxAttempts?: number; delayMs?: number },
): Promise<string> {
  const db = getDbAdapter();
  const id = `job-${crypto.randomUUID()}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_job_queue (id, type, payload, status, attempts, max_attempts, scheduled_at, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    id,
    type,
    JSON.stringify(payload),
    opts?.maxAttempts ?? 3,
    now + (opts?.delayMs ?? 0),
    now,
  );
  return id;
}

export async function processJobQueue(): Promise<void> {
  const db = getDbAdapter();
  const now = Date.now();

  const jobs = await db.queryAll<{
    id: string; type: string; payload: string; attempts: number; max_attempts: number;
  }>(
    `SELECT id, type, payload, attempts, max_attempts
     FROM nf_job_queue
     WHERE status = 'pending' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 10`,
    now,
  );

  for (const job of jobs) {
    // Atomic claim: only proceed if this instance wins the race (status still 'pending')
    const claimed = await db.execute(
      `UPDATE nf_job_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'pending'`,
      job.id,
    );
    if (claimed.changes === 0) continue; // another instance already claimed this job

    try {
      await executeJob(job.type as JobType, JSON.parse(job.payload));
      await db.execute(
        `UPDATE nf_job_queue SET status = 'done', processed_at = ? WHERE id = ?`,
        now, job.id,
      );
    } catch (err) {
      const failed = job.attempts + 1 >= job.max_attempts;
      const backoffMs = Math.min(1000 * 2 ** job.attempts, 3_600_000); // exponential backoff, max 1h
      await db.execute(
        `UPDATE nf_job_queue SET status = ?, error = ?, scheduled_at = ? WHERE id = ?`,
        failed ? 'failed' : 'pending',
        err instanceof Error ? err.message : String(err),
        now + backoffMs,
        job.id,
      );
    }
  }
}

async function executeJob(type: JobType, payload: unknown): Promise<void> {
  if (type === 'send_email') {
    const { sendNotificationEmail } = await import('../app/lib/mailer');
    const { to, subject, html } = payload as JobPayload['send_email'];
    await sendNotificationEmail(to, subject, html);
  }
  // stripe_reprocess: future implementation
}
