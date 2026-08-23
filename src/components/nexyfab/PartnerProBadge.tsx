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
import { loc } from '@/lib/i18n/loc';
import { formatDate } from '@/lib/i18n/format';

interface ProfileResp {
  profile?: {
    plan?: string;
    proGraceUntil?: number | null;
    proGraceActive?: boolean;
  };
}

export default function PartnerProBadge({ session, lang = 'en' }: { session: string; lang?: string }) {
  const [data, setData] = useState<ProfileResp['profile'] | null>(null);
  const [now] = useState(() => Date.now());

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

  const remainingMs = data.proGraceUntil - now;
  if (remainingMs <= 0) return null;

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  const expiry = formatDate(data.proGraceUntil, lang) ?? '—';

  let color: { bg: string; border: string; text: string };
  let urgencyLabel = '';
  if (remainingDays <= 7) {
    color = { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
    urgencyLabel = loc(lang, { ko: '⏰ 만료 임박', en: '⏰ Expiring soon', ja: '⏰ まもなく期限', zh: '⏰ 即将到期', es: '⏰ Próximo a vencer', ar: '⏰ يوشك على الانتهاء' });
  } else if (remainingDays <= 14) {
    color = { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
    urgencyLabel = loc(lang, { ko: '⚠️ 곧 만료', en: '⚠️ Expires soon', ja: '⚠️ まもなく期限', zh: '⚠️ 即将到期', es: '⚠️ Vence pronto', ar: '⚠️ ينتهي قريبًا' });
  } else {
    color = { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' };
    urgencyLabel = loc(lang, { ko: '✓ 활성', en: '✓ Active', ja: '✓ 有効', zh: '✓ 有效', es: '✓ Activo', ar: '✓ نشط' });
  }

  return (
    <div
      title={loc(lang, { ko: '견적 제출 / 수락 / 정산 시 자동 연장됩니다', en: 'Automatically extended when quotes are submitted, accepted, or settled', ja: '見積提出・承認・精算時に自動延長されます', zh: '提交、接受或结算报价时自动延长', es: 'Se extiende automáticamente al enviar, aceptar o liquidar una cotización', ar: 'يُمدد تلقائيًا عند تقديم أو قبول أو تسوية عرض السعر' })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 8,
        background: color.bg, border: `1px solid ${color.border}`,
        fontSize: 12, color: color.text, fontWeight: 600,
      }}
    >
      <span style={{ fontWeight: 800 }}>{urgencyLabel} Pro</span>
      <span style={{ opacity: 0.85 }}>D-{remainingDays}</span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>({expiry} {loc(lang, { ko: '까지', en: 'until', ja: 'まで', zh: '截止', es: 'hasta', ar: 'حتى' })})</span>
    </div>
  );
}
