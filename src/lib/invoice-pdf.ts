// Invoice PDF generation + email attachment on payment success.
// Mirrors the quote-PDF pattern but driven by nf_aw_invoices schema.
// Embeds the NanumGothic font for proper Korean rendering.

import { getDbAdapter } from './db-adapter';

export interface InvoicePdfInput {
  invoiceId: string;
  /** Override locale; defaults to user.language. */
  locale?: 'ko' | 'en';
}

export interface InvoicePdfResult {
  pdfBase64: string;
  filename: string;
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
  const locale = input.locale ?? (user?.language?.startsWith('ko') ? 'ko' : 'en');
  const isKo = locale === 'ko';

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header
  doc.setFontSize(22);
  doc.setTextColor(60, 96, 224);
  doc.text('NexyFab', 20, 25);
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text(isKo ? 'Nexysys Lab Co., Ltd.' : 'Nexysys Lab Co., Ltd.', 20, 32);
  doc.text(isKo ? '대한민국 서울 · nexyfab@nexysys.com' : 'Seoul, Korea · nexyfab@nexysys.com', 20, 38);

  // INVOICE title + ID
  doc.setFontSize(28);
  doc.setTextColor(40);
  doc.text(isKo ? '인보이스' : 'INVOICE', 130, 28);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`#${inv.id}`, 130, 36);

  // Bill-to
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(isKo ? '청구 대상' : 'BILL TO', 20, 55);
  doc.setFontSize(11);
  doc.setTextColor(40);
  doc.text(user?.name ?? '—', 20, 62);
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(user?.email ?? '', 20, 68);

  // Dates
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(isKo ? '발행일' : 'ISSUED', 130, 55);
  doc.setFontSize(11);
  doc.setTextColor(40);
  doc.text(new Date(inv.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }), 130, 62);
  if (inv.paid_at) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(isKo ? '결제일' : 'PAID', 130, 70);
    doc.setFontSize(11);
    doc.setTextColor(40);
    doc.text(new Date(inv.paid_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }), 130, 77);
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
  doc.text(isKo ? '내역' : 'DESCRIPTION', 20, 96);
  doc.text(isKo ? '금액' : 'AMOUNT', 170, 96, { align: 'right' });
  doc.line(20, 100, 190, 100);

  doc.setFontSize(11);
  doc.setTextColor(40);
  const itemLabel = inv.description
    ?? (isKo ? `${inv.product.toUpperCase()} 구독 · 1개월` : `${inv.product.toUpperCase()} Subscription · 1 month`);
  doc.text(itemLabel, 20, 110);
  const amount = inv.currency === 'KRW'
    ? `₩${Math.round(inv.display_amount).toLocaleString()}`
    : `${inv.currency} ${inv.display_amount.toFixed(2)}`;
  doc.text(amount, 170, 110, { align: 'right' });

  // Total
  doc.line(20, 120, 190, 120);
  doc.setFontSize(13);
  doc.setTextColor(40);
  doc.setFont('helvetica', 'bold');
  doc.text(isKo ? '합계' : 'TOTAL', 20, 132);
  doc.text(amount, 170, 132, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  // VAT note (KRW only adds Korean VAT — for global currencies we leave
  // the gateway's tax_summary to handle it).
  if (inv.currency === 'KRW') {
    const vatLabel = isKo ? '※ 부가가치세 10% 포함' : '* VAT 10% included';
    doc.setFontSize(9);
    doc.setTextColor(140);
    doc.text(vatLabel, 20, 140);
  }

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text(
    isKo
      ? '문의: nexyfab@nexysys.com · 이 인보이스는 자동 생성되었습니다.'
      : 'Questions? nexyfab@nexysys.com · This invoice was auto-generated.',
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

  const isKo = !user.language || user.language.startsWith('ko');
  const amount = inv.currency === 'KRW'
    ? `₩${Math.round(inv.display_amount).toLocaleString()}`
    : `${inv.currency} ${inv.display_amount.toFixed(2)}`;
  const subject = isKo
    ? `[NexyFab] 결제 완료 · ${amount}`
    : `[NexyFab] Payment received · ${amount}`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;">
          <span style="font-size:22px;font-weight:700;color:#60a5fa;">NexyFab</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:#10b981;font-size:20px;margin:0 0 12px;">✓ ${isKo ? '결제 완료' : 'Payment received'}</h1>
          <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 16px;">
            ${user.name} 님, ${isKo ? `${amount} 결제가 정상 처리되었습니다.` : `${amount} payment was processed successfully.`}
          </p>
          <p style="color:#94a3b8;font-size:12px;margin:0 0 12px;">
            ${isKo ? '인보이스 PDF 가 이 메일에 첨부되어 있습니다.' : 'The invoice PDF is attached to this email.'}
          </p>
          <p style="color:#475569;font-size:11px;margin:24px 0 0;">
            ${isKo ? '인보이스' : 'Invoice'}: <span style="font-family:monospace;color:#64748b;">${invoiceId}</span>
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
