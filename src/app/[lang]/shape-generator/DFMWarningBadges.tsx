'use client';

import React from 'react';
import type { DFMIssue, DFMResult } from './analysis/dfmAnalysis';

interface DFMWarningBadgesProps {
  /** One entry per analyzed manufacturing process (same shape as analysis store). */
  dfmResults: DFMResult[] | null;
  visible: boolean;
  lang: string;
}

function flattenNonInfoIssues(results: DFMResult[]): DFMIssue[] {
  return results.flatMap(r => r.issues).filter(i => i.severity !== 'info');
}

const dict = {
  ko: { pass: '합격', warn: '주의', fail: '위험', noIssues: '제조 이슈 없음' },
  en: { pass: 'Pass', warn: 'Warning', fail: 'Critical', noIssues: 'No issues' },
  ja: { pass: '合格', warn: '注意', fail: '危険', noIssues: '製造上の問題なし' },
  zh: { pass: '合格', warn: '警告', fail: '严重', noIssues: '无制造问题' },
  es: { pass: 'Aprobado', warn: 'Advertencia', fail: 'Crítico', noIssues: 'Sin problemas' },
  ar: { pass: 'ناجح', warn: 'تحذير', fail: 'حرج', noIssues: 'لا مشاكل' },
};
const dfmLangMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function issueBadgeLabel(issue: DFMIssue): string {
  const fromType = issue.type.replace(/_/g, ' ');
  if (fromType.length > 0 && fromType.length <= 28) return fromType;
  const d = issue.description.trim();
  if (d.length <= 28) return d;
  return `${d.slice(0, 26)}…`;
}

export default function DFMWarningBadges({ dfmResults, visible, lang }: DFMWarningBadgesProps) {
  if (!visible || !dfmResults || dfmResults.length === 0) return null;

  const t = dict[dfmLangMap[lang] ?? 'en'];

  const issues = flattenNonInfoIssues(dfmResults);

  if (issues.length === 0) {
    return (
      <div style={{
        position: 'absolute',
        top: 16, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'linear-gradient(135deg, rgba(46, 160, 67, 0.15) 0%, rgba(35, 134, 54, 0.2) 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(46, 160, 67, 0.4)',
        borderRadius: 24,
        padding: '6px 14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset',
        pointerEvents: 'auto',
        cursor: 'default',
        transition: 'transform 0.2s',
      }}>
        <span style={{ fontSize: 13 }}>✅</span>
        <span style={{ fontSize: 11, color: 'var(--nx-ok)', fontWeight: 700, letterSpacing: '0.02em' }}>{t.noIssues}</span>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      top: 16, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      display: 'flex', gap: 8,
      pointerEvents: 'auto',
    }}>
      {issues.slice(0, 3).map((issue, i) => {
        const isWarn = issue.severity === 'warning';
        const color = isWarn ? 'var(--nx-warn)' : 'var(--nx-error)';
        const bg = isWarn ? 'linear-gradient(135deg, rgba(210,153,34,0.15) 0%, rgba(187,128,9,0.2) 100%)' : 'linear-gradient(135deg, rgba(248,81,73,0.15) 0%, rgba(218,54,51,0.2) 100%)';
        const borderColor = isWarn ? 'rgba(210,153,34,0.4)' : 'rgba(248,81,73,0.4)';
        const tip = [issue.description, issue.suggestion].filter(Boolean).join('\n\n');
        return (
          <div 
            key={i} 
            title={tip || issue.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: bg,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: `1px solid ${borderColor}`,
              borderRadius: 24,
              padding: '6px 14px',
              animation: `dfmBadgeIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${i * 0.05}s both`,
              boxShadow: `0 4px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset`,
              cursor: 'help',
              transition: 'transform 0.2s, filter 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.filter = 'brightness(1.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.filter = 'brightness(1)'; }}
          >
            <span style={{ fontSize: 13 }}>{isWarn ? '⚠️' : '🚨'}</span>
            <span style={{
              fontSize: 11, color, fontWeight: 700, letterSpacing: '0.02em',
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {issueBadgeLabel(issue)}
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
