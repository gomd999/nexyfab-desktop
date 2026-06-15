/**
 * partnerRedaction — enforce customer anonymity in partner-facing RFQ/quote views.
 *
 * Policy (NexyFab "회사명 비공개"): before a quote is accepted, a partner sees the
 * job's technical facts (shape, material, quantity, DFM) but NOT who the customer
 * is. Today that holds only because the pre-acceptance queries happen not to
 * SELECT customer columns — anonymity by omission, one careless `SELECT *` away
 * from a leak. This module makes it explicit and testable: route the partner-
 * facing RFQ payload through `redactRfqForPartner` so any customer-identity field
 * that ever sneaks in is stripped, and assert the invariant in tests.
 *
 * Scope: PRE-acceptance only (RFQ / open quote). Once a contract is signed the
 * two parties are introduced, so contract/order payloads intentionally DO carry
 * the customer email — do NOT run this on those.
 */

/** Structured fields that identify the customer (snake + camel variants). The
 *  list is domain-specific on purpose — generic `name`/`email` are excluded so
 *  legitimate fields (shape_name, project_name) are never stripped. */
export const CUSTOMER_IDENTITY_FIELDS = [
  'customer_email', 'customerEmail',
  'customer_contact', 'customerContact',
  'customer_name', 'customerName',
  'customer_phone', 'customerPhone',
  'buyer_email', 'buyerEmail',
  'user_id', 'userId',
  'user_email', 'userEmail',
  'user_name', 'userName',
] as const;

const FIELD_SET = new Set<string>(CUSTOMER_IDENTITY_FIELDS);

/** Strip every customer-identity field from a partner-facing RFQ/quote object.
 *  Returns a shallow copy; safe to call on already-clean objects (no-op). */
export function redactRfqForPartner<T extends Record<string, unknown>>(rfq: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rfq)) {
    if (!FIELD_SET.has(k)) out[k] = v;
  }
  return out as T;
}

/** Convenience for a list of RFQs. */
export function redactRfqsForPartner<T extends Record<string, unknown>>(rfqs: readonly T[]): T[] {
  return rfqs.map(redactRfqForPartner);
}

/** Names of customer-identity fields present with a non-empty value — empty when
 *  the object is clean. Used by tests (and an optional dev guard) to assert the
 *  anonymity invariant instead of trusting which columns a query selected. */
export function findCustomerIdentityLeak(obj: Record<string, unknown>): string[] {
  return CUSTOMER_IDENTITY_FIELDS.filter((f) => {
    const v = obj[f];
    return v !== undefined && v !== null && v !== '';
  });
}

/** Throw if a partner-facing object still carries customer identity. */
export function assertNoCustomerIdentityLeak(obj: Record<string, unknown>, context = 'partner payload'): void {
  const leaked = findCustomerIdentityLeak(obj);
  if (leaked.length > 0) {
    throw new Error(`Customer anonymity leak in ${context}: ${leaked.join(', ')}`);
  }
}
