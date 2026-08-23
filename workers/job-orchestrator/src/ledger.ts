interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableStateLike { storage: DurableStorageLike }

type LedgerStatus = 'REGISTERED' | 'ENQUEUEING' | 'QUEUE_PERSISTED' | 'WORKFLOW_STARTED';
type LedgerRecord = {
  jobId: string;
  messageSha256: string;
  status: LedgerStatus;
  reservationDeliveryId?: string;
  reservationExpiresAt?: number;
  queueDeliveryId?: string;
  updatedAt: number;
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RESERVATION_MS = 60_000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export class CadJobLedger {
  constructor(private readonly state: DurableStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const jobId = typeof body.jobId === 'string' ? body.jobId : '';
    const messageSha256 = typeof body.messageSha256 === 'string' ? body.messageSha256 : '';
    const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : '';
    const now = Number.isSafeInteger(body.now) ? Number(body.now) : Date.now();
    if (!SAFE_ID.test(jobId) || !SHA256.test(messageSha256)) return json(400, { ok: false, code: 'INVALID_LEDGER_IDENTITY' });
    const existing = await this.state.storage.get<LedgerRecord>('record');
    if (existing && (existing.jobId !== jobId || existing.messageSha256 !== messageSha256)) {
      return json(409, { ok: false, code: 'JOB_ID_PAYLOAD_CONFLICT' });
    }

    if (url.pathname === '/register') {
      if (!SAFE_ID.test(deliveryId)) return json(400, { ok: false, code: 'INVALID_DELIVERY_ID' });
      if (existing?.status === 'QUEUE_PERSISTED' || existing?.status === 'WORKFLOW_STARTED') {
        return json(200, { ok: true, needsEnqueue: false, status: existing.status });
      }
      if (existing?.status === 'ENQUEUEING' && Number(existing.reservationExpiresAt ?? 0) >= now) {
        return json(200, { ok: true, needsEnqueue: false, status: existing.status });
      }
      const record: LedgerRecord = {
        jobId,
        messageSha256,
        status: 'ENQUEUEING',
        reservationDeliveryId: deliveryId,
        reservationExpiresAt: now + RESERVATION_MS,
        updatedAt: now,
      };
      await this.state.storage.put('record', record);
      return json(200, { ok: true, needsEnqueue: true, status: record.status });
    }

    if (!existing) return json(404, { ok: false, code: 'LEDGER_NOT_FOUND' });
    if (url.pathname === '/release') {
      if (existing.status === 'ENQUEUEING' && existing.reservationDeliveryId === deliveryId) {
        await this.state.storage.put('record', {
          ...existing,
          status: 'REGISTERED',
          reservationDeliveryId: undefined,
          reservationExpiresAt: undefined,
          updatedAt: now,
        });
      }
      return json(200, { ok: true });
    }
    if (url.pathname === '/mark-enqueued') {
      if (existing.status !== 'ENQUEUEING' || existing.reservationDeliveryId !== deliveryId) {
        return json(409, { ok: false, code: 'DELIVERY_RESERVATION_MISMATCH' });
      }
      await this.state.storage.put('record', {
        ...existing,
        status: 'QUEUE_PERSISTED',
        queueDeliveryId: deliveryId,
        reservationDeliveryId: undefined,
        reservationExpiresAt: undefined,
        updatedAt: now,
      });
      return json(200, { ok: true, status: 'QUEUE_PERSISTED' });
    }
    if (url.pathname === '/mark-workflow') {
      await this.state.storage.put('record', { ...existing, status: 'WORKFLOW_STARTED', updatedAt: now });
      return json(200, { ok: true, status: 'WORKFLOW_STARTED' });
    }
    return json(404, { ok: false, code: 'NOT_FOUND' });
  }
}
