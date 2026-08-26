import { formatDate, formatMoney, formatNumber } from '@/lib/i18n/format';
import {
  nexyfabAppLangPathFromEmailLocale,
  type NexyfabEmailContentLocale,
} from '@/lib/nexyfab-email';
import { escapeHtml } from '@/lib/sanitize';

export type QuoteExpiryEmailInput = {
  locale: NexyfabEmailContentLocale;
  recipientName: string;
  quoteId: string;
  rfqShapeName: string;
  quoteAmount: number;
  validUntil: string | number | Date;
  hoursLeft: number;
  rfqId: string;
  recipientType: 'customer' | 'partner';
  baseUrl?: string;
};

type Copy = {
  alert: string;
  greeting: (name: string) => string;
  customerTitle: (shape: string) => string;
  partnerTitle: (shape: string) => string;
  customerSubject: (hours: string, shape: string) => string;
  partnerSubject: (hours: string, shape: string) => string;
  customerBody: (id: string, hours: string) => string;
  partnerBody: (id: string, hours: string) => string;
  quoteId: string;
  part: string;
  amount: string;
  expiry: string;
  customerCta: string;
  partnerCta: string;
  footer: string;
};

const COPY: Record<NexyfabEmailContentLocale, Copy> = {
  ko: {
    alert: '견적 알림', greeting: name => `안녕하세요, ${name}님`,
    customerTitle: shape => `견적을 검토해 주세요 — ${shape}`, partnerTitle: shape => `견적 유효기간 만료 임박 — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] 견적 마감 ${hours}시간 전 — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] 제출 견적 만료 임박 — ${shape}`,
    customerBody: (id, hours) => `제조사로부터 받은 견적(<strong>${id}</strong>)이 <strong>${hours}시간 후</strong> 만료됩니다.<br>지금 바로 검토하고 수락하거나 새 견적을 요청하세요.`,
    partnerBody: (id, hours) => `귀하가 제출하신 견적(<strong>${id}</strong>)이 <strong>${hours}시간 후</strong> 만료됩니다.<br>고객이 아직 결정하지 않았습니다.`,
    quoteId: '견적 ID', part: '부품명', amount: '견적 금액', expiry: '만료 일시', customerCta: '견적 확인하기 →', partnerCta: '파트너 대시보드 →',
    footer: '이 메일은 NexyFab 자동 알림 시스템에서 발송되었습니다. 문의: nexyfab@nexysys.com',
  },
  en: {
    alert: 'Quote alert', greeting: name => `Hello, ${name}`,
    customerTitle: shape => `Please review your quote — ${shape}`, partnerTitle: shape => `Your submitted quote expires soon — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] Quote expires in ${hours} hours — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] Submitted quote expires soon — ${shape}`,
    customerBody: (id, hours) => `The manufacturer quote (<strong>${id}</strong>) expires in <strong>${hours} hours</strong>.<br>Review and accept it now, or request a new quote.`,
    partnerBody: (id, hours) => `Your submitted quote (<strong>${id}</strong>) expires in <strong>${hours} hours</strong>.<br>The customer has not made a decision yet.`,
    quoteId: 'Quote ID', part: 'Part', amount: 'Quote amount', expiry: 'Expires at', customerCta: 'Review quote →', partnerCta: 'Partner dashboard →',
    footer: 'This automated alert was sent by NexyFab. Contact: nexyfab@nexysys.com',
  },
  ja: {
    alert: '見積通知', greeting: name => `${name} 様`,
    customerTitle: shape => `見積をご確認ください — ${shape}`, partnerTitle: shape => `提出した見積の有効期限が近づいています — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] 見積期限まであと${hours}時間 — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] 提出した見積の期限が近づいています — ${shape}`,
    customerBody: (id, hours) => `メーカーからの見積（<strong>${id}</strong>）は<strong>${hours}時間後</strong>に期限切れとなります。<br>内容を確認して承認するか、新しい見積を依頼してください。`,
    partnerBody: (id, hours) => `提出した見積（<strong>${id}</strong>）は<strong>${hours}時間後</strong>に期限切れとなります。<br>お客様はまだ決定していません。`,
    quoteId: '見積ID', part: '部品名', amount: '見積金額', expiry: '有効期限', customerCta: '見積を確認 →', partnerCta: 'パートナーダッシュボード →',
    footer: 'このメールはNexyFabの自動通知システムから送信されました。お問い合わせ: nexyfab@nexysys.com',
  },
  cn: {
    alert: '报价提醒', greeting: name => `您好，${name}`,
    customerTitle: shape => `请查看您的报价 — ${shape}`, partnerTitle: shape => `已提交的报价即将到期 — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] 报价将在${hours}小时后到期 — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] 已提交的报价即将到期 — ${shape}`,
    customerBody: (id, hours) => `制造商报价（<strong>${id}</strong>）将在<strong>${hours}小时后</strong>到期。<br>请立即查看并接受，或申请新的报价。`,
    partnerBody: (id, hours) => `您提交的报价（<strong>${id}</strong>）将在<strong>${hours}小时后</strong>到期。<br>客户尚未做出决定。`,
    quoteId: '报价ID', part: '零件名称', amount: '报价金额', expiry: '到期时间', customerCta: '查看报价 →', partnerCta: '合作伙伴控制台 →',
    footer: '此邮件由NexyFab自动提醒系统发送。联系邮箱：nexyfab@nexysys.com',
  },
  es: {
    alert: 'Aviso de cotización', greeting: name => `Hola, ${name}`,
    customerTitle: shape => `Revise su cotización — ${shape}`, partnerTitle: shape => `La cotización enviada vence pronto — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] La cotización vence en ${hours} horas — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] La cotización enviada vence pronto — ${shape}`,
    customerBody: (id, hours) => `La cotización del fabricante (<strong>${id}</strong>) vence en <strong>${hours} horas</strong>.<br>Revísela y acéptela ahora, o solicite una nueva.`,
    partnerBody: (id, hours) => `La cotización que envió (<strong>${id}</strong>) vence en <strong>${hours} horas</strong>.<br>El cliente aún no ha tomado una decisión.`,
    quoteId: 'ID de cotización', part: 'Pieza', amount: 'Importe', expiry: 'Vencimiento', customerCta: 'Revisar cotización →', partnerCta: 'Panel de socios →',
    footer: 'Este aviso automático fue enviado por NexyFab. Contacto: nexyfab@nexysys.com',
  },
  ar: {
    alert: 'تنبيه عرض السعر', greeting: name => `مرحبًا، ${name}`,
    customerTitle: shape => `يرجى مراجعة عرض السعر — ${shape}`, partnerTitle: shape => `سينتهي عرض السعر المرسل قريبًا — ${shape}`,
    customerSubject: (hours, shape) => `[NexyFab] ينتهي عرض السعر خلال ${hours} ساعة — ${shape}`,
    partnerSubject: (_hours, shape) => `[NexyFab] سينتهي عرض السعر المرسل قريبًا — ${shape}`,
    customerBody: (id, hours) => `سينتهي عرض الشركة المصنّعة (<strong>${id}</strong>) خلال <strong>${hours} ساعة</strong>.<br>راجعه واقبله الآن، أو اطلب عرضًا جديدًا.`,
    partnerBody: (id, hours) => `سينتهي عرض السعر الذي أرسلته (<strong>${id}</strong>) خلال <strong>${hours} ساعة</strong>.<br>لم يتخذ العميل قرارًا بعد.`,
    quoteId: 'معرّف العرض', part: 'القطعة', amount: 'قيمة العرض', expiry: 'وقت الانتهاء', customerCta: 'مراجعة العرض ←', partnerCta: 'لوحة الشريك ←',
    footer: 'أرسل NexyFab هذا التنبيه تلقائيًا. للتواصل: nexyfab@nexysys.com',
  },
};

