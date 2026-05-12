'use client';

// L4 — Simulation quota widget for the billing/usage page.
//
// Polls /api/nexyfab/sim-quota once on mount and shows used/remaining
// of the monthly cap, plus a per-kind breakdown (CFD vs CAM vs ...).
// Renders nothing for free-plan-locked users (they get a Pro upsell
// pill instead).

import React, { useEffect, useState } from 'react';

interface QuotaResp {
  ok: boolean;
  plan: string;
  used: number;
  limit: number;          // -1 unlimited, -2 plan-locked
  remaining: number | null;
  byKind: Record<string, number>;
}

const KIND_LABEL: Record<string, { ko: string; en: string; emoji: string }> = {
  cfd:       { ko: '유체', en: 'CFD',     emoji: '💨' },
  mbd:       { ko: '동역학', en: 'MBD',   emoji: '⚙' },
  cam:       { ko: 'CAM', en: 'CAM',      emoji: '🛠' },
  mold_fill: { ko: '사출', en: 'Mold',    emoji: '🟦' },
  optics:    { ko: '광학', en: 'Optics',  emoji: '🔭' },
  thermal:   { ko: '열', en: 'Thermal',   emoji: '🔥' },
};

const dict = {
  ko: {
    title: '🧪 시뮬레이션 사용량',
    used: '이번 달 사용',
    remaining: '잔여',
    unlimited: '무제한',
    locked: 'Pro+ 전용',
    upgrade: 'Pro로 업그레이드',
    breakdown: '유형별',
    none: '아직 사용 없음',
    error: '사용량을 불러오지 못했습니다.',
  },
  en: {
    title: '🧪 Simulation usage',
    used: 'This month',
    remaining: 'Remaining',
    unlimited: 'Unlimited',
    locked: 'Pro+ feature',
    upgrade: 'Upgrade to Pro',
    breakdown: 'By kind',
    none: 'No runs yet',
    error: 'Failed to load usage.',
  },
};

export interface SimQuotaWidgetProps {
  lang: 'ko' | 'en';
}

export default function SimQuotaWidget({ lang }: SimQuotaWidgetProps) {
  const t = dict[lang];
  const [data, setData] = useState<QuotaResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/nexyfab/sim-quota', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as QuotaResp;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div style={{ padding: 14, color: '#ffa198', fontSize: 12 }}>{t.error}: {error}</div>;
  }
  if (!data) {
    return <div style={{ padding: 14, color: '#8b949e', fontSize: 12 }}>…</div>;
  }

  const isLocked = data.limit === -2;
  const isUnlimited = data.limit === -1;
  const pct = !isLocked && !isUnlimited && data.limit > 0
    ? Math.min(1, data.used / data.limit) * 100
    : 0;
  const barColor = pct > 90 ? '#f85149' : pct > 70 ? '#d29922' : '#3fb950';

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 10,
      padding: 16,
      marginTop: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{t.title}</span>
        <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>{data.plan}</span>
      </div>

      {isLocked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#8b949e' }}>{t.locked}</span>
          <a href="../pricing" style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 700,
            borderRadius: 6, background: '#1f6feb', color: '#fff',
            textDecoration: 'none',
          }}>{t.upgrade}</a>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#8b949e' }}>{t.used}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' }}>
              {data.used} / {isUnlimited ? '∞' : data.limit}
            </span>
            {data.remaining !== null && (
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                ({t.remaining}: {data.remaining})
              </span>
            )}
          </div>
          {!isUnlimited && (
            <div style={{ width: '100%', height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.3s' }} />
            </div>
          )}

          {Object.keys(data.byKind).length === 0 ? (
            <div style={{ fontSize: 11, color: '#8b949e' }}>{t.none}</div>
          ) : (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.breakdown}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(data.byKind).map(([kind, count]) => {
                  const meta = KIND_LABEL[kind] ?? { ko: kind, en: kind, emoji: '🧪' };
                  return (
                    <span key={kind} style={{
                      padding: '3px 8px', fontSize: 11,
                      borderRadius: 12,
                      background: '#0d1117', border: '1px solid #30363d',
                      color: '#c9d1d9', fontFamily: 'monospace',
                    }}>
                      {meta.emoji} {meta[lang]} ×{count}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
