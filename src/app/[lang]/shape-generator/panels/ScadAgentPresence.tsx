'use client';

// W8 — Collab presence indicator for the SCAD agent panel.
//
// Heart-beats /api/nexyfab/scad-agent/presence every HEARTBEAT_MS while
// the panel is mounted with an active session. The server keeps a TTL
// roster keyed by sessionId; when the user closes the tab their entry
// expires within 60s and peers see them drop off.
//
// Avatar circles are derived from `id` hash → stable color; first
// initial of `label` shown inside. Click the strip to open a tooltip
// with full participant labels.

import React, { useEffect, useRef, useState } from 'react';

interface Peer {
  id: string;
  label: string;
}

const HEARTBEAT_MS = 20_000;
const dict = {
  ko: { solo: '👤 혼자', n: (n: number) => `👥 ${n}명`, you: '나', list: '참여자' },
  en: { solo: '👤 solo', n: (n: number) => `👥 ${n}`, you: 'you', list: 'Participants' },
  ja: { solo: '👤 一人', n: (n: number) => `👥 ${n}人`, you: '自分', list: '参加者' },
  zh: { solo: '👤 单人', n: (n: number) => `👥 ${n}人`, you: '我', list: '参与者' },
  es: { solo: '👤 solo', n: (n: number) => `👥 ${n}`, you: 'tú', list: 'Participantes' },
  ar: { solo: '👤 وحده', n: (n: number) => `👥 ${n}`, you: 'أنت', list: 'المشاركون' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface ScadAgentPresenceProps {
  lang: string;
  /** Live agent session id from the SSE done event. Null while no session. */
  sessionId: string | null;
  /** Stable per-user id for the local viewer (auth user id, or anon uuid). */
  userId: string;
  /** Display label for the local viewer. */
  userLabel: string;
}

export default function ScadAgentPresence({ lang, sessionId, userId, userLabel }: ScadAgentPresenceProps) {
  const t = dict[langMap[lang] ?? 'en'];
  const [peers, setPeers] = useState<Peer[]>([]);
  const [open, setOpen] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!sessionId) {
      setPeers([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beat = async () => {
      try {
        const res = await fetch('/api/nexyfab/scad-agent/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, userId, label: userLabel }),
        });
        if (!cancelledRef.current && res.ok) {
          const data = await res.json() as { peers?: Peer[] };
          setPeers(data.peers ?? []);
        }
      } catch { /* ignore — heartbeat will retry */ }
      if (!cancelledRef.current) {
        timer = setTimeout(beat, HEARTBEAT_MS);
      }
    };
    void beat();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, userId, userLabel]);

  if (!sessionId) return null;

  const others = peers.filter(p => p.id !== userId);
  const total = peers.length || 1; // include self if roster hasn't echoed yet

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={pillStyle}
        title={total === 1 ? t.solo : `${total} participants`}
      >
        {total === 1 ? t.solo : t.n(total)}
        {others.length > 0 && (
          <span style={{ display: 'inline-flex', marginLeft: 4 }}>
            {others.slice(0, 3).map(p => (
              <Avatar key={p.id} id={p.id} label={p.label} />
            ))}
            {others.length > 3 && (
              <span style={{ ...avatarStyle, background: '#30363d', color: '#8b949e' }}>
                +{others.length - 3}
              </span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div style={popoverStyle}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t.list}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <PeerRow label={`${userLabel} (${t.you})`} id={userId} self />
            {others.map(p => (
              <PeerRow key={p.id} label={p.label} id={p.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ id, label }: { id: string; label: string }) {
  const color = colorFor(id);
  const initial = (label.trim()[0] ?? '?').toUpperCase();
  return (
    <span style={{ ...avatarStyle, background: color }} title={label}>
      {initial}
    </span>
  );
}

function PeerRow({ id, label, self = false }: { id: string; label: string; self?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#c9d1d9' }}>
      <Avatar id={id} label={label} />
      <span style={{ fontWeight: self ? 700 : 400 }}>{label}</span>
    </div>
  );
}

function colorFor(id: string): string {
  // Stable hash → HSL hue. Saturation/lightness fixed for legible chips
  // on the dark theme.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xfffffff;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

const pillStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 10, fontWeight: 700,
  borderRadius: 12,
  border: '1px solid #30363d',
  background: 'transparent', color: '#9ca3af',
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};
const avatarStyle: React.CSSProperties = {
  width: 18, height: 18,
  borderRadius: 9,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 9, fontWeight: 700, color: '#fff',
  marginLeft: -4,
  border: '1px solid #161b22',
};
const popoverStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4,
  padding: 10,
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 8,
  minWidth: 180,
  zIndex: 800,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
};