export function buildQuoteExpiryEmail(input: QuoteExpiryEmailInput): { subject: string; html: string } {
  const copy = COPY[input.locale];
  const isPartner = input.recipientType === 'partner';
  const safeName = escapeHtml(input.recipientName);
  const safeId = escapeHtml(input.quoteId);
  const safeShape = escapeHtml(input.rfqShapeName);
  const subjectShape = input.rfqShapeName.replace(/[\r\n]+/g, ' ').trim();
  const hours = formatNumber(input.hoursLeft, input.locale) ?? String(input.hoursLeft);
  const amount = formatMoney(input.quoteAmount, input.locale, 'KRW', { currencyDisplay: 'code' }) ?? `${input.quoteAmount} KRW`;
  const validUntil = formatDate(input.validUntil, input.locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) ?? String(input.validUntil);
  const title = isPartner ? copy.partnerTitle(safeShape) : copy.customerTitle(safeShape);
  const subject = isPartner ? copy.partnerSubject(hours, subjectShape) : copy.customerSubject(hours, subjectShape);
  const body = isPartner ? copy.partnerBody(safeId, hours) : copy.customerBody(safeId, hours);
  const root = (input.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'https://nexyfab.com').replace(/\/$/, '');
  const routeLang = nexyfabAppLangPathFromEmailLocale(input.locale);
  const href = isPartner
    ? `${root}/partner/dashboard?lang=${input.locale}`
    : `${root}/${routeLang}/nexyfab/rfq#${encodeURIComponent(input.rfqId)}`;
  const htmlLang = input.locale === 'cn' ? 'zh-CN' : input.locale;
  const dir = input.locale === 'ar' ? 'rtl' : 'ltr';

  return {
    subject,
    html: `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:system-ui,-apple-system,sans-serif;text-align:${dir === 'rtl' ? 'right' : 'left'}">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
    <table width="560" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <tr><td style="background:#1a56db;padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:800">NexyFab</span><span style="color:#93c5fd;font-size:13px;margin-inline-start:8px">${copy.alert}</span></td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280">${copy.greeting(safeName)}</p>
        <h2 style="margin:0 0 16px;font-size:18px;color:#111827">${title}</h2>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7">${body}</p>
        <table width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px">
          <tr><td style="padding:4px 8px;color:#6b7280">${copy.quoteId}</td><td style="padding:4px 8px;font-weight:600;color:#111827">${safeId}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">${copy.part}</td><td style="padding:4px 8px;font-weight:600;color:#111827">${safeShape}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">${copy.amount}</td><td style="padding:4px 8px;font-weight:700;color:#1a56db">${escapeHtml(amount)}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">${copy.expiry}</td><td style="padding:4px 8px;font-weight:600;color:#dc2626">${escapeHtml(validUntil)}</td></tr>
        </table>
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none">${isPartner ? copy.partnerCta : copy.customerCta}</a>
      </td></tr>
      <tr><td style="padding:14px 28px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af">${copy.footer}</td></tr>
    </table>
  </td></tr></table>
</body></html>`,
  };
}
