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

/**
 * Request a QUOTE (not an order) from a supplier — posts to /api/nexyfab/rfq,
 * the canonical auction endpoint, which only requires materialId + quantity and
 * carries no price (you request a quote precisely because you don't have one).
 *
 * The supplier-panel "Request Quote" buttons previously hit /api/nexyfab/orders,
 * which rejects any order with totalPrice <= 0 (orders/route.ts:193) — so the
 * price-less quote requests 400'd in production. This helper routes them through
 * the proper RFQ pipeline instead. (2026-06-09 fix.)
 *
 * preferredFactoryId is intentionally omitted here: the supplier-matcher ids are
 * not nf_factories ids yet (directory↔marketplace mapping is a separate task), so
 * the RFQ broadcasts to active partners and records the requested supplier name
 * in `note`.
 */
export interface QuoteRequestPayload {
  partName?: string;
  /** Display name of the supplier the user picked — recorded in the RFQ note. */
  manufacturerName: string;
  materialId: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  /** RfqWriter full-email path: the composed subject/body. */
  rfqSubject?: string;
  rfqBody?: string;
}

export interface QuoteRequestResult {
  ok: boolean;
  /** Backend-assigned rfq id ("new" sentinel when the server didn't echo one). */
  rfqId?: string;
  message?: string;
}

export async function requestSupplierQuote(payload: QuoteRequestPayload): Promise<QuoteRequestResult> {
  try {
    const note = [
      payload.manufacturerName ? `요청 공급사 / Requested supplier: ${payload.manufacturerName}` : '',
      payload.rfqSubject ? `\n${payload.rfqSubject}` : '',
      payload.rfqBody ? `\n${payload.rfqBody}` : '',
    ].filter(Boolean).join('').slice(0, 2000) || undefined;

    const body: Record<string, unknown> = {
      materialId: payload.materialId,
      quantity: payload.quantity,
      shapeName: payload.partName ?? 'Custom Part',
      volume_cm3: payload.volume_cm3 ?? 0,
      bbox: payload.bbox ?? { w: 0, h: 0, d: 0 },
    };
    if (note) body.note = note;

    const res = await fetch('/api/nexyfab/rfq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, message: errText || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { rfqId?: string; id?: string };
    return { ok: true, rfqId: data.rfqId ?? data.id ?? 'new' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
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
