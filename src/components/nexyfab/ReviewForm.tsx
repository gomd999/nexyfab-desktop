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
};

export interface ReviewFormProps {
  lang: 'ko' | 'en';
  /** Order/contract id this review is for. */
  contractId: string;
  /** The partner being reviewed. */
  partnerEmail: string;
  /** Optional callback after successful submit. */
  onSubmitted?: () => void;
}

export default function ReviewForm({ lang, contractId, partnerEmail, onSubmitted }: ReviewFormProps) {
  const t = dict[lang];
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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>{t.title}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>{t.subtitle}</p>
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
        <span style={{ fontSize: 11, color: allRated ? '#3fb950' : '#8b949e' }}>
          {allRated ? '✓ 모든 항목 평가됨' : t.requireRating}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!allRated || submitting}
          style={{
            padding: '8px 18px', fontSize: 12, fontWeight: 700,
            borderRadius: 6, border: 'none',
            background: allRated && !submitting ? '#1f6feb' : '#30363d',
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #21262d' }}>
      <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: 28, height: 28,
              fontSize: 18, lineHeight: 1,
              background: 'transparent', border: 'none',
              color: n <= value ? accent : '#30363d',
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
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: 16,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: '#8b949e', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#e6edf3', fontSize: 12, fontFamily: 'inherit',
  resize: 'vertical', outline: 'none',
};
