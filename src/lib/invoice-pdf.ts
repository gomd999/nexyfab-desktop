// Invoice PDF generation + email attachment on payment success.
// Mirrors the quote-PDF pattern but driven by nf_aw_invoices schema.
// Embeds the NanumGothic font for proper Korean rendering.

import { getDbAdapter } from './db-adapter';
import { nexyfabEmailLocaleFromLanguageTag, type NexyfabEmailContentLocale } from './nexyfab-email';

export interface InvoicePdfInput {
  invoiceId: string;
  /** Override locale; defaults to user.language. */
  locale?: NexyfabEmailContentLocale;
}

export interface InvoicePdfResult {
  pdfBase64: string;
  filename: string;
}

const INVOICE_INTL_LOCALE: Record<NexyfabEmailContentLocale, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

const INVOICE_COPY: Record<NexyfabEmailContentLocale, Record<string, string>> = {
  ko: { invoice: '\uC778\uBCF4\uC774\uC2A4', billTo: '\uCCAD\uAD6C \uB300\uC0C1', issued: '\uBC1C\uD589\uC77C', paid: '\uACB0\uC81C\uC77C', description: '\uB0B4\uC5ED', amount: '\uAE08\uC561', total: '\uD569\uACC4', vat: '* \uBD80\uAC00\uAC00\uCE58\uC138 10% \uD3EC\uD568', footer: '\uBB38\uC758: nexyfab@nexysys.com · \uC790\uB3D9 \uC0DD\uC131 \uC778\uBCF4\uC774\uC2A4', subscription: '\uAD6C\uB3C5 · 1\uAC1C\uC6D4', paymentReceived: '\uACB0\uC81C \uC644\uB8CC', processed: '\uACB0\uC81C\uAC00 \uC815\uC0C1 \uCC98\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', attached: '\uC778\uBCF4\uC774\uC2A4 PDF\uAC00 \uCCA8\uBD80\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.' },
  en: { invoice: 'INVOICE', billTo: 'BILL TO', issued: 'ISSUED', paid: 'PAID', description: 'DESCRIPTION', amount: 'AMOUNT', total: 'TOTAL', vat: '* VAT 10% included', footer: 'Questions? nexyfab@nexysys.com · This invoice was auto-generated.', subscription: 'Subscription · 1 month', paymentReceived: 'Payment received', processed: 'Your payment was processed successfully.', attached: 'The invoice PDF is attached to this email.' },
  ja: { invoice: '\u8ACB\u6C42\u66F8', billTo: '\u8ACB\u6C42\u5148', issued: '\u767A\u884C\u65E5', paid: '\u652F\u6255\u65E5', description: '\u5185\u8A33', amount: '\u91D1\u984D', total: '\u5408\u8A08', vat: '* \u6D88\u8CBB\u7A0E10%\u8FBC\u307F', footer: '\u304A\u554F\u3044\u5408\u308F\u305B: nexyfab@nexysys.com', subscription: '\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3 · 1\u30F6\u6708', paymentReceived: '\u304A\u652F\u6255\u3044\u5B8C\u4E86', processed: '\u304A\u652F\u6255\u3044\u304C\u6B63\u5E38\u306B\u51E6\u7406\u3055\u308C\u307E\u3057\u305F\u3002', attached: '\u8ACB\u6C42\u66F8PDF\u3092\u6DFB\u4ED8\u3057\u307E\u3057\u305F\u3002' },
  cn: { invoice: '\u53D1\u7968', billTo: '\u6536\u4EF6\u65B9', issued: '\u5F00\u7968\u65E5\u671F', paid: '\u4ED8\u6B3E\u65E5\u671F', description: '\u8BF4\u660E', amount: '\u91D1\u989D', total: '\u5408\u8BA1', vat: '* \u5DF2\u5305\u542B10%\u589E\u503C\u7A0E', footer: '\u54A8\u8BE2: nexyfab@nexysys.com', subscription: '\u8BA2\u9605 · 1\u4E2A\u6708', paymentReceived: '\u4ED8\u6B3E\u5DF2\u6536\u5230', processed: '\u60A8\u7684\u4ED8\u6B3E\u5DF2\u6210\u529F\u5904\u7406\u3002', attached: '\u53D1\u7968PDF\u5DF2\u9644\u5728\u6B64\u90AE\u4EF6\u4E2D\u3002' },
  es: { invoice: 'FACTURA', billTo: 'FACTURAR A', issued: 'EMITIDA', paid: 'PAGADA', description: 'DESCRIPCIÓN', amount: 'IMPORTE', total: 'TOTAL', vat: '* IVA del 10% incluido', footer: 'Consultas: nexyfab@nexysys.com', subscription: 'Suscripción · 1 mes', paymentReceived: 'Pago recibido', processed: 'Tu pago se procesó correctamente.', attached: 'La factura PDF está adjunta a este correo.' },
  ar: { invoice: '\u0641\u0627\u062A\u0648\u0631\u0629', billTo: '\u0641\u0627\u062A\u0648\u0631\u0629 \u0625\u0644\u0649', issued: '\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0635\u062F\u0627\u0631', paid: '\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062F\u0641\u0639', description: '\u0627\u0644\u0648\u0635\u0641', amount: '\u0627\u0644\u0645\u0628\u0644\u063A', total: '\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A', vat: '* \u0634\u0627\u0645\u0644 \u0636\u0631\u064A\u0628\u0629 10%', footer: '\u0627\u0644\u0627\u0633\u062A\u0641\u0633\u0627\u0631: nexyfab@nexysys.com', subscription: '\u0627\u0634\u062A\u0631\u0627\u0643 · \u0634\u0647\u0631', paymentReceived: '\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062F\u0641\u0639', processed: '\u062A\u0645\u062A \u0645\u0639\u0627\u0644\u062C\u0629 \u062F\u0641\u0639\u062A\u0643.', attached: '\u0645\u0631\u0641\u0642 PDF \u0644\u0644\u0641\u0627\u062A\u0648\u0631\u0629.' },
};

