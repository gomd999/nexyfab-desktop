'use client';

/**
 * DisputeButton — buyer-side trigger for escrow dispute (Q8/B fix).
 *
 * Renders an inconspicuous link by default ("문제가 있나요?") so it
 * doesn't dominate the order detail UI. Clicking opens an inline form
 * for reason + optional evidence URLs. Submission flips the latest
 * escrow row to 'disputed' via /api/nexyfab/orders/{id}/dispute.
 *
 * Why: without this, only admins could mark_disputed → buyers had no
 * UI path to raise a complaint, forcing every dispute through email/CS.
 */
import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';

const dict = {
  ko: {
    askProblem: '문제가 있나요? 분쟁 신청',
    formTitle: '🚨 분쟁 신청',
    reasonLabel: '문제 내용 *',
    reasonPlaceholder: '예: 도면과 다른 제품 수령, 표면 처리 누락, 수량 부족 등 (최대 500자)',
    evidenceLabel: '증거 URL (선택, 줄바꿈으로 구분, 최대 10개)',
    evidencePlaceholder: 'https://... (사진/문서 링크)',
    submit: '분쟁 신청',
    submitting: '신청 중…',
    cancel: '취소',
    success: '분쟁이 접수되었습니다. 운영팀이 1-2영업일 내 양측에 연락합니다.',
    afterStatus: '에스크로 정산이 일시 보류됩니다.',
  },
  en: {
    askProblem: 'Have an issue? Open a dispute',
    formTitle: '🚨 Open Dispute',
    reasonLabel: 'Issue description *',
    reasonPlaceholder: 'e.g., Product differs from drawing, missing finishing, quantity short (max 500 chars)',
    evidenceLabel: 'Evidence URLs (optional, newline-separated, max 10)',
    evidencePlaceholder: 'https://... (photos/docs)',
    submit: 'Submit dispute',
    submitting: 'Submitting…',
    cancel: 'Cancel',
    success: 'Dispute filed. Ops will contact both parties within 1-2 business days.',
    afterStatus: 'Escrow settlement is paused.',
  },
  ja: {
    askProblem: '問題がありますか？ 異議を申し立てる',
    formTitle: '🚨 異議申立',
    reasonLabel: '問題の内容 *',
    reasonPlaceholder: '例: 図面と異なる製品を受領、表面処理の欠落、数量不足など (最大 500 文字)',
    evidenceLabel: '証拠 URL (任意・改行区切り・最大 10 件)',
    evidencePlaceholder: 'https://... (写真/書類のリンク)',
    submit: '異議を申し立てる',
    submitting: '送信中…',
    cancel: 'キャンセル',
    success: '異議を受け付けました。運営チームが 1〜2 営業日以内に双方へご連絡します。',
    afterStatus: 'エスクロー精算は一時保留されます。',
  },
  zh: {
    askProblem: '遇到问题？发起争议',
    formTitle: '🚨 发起争议',
    reasonLabel: '问题说明 *',
    reasonPlaceholder: '例如：收到与图纸不符的产品、缺少表面处理、数量不足等（最多 500 字）',
    evidenceLabel: '证据链接（可选，换行分隔，最多 10 条）',
    evidencePlaceholder: 'https://...（照片/文件链接）',
    submit: '提交争议',
    submitting: '提交中…',
    cancel: '取消',
    success: '争议已受理。运营团队将在 1~2 个工作日内联系双方。',
    afterStatus: '托管结算将暂时冻结。',
  },
  es: {
    askProblem: '¿Tiene algún problema? Abrir una disputa',
    formTitle: '🚨 Abrir disputa',
    reasonLabel: 'Descripción del problema *',
    reasonPlaceholder: 'p. ej., producto distinto al plano, falta de acabado, cantidad incompleta (máx. 500 caracteres)',
    evidenceLabel: 'URL de pruebas (opcional, una por línea, máx. 10)',
    evidencePlaceholder: 'https://... (fotos o documentos)',
    submit: 'Enviar disputa',
    submitting: 'Enviando…',
    cancel: 'Cancelar',
    success: 'Se ha registrado la disputa. El equipo de operaciones contactará con ambas partes en 1-2 días hábiles.',
    afterStatus: 'La liquidación del depósito queda suspendida temporalmente.',
  },
  ar: {
    askProblem: 'هل تواجه مشكلة؟ افتح نزاعاً',
    formTitle: '🚨 فتح نزاع',
    reasonLabel: 'وصف المشكلة *',
    reasonPlaceholder: 'مثال: استلام منتج مخالف للرسم، غياب المعالجة السطحية، نقص في الكمية (بحد أقصى 500 حرف)',
    evidenceLabel: 'روابط الأدلة (اختياري، سطر لكل رابط، بحد أقصى 10)',
    evidencePlaceholder: 'https://... (صور أو مستندات)',
    submit: 'إرسال النزاع',
    submitting: 'جارٍ الإرسال…',
    cancel: 'إلغاء',
    success: 'تم تسجيل النزاع. سيتواصل فريق التشغيل مع الطرفين خلال يوم إلى يومي عمل.',
    afterStatus: 'ستُعلَّق تسوية الضمان مؤقتاً.',
  },
};

