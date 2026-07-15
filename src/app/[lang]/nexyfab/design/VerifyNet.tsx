'use client';

/**
 * VerifyNet — 검증 그물 3겹 시각화 (방법론 §7, 2026-07-16).
 * 어떤 검증을 통과했고 무엇이 미실행인지 정직하게 상시 노출한다.
 * 미구현 그물(역투영 diff·vision 비평)은 숨기지 않고 '후속'으로 표기 —
 * 은폐 없는 상태 표가 신뢰의 근거다(feedback_landing_no_mock 정합).
 */

export type NetStatus = 'pass' | 'fail' | 'skip' | 'todo';

const STATUS_UI: Record<NetStatus, { mark: string; color: string }> = {
  pass: { mark: '✓', color: '#16a34a' },
  fail: { mark: '✗', color: '#dc2626' },
  skip: { mark: '—', color: 'var(--nx-text-3, #6b7684)' },
  todo: { mark: '·', color: 'var(--nx-text-3, #6b7684)' },
};

export interface NetItem { label: string; status: NetStatus; note?: string }

export default function VerifyNet({ ko, items }: { ko: boolean; items: NetItem[] }) {
  return (
    <div style={{ marginBottom: 10, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
        🕸 {ko ? '검증 그물' : 'Verification net'}
        <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? '통과·실패·미실행을 숨기지 않습니다' : 'pass / fail / not-run — nothing hidden'}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 3 }}>
        {items.map((it) => {
          const ui = STATUS_UI[it.status];
          return (
            <div key={it.label} style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 10.5 }}>
              <span style={{ color: ui.color, fontWeight: 800, width: 10, textAlign: 'center' }}>{ui.mark}</span>
              <span style={{ fontWeight: 600, color: it.status === 'todo' ? 'var(--nx-text-3, #6b7684)' : 'inherit' }}>{it.label}</span>
              {it.note && <span style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{it.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
