'use client';

/**
 * ReservationConfirmModal.tsx
 *
 * Shown when a buyer attempts checkout while NEXYFAB_ESCROW_ENABLED is
 * false (Phase-1 fake-door). The automated Toss escrow flow is
 * suppressed; instead the order moves to 'reserved_awaiting_manager'
 * and the founder follows up by hand within 24h.
 *
 * Trigger flips to true once 통신판매중개업 신고 + Toss 에스크로 옵션
 * 활성 (M4). After that this modal stays in the codebase as a
 * fallback for any manually-paused order, but the default path is
 * the live Toss SDK checkout.
 */

import React from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface ReservationConfirmModalProps {
  open: boolean;
  lang: string;
  onClose: () => void;
  /** Optional — buyer email shown back ("회신 받을 주소") so the user
   *  can confirm where the founder's follow-up will land. */
  buyerEmail?: string;
}

export default function ReservationConfirmModal({
  open,
  lang,
  onClose,
  buyerEmail,
}: ReservationConfirmModalProps) {
  if (!open) return null;
  const ko = isKorean(lang);

  const t = ko
    ? {
        title: '예약이 접수되었습니다',
        line1: 'B2B 안심 제조 보증 상태로 예약되었습니다.',
        line2: '담당 매니저가 도면을 검토하고 파트너 공장과 단가를 조율한 뒤, 24시간 내에 확정 견적과 결제 링크를 보내드립니다.',
        emailNote: '회신 받을 주소',
        whyTitle: '왜 즉시 결제가 아닌가요?',
        why: '현재 NexyFab은 콘시어지 트랙으로 운영됩니다. 매니저가 직접 도면 오류를 점검하고 파트너와 단가를 협상하여 가장 좋은 결과를 만들기 위한 단계입니다.',
        ok: '확인',
      }
    : {
        title: 'Reservation received',
        line1: 'Your order has been reserved under our concierge track.',
        line2: 'A manager will review your design, negotiate with our partner factories, and send a confirmed quote and payment link within 24 hours.',
        emailNote: 'Reply will be sent to',
        whyTitle: 'Why not immediate checkout?',
        why: 'NexyFab currently operates in concierge mode — a manager reviews every design for errors and negotiates with partners on your behalf to ensure the best outcome.',
        ok: 'OK',
      };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 12,
          maxWidth: 520, width: '100%',
          padding: '28px 24px',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'start', marginBottom: 16 }}>
          <div
            aria-hidden
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#fef3c7', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}
          >
            🤝
          </div>
          <h2
            id="reservation-modal-title"
            style={{ margin: 0, fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}
          >
            {t.title}
          </h2>
        </div>

        <p style={{ margin: '0 0 12px', lineHeight: 1.55, fontSize: 15 }}>{t.line1}</p>
        <p style={{ margin: '0 0 16px', lineHeight: 1.55, fontSize: 14, color: '#475569' }}>{t.line2}</p>

        {buyerEmail && (
          <div
            style={{
              padding: '10px 12px',
              background: '#f1f5f9',
              borderRadius: 8,
              fontSize: 13,
              color: '#475569',
              marginBottom: 16,
            }}
          >
            <span style={{ color: '#94a3b8' }}>{t.emailNote}: </span>
            <code style={{ color: '#0f172a' }}>{buyerEmail}</code>
          </div>
        )}

        <details style={{ marginBottom: 20 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#64748b', userSelect: 'none' }}>
            {t.whyTitle}
          </summary>
          <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55, color: '#64748b' }}>
            {t.why}
          </p>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 22px',
              background: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {t.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
