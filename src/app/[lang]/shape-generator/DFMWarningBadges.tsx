'use client';

import React from 'react';

interface DFMIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  label?: string;
  paramKey?: string;
}

interface DFMResult {
  checks?: DFMIssue[];
  score?: number;
}
interface DFMWarningBadgesProps {
  dfmResults: DFMResult | null;
  visible: boolean;
  lang: string;
}

const dict = {
  ko: { pass: '합격', warn: '주의', fail: '위험', noIssues: '제조 이슈 없음' },
  en: { pass: 'Pass', warn: 'Warning', fail: 'Critical', noIssues: 'No issues' },
};

export default function DFMWarningBadges({ dfmResults, visible, lang }: DFMWarningBadgesProps) {
  if (!visible || !dfmResults) return null;

  const isKo = lang === 'ko' || lang === 'kr';
  const t = isKo ? dict.ko : dict.en;

  const issues = dfmResults.checks?.filter(c => c.severity !== 'info') ?? [];

  if (issues.length === 0) {
    return (
      <div style={{
        position: 'absolute',
        top: 12, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(63, 185, 80, 0.12)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(63, 185, 80, 0.3)',
        borderRadius: 20,
        padding: '4px 12px',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 12 }}>✅</span>
        <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>{t.noIssues}</span>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      top: 12, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      display: 'flex', gap: 6,
      pointerEvents: 'none',
    }}>
      {issues.slice(0, 3).map((issue, i) => {
        const isWarn = issue.severity === 'warning';
        const color = isWarn ? '#d29922' : '#f85149';
        const bg = isWarn ? 'rgba(210,153,34,0.12)' : 'rgba(248,81,73,0.12)';
        const borderColor = isWarn ? 'rgba(210,153,34,0.3)' : 'rgba(248,81,73,0.3)';
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: bg,
            backdropFilter: 'blur(8px)',
            border: `1px solid ${borderColor}`,
            borderRadius: 20,
            padding: '4px 10px',
            animation: 'dfmBadgeIn 0.3s ease-out',
          }}>
            <span style={{ fontSize: 11 }}>{isWarn ? '⚠️' : '🚨'}</span>
            <span style={{
              fontSize: 10, color, fontWeight: 700,
              maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {issue.label || (isWarn ? t.warn : t.fail)}
            </span>
          </div>
        );
      })}
      <style>{`
        @keyframes dfmBadgeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
