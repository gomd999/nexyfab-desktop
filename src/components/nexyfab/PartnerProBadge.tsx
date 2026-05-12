'use client';

/**
 * PartnerProBadge — surfaces the partner's deal-driven Pro grace status.
 *
 * Reads /api/partner/profile to get { plan, proGraceUntil, proGraceActive }.
 * Renders nothing if grace is inactive (paid Pro or no grace) — the badge
 * is meant to call out the temporary grant, not to clutter the UI for
 * users who already have permanent access.
 *
 * Color cliff: green > 14d, amber 14d → 7d, red ≤ 7d. Mirrors the cron's
 * 7d/1d email cadence so the visual urgency tracks the messaging cadence.
 */
import React, { useEffect, useState } from 'react';

interface ProfileResp {
  profile?: {
    plan?: string;
    proGraceUntil?: number | null;
    proGraceActive?: boolean;
  };
}

export default function PartnerProBadge({ session }: { session: string }) {
  const [data, setData] = useState<ProfileResp['profile'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session || session === 'demo') return;
      try {
        const res = await fetch('/api/partner/profile', {
          headers: { Authorization: `Bearer ${session}` },
        });
        if (!res.ok) return;
        const body = await res.json() as ProfileResp;
        if (!cancelled) setData(body.profile ?? null);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  if (!data?.proGraceActive || !data.proGraceUntil) return null;

  const remainingMs = data.proGraceUntil - Date.now();
  if (remainingMs <= 0) return null;

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  const expiry = new Date(data.proGraceUntil).toLocaleDateString('ko-KR');

  let color: { bg: string; border: string; text: string };
  let urgencyLabel = '';
  if (remainingDays <= 7) {
    color = { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
    urgencyLabel = '⏰ 만료 임박';
  } else if (remainingDays <= 14) {
    color = { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
    urgencyLabel = '⚠️ 곧 만료';
  } else {
    color = { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' };
    urgencyLabel = '✓ 활성';
  }

  return (
    <div
      title="견적 제출 / 수락 / 정산 시 자동 연장됩니다"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 8,
        background: color.bg, border: `1px solid ${color.border}`,
        fontSize: 12, color: color.text, fontWeight: 600,
      }}
    >
      <span style={{ fontWeight: 800 }}>{urgencyLabel} Pro</span>
      <span style={{ opacity: 0.85 }}>D-{remainingDays}</span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>({expiry}까지)</span>
    </div>
  );
}