export default function DisputeButton({
  lang, orderId, onDisputed,
}: { /** ⚠ 260802: `'ko' | 'en'` 이라 부모가 다른 언어를 넘길 수조차 없었다. */ lang: string; orderId: string; onDisputed?: () => void }) {
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { setErr(t.reasonLabel); return; }
    setSubmitting(true); setErr(null);
    try {
      const evidence = evidenceText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10);
      const res = await fetch(`/api/nexyfab/orders/${encodeURIComponent(orderId)}/dispute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), evidence }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSuccess(true);
      onDisputed?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={successBoxStyle}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ {t.success}</div>
        <div style={{ fontSize: 11, opacity: 0.85 }}>{t.afterStatus}</div>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={triggerStyle}>
        ⚠️ {t.askProblem}
      </button>
    );
  }

  return (
    <div style={formContainerStyle}>
      <div style={{ fontWeight: 700, marginBottom: 10, color: '#f85149' }}>{t.formTitle}</div>
      <label style={labelStyle}>{t.reasonLabel}
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value.slice(0, 500))}
          placeholder={t.reasonPlaceholder}
          rows={4}
          style={textareaStyle}
        />
      </label>
      <label style={labelStyle}>{t.evidenceLabel}
        <textarea
          value={evidenceText}
          onChange={e => setEvidenceText(e.target.value)}
          placeholder={t.evidencePlaceholder}
          rows={3}
          style={textareaStyle}
        />
      </label>
      {err && <div style={errStyle}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={() => { setOpen(false); setReason(''); setEvidenceText(''); setErr(null); }} style={cancelBtnStyle}>
          {t.cancel}
        </button>
        <button onClick={submit} disabled={submitting || !reason.trim()} style={submitBtnStyle}>
          {submitting ? t.submitting : t.submit}
        </button>
      </div>
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  marginTop: 16, padding: '8px 14px', fontSize: 12, color: '#f85149',
  background: 'transparent', border: '1px solid #f8514940', borderRadius: 6,
  cursor: 'pointer', fontWeight: 600,
};
const formContainerStyle: React.CSSProperties = {
  marginTop: 16, padding: 14,
  background: '#1c1110', border: '1px solid #f8514940', borderRadius: 8,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#c9d1d9', marginBottom: 8,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px', fontSize: 12,
  background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
  color: '#e6edf3', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  boxSizing: 'border-box',
};
const errStyle: React.CSSProperties = {
  padding: 8, fontSize: 11, color: '#f85149',
  background: '#1c1110', border: '1px solid #f8514940', borderRadius: 6,
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  background: 'transparent', color: '#8b949e',
  border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer',
};
const submitBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 700,
  background: '#f85149', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
const successBoxStyle: React.CSSProperties = {
  marginTop: 16, padding: 12,
  background: '#0e2615', border: '1px solid #3fb95040', borderRadius: 8,
  color: '#3fb950', fontSize: 12, lineHeight: 1.5,
};
