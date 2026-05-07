/**
 * SLA deadline checker — run periodically via job queue or cron.
 * Checks contract milestones with due_date and sends alerts.
 */
import { getDbAdapter } from './db-adapter';
import { createNotification } from '../app/lib/notify';
import { enqueueJob } from './job-queue';

export interface SLAAlert {
  contractId: string;
  milestoneId: string;
  title: string;
  dueDate: string;
  daysUntilDue: number;
  status: 'warning' | 'overdue';
}

export async function checkSLADeadlines(): Promise<SLAAlert[]> {
  const db = getDbAdapter();
  const warningDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  let milestones: Array<{
    id: string; contract_id: string; title: string; due_date: string; status: string;
  }> = [];

  try {
    milestones = await db.queryAll<{
      id: string; contract_id: string; title: string; due_date: string; status: string;
    }>(
      `SELECT id, contract_id, title, due_date, status
       FROM nf_contract_milestones
       WHERE status NOT IN ('completed', 'rejected')
         AND due_date IS NOT NULL
         AND due_date <= ?`,
      warningDate,
    );
  } catch { return []; }

  const alerts: SLAAlert[] = [];

  for (const m of milestones) {
    const dueDate = new Date(m.due_date);
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const daysUntilDue = Math.ceil(diffMs / 86_400_000);
    const alertStatus: 'warning' | 'overdue' = daysUntilDue < 0 ? 'overdue' : 'warning';

    alerts.push({
      contractId: m.contract_id,
      milestoneId: m.id,
      title: m.title,
      dueDate: m.due_date,
      daysUntilDue,
      status: alertStatus,
    });

    // Notifications + email alerts
    try {
      const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@nexyfab.com';

      if (alertStatus === 'overdue') {
        createNotification(
          'admin',
          'sla_overdue',
          `SLA 위반 — ${m.title}`,
          `계약 ${m.contract_id}의 마일스톤이 ${Math.abs(daysUntilDue)}일 지연되었습니다. 납기: ${m.due_date}`,
          { contractId: m.contract_id },
        );
        await enqueueJob('send_email', {
          to: adminEmail,
          subject: `[NexyFab] SLA 위반 — ${m.title}`,
          html: `<p>계약 <strong>${m.contract_id}</strong>의 마일스톤 <strong>${m.title}</strong>이 ${Math.abs(daysUntilDue)}일 지연되었습니다.</p><p>납기일: ${m.due_date}</p>`,
        }).catch(() => {});
      } else if (daysUntilDue <= 3) {
        createNotification(
          'admin',
          'sla_warning',
          `납기 ${daysUntilDue}일 전 — ${m.title}`,
          `계약 ${m.contract_id}의 마일스톤 납기가 ${daysUntilDue}일 남았습니다. 납기: ${m.due_date}`,
          { contractId: m.contract_id },
        );
        await enqueueJob('send_email', {
          to: adminEmail,
          subject: `[NexyFab] 납기 ${daysUntilDue}일 전 — ${m.title}`,
          html: `<p>계약 <strong>${m.contract_id}</strong>의 마일스톤 <strong>${m.title}</strong> 납기가 ${daysUntilDue}일 남았습니다.</p><p>납기일: ${m.due_date}</p>`,
        }).catch(() => {});
      }
    } catch { /* non-blocking */ }
  }

  return alerts;
}
