/**
 * Shared client helper for submitting an RFQ order to /api/nexyfab/orders.
 *
 * Before this helper, three call sites (ManufacturerMatch, AISupplierPanel's
 * one-click Request Quote, and AISupplierPanel's RfqWriterPanel onSendDraft
 * binding) each reimplemented the same fetch + JSON-parse + typed-result
 * shape. Drift between them risked the backend seeing slightly different
 * payloads for the same logical action — e.g. one site omitting
 * `estimatedLeadDays`, another stuffing in a totalPriceKRW. Funnel back
 * through one entry point so the request shape stays consistent.
 */

export interface RfqSubmitPayload {
  /** Defaults to "Custom Part" if omitted. */
  partName?: string;
  /** Display name (already localized — Korean caller passes mfr.nameKo). */
  manufacturerName: string;
  quantity: number;
  /** Quote ETA in days, when the upstream panel knows it. */
  estimatedLeadDays?: number;
  /** Rough total price estimate in KRW, for the "quick quote" path. */
  totalPriceKRW?: number;
  /** Optional draft email subject — set when the caller went through the
   *  RfqWriter (full email) path so the backend can archive both fields. */
  rfqSubject?: string;
  rfqBody?: string;
}

export interface RfqSubmitResult {
  ok: boolean;
  /** Backend-assigned order id ("new" sentinel when the server didn't echo one). */
  orderId?: string;
  /** Failure reason, suitable for surfacing to the user. */
  message?: string;
}

export async function submitRfqOrder(payload: RfqSubmitPayload): Promise<RfqSubmitResult> {
  try {
    const body: Record<string, unknown> = {
      partName: payload.partName ?? 'Custom Part',
      manufacturerName: payload.manufacturerName,
      quantity: payload.quantity,
    };
    if (payload.estimatedLeadDays !== undefined) body.estimatedLeadDays = payload.estimatedLeadDays;
    if (payload.totalPriceKRW !== undefined) body.totalPriceKRW = payload.totalPriceKRW;
    if (payload.rfqSubject !== undefined) body.rfqSubject = payload.rfqSubject;
    if (payload.rfqBody !== undefined) body.rfqBody = payload.rfqBody;

    const res = await fetch('/api/nexyfab/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, message: errText || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { order?: { id?: string } };
    return { ok: true, orderId: data.order?.id ?? 'new' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
