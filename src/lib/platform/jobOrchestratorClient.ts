import {
  validateCadJobMessage,
  validateCadJobTransportReceipt,
  type CadJobMessage,
  type CadJobTransportReceipt,
} from './contracts';

export type DispatchCadJobResult =
  | { ok: true; receipt: CadJobTransportReceipt }
  | { ok: false; code: 'JOB_CONTRACT_REJECTED' | 'ORCHESTRATOR_NOT_CONFIGURED' | 'ORCHESTRATOR_UNAVAILABLE' | 'TRANSPORT_RECEIPT_REJECTED'; issues: string[] };

export async function dispatchCadJob(
  message: CadJobMessage,
  options: { fetchImpl?: typeof fetch; origin?: string; secret?: string } = {},
): Promise<DispatchCadJobResult> {
  const issues = validateCadJobMessage(message);
  if (issues.length) return { ok: false, code: 'JOB_CONTRACT_REJECTED', issues };
  const origin = options.origin ?? process.env.NEXYFAB_JOB_ORCHESTRATOR_URL;
  const secret = options.secret ?? process.env.NEXYFAB_JOB_ORCHESTRATOR_INGRESS_SECRET;
  if (!origin?.trim() || !secret || secret.length < 32) {
    return { ok: false, code: 'ORCHESTRATOR_NOT_CONFIGURED', issues: ['orchestrator_origin_or_secret_missing'] };
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${origin.replace(/\/$/, '')}/v1/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    return { ok: false, code: 'ORCHESTRATOR_UNAVAILABLE', issues: ['orchestrator_network_failure'] };
  }
  const body = await response.json().catch(() => ({})) as { receipt?: CadJobTransportReceipt; code?: string };
  if (!response.ok || !body.receipt) {
    return { ok: false, code: 'ORCHESTRATOR_UNAVAILABLE', issues: [body.code ?? `orchestrator_http_${response.status}`] };
  }
  const receiptIssues = validateCadJobTransportReceipt(body.receipt);
  if (body.receipt.jobId !== message.jobId) receiptIssues.push('transport_receipt_job_mismatch');
  if (receiptIssues.length) return { ok: false, code: 'TRANSPORT_RECEIPT_REJECTED', issues: [...new Set(receiptIssues)] };
  return { ok: true, receipt: body.receipt };
}
