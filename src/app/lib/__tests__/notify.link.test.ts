import { describe, it, expect } from 'vitest';
import { notificationLinkFor } from '../notify';

describe('notificationLinkFor', () => {
  it('routes RFQ meta by recipient role', () => {
    expect(notificationLinkFor('admin', { rfqId: 'rfq-1' })).toBe('/admin/rfq');
    expect(notificationLinkFor('partner:a@b.com', { rfqId: 'rfq-1' })).toBe('/partner/quotes');
    expect(notificationLinkFor('user-uuid-123', { rfqId: 'rfq-1' })).toBe('/ko/nexyfab/rfq');
  });

  it('routes quote ids to admin quote detail', () => {
    expect(notificationLinkFor('admin', { quoteId: 'q-99' })).toBe('/admin/quotes/q-99');
    expect(notificationLinkFor('partner:x@y.com', { quoteId: 'q-99' })).toBe('/partner/quotes');
  });

  it('respects href override', () => {
    expect(notificationLinkFor('admin', { href: '/custom', rfqId: 'x' })).toBe('/custom');
    expect(notificationLinkFor('admin', { href: '', rfqId: 'x' })).toBe(null);
  });
});
