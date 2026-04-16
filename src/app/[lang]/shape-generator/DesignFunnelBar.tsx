'use client';

import React from 'react';

export interface FunnelStep {
  label: string;
  done: boolean;
  active: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface DesignFunnelBarProps {
  lang: string;
  hasGeometry: boolean;
  dfmChecked: boolean;   // dfmResults !== null
  dfmClean: boolean;     // dfmIssueCount === 0
  dfmIssueCount: number;
  rfqDone: boolean;
  manufacturerMatched: boolean;
  onGoToDFM: () => void;
  onGoToQuote: () => void;
  onGoToMatch: () => void;
  theme: { panelBg: string; border: string; text: string; textMuted: string };
}

export default function DesignFunnelBar({
  lang, hasGeometry, dfmChecked, dfmClean, dfmIssueCount,
  rfqDone, manufacturerMatched,
  onGoToDFM, onGoToQuote, onGoToMatch,
  theme,
}: DesignFunnelBarProps) {
  const isKo = lang === 'ko';

  // 현재 활성 단계 계산
  const step = manufacturerMatched ? 4 : rfqDone ? 3 : (dfmChecked && dfmClean) ? 2 : hasGeometry ? 1 : 0;

  const steps = [
    {
      n: 1,
      label: isKo ? '형상 설계' : 'Design',
      icon: '📐',
      done: hasGeometry,
      hint: isKo ? '기본 형상 생성 완료' : 'Shape created',
    },
    {
      n: 2,
      label: isKo ? 'DFM 검토' : 'DFM Check',
      icon: dfmChecked && !dfmClean ? '⚠️' : '🔍',
      done: dfmChecked && dfmClean,
      warn: dfmChecked && !dfmClean,
      hint: !dfmChecked
        ? (isKo ? '형상 생성 후 자동 분석' : 'Auto-analyzed after shape')
        : dfmClean
          ? (isKo ? '제조 가능성 검증 완료' : 'DFM passed')
          : (isKo ? `이슈 ${dfmIssueCount}건 — 견적은 가능하나 비용 증가 가능` : `${dfmIssueCount} issue(s) — quote possible but cost may rise`),
      action: hasGeometry && !dfmClean ? onGoToDFM : undefined,
      actionLabel: isKo ? 'DFM 보기' : 'View DFM',
    },
    {
      n: 3,
      label: isKo ? '견적 요청' : 'Get Quote',
      icon: '📋',
      done: rfqDone,
      hint: rfqDone
        ? (isKo ? '견적 요청 완료' : 'Quote requested')
        : (isKo ? '형상·재질 확정 후 요청' : 'Finalize shape & material'),
      action: hasGeometry && !rfqDone ? onGoToQuote : undefined,
      actionLabel: isKo ? '견적 요청' : 'Request Quote',
    },
    {
      n: 4,
      label: isKo ? '제조사 매칭' : 'Match Factory',
      icon: '🏭',
      done: manufacturerMatched,
      hint: manufacturerMatched
        ? (isKo ? '제조사 선택 완료' : 'Factory selected')
        : (isKo ? '견적 후 AI 매칭' : 'AI matching after quote'),
      action: rfqDone && !manufacturerMatched ? onGoToMatch : undefined,
      actionLabel: isKo ? '제조사 보기' : 'View Factories',
    },
  ];

  return (
    <div style={{
      background: theme.panelBg,
      borderBottom: `1px solid ${theme.border}`,
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      height: 36,
      flexShrink: 0,
      overflowX: 'auto',
    }}>
      {steps.map((s, i) => {
        const isCurrent = s.n === step + 1 && !s.done;
        const isWarn = s.warn;
        const color = s.done
          ? '#3fb950'
          : isWarn
            ? '#f0883e'
            : isCurrent
              ? '#58a6ff'
              : '#484f58';

        return (
          <React.Fragment key={s.n}>
            {/* 단계 */}
            <div
              title={s.hint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 10px',
                height: '100%',
                cursor: s.action ? 'pointer' : 'default',
                borderBottom: isCurrent ? '2px solid #58a6ff' : isWarn ? '2px solid #f0883e' : s.done ? '2px solid #3fb950' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
              onClick={s.action}
            >
              <span style={{ fontSize: 12 }}>{s.icon}</span>
              <span style={{
                fontSize: 11,
                fontWeight: isCurrent || s.done ? 700 : 400,
                color,
                whiteSpace: 'nowrap',
              }}>
                {s.done && <span style={{ marginRight: 3 }}>✓</span>}
                {s.label}
              </span>
              {/* 다음 단계 유도 버튼 */}
              {s.action && isCurrent && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#161b22',
                  background: '#58a6ff',
                  borderRadius: 4,
                  padding: '1px 6px',
                  marginLeft: 2,
                  animation: 'funnel-pulse 1.8s ease-in-out infinite',
                }}>
                  {s.actionLabel}
                </span>
              )}
              {s.action && isWarn && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: '#161b22', background: '#f0883e',
                  borderRadius: 4, padding: '1px 6px', marginLeft: 2,
                }}>
                  {s.actionLabel}
                </span>
              )}
            </div>

            {/* 구분자 화살표 */}
            {i < steps.length - 1 && (
              <span style={{ color: '#30363d', fontSize: 10, flexShrink: 0 }}>›</span>
            )}
          </React.Fragment>
        );
      })}

      {/* 펄스 애니메이션 */}
      <style>{`
        @keyframes funnel-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
