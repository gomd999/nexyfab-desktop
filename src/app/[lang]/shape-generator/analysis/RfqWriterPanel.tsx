'use client';

/**
 * RfqWriterPanel.tsx — AI RFQ Writer (Phase 7-1).
 *
 * Generates a tailored RFQ email (subject + body in EN/KO) plus a checklist of
 * questions and attachments, given the current design context and a target
 * supplier. Includes a tone selector + copy buttons.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { writeRfq, type RfqDraft, type RfqSupplierBrief } from './rfqWriter';
import QuickCostPreview from './QuickCostPreview';
import type { ProcessType } from '../estimation/CostEstimator';

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  teal: '#39c5bb',
  gold: '#d29922',
  green: '#3fb950',
  red: '#f85149',
  text: '#c9d1d9',
  dim: '#8b949e',
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: 'AI RFQ 작성기',
    pcsSuffix: '개',
    toneFormal: '격식',
    toneConcise: '간결',
    toneCollaborative: '협력적',
    drafting: '생성 중…',
    regenerate: '재생성',
    draftingFull: 'RFQ 초안 생성 중…',
    subject: '제목',
    body: '본문',
    mustAsk: '꼭 물어볼 것',
    attachmentsChecklist: '첨부 체크리스트',
    proRequired: 'Pro 플랜이 필요합니다',
    copiedClipboard: '클립보드에 복사됨',
    copyFailed: '복사 실패',
    sendSuccess: '전송 완료',
    sendFailed: '전송 실패',
    copy: '복사',
    sending: '전송 중…',
    sendRfq: 'RFQ 전송',
  },
  en: {
    title: 'AI RFQ Writer',
    pcsSuffix: ' pcs',
    toneFormal: 'Formal',
    toneConcise: 'Concise',
    toneCollaborative: 'Collaborative',
    drafting: 'Drafting…',
    regenerate: 'Regenerate',
    draftingFull: 'Drafting your RFQ…',
    subject: 'Subject',
    body: 'Body',
    mustAsk: 'Must-ask questions',
    attachmentsChecklist: 'Attachment checklist',
    proRequired: 'Pro plan required',
    copiedClipboard: 'Copied to clipboard',
    copyFailed: 'Copy failed',
    sendSuccess: 'Sent',
    sendFailed: 'Send failed',
    copy: 'Copy',
    sending: 'Sending…',
    sendRfq: 'Send RFQ',
  },
  ja: {
    title: 'AI RFQ 作成ツール',
    pcsSuffix: '個',
    toneFormal: 'フォーマル',
    toneConcise: '簡潔',
    toneCollaborative: '協力的',
    drafting: '生成中…',
    regenerate: '再生成',
    draftingFull: 'RFQ ドラフト生成中…',
    subject: '件名',
    body: '本文',
    mustAsk: '必ず聞くこと',
    attachmentsChecklist: '添付チェックリスト',
    proRequired: 'Pro プランが必要です',
    copiedClipboard: 'クリップボードにコピーしました',
    copyFailed: 'コピーに失敗しました',
    sendSuccess: '送信完了',
    sendFailed: '送信失敗',
    copy: 'コピー',
    sending: '送信中…',
    sendRfq: 'RFQ 送信',
  },
  zh: {
    title: 'AI RFQ 写作工具',
    pcsSuffix: '件',
    toneFormal: '正式',
    toneConcise: '简洁',
    toneCollaborative: '协作',
    drafting: '生成中…',
    regenerate: '重新生成',
    draftingFull: '正在生成 RFQ 草稿…',
    subject: '主题',
    body: '正文',
    mustAsk: '必问问题',
    attachmentsChecklist: '附件清单',
    proRequired: '需要 Pro 套餐',
    copiedClipboard: '已复制到剪贴板',
    copyFailed: '复制失败',
    sendSuccess: '发送完成',
    sendFailed: '发送失败',
    copy: '复制',
    sending: '发送中…',
    sendRfq: '发送 RFQ',
  },
  es: {
    title: 'Redactor RFQ con IA',
    pcsSuffix: ' uds',
    toneFormal: 'Formal',
    toneConcise: 'Conciso',
    toneCollaborative: 'Colaborativo',
    drafting: 'Redactando…',
    regenerate: 'Regenerar',
    draftingFull: 'Redactando tu RFQ…',
    subject: 'Asunto',
    body: 'Cuerpo',
    mustAsk: 'Preguntas imprescindibles',
    attachmentsChecklist: 'Lista de adjuntos',
    proRequired: 'Se requiere plan Pro',
    copiedClipboard: 'Copiado al portapapeles',
    copyFailed: 'Error al copiar',
    sendSuccess: 'Enviado',
    sendFailed: 'Error al enviar',
    copy: 'Copiar',
    sending: 'Enviando…',
    sendRfq: 'Enviar RFQ',
  },
  ar: {
    title: 'كاتب RFQ بالذكاء الاصطناعي',
    pcsSuffix: ' قطعة',
    toneFormal: 'رسمي',
    toneConcise: 'موجز',
    toneCollaborative: 'تعاوني',
    drafting: '...جاري الصياغة',
    regenerate: 'إعادة التوليد',
    draftingFull: '...جاري صياغة طلب عرض الأسعار',
    subject: 'الموضوع',
    body: 'المحتوى',
    mustAsk: 'أسئلة يجب طرحها',
    attachmentsChecklist: 'قائمة المرفقات',
    proRequired: 'مطلوب خطة Pro',
    copiedClipboard: 'تم النسخ إلى الحافظة',
    copyFailed: 'فشل النسخ',
    sendSuccess: 'تم الإرسال',
    sendFailed: 'فشل الإرسال',
    copy: 'نسخ',
    sending: '...جاري الإرسال',
    sendRfq: 'إرسال RFQ',
  },
};

interface RfqWriterPanelProps {
  lang: string;
  supplier: RfqSupplierBrief;
  partName?: string;
  material: string;
  process: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  certificationsRequired?: string[];
  projectId?: string;
  onClose: () => void;
  onRequirePro?: () => void;
  /** Wired to /api/nexyfab/orders for one-click sending of the draft. */
  onSendDraft?: (subject: string, bodyText: string) => Promise<{ ok: boolean; message?: string }>;
}

