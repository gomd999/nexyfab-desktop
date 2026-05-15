'use client';

// B3 — Multi-dimensional partner metrics bar.
//
// Per memory rule (2026-04-23): NEVER show a single composite credit
// score. Each operational dimension stays separate so a partner knows
// exactly which axis to improve and a buyer can pick by what they
// actually care about (a fast-response shop vs a high-quality one).
//
// Surfaces 4 user-meaningful axes from /partner/metrics-batch:
//   - 납기 정시율 (on_time_rate)
//   - 품질 (quality_avg, 1-5 → percent)
//   - 응답속도 (response_minutes inverted to a 0-1 rough indicator)
//   - 소통 (communication_avg, 1-5 → percent)
//
// Empty/cold-start partners show "—" rather than a fabricated 0% so
// they're not unfairly penalized vs. a measured 0%.

import React from 'react';

export interface PartnerMetrics {
  onTimeRate: number | null;
  avgLeadTimeDays: number | null;
  avgResponseMinutes: number | null;
  responseSamples: number;
  qualityAvg: number | null;
  communicationAvg: number | null;
  reviewCount: number;
}

const dict = {
  ko: {
    onTime: '납기',
    quality: '품질',
    response: '응답',
    comm: '소통',
    samplesPrefix: 'n=',
    leadTimeSuffix: '일',
    responseHr: '시간',
    responseMin: '분',
    none: '—',
    notMeasured: '측정 전',
  },
  en: {
    onTime: 'On-time',
    quality: 'Quality',
    response: 'Response',
    comm: 'Comm',
    samplesPrefix: 'n=',
    leadTimeSuffix: 'd',
    responseHr: 'h',
    responseMin: 'm',
    none: '—',
    notMeasured: 'Not measured',
  },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'en', cn: 'en', zh: 'en', es: 'en', ar: 'en',
};

export interface PartnerMetricsBarProps {
  lang: string;
  metrics: PartnerMetrics | null;
  /** Compact = chip strip; full = labeled rows with progress bars. */
  variant?: 'compact' | 'full';
}

export default function PartnerMetricsBar({ lang, metrics, variant = 'compact' }: PartnerMetricsBarProps) {
  const t = dict[langMap[lang] ?? 'en'];

  if (!metrics) {
    return (
      <div style={{ fontSize: 10, color: 'var(--nx-text-2)', padding: '2px 0' }}>
        {t.notMeasured}
      </div>
    );
  }

  const dims = [
    {
      key: 'onTime',
      label: t.onTime,
      value: metrics.onTimeRate,
      formatted: metrics.onTimeRate != null ? `${(metrics.onTimeRate * 100).toFixed(0)}%` : t.none,
      pct: metrics.onTimeRate != null ? metrics.onTimeRate : null,
      color: 'var(--nx-ok)',
    },
    {
      key: 'quality',
      label: t.quality,
      value: metrics.qualityAvg,
      formatted: metrics.qualityAvg != null ? `${metrics.qualityAvg.toFixed(1)}/5` : t.none,
      pct: metrics.qualityAvg != null ? metrics.qualityAvg / 5 : null,
      color: 'var(--nx-accent)',
    },
    {
      key: 'response',
      label: t.response,
      value: metrics.avgResponseMinutes,
      formatted: formatResponse(metrics.avgResponseMinutes, t),
      // Below 60 min = green; 60min~1day = yellow; >1day = red. As a 0-1 indicator, normalize: <60min→1.0, >1440min→0.0
      pct: metrics.avgResponseMinutes != null
        ? Math.max(0, Math.min(1, 1 - (metrics.avgResponseMinutes - 60) / 1380))
        : null,
      color: 'var(--nx-warn)',
    },
    {
      key: 'comm',
      label: t.comm,
      value: metrics.communicationAvg,
      formatted: metrics.communicationAvg != null ? `${metrics.communicationAvg.toFixed(1)}/5` : t.none,
      pct: metrics.communicationAvg != null ? metrics.communicationAvg / 5 : null,
      color: 'var(--nx-accent-2)',
    },
  ];

  if (variant === 'compact') {
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {dims.map(d => (
          <span
            key={d.key}
            style={{
              padding: '2px 7px',
              fontSize: 10, fontWeight: 600,
              borderRadius: 10,
              border: `1px solid ${d.value != null ? d.color : 'var(--nx-border)'}`,
              background: d.value != null ? `${d.color}22` : 'transparent',
              color: d.value != null ? d.color : 'var(--nx-text-2)',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
            title={`${d.label}: ${d.formatted}`}
          >
            {d.label} {d.formatted}
          </span>
        ))}
      </div>
    );
  }

  // full variant — labeled rows with progress bars
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {dims.map(d => (
        <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ width: 60, color: 'var(--nx-text-2)' }}>{d.label}</span>
          <div style={{ flex: 1, height: 6, background: 'var(--nx-panel-2)', borderRadius: 3, overflow: 'hidden' }}>
            {d.pct != null && (
              <div style={{
                width: `${Math.max(2, d.pct * 100)}%`,
                height: '100%',
                background: d.color,
                transition: 'width 0.18s',
              }} />
            )}
          </div>
          <span style={{
            width: 60, textAlign: 'right',
            fontFamily: 'monospace',
            color: d.value != null ? 'var(--nx-text)' : 'var(--nx-text-3)',
            fontWeight: 600,
          }}>
            {d.formatted}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatResponse(min: number | null, t: typeof dict.ko): string {
  if (min == null) return t.none;
  if (min < 60) return `${min.toFixed(0)}${t.responseMin}`;
  if (min < 60 * 24) return `${(min / 60).toFixed(1)}${t.responseHr}`;
  return `${(min / 1440).toFixed(1)}${t.leadTimeSuffix}`;
}
