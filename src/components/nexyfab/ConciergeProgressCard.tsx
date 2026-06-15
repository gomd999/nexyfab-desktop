'use client';

// Q3 — Customer-facing Concierge progress feed.
//
// Mounted on the RFQ detail page. Polls /concierge/{rfqId} every 30s
// while the user has it open. Shows masked factory names + status
// chips so the buyer sees real-time signal that we're working on it,
// without learning the factory identity (anti-poach UI guardrail).
//
// Once a factory's status reaches `quote_received` or `partner_signup`,
// the name unmasks (the buyer will engage with that factory anyway,
// and the relationship is now legitimately established through us).

import React, { useCallback, useEffect, useState } from 'react';

interface Entry {
  id: string;
  factoryId: string;
  displayName: string;     // already masked by API
  region: string | null;
  status: string;
  note: string | null;
  publicNote: boolean;
  lastActionAt: number;
  partnerEmail: string | null;  // populated only when fully revealed
}

const POLL_MS = 30_000;

const STATUS_META: Record<string, { ko: string; en: string; emoji: string; color: string }> = {
  recommended:    { ko: '추천됨',         en: 'Recommended',  emoji: '📋', color: 'var(--nx-text-2)' },
  contacted:      { ko: '컨택 시도 중',   en: 'Contacting',   emoji: '📞', color: '#d29922' },
  responded:      { ko: '응답 받음',      en: 'Responded',    emoji: '💬', color: '#79c0ff' },
  quote_drafting: { ko: '견적 작성 중',   en: 'Drafting',     emoji: '📨', color: '#a371f7' },
  quote_received: { ko: '견적 도착!',     en: 'Quote arrived!', emoji: '✅', color: '#3fb950' },
  partner_signup: { ko: '가입 완료',      en: 'Joined NexyFab', emoji: '🔓', color: '#3fb950' },
  declined:       { ko: '거절',           en: 'Declined',     emoji: '✋', color: 'var(--nx-text-3)' },
};

const dict = {
  ko: {
    title: '📞 추천 공장 진행 상황',
    subtitle: '디렉토리에서 추천한 공장을 NexyFab이 직접 컨택하고 있습니다',
    empty: '추천된 공장이 없습니다. 운영팀이 곧 추천을 시작할 예정입니다.',
    blurNote: '💡 회사명은 "견적 도착" 또는 "가입 완료" 시 공개됩니다',
    refresh: '새로고침',
    contact: '직접 연락',
  },
  en: {
    title: '📞 Recommended factories — progress',
    subtitle: 'NexyFab is reaching out to directory factories on your behalf',
    empty: 'No recommendations yet. Ops will start outreach shortly.',
    blurNote: '💡 Company names unmask once a quote arrives or they join NexyFab',
    refresh: 'Refresh',
    contact: 'Contact directly',
  },
};

export interface ConciergeProgressCardProps {
  lang: 'ko' | 'en';
  rfqId: string;
}

export default function ConciergeProgressCard({ lang, rfqId }: ConciergeProgressCardProps) {
  const t = dict[lang];
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/nexyfab/concierge/${encodeURIComponent(rfqId)}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { entries: Entry[] };
      setEntries(data.entries);
      setLoaded(true);
    } catch { /* ignore */ }
  }, [rfqId]);

  useEffect(() => {
    queueMicrotask(() => { void fetchEntries(); });
    const id = setInterval(() => { void fetchEntries(); }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchEntries]);

  return (
    <div style={containerStyle}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>{t.title}</div>
          <div style={subtitleStyle}>{t.subtitle}</div>
        </div>
        <button onClick={() => void fetchEntries()} style={refreshBtn}>{t.refresh}</button>
      </div>

      {!loaded && <div style={mutedStyle}>…</div>}
      {loaded && entries.length === 0 && <div style={mutedStyle}>{t.empty}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(e => {
          const meta = STATUS_META[e.status] ?? STATUS_META.recommended;
          const revealed = e.status === 'quote_received' || e.status === 'partner_signup';
          return (
            <div key={e.id} style={{
              ...rowStyle,
              borderLeft: `3px solid ${meta.color}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: revealed ? 'var(--nx-text)' : 'var(--nx-text)' }}>
                  {e.displayName}
                  {e.region && (
                    <span style={{ fontSize: 11, color: 'var(--nx-text-2)', fontWeight: 400, marginLeft: 8 }}>
                      · {e.region}
                    </span>
                  )}
                </div>
                {e.note && e.publicNote && (
                  <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 3 }}>📝 {e.note}</div>
                )}
                <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginTop: 2 }}>
                  {timeAgo(e.lastActionAt, lang)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 700,
                  borderRadius: 12,
                  background: `${meta.color}22`, color: meta.color,
                }}>
                  {meta.emoji} {lang === 'ko' ? meta.ko : meta.en}
                </span>
                {revealed && e.partnerEmail && (
                  <a href={`mailto:${e.partnerEmail}`} style={contactLinkStyle}>
                    📧 {t.contact}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {entries.some(e => e.status !== 'quote_received' && e.status !== 'partner_signup') && (
        <div style={blurNoteStyle}>{t.blurNote}</div>
      )}
    </div>
  );
}

function timeAgo(ts: number, lang: 'ko' | 'en'): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (lang === 'ko') {
    if (sec < 60) return `${sec}초 전`;
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
    return `${Math.floor(sec / 86400)}일 전`;
  }
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const containerStyle: React.CSSProperties = {
  background: 'var(--nx-bg)', border: '1px solid #1f6feb', borderRadius: 10,
  padding: 14, marginTop: 12,
};
const headerRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 10, gap: 10, flexWrap: 'wrap',
};
const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: '#79c0ff' };
const subtitleStyle: React.CSSProperties = { fontSize: 11, color: 'var(--nx-text-2)', marginTop: 2 };
const refreshBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 10,
  borderRadius: 4, border: '1px solid var(--nx-border)',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
};
const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--nx-text-2)', padding: 12, textAlign: 'center' };
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-start',
  padding: 10, background: 'var(--nx-panel)', borderRadius: 8,
};
const contactLinkStyle: React.CSSProperties = {
  fontSize: 10, color: '#79c0ff', textDecoration: 'underline',
};
const blurNoteStyle: React.CSSProperties = {
  marginTop: 10, padding: '6px 10px', fontSize: 10,
  background: '#1f6feb15', color: '#79c0ff', borderRadius: 6,
};
