import { describe, expect, it } from 'vitest';
import { buildQuoteExpiryEmail } from './quoteExpiryEmail';
import type { NexyfabEmailContentLocale } from '@/lib/nexyfab-email';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u;
const LOCALES: NexyfabEmailContentLocale[] = ['ko', 'en', 'ja', 'cn', 'es', 'ar'];

describe('buildQuoteExpiryEmail', () => {
  it.each(LOCALES)('builds a localized customer reminder for %s', locale => {
    const email = buildQuoteExpiryEmail({
      locale,
      recipientName: 'Alex',
      quoteId: 'quote-1',
      rfqShapeName: 'Bracket',
      quoteAmount: 125000,
      validUntil: '2026-08-27T03:00:00.000Z',
      hoursLeft: 12,
      rfqId: 'rfq-1',
      recipientType: 'customer',
      baseUrl: 'https://nexyfab.example',
    });

    const route = locale === 'ko' ? 'kr' : locale;
    expect(email.html).toContain(`https://nexyfab.example/${route}/nexyfab/rfq#rfq-1`);
    expect(email.html).toContain('KRW');
    if (locale !== 'ko') expect(`${email.subject} ${email.html}`).not.toMatch(HANGUL);
  });

  it('sets Arabic direction and keeps the partner locale in the dashboard link', () => {
    const email = buildQuoteExpiryEmail({
      locale: 'ar', recipientName: 'Alex', quoteId: 'q', rfqShapeName: 'Part',
      quoteAmount: 10, validUntil: '2026-08-27T03:00:00.000Z', hoursLeft: 2,
      rfqId: 'r', recipientType: 'partner', baseUrl: 'https://nexyfab.example/',
    });
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('/partner/dashboard?lang=ar');
  });
});
