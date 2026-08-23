import { verifyCommercialTransportHmac, validateCommercialTransport, type CommercialTransportEnvelope, type CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';

export type CommercialWorkerHoldCode = 'TRANSPORT_INVALID' | 'TRANSPORT_EXPIRED' | 'WORKER_ENDPOINT_NOT_CONFIGURED' | 'SSRF_BLOCKED';
export type CommercialWorkerPreparation = { ok: true; envelope: CommercialTransportEnvelope } | { ok: false; status: 'HOLD'; code: CommercialWorkerHoldCode };
export type CommercialExecutor = (envelope: CommercialTransportEnvelope) => Promise<CommercialWorkerReceipt>;
function safeEndpoint(value: string): boolean { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return false; if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[::1\])/i.test(url.hostname)) return false; return true; } catch { return false; } }
export async function prepareCommercialWorkerExecution(input: { envelope: CommercialTransportEnvelope; transportSecret?: string; workerEndpoint?: string; now?: number }): Promise<CommercialWorkerPreparation> {
  if (!input.transportSecret || input.transportSecret.length < 32 || !input.workerEndpoint) return { ok: false, status: 'HOLD', code: 'WORKER_ENDPOINT_NOT_CONFIGURED' };
  if (!safeEndpoint(input.workerEndpoint)) return { ok: false, status: 'HOLD', code: 'SSRF_BLOCKED' };
  const issues = validateCommercialTransport(input.envelope); if (issues.length) return { ok: false, status: 'HOLD', code: issues.some(item => item.includes('expiry')) ? 'TRANSPORT_EXPIRED' : 'TRANSPORT_INVALID' };
  const now = input.now ?? Date.now(); if (Date.parse(input.envelope.expiresAt) <= now) return { ok: false, status: 'HOLD', code: 'TRANSPORT_EXPIRED' };
  if (!(await verifyCommercialTransportHmac(input.transportSecret, input.envelope))) return { ok: false, status: 'HOLD', code: 'TRANSPORT_INVALID' };
  return { ok: true, envelope: input.envelope };
}
export async function executeCommercialWorker(input: { envelope: CommercialTransportEnvelope; transportSecret?: string; workerEndpoint?: string; executor: CommercialExecutor; now?: number }): Promise<{ ok: true; receipt: CommercialWorkerReceipt } | { ok: false; status: 'HOLD'; code: CommercialWorkerHoldCode }> {
  const prepared = await prepareCommercialWorkerExecution(input); if (!prepared.ok) return prepared;
  try { return { ok: true, receipt: await input.executor(prepared.envelope) }; } catch { return { ok: false, status: 'HOLD', code: 'TRANSPORT_INVALID' }; }
}