export default function RfqWriterPanel({
  lang, supplier, partName, material, process, quantity, volume_cm3, bbox,
  certificationsRequired, projectId, onClose, onRequirePro, onSendDraft,
}: RfqWriterPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedLang = langMap[seg] ?? 'en';
  const t = dict[resolvedLang];
  const isKo = resolvedLang === 'ko';

  const [tone, setTone] = useState<'formal' | 'concise' | 'collaborative'>('formal');
  const [draft, setDraft] = useState<RfqDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [showAsKo, setShowAsKo] = useState<boolean>(isKo);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await writeRfq({
        supplier, partName, material, process, quantity,
        volume_cm3, bbox, certificationsRequired, tone,
        lang, projectId,
      });
      setDraft(d);
      setSent(null);
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        onRequirePro?.();
        setError(t.proRequired);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [supplier, partName, material, process, quantity, volume_cm3, bbox, certificationsRequired, tone, lang, projectId, onRequirePro, t.proRequired]);

  useEffect(() => {
    if (draft === null && !loading && !error) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = useCallback(async () => {
    if (!draft) return;
    const subject = showAsKo ? draft.subjectKo : draft.subject;
    const body = showAsKo ? draft.bodyKo : draft.body;
    const text = `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setSent(t.copiedClipboard);
      window.setTimeout(() => setSent(null), 2500);
    } catch {
      setError(t.copyFailed);
    }
  }, [draft, showAsKo, t.copiedClipboard, t.copyFailed]);

  const handleSend = useCallback(async () => {
    if (!draft || !onSendDraft) return;
    setSending(true);
    try {
      const subject = showAsKo ? draft.subjectKo : draft.subject;
      const body = showAsKo ? draft.bodyKo : draft.body;
      const res = await onSendDraft(subject, body);
      setSent(res.message ?? (res.ok ? t.sendSuccess : t.sendFailed));
    } catch (e) {
      setSent(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [draft, onSendDraft, showAsKo, t.sendSuccess, t.sendFailed]);

  const toneLabel = (opt: 'formal' | 'concise' | 'collaborative'): string => {
    if (opt === 'formal') return t.toneFormal;
    if (opt === 'concise') return t.toneConcise;
    return t.toneCollaborative;
  };

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 950,
      width: 460, maxHeight: 'calc(100vh - 80px)',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.gold}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✉️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {t.title}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {(supplier.nameKo ?? supplier.name ?? 'Supplier')} · {material} · {quantity}{t.pcsSuffix}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['formal', 'concise', 'collaborative'] as const).map(opt => (
            <button key={opt} onClick={() => setTone(opt)} style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: `1px solid ${tone === opt ? C.gold : C.border}`,
              background: tone === opt ? `${C.gold}22` : 'transparent',
              color: tone === opt ? C.gold : C.dim,
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>
              {toneLabel(opt)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowAsKo(false)} style={{
            flex: 1, padding: '4px 0', borderRadius: 4,
            border: `1px solid ${!showAsKo ? C.accent : C.border}`,
            background: !showAsKo ? `${C.accent}22` : 'transparent',
            color: !showAsKo ? C.accent : C.dim,
            fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }}>EN</button>
          <button onClick={() => setShowAsKo(true)} style={{
            flex: 1, padding: '4px 0', borderRadius: 4,
            border: `1px solid ${showAsKo ? C.accent : C.border}`,
            background: showAsKo ? `${C.accent}22` : 'transparent',
            color: showAsKo ? C.accent : C.dim,
            fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }}>KO</button>
          <button onClick={run} disabled={loading} style={{
            flex: 2, padding: '4px 0', borderRadius: 4, border: 'none',
            background: loading ? C.border : `linear-gradient(135deg, ${C.gold}, ${C.accent})`,
            color: '#fff', fontSize: 11, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
          }}>
            {loading ? t.drafting : `✨ ${t.regenerate}`}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 11, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        {!error && !draft && loading && (
          <div style={{ color: C.dim, fontSize: 12, textAlign: 'center', padding: 20 }}>
            {t.draftingFull}
          </div>
        )}

        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>
                {t.subject}
              </div>
              <div style={{
                padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card,
                color: C.text, fontSize: 12, fontWeight: 700,
              }}>
                {showAsKo ? draft.subjectKo : draft.subject}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>
                {t.body}
              </div>
              <textarea
                readOnly
                value={showAsKo ? draft.bodyKo : draft.body}
                style={{
                  width: '100%', minHeight: 220, resize: 'vertical',
                  padding: '10px 12px', borderRadius: 6,
                  border: `1px solid ${C.border}`, background: C.card,
                  color: C.text, fontSize: 12, lineHeight: 1.5,
                  fontFamily: 'inherit', whiteSpace: 'pre-wrap',
                }}
              />
            </div>

            {draft.asks.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, marginBottom: 4 }}>
                  ❓ {t.mustAsk}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: C.text, fontSize: 11, lineHeight: 1.6 }}>
                  {(showAsKo ? draft.asksKo : draft.asks).map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {draft.attachmentsChecklist.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, marginBottom: 4 }}>
                  📎 {t.attachmentsChecklist}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: C.text, fontSize: 11, lineHeight: 1.6 }}>
                  {(showAsKo ? draft.attachmentsChecklistKo : draft.attachmentsChecklist).map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {sent && (
              <div style={{
                padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${C.green}44`, background: `${C.green}11`,
                color: C.green, fontSize: 11, fontWeight: 700, textAlign: 'center',
              }}>
                ✓ {sent}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-send instant cost preview — shows ±30% ballpark before user clicks Send */}
      <div style={{ padding: '8px 12px 0 12px' }}>
        <QuickCostPreview
          lang={lang}
          materialId={material}
          quantity={quantity}
          volume_cm3={volume_cm3}
          bbox={bbox}
          preferProcess={(['cnc', 'fdm', 'sla', 'sls', 'injection', 'sheetmetal_laser'] as ProcessType[]).includes(process as ProcessType) ? (process as ProcessType) : undefined}
          currency={isKo ? 'KRW' : 'USD'}
        />
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 12px', borderTop: `1px solid ${C.border}`,
        display: 'flex', gap: 6,
      }}>
        <button onClick={handleCopy} disabled={!draft} style={{
          flex: 1, padding: '8px 0', borderRadius: 6,
          border: `1px solid ${C.accent}`, background: 'transparent',
          color: C.accent, fontSize: 12, fontWeight: 800,
          cursor: draft ? 'pointer' : 'not-allowed', opacity: draft ? 1 : 0.5,
        }}>
          📋 {t.copy}
        </button>
        {onSendDraft && (
          <button onClick={handleSend} disabled={!draft || sending} style={{
            flex: 2, padding: '8px 0', borderRadius: 6, border: 'none',
            background: !draft || sending ? C.border : `linear-gradient(135deg, ${C.gold}, ${C.accent})`,
            color: '#fff', fontSize: 12, fontWeight: 800,
            cursor: !draft || sending ? 'wait' : 'pointer',
          }}>
            {sending ? t.sending : `🚀 ${t.sendRfq}`}
          </button>
        )}
      </div>
    </div>
  );
}
