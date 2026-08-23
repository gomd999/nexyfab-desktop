import { describe, expect, it } from 'vitest';
import { invoiceAmount } from './invoice-pdf';
import {
  contractAdminSummaryEmail,
  contractSignedHtml,
  dripD1Html,
  dripD7Html,
  nexyfabEmailLocaleFromLanguageTag,
  partnerRfqNotificationHtml,
  quoteReceivedHtml,
  quoteReceivedInAppBody,
  quoteReceivedInAppTitle,
  rfqAssignedToFactoryHtml,
  rfqConfirmationHtml,
  rfqNotificationHtml,
  type RFQEmailData,
  welcomeHtml,
} from './nexyfab-email';

const rfq: RFQEmailData = {
  rfqId: 'rfq-123456789',
  shapeName: 'Bracket',
  materialId: 'AL6061',
  quantity: 1200,
  volume_cm3: 14.25,
  estimatedCost: 340,
};

describe('NexyFab server email locale handling', () => {
  it.each(['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const)('formats invoice currency for %s without changing the currency code', (locale) => {
    expect(invoiceAmount(1234.5, 'USD', locale)).toContain('USD');
  });

  it('normalizes aliases and language tags to all supported content locales', () => {
    expect(nexyfabEmailLocaleFromLanguageTag('ko-KR')).toBe('ko');
    expect(nexyfabEmailLocaleFromLanguageTag('kr')).toBe('ko');
    expect(nexyfabEmailLocaleFromLanguageTag('zh-CN,ja;q=0.8')).toBe('cn');
    expect(nexyfabEmailLocaleFromLanguageTag('es-MX')).toBe('es');
    expect(nexyfabEmailLocaleFromLanguageTag('ar-SA')).toBe('ar');
  });

  it.each(['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const)('emits a locale-aware contract email for %s', (lang) => {
    const html = contractSignedHtml({
      recipientName: 'Ada',
      recipientType: 'customer',
      lang,
      contractId: 'contract-1',
      projectName: 'Housing',
      factoryName: 'Factory A',
      contractAmount: 125000,
      currency: 'KRW',
    });
    expect(html).toContain(`<html lang="${lang === 'ko' ? 'ko' : lang}">`);
    expect(html).toContain('contract-1');
  });

  it.each(['en', 'ja', 'cn', 'es', 'ar'] as const)('localizes factory-facing RFQ detail labels for %s', (lang) => {
    const html = rfqAssignedToFactoryHtml({
      factoryName: 'Factory A',
      rfqId: rfq.rfqId,
      shapeName: rfq.shapeName,
      materialId: rfq.materialId,
      quantity: rfq.quantity,
      lang,
    });
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(lang === 'es' ? 'Cantidad' : lang === 'ar' ? '\u0627\u0644\u0643\u0645\u064a\u0629' : lang === 'ja' ? '\u6570\u91cf' : lang === 'cn' ? '\u6570\u91cf' : 'Quantity');
  });

  it('passes locale through RFQ confirmation and localizes its detail table', () => {
    const html = rfqConfirmationHtml(rfq, 'es');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('N\u00famero de RFQ');
    expect(html).toContain('Cantidad');
  });

  it('localizes partner notification output and preserves machine identifiers', () => {
    const html = partnerRfqNotificationHtml({
      rfqId: rfq.rfqId,
      shapeName: rfq.shapeName,
      materialId: rfq.materialId,
      quantity: rfq.quantity,
      lang: 'ar',
    });
    expect(html).toContain('<html lang="ar">');
    expect(html).toContain('RFQ-1234');
    expect(html).toContain('\u0627\u0644\u0643\u0645\u064a\u0629');
  });

  it('does not fall back to English copy for legacy Spanish/Arabic templates', () => {
    for (const locale of ['es', 'ar'] as const) {
      expect(rfqNotificationHtml(rfq, locale)).toContain(locale === 'es' ? 'Nueva solicitud' : '\u0637\u0644\u0628 \u062a\u0633\u0639\u064a\u0631');
      expect(welcomeHtml('Ada', locale)).toContain(locale === 'es' ? 'bienvenida' : '\u0645\u0631\u062d\u0628\u0627');
      expect(dripD1Html('Ada', locale)).toContain(locale === 'es' ? 'Tres funciones' : '\u062b\u0644\u0627\u062b');
      expect(dripD7Html('Ada', locale)).toContain(locale === 'es' ? 'Crea más' : '\u0627\u0646\u062c\u0632');
      expect(quoteReceivedHtml({ userName: 'Ada', lang: locale, rfqId: rfq.rfqId, shapeName: rfq.shapeName, factoryName: 'Factory A', estimatedAmount: 10 })).toContain(locale === 'es' ? 'cotización' : '\u0639\u0631\u0636');
      expect(quoteReceivedInAppTitle(locale, 'Housing')).not.toContain('Quote received');
      expect(quoteReceivedInAppBody(locale, 'Factory A')).not.toContain('submitted a quote');
    }
  });

  it('localizes the administrator contract summary while retaining KRW', () => {
    for (const locale of ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const) {
      const summary = contractAdminSummaryEmail(locale, { contractId: 'c-1', projectName: 'Housing', factoryName: 'Factory A', contractAmount: 1000, feeRate: 5, finalCharge: 50, isFirstContract: false });
      expect(summary.html).toContain('KRW');
      expect(summary.subject).toContain('Housing');
    }
  });
});
