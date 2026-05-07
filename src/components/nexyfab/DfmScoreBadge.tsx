'use client';

/**
 * DFM Score Badge
 * Shows a small color-coded manufacturability score.
 * Green 80-100, Yellow 50-79, Red 0-49, Gray = no data
 */

interface DfmScoreBadgeProps {
  score: number | null | undefined;
  process?: string | null;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const SCORE_LEVELS = [
  { min: 80, label: '제조 가능', labelEn: 'Machinable',  color: '#22c55e', bg: '#22c55e1a', dot: '#22c55e' },
  { min: 50, label: '검토 필요', labelEn: 'Review',      color: '#f59e0b', bg: '#f59e0b1a', dot: '#f59e0b' },
  { min: 0,  label: '제조 어려움', labelEn: 'Difficult', color: '#ef4444', bg: '#ef44441a', dot: '#ef4444' },
];

function getLevel(score: number) {
  return SCORE_LEVELS.find(l => score >= l.min) ?? SCORE_LEVELS[2]!;
}

export default function DfmScoreBadge({ score, process, size = 'sm', showLabel = true }: DfmScoreBadgeProps) {
  if (score == null) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: size === 'sm' ? 10 : 12,
        color: '#484f58', background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: 4, padding: size === 'sm' ? '2px 6px' : '3px 8px',
        fontWeight: 600, letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 9 }}>⬡</span>
        {showLabel && 'DFM 미분석'}
      </span>
    );
  }

  const level = getLevel(score);
  const processLabel = process ? process.replace(/_/g, ' ').toUpperCase() : null;

  return (
    <span
      title={`DFM Score: ${score}/100${process ? ` (${process})` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: size === 'sm' ? 10 : 12,
        color: level.color, background: level.bg,
        border: `1px solid ${level.color}44`,
        borderRadius: 4, padding: size === 'sm' ? '2px 6px' : '3px 8px',
        fontWeight: 700, letterSpacing: '0.02em',
        whiteSpace: 'nowrap', cursor: 'default',
      }}
    >
      <span style={{
        width: size === 'sm' ? 5 : 6, height: size === 'sm' ? 5 : 6,
        borderRadius: '50%', background: level.dot, flexShrink: 0,
        display: 'inline-block',
      }} />
      {score}
      {showLabel && (
        <>
          <span style={{ opacity: 0.6, fontWeight: 400 }}>/100</span>
          {processLabel && (
            <span style={{ opacity: 0.7, fontWeight: 500, fontSize: (size === 'sm' ? 10 : 12) - 1 }}>
              · {processLabel}
            </span>
          )}
        </>
      )}
    </span>
  );
}