const INVOICE_ADDRESS: Record<NexyfabEmailContentLocale, string> = {
  ko: '대한민국 서울 · nexyfab@nexysys.com',
  en: 'Seoul, Korea · nexyfab@nexysys.com',
  ja: '韓国・ソウル · nexyfab@nexysys.com',
  cn: '韩国首尔 · nexyfab@nexysys.com',
  es: 'Seúl, Corea · nexyfab@nexysys.com',
  ar: 'سيول، كوريا · nexyfab@nexysys.com',
};

export function invoiceAmount(amount: number, currency: string, locale: NexyfabEmailContentLocale): string {
  try { return `${new Intl.NumberFormat(INVOICE_INTL_LOCALE[locale], { style: 'currency', currency }).format(amount)} ${currency}`; }
  catch { return `${currency} ${amount.toLocaleString(INVOICE_INTL_LOCALE[locale])}`; }
}

/**
 * Render an invoice as a PDF buffer. Returns base64 so the caller can
 * attach it to an email (nodemailer / Resend / SES) without writing to disk.
 */
export async function renderInvoicePdf(input: InvoicePdfInput): Promise<InvoicePdfResult | null> {
  const db = getDbAdapter();
  const inv = await db.queryOne<{
    id: string;
    user_id: string;
    org_id: string | null;
    product: string;
    display_amount: number;
    currency: string;
    status: string;
    created_at: number;
    paid_at: number | null;
    description: string | null;
  }>(
    `SELECT id, user_id, org_id, product, display_amount, currency, status,
            created_at, paid_at, description
       FROM nf_aw_invoices WHERE id = ?`,
    input.invoiceId,
  );
  if (!inv) return null;

  const user = await db.queryOne<{ email: string; name: string; language: string | null; country: string | null }>(
    'SELECT email, name, language, country FROM nf_users WHERE id = ?',
    inv.user_id,
  );
  const locale = input.locale ?? nexyfabEmailLocaleFromLanguageTag(user?.language);
  const copy = INVOICE_COPY[locale];
  const intlLocale = INVOICE_INTL_LOCALE[locale];

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header
  doc.setFontSize(22);
  doc.setTextColor(60, 96, 224);
  doc.text('NexyFab', 20, 25);
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text('Nexysys Lab Co., Ltd.', 20, 32);
  doc.text(INVOICE_ADDRESS[locale], 20, 38);

  // INVOICE title + ID
  doc.setFontSize(28);
  doc.setTextColor(40);
  doc.text(copy.invoice, 130, 28);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`#${inv.id}`, 130, 36);

  // Bill-to
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(copy.billTo, 20, 55);
  doc.setFontSize(11);
  doc.setTextColor(40);
  doc.text(user?.name ?? '—', 20, 62);
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(user?.email ?? '', 20, 68);

  // Dates
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(copy.issued, 130, 55);
  doc.setFontSize(11);
  doc.setTextColor(40);
  doc.text(new Date(inv.created_at).toLocaleDateString(intlLocale, { year: 'numeric', month: 'short', day: 'numeric' }), 130, 62);
  if (inv.paid_at) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(copy.paid, 130, 70);
    doc.setFontSize(11);
    doc.setTextColor(40);
    doc.text(new Date(inv.paid_at).toLocaleDateString(intlLocale, { year: 'numeric', month: 'short', day: 'numeric' }), 130, 77);
  }

  // Status pill
  const statusColor = inv.status === 'paid' ? [16, 185, 129]
    : inv.status === 'past_due' ? [239, 68, 68]
    : [148, 163, 184];
  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.roundedRect(170, 18, 24, 8, 2, 2, 'F');
  doc.setTextColor(255);
  doc.setFontSize(9);
  doc.text(inv.status.toUpperCase(), 172, 24);

  // Line items table
  doc.setDrawColor(220);
  doc.line(20, 90, 190, 90);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(copy.description, 20, 96);
  doc.text(copy.amount, 170, 96, { align: 'right' });
  doc.line(20, 100, 190, 100);

  doc.setFontSize(11);
  doc.setTextColor(40);
  const itemLabel = inv.description ?? `${inv.product.toUpperCase()} ${copy.subscription}`;
  doc.text(itemLabel, 20, 110);
  const amount = invoiceAmount(inv.display_amount, inv.currency, locale);
  doc.text(amount, 170, 110, { align: 'right' });

  // Total
  doc.line(20, 120, 190, 120);
  doc.setFontSize(13);
  doc.setTextColor(40);
  doc.setFont('helvetica', 'bold');
  doc.text(copy.total, 20, 132);
  doc.text(amount, 170, 132, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  // VAT note (KRW only adds Korean VAT — for global currencies we leave
  // the gateway's tax_summary to handle it).
  if (inv.currency === 'KRW') {
    const vatLabel = copy.vat;
    doc.setFontSize(9);
    doc.setTextColor(140);
    doc.text(vatLabel, 20, 140);
  }

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text(
    copy.footer,
    20, 280,
  );

  // Output as base64.
  const dataUrl = doc.output('datauristring');
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  return {
    pdfBase64: base64,
    filename: `nexyfab-invoice-${inv.id}.pdf`,
  };
}

