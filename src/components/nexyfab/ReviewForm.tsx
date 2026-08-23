'use client';

// B8 — Multi-dimensional review form.
//
// Per memory rule (no single composite score): collects each axis
// separately. Existing /api/reviews schema has rating + cat_deadline +
// cat_quality + cat_communication; response speed is derived
// automatically from quote-response timestamps so it isn't asked here.
//
// UX choices:
//   - 5-star tap targets (mobile-friendly)
//   - Optional axis-specific comments unlock when star ≤3 (encourage
//     specific feedback when something went wrong)
//   - Submit disabled until overall + all 3 axes are rated
//   - One-shot: after submit, form locks and shows "thanks"

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { loc } from '@/lib/i18n/loc';

const dict = {
  ko: {
    title: '리뷰 작성',
    subtitle: '각 항목을 별도로 평가해주세요. 단일 점수가 아닌 차원별 점수가 다른 구매자에게 보입니다.',
    overall: '종합 평가',
    deadline: '납기 준수',
    quality: '품질',
    communication: '소통',
    comment: '의견 (선택)',
    commentPlaceholder: '구체적인 경험을 적어주시면 다른 구매자에게 도움이 됩니다.',
    submit: '리뷰 등록',
    submitting: '등록 중...',
    success: '리뷰가 등록되었습니다. 감사합니다!',
    error: '등록에 실패했습니다. 다시 시도해주세요.',
    requireRating: '모든 항목을 평가해주세요',
    lowRatingHint: '아쉬운 점을 남겨주시면 제조사에게 전달됩니다.',
  },
  en: {
    title: 'Write a review',
    subtitle: 'Rate each axis separately — buyers see them as distinct dimensions, not a composite score.',
    overall: 'Overall',
    deadline: 'On-time delivery',
    quality: 'Quality',
    communication: 'Communication',
    comment: 'Comments (optional)',
    commentPlaceholder: 'Specific experience helps other buyers.',
    submit: 'Submit review',
    submitting: 'Submitting...',
    success: 'Review submitted. Thank you!',
    error: 'Submit failed. Please try again.',
    requireRating: 'Please rate every axis',
    lowRatingHint: 'Your feedback will be shared with the manufacturer.',
  },
  ja: {
    title: 'レビューを書く',
    subtitle: '各項目を個別に評価してください。総合点ではなく項目別スコアが他の購入者に表示されます。',
    overall: '総合評価',
    deadline: '納期遵守',
    quality: '品質',
    communication: '対応',
    comment: 'コメント (任意)',
    commentPlaceholder: '具体的な経験を書いていただくと、他の購入者の参考になります。',
    submit: 'レビューを投稿',
    submitting: '投稿中...',
    success: 'レビューを登録しました。ありがとうございます！',
    error: '登録に失敗しました。もう一度お試しください。',
    requireRating: 'すべての項目を評価してください',
    lowRatingHint: '残念だった点を書いていただくと、製造元に伝わります。',
  },
  zh: {
    title: '撰写评价',
    subtitle: '请分项评分。其他买家看到的是各维度分数，而不是综合分。',
    overall: '综合评价',
    deadline: '按期交付',
    quality: '质量',
    communication: '沟通',
    comment: '评论（可选）',
    commentPlaceholder: '写下具体经历，可以帮助其他买家。',
    submit: '提交评价',
    submitting: '提交中...',
    success: '评价已提交，谢谢！',
    error: '提交失败，请重试。',
    requireRating: '请为所有项目评分',
    lowRatingHint: '写下不满意之处，我们会转达给制造商。',
  },
  es: {
    title: 'Escribir una reseña',
    subtitle: 'Puntúe cada eje por separado: los compradores ven dimensiones distintas, no una nota global.',
    overall: 'Valoración global',
    deadline: 'Cumplimiento de plazos',
    quality: 'Calidad',
    communication: 'Comunicación',
    comment: 'Comentario (opcional)',
    commentPlaceholder: 'Contar su experiencia concreta ayuda a otros compradores.',
    submit: 'Publicar reseña',
    submitting: 'Enviando...',
    success: 'Reseña publicada. ¡Gracias!',
    error: 'No se ha podido publicar. Inténtelo de nuevo.',
    requireRating: 'Puntúe todos los apartados',
    lowRatingHint: 'Si indica qué no funcionó, se lo trasladaremos al fabricante.',
  },
  ar: {
    title: 'كتابة تقييم',
    subtitle: 'قيّم كل محور على حدة — يرى المشترون أبعاداً منفصلة وليس درجة مجمّعة.',
    overall: 'التقييم العام',
    deadline: 'الالتزام بموعد التسليم',
    quality: 'الجودة',
    communication: 'التواصل',
    comment: 'تعليق (اختياري)',
    commentPlaceholder: 'ذِكر تجربتك بالتفصيل يساعد المشترين الآخرين.',
    submit: 'نشر التقييم',
    submitting: 'جارٍ الإرسال...',
    success: 'تم نشر التقييم. شكراً لك!',
    error: 'تعذّر النشر. حاول مرة أخرى.',
    requireRating: 'يُرجى تقييم جميع البنود',
    lowRatingHint: 'إذا ذكرت ما لم يكن مُرضياً، سننقله إلى جهة التصنيع.',
  },
};

