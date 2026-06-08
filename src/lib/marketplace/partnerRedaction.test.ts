/**
 * partnerRedaction — customer anonymity invariant for partner-facing RFQ views.
 */
import { describe, it, expect } from 'vitest';
import {
  redactRfqForPartner,
  redactRfqsForPartner,
  findCustomerIdentityLeak,
  assertNoCustomerIdentityLeak,
  CUSTOMER_IDENTITY_FIELDS,
} from './partnerRedaction';

describe('redactRfqForPartner', () => {
  it('strips customer-identity fields (snake + camel)', () => {
    const rfq = {
      id: 'rfq1', shapeName: 'bracket', materialId: 'al6061', quantity: 100,
      customer_email: 'buyer@x.com', customerEmail: 'buyer@x.com',
      user_id: 'u-42', userId: 'u-42', customer_name: 'ACME', buyer_email: 'b@x.com',
    };
    const out = redactRfqForPartner(rfq);
    expect(out).toEqual({ id: 'rfq1', shapeName: 'bracket', materialId: 'al6061', quantity: 100 });
    expect(findCustomerIdentityLeak(out)).toEqual([]);
  });

  it('keeps legitimate non-identity fields, including *_name that are not the customer', () => {
    const rfq = { id: 'r', shape_name: 'gear', project_name: 'Project Zeta', note: 'tight tolerance' };
    const out = redactRfqForPartner(rfq);
    // shape_name / project_name / note must survive (only customer_* identity goes)
    expect(out).toEqual(rfq);
  });

  it('is a no-op on an already-clean object', () => {
    const clean = { id: 'r', shapeName: 'plate', quantity: 5 };
    expect(redactRfqForPartner(clean)).toEqual(clean);
  });

  it('redacts a list', () => {
    const list = [
      { id: 'a', shapeName: 'x', customer_email: 'a@x.com' },
      { id: 'b', shapeName: 'y', userId: 'u9' },
    ];
    const out = redactRfqsForPartner(list);
    expect(out).toEqual([{ id: 'a', shapeName: 'x' }, { id: 'b', shapeName: 'y' }]);
  });
});

describe('findCustomerIdentityLeak / assert', () => {
  it('reports only present, non-empty identity fields', () => {
    expect(findCustomerIdentityLeak({ id: 'r', customer_email: '', user_id: null })).toEqual([]);
    expect(findCustomerIdentityLeak({ id: 'r', customer_email: 'x@y.com' })).toEqual(['customer_email']);
  });

  it('assertNoCustomerIdentityLeak throws on a leak, passes when clean', () => {
    expect(() => assertNoCustomerIdentityLeak({ id: 'r', shapeName: 'x' })).not.toThrow();
    expect(() => assertNoCustomerIdentityLeak({ id: 'r', customer_email: 'x@y.com' }, 'dashboard'))
      .toThrow(/anonymity leak in dashboard: customer_email/);
  });

  it('every declared identity field is actually stripped by the redactor', () => {
    // guards the FIELD_SET ↔ CUSTOMER_IDENTITY_FIELDS coupling
    const withAll = Object.fromEntries(CUSTOMER_IDENTITY_FIELDS.map((f) => [f, 'secret']));
    const out = redactRfqForPartner({ id: 'keep', ...withAll });
    expect(out).toEqual({ id: 'keep' });
  });
});

describe('partner-dashboard RFQ shape invariant', () => {
  it('the dashboard pendingRfqs shape carries no customer identity', () => {
    // mirrors the object built in partner/dashboard/route.ts pendingRfqs map
    const dashboardRfq = {
      id: 'rfq1', shapeName: 'bracket', materialId: 'al6061', quantity: 100,
      volume_cm3: 12.5, dfmScore: 0.9, note: 'as drawn', assignedAt: null, createdAt: '2026-06-08',
    };
    expect(findCustomerIdentityLeak(dashboardRfq)).toEqual([]);
    expect(() => assertNoCustomerIdentityLeak(redactRfqForPartner(dashboardRfq))).not.toThrow();
  });
});
