'use client';

/**
 * DesktopDownloadCard.tsx
 *
 * Phase-2 Week-4 CTA: surface the Tauri desktop build (Windows /
 * macOS / Linux) so power users can install offline-capable native
 * NexyFab. Slots into the dashboard / settings / pricing pages as a
 * compact card.
 *
 * Detection:
 *   - Auto-detect platform from `navigator.userAgent`.
 *   - Show the right primary CTA per platform; alt downloads in a
 *     "more" menu.
 *
 * The actual installer URLs live in env vars so ops can rotate
 * releases without code changes:
 *   NEXT_PUBLIC_DESKTOP_DOWNLOAD_WINDOWS=
 *   NEXT_PUBLIC_DESKTOP_DOWNLOAD_MACOS=
 *   NEXT_PUBLIC_DESKTOP_DOWNLOAD_LINUX=
 */

import React, { useEffect, useState } from 'react';

export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

function detectPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

export interface DesktopDownloadCardProps {
  lang: string;
  /** Optional override platform — for testing or admin override. */
  forcePlatform?: DesktopPlatform;
}

const COPY = {
  ko: {
    headline: 'NexyFab 데스크톱',
    sub: '오프라인에서도 스케치 / 모델링 / Export. WASM 번들 포함.',
    download: '다운로드',
    other: '다른 OS',
    sizeNote: '약 80MB',
    versionLabel: '버전',
    bullet1: '⚡ 네이티브 성능 (큰 어셈블리 부드러움)',
    bullet2: '📶 오프라인 사용 (sketch / extrude / export)',
    bullet3: '🔄 자동 업데이트',
  },
  en: {
    headline: 'NexyFab Desktop',
    sub: 'Sketch / model / export even offline. WASM bundled.',
    download: 'Download',
    other: 'Other OS',
    sizeNote: '~80MB',
    versionLabel: 'Version',
    bullet1: '⚡ Native performance for large assemblies',
    bullet2: '📶 Offline (sketch / extrude / export)',
    bullet3: '🔄 Auto-update',
  },
} as const;

const PLATFORM_LABEL: Record<DesktopPlatform, { ko: string; en: string }> = {
  windows: { ko: 'Windows', en: 'Windows' },
  macos:   { ko: 'macOS',   en: 'macOS' },
  linux:   { ko: 'Linux',   en: 'Linux' },
  unknown: { ko: '데스크톱', en: 'Desktop' },
};

const PLATFORM_EXT: Record<DesktopPlatform, string> = {
  windows: '.exe',
  macos:   '.dmg',
  linux:   '.AppImage',
  unknown: '',
};

function downloadUrlFor(p: DesktopPlatform): string {
  const envMap: Record<DesktopPlatform, string | undefined> = {
    windows: process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_WINDOWS,
    macos:   process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_MACOS,
    linux:   process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_LINUX,
    unknown: undefined,
  };
  return envMap[p] || '#'; // empty placeholder if not configured yet
}

export default function DesktopDownloadCard({
  lang, forcePlatform,
}: DesktopDownloadCardProps) {
  const [platform, setPlatform] = useState<DesktopPlatform>(forcePlatform ?? 'unknown');

  useEffect(() => {
    if (!forcePlatform) setPlatform(detectPlatform());
  }, [forcePlatform]);

  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const platformLabel = PLATFORM_LABEL[platform === 'unknown' ? 'windows' : platform];
  const primaryPlatform = platform === 'unknown' ? 'windows' : platform;
  const primaryUrl = downloadUrlFor(primaryPlatform);
  const version = process.env.NEXT_PUBLIC_DESKTOP_VERSION || '0.1.0';

  const otherPlatforms: DesktopPlatform[] = (['windows', 'macos', 'linux'] as const)
    .filter(p => p !== primaryPlatform);

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, var(--nx-panel-2) 0%, var(--nx-panel) 100%)',
        color: 'var(--nx-text)',
        borderRadius: 12,
        padding: '24px 22px',
        maxWidth: 480,
        boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{t.headline}</h3>
        <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {t.versionLabel} {version} · {t.sizeNote}
        </span>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--nx-text-2)', lineHeight: 1.55 }}>
        {t.sub}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', fontSize: 12.5, lineHeight: 1.7, color: 'var(--nx-text-2)' }}>
        <li>{t.bullet1}</li>
        <li>{t.bullet2}</li>
        <li>{t.bullet3}</li>
      </ul>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <a
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#3b82f6',
            color: 'white',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span aria-hidden>⬇</span>
          {t.download} · {platformLabel[ko ? 'ko' : 'en']} {PLATFORM_EXT[primaryPlatform]}
        </a>
        <details style={{ position: 'relative', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--nx-text-2)', listStyle: 'none' }}>
            {t.other} ▾
          </summary>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {otherPlatforms.map(p => (
              <a
                key={p}
                href={downloadUrlFor(p)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: 'var(--nx-panel-2)',
                  border: '1px solid var(--nx-border)',
                  color: 'var(--nx-text-2)',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  textDecoration: 'none',
                }}
              >
                {PLATFORM_LABEL[p][ko ? 'ko' : 'en']} {PLATFORM_EXT[p]}
              </a>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