export interface ReviewFormProps {
  /** ⚠ 260802: `'ko' | 'en'` 이라 부모가 다른 언어를 넘길 수조차 없었다. */
  lang: string;
  /** Order/contract id this review is for. */
  contractId: string;
  /** The partner being reviewed. */
  partnerEmail: string;
  /** Optional callback after successful submit. */
  onSubmitted?: () => void;
}

export default function ReviewForm({ lang, contractId, partnerEmail, onSubmitted }: ReviewFormProps) {
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const [overall, setOverall] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [quality, setQuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRated = overall > 0 && deadline > 0 && quality > 0 && communication > 0;
  const showLowHint = (overall <= 3 || deadline <= 3 || quality <= 3 || communication <= 3) && allRated;

  const handleSubmit = async () => {
    if (!allRated) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId,
          partnerEmail,
          rating: overall,
          categories: { deadline, quality, communication },
          comment: comment.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setDone(true);
      onSubmitted?.();
    } catch (e) {
      setError((e as Error).message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={{ ...containerStyle, textAlign: 'center', padding: 28 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#3fb950' }}>{t.success}</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--nx-text)' }}>{t.title}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--nx-text-2)', lineHeight: 1.5 }}>{t.subtitle}</p>
      </div>

      <StarRow label={t.overall} value={overall} onChange={setOverall} accent="#79c0ff" />
      <StarRow label={t.deadline} value={deadline} onChange={setDeadline} accent="#3fb950" />
      <StarRow label={t.quality} value={quality} onChange={setQuality} accent="#1f6feb" />
      <StarRow label={t.communication} value={communication} onChange={setCommunication} accent="#a371f7" />

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle}>{t.comment}</label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value.slice(0, 1000))}
          placeholder={t.commentPlaceholder}
          rows={3}
          style={textareaStyle}
        />
        {showLowHint && (
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#d29922' }}>💡 {t.lowRatingHint}</p>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 10, padding: '6px 10px', fontSize: 11, color: '#ffa198', background: 'rgba(248,81,73,0.12)', borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: allRated ? '#3fb950' : 'var(--nx-text-2)' }}>
          {allRated ? loc(lang, {
            ko: '✓ 모든 항목 평가됨',
            en: '✓ All items rated',
            ja: '✓ すべて評価済み',
            zh: '✓ 所有项目已评分',
            es: '✓ Todos los elementos evaluados',
            ar: '✓ تم تقييم جميع البنود',
          }) : t.requireRating}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!allRated || submitting}
          style={{
            padding: '8px 18px', fontSize: 12, fontWeight: 700,
            borderRadius: 6, border: 'none',
            background: allRated && !submitting ? '#1f6feb' : 'var(--nx-border)',
            color: '#fff',
            cursor: allRated && !submitting ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? t.submitting : t.submit}
        </button>
      </div>
    </div>
  );
}

function StarRow({ label, value, onChange, accent }: { label: string; value: number; onChange: (v: number) => void; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--nx-panel-2)' }}>
      <span style={{ fontSize: 12, color: 'var(--nx-text)', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: 28, height: 28,
              fontSize: 18, lineHeight: 1,
              background: 'transparent', border: 'none',
              color: n <= value ? accent : 'var(--nx-border)',
              cursor: 'pointer',
            }}
            aria-label={`${label} ${n}/5`}
          >
            {n <= value ? '★' : '☆'}
          </button>
        ))}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: 'var(--nx-bg)',
  border: '1px solid var(--nx-border)',
  borderRadius: 10,
  padding: 16,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: 'var(--nx-text-2)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'var(--nx-panel)',
  border: '1px solid var(--nx-border)',
  borderRadius: 6,
  color: 'var(--nx-text)', fontSize: 12, fontFamily: 'inherit',
  resize: 'vertical', outline: 'none',
};