/**
 * Email the invoice PDF to the customer on payment success. Called from
 * the payment-success webhook handler. Fire-and-forget — failure here
 * never blocks the webhook ACK to the gateway.
 */
export async function emailInvoicePdf(invoiceId: string): Promise<void> {
  const result = await renderInvoicePdf({ invoiceId });
  if (!result) return;
  const db = getDbAdapter();
  const inv = await db.queryOne<{ user_id: string; product: string; display_amount: number; currency: string }>(
    'SELECT user_id, product, display_amount, currency FROM nf_aw_invoices WHERE id = ?',
    invoiceId,
  );
  if (!inv) return;
  const user = await db.queryOne<{ email: string; name: string; language: string | null }>(
    'SELECT email, name, language FROM nf_users WHERE id = ?',
    inv.user_id,
  );
  if (!user?.email) return;

  const locale = nexyfabEmailLocaleFromLanguageTag(user.language);
  const copy = INVOICE_COPY[locale];
  const amount = invoiceAmount(inv.display_amount, inv.currency, locale);
  const subject = `[NexyFab] ${copy.paymentReceived} · ${amount}`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;">
          <span style="font-size:22px;font-weight:700;color:#60a5fa;">NexyFab</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:#10b981;font-size:20px;margin:0 0 12px;">✓ ${copy.paymentReceived}</h1>
          <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 16px;">
            ${user.name}, ${copy.processed} <strong>${amount}</strong>
          </p>
          <p style="color:#94a3b8;font-size:12px;margin:0 0 12px;">
            ${copy.attached}
          </p>
          <p style="color:#475569;font-size:11px;margin:24px 0 0;">
            ${copy.invoice}: <span style="font-family:monospace;color:#64748b;">${invoiceId}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const { sendEmail } = await import('@/lib/nexyfab-email');
    await sendEmail(user.email, subject, html, {
      attachments: [{
        filename: result.filename,
        content: result.pdfBase64,
        encoding: 'base64',
        contentType: 'application/pdf',
      }],
    });
  } catch (err) {
    console.error('[invoice-pdf] email send failed:', err);
  }
}
