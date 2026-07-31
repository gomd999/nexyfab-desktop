'use client';

// M4 — Order milestone feed (chronological partner updates).
//
// Buyer-side: read-only feed. Partner-side: composer + feed.
// Photos are URLs — partner uploads via existing CAD/file upload then
// pastes the URL (uploader integration is a follow-up).

import React, { useCallback, useEffect, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';

interface Milestone {
  id: string;
  orderId: string;
  step: string;
  note: string | null;
  attachments: string[];
  byPartnerEmail: string;
  createdAt: number;
}

const STEPS = ['production_start', 'qc', 'packing', 'shipped', 'note'] as const;
type Step = typeof STEPS[number];

const dict = {
  ko: {
    title: '📸 진행 상황',
    composer: '진행 상황 업로드 (파트너만)',
    step: '단계',
    notePh: '메모 (선택, 2000자)',
    attachPh: '사진/문서 URL (쉼표 구분)',
    post: '업로드',
    posting: '업로드 중',
    empty: '아직 업로드된 진행 상황이 없습니다.',
    refresh: '새로고침',
    requireOne: '메모 또는 첨부 중 하나는 필수',
    error: '오류',
    stepLabels: {
      production_start: '🏭 생산 시작',
      qc: '🔍 품질 검사',
      packing: '📦 포장',
      shipped: '🚚 출하',
      note: '📝 메모',
    },
  },
  en: {
    title: '📸 Progress',
    composer: 'Post update (partner only)',
    step: 'Step',
    notePh: 'Note (optional, 2000 chars)',
    attachPh: 'Photo/doc URLs (comma-separated)',
    post: 'Post',
    posting: 'Posting',
    empty: 'No milestones yet.',
    refresh: 'Refresh',
    requireOne: 'Note or at least one attachment required',
    error: 'Error',
    stepLabels: {
      production_start: '🏭 Production start',
      qc: '🔍 QC',
      packing: '📦 Packing',
      shipped: '🚚 Shipped',
      note: '📝 Note',
    },
  },
  ja: {
    title: '📸 進捗',
    composer: '進捗を投稿 (パートナーのみ)',
    step: '工程',
    notePh: 'メモ (任意・2000 文字)',
    attachPh: '写真/書類の URL (カンマ区切り)',
    post: '投稿',
    posting: '投稿中',
    empty: 'まだ投稿された進捗はありません。',
    refresh: '更新',
    requireOne: 'メモまたは添付のいずれかが必要です',
    error: 'エラー',
    stepLabels: {
      production_start: '🏭 生産開始',
      qc: '🔍 品質検査',
      packing: '📦 梱包',
      shipped: '🚚 出荷',
      note: '📝 メモ',
    },
  },
  zh: {
    title: '📸 进度',
    composer: '发布进度（仅合作伙伴）',
    step: '阶段',
    notePh: '备注（可选，2000 字）',
    attachPh: '照片/文件链接（逗号分隔）',
    post: '发布',
    posting: '发布中',
    empty: '暂无进度更新。',
    refresh: '刷新',
    requireOne: '备注与附件至少填写一项',
    error: '错误',
    stepLabels: {
      production_start: '🏭 开始生产',
      qc: '🔍 质量检验',
      packing: '📦 包装',
      shipped: '🚚 发货',
      note: '📝 备注',
    },
  },
  es: {
    title: '📸 Progreso',
    composer: 'Publicar avance (solo socios)',
    step: 'Etapa',
    notePh: 'Nota (opcional, 2000 caracteres)',
    attachPh: 'URL de fotos o documentos (separadas por comas)',
    post: 'Publicar',
    posting: 'Publicando',
    empty: 'Todavía no hay avances publicados.',
    refresh: 'Actualizar',
    requireOne: 'Se requiere una nota o un adjunto',
    error: 'Error',
    stepLabels: {
      production_start: '🏭 Inicio de producción',
      qc: '🔍 Control de calidad',
      packing: '📦 Embalaje',
      shipped: '🚚 Enviado',
      note: '📝 Nota',
    },
  },
  ar: {
    title: '📸 التقدّم',
    composer: 'نشر تحديث (للشركاء فقط)',
    step: 'المرحلة',
    notePh: 'ملاحظة (اختياري، 2000 حرف)',
    attachPh: 'روابط الصور أو المستندات (مفصولة بفواصل)',
    post: 'نشر',
    posting: 'جارٍ النشر',
    empty: 'لا توجد تحديثات منشورة بعد.',
    refresh: 'تحديث',
    requireOne: 'يلزم إدخال ملاحظة أو مرفق على الأقل',
    error: 'خطأ',
    stepLabels: {
      production_start: '🏭 بدء الإنتاج',
      qc: '🔍 فحص الجودة',
      packing: '📦 التغليف',
      shipped: '🚚 تم الشحن',
      note: '📝 ملاحظة',
    },
  },
};

export interface OrderMilestoneFeedProps {
  /** ⚠ 260802: `'ko' | 'en'` 이라 부모가 다른 언어를 넘길 수조차 없었다. */
  lang: string;
  orderId: string;
  /** True when the viewer is the assigned partner — shows the composer. */
  isPartner: boolean;
}

export default function OrderMilestoneFeed({ lang, orderId, isPartner }: OrderMilestoneFeedProps) {
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [step, setStep] = useState<Step>('production_start');
  const [note, setNote] = useState('');
  const [attach, setAttach] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchMilestones = useCallback(async () => {
    try {
      const res = await fetch(`/api/nexyfab/orders/${encodeURIComponent(orderId)}/milestones`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { milestones: Milestone[] };
      setMilestones(data.milestones);
      setLoaded(true);
    } catch { /* ignore */ }
  }, [orderId]);

  useEffect(() => { void fetchMilestones(); }, [fetchMilestones]);

  const post = useCallback(async () => {
    if (!isPartner || posting) return;
    const attachments = attach
      .split(',')
      .map(s => s.trim())
      .filter(s => /^https?:\/\//.test(s));
    if (!note.trim() && attachments.length === 0) {
      setError(t.requireOne);
      return;
    }
    setPosting(true); setError(null);
    try {
      const res = await fetch(`/api/nexyfab/orders/${encodeURIComponent(orderId)}/milestones`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, note: note.trim() || undefined, attachments }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { milestone: Milestone };
      setMilestones(prev => [...prev, data.milestone]);
      setNote(''); setAttach('');
    } catch (e) {
      setError((e as Error).message || t.error);
    } finally {
      setPosting(false);
    }
  }, [isPartner, posting, attach, note, step, orderId, t.requireOne, t.error]);

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={titleStyle}>{t.title}</span>
        <button onClick={() => void fetchMilestones()} style={refreshStyle}>{t.refresh}</button>
      </div>

      {!loaded && <div style={mutedStyle}>…</div>}
      {loaded && milestones.length === 0 && <div style={mutedStyle}>{t.empty}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {milestones.map(m => (
          <div key={m.id} style={milestoneStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={stepBadgeStyle}>{t.stepLabels[m.step as Step] ?? m.step}</span>
              <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{new Date(m.createdAt).toLocaleString()}</span>
            </div>
            {m.note && <div style={{ fontSize: 12, color: 'var(--nx-text)', lineHeight: 1.5, marginBottom: 6 }}>{m.note}</div>}
            {m.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {m.attachments.map((url, i) => {
                  const isImage = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
                  return isImage ? (
                     
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--nx-border)' }} />
                    </a>
                  ) : (
                    <a key={i} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#79c0ff', textDecoration: 'underline', wordBreak: 'break-all' }}>
                      📎 {url.split('/').pop()?.slice(0, 30) ?? 'file'}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {isPartner && (
        <div style={composerStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t.composer}
          </div>
          <select value={step} onChange={e => setStep(e.target.value as Step)} style={selectStyle}>
            {STEPS.map(s => <option key={s} value={s}>{t.stepLabels[s]}</option>)}
          </select>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 2000))}
            placeholder={t.notePh}
            rows={2}
            style={textareaStyle}
          />
          <input
            type="text"
            value={attach}
            onChange={e => setAttach(e.target.value)}
            placeholder={t.attachPh}
            style={inputStyle}
          />
          {error && <div style={errStyle}>{error}</div>}
          <button onClick={() => void post()} disabled={posting} style={postBtnStyle}>
            {posting ? t.posting : t.post}
          </button>
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10,
  padding: 12, color: 'var(--nx-text)', marginTop: 12,
};
const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--nx-text)' };
const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--nx-text-2)', padding: 12, textAlign: 'center' };
const milestoneStyle: React.CSSProperties = {
  padding: 10, background: 'var(--nx-panel)', borderRadius: 8, border: '1px solid var(--nx-panel-2)',
};
const stepBadgeStyle: React.CSSProperties = {
  padding: '2px 8px', fontSize: 10, fontWeight: 700,
  borderRadius: 10, background: '#1f6feb22', color: '#79c0ff',
};
const composerStyle: React.CSSProperties = {
  marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--nx-panel-2)',
  display: 'flex', flexDirection: 'column', gap: 6,
};
const selectStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12,
  background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
  borderRadius: 6, color: 'var(--nx-text)', outline: 'none',
};
const textareaStyle: React.CSSProperties = {
  padding: 8, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
  borderRadius: 6, color: 'var(--nx-text)', fontSize: 12, fontFamily: 'inherit',
  resize: 'vertical', outline: 'none',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11, fontFamily: 'monospace',
  background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
  borderRadius: 6, color: 'var(--nx-text)', outline: 'none',
};
const errStyle: React.CSSProperties = {
  fontSize: 11, color: '#ffa198', padding: '4px 8px',
  background: 'rgba(248,81,73,0.12)', borderRadius: 4,
};
const postBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 700,
  borderRadius: 6, border: 'none',
  background: '#1f6feb', color: '#fff',
  cursor: 'pointer', alignSelf: 'flex-end',
};
const refreshStyle: React.CSSProperties = {
  padding: '3px 10px', fontSize: 10,
  borderRadius: 4, border: '1px solid var(--nx-border)',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
};
