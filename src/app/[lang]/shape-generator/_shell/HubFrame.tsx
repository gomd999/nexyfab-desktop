'use client';

// Generates a deterministic isometric cube SVG colored by the project name,
// so each tile feels unique without needing a real 3D render. Uses thumbnail
// data URL when available.
function ProjectThumbnail({ name, thumbnail }: { name: string; thumbnail?: string }) {
  if (thumbnail) {
    return (
      <div
        style={{
          height: 100,
          background: `url(${thumbnail}) center/cover`,
          borderBottom: '1px solid var(--nx-border)',
        }}
      />
    );
  }
  // Seed two accent colors from the name hash.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const PALETTE = [
    ['#22e0c8', '#0a8074'],
    ['#5e9eff', '#1a3a8a'],
    ['#ff9b3d', '#7a3e0f'],
    ['#a87bff', '#3e1f72'],
    ['#ffd24d', '#7a5500'],
    ['#ff6b9b', '#7a1f3e'],
    ['#5eead4', '#0a8074'],
  ];
  const [top, side] = PALETTE[Math.abs(h) % PALETTE.length];
  const initials = name
    .split(/\s|[-_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      style={{
        height: 100,
        background:
          'radial-gradient(ellipse at center, var(--nx-viewport-bg-top), var(--nx-viewport-bg-bot))',
        position: 'relative',
        borderBottom: '1px solid var(--nx-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <svg width="72" height="72" viewBox="0 0 100 100" aria-hidden="true">
        {/* isometric cube */}
        <polygon points="50,20 80,35 50,50 20,35" fill={top} opacity="0.9" />
        <polygon points="20,35 50,50 50,82 20,67" fill={side} opacity="0.8" />
        <polygon points="80,35 50,50 50,82 80,67" fill={side} opacity="0.6" />
        <polygon
          points="50,20 80,35 50,50 20,35"
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="0.6"
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          fontSize: 14,
          fontWeight: 800,
          color: 'rgba(255,255,255,0.92)',
          letterSpacing: '0.04em',
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {initials || '?'}
      </span>
    </div>
  );
}

// Hub view (Phase 2) — shell-v2 styled landing screen for /[lang]/nexyfab/hub.
// Renders sidebar + main grid using shape-generator design tokens.
// Reads existing useAuthStore / useProjectsStore data — no new fetch logic.
// "New Design" and project cards route into /shape-generator (the real 3D modeler).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { useProjectsStore } from '@/hooks/useProjects';
import { useTheme } from '../ThemeContext';
import { I, type IconName } from './Icons';

interface HubFrameProps {
  lang: string;
  isKo: boolean;
  onShowAuth?: () => void;
}

interface NavItem {
  id: string;
  lbl: string;
  ico: IconName;
  href?: string;
  badge?: string;
  disabled?: boolean;
  comingSoon?: boolean;
}

interface QuickStart {
  ico: IconName;
  lbl: string;
  lblKo: string;
  sub: string;
  subKo: string;
  href: string;
}

export function HubFrame({ lang, isKo, onShowAuth }: HubFrameProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { projects, isLoading, saveProject } = useProjectsStore();
  const { mode: themeMode, toggleTheme } = useTheme();
  const plan = user?.plan ?? 'free';
  const [searchQuery, setSearchQuery] = useState('');

  const navItems: NavItem[] = [
    { id: 'recent', lbl: isKo ? '최근' : 'Recent', ico: 'history' },
    { id: 'projects', lbl: isKo ? '프로젝트' : 'Projects', ico: 'folder', href: `/${lang}/nexyfab/projects` },
    { id: 'shared', lbl: isKo ? '공유된 항목' : 'Shared with me', ico: 'share', href: `/${lang}/nexyfab/projects?filter=shared` },
    { id: 'branches', lbl: isKo ? '브랜치' : 'Branches', ico: 'branch', comingSoon: true },
    { id: 'ai', lbl: isKo ? 'Nexy AI 스튜디오' : 'Nexy AI Studio', ico: 'ai', badge: 'NEW', href: `/${lang}/shape-generator?mode=ai` },
    { id: 'library', lbl: isKo ? '부품 라이브러리' : 'Part Library', ico: 'cube', href: `/${lang}/nexyfab/cots` },
  ];

  const quickStarts: QuickStart[] = [
    {
      ico: 'cube',
      lbl: 'New Part',
      lblKo: '새 파트',
      sub: 'Solid · parametric',
      subKo: '솔리드 · 파라메트릭',
      href: `/${lang}/shape-generator`,
    },
    {
      ico: 'combine',
      lbl: 'New Assembly',
      lblKo: '새 어셈블리',
      sub: 'Mate components',
      subKo: '부품 결합',
      href: `/${lang}/shape-generator?mode=assembly`,
    },
    {
      ico: 'doc',
      lbl: 'New Drawing',
      lblKo: '새 도면',
      sub: 'From a part or assembly',
      subKo: '파트 또는 어셈블리에서',
      href: `/${lang}/shape-generator/drawing`,
    },
    {
      ico: 'sketch',
      lbl: 'From Sketch',
      lblKo: '스케치에서',
      sub: 'Import DXF / SVG',
      subKo: 'DXF / SVG 가져오기',
      href: `/${lang}/shape-generator?import=sketch`,
    },
  ];

  // Filtered projects driven by Hub search input.
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = projects ?? [];
    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  // Top 6 recent projects sorted by updatedAt (filtered by search query)
  const recentProjects = useMemo(
    () =>
      [...filteredProjects]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 6),
    [filteredProjects],
  );

  const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? '?';
  const userName = user?.name ?? user?.email ?? (isKo ? '게스트' : 'Guest');
  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free';

  // Guest quota: 1 free project per device. Stored separately from autosave
  // so we keep an integer count even if the user clears autosave slots.
  // On signup, the migration effect (see below) clears this so the user
  // re-enters as a fresh Free-plan account with their guest project carried over.
  const GUEST_QUOTA_KEY = 'nexyfab.guest.projectCount';
  const GUEST_MIGRATED_KEY = 'nexyfab.guest.migrated';
  const AUTOSAVE_META_KEY = 'nexyfab-autosave-meta';

  // Hub is a full-screen app surface. Add the body class so shell-v2 CSS
  // (data-shell-v2-hide elements, ops sidebar suppression, footer hiding)
  // applies — the parent /nexyfab/layout otherwise reserves space for its
  // footer, which produces a duplicate scrollbar on long Hub content.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('sg-shell-v2');
    return () => {
      document.body.classList.remove('sg-shell-v2');
    };
  }, []);

  // ── Guest → signed-in migration ────────────────────────────────────────────
  // When a guest authenticates, lift their most-recent localStorage autosave
  // slot into a real project under the new account so they can re-open it
  // from any device. Best-effort: silent on failure (autosave stays as
  // recovery fallback). Runs once per device per migration cycle.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(GUEST_MIGRATED_KEY) === '1') return;
      const guestCount = parseInt(localStorage.getItem(GUEST_QUOTA_KEY) ?? '0', 10) || 0;
      if (guestCount < 1) return;
      const metaRaw = localStorage.getItem(AUTOSAVE_META_KEY);
      if (!metaRaw) return;
      const meta = JSON.parse(metaRaw) as Array<{ key: string; timestamp: number; selectedId: string }>;
      if (!Array.isArray(meta) || meta.length === 0) return;
      const newest = [...meta].sort((a, b) => b.timestamp - a.timestamp)[0];
      const sceneRaw = localStorage.getItem(newest.key);
      if (!sceneRaw) return;
      const name = `${newest.selectedId || 'guest'} (${isKo ? '게스트 작업' : 'from guest mode'})`;
      saveProject({ name, shapeId: newest.selectedId || undefined, sceneData: sceneRaw }).then(p => {
        if (p) {
          localStorage.setItem(GUEST_MIGRATED_KEY, '1');
          localStorage.removeItem(GUEST_QUOTA_KEY);
        }
      });
    } catch {
      // localStorage blocked or malformed — silent fall-through.
    }
  }, [user, saveProject, isKo]);

  const handleNewDesign = () => {
    if (user) {
      router.push(`/${lang}/shape-generator`);
      return;
    }
    // Guest path: allow up to 1 project; force auth modal beyond that.
    let count = 0;
    try {
      count = parseInt(localStorage.getItem(GUEST_QUOTA_KEY) ?? '0', 10) || 0;
    } catch {
      // localStorage blocked — treat as fresh guest and let through.
    }
    if (count >= 1) {
      onShowAuth?.();
      return;
    }
    try {
      localStorage.setItem(GUEST_QUOTA_KEY, '1');
    } catch {
      /* ignore */
    }
    router.push(`/${lang}/shape-generator?guest=1`);
  };

  return (
    <div
      className="nx-app"
      style={{ flexDirection: 'row', minHeight: 0, height: '100%' }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          flex: '0 0 220px',
          background: 'var(--nx-panel)',
          borderRight: '1px solid var(--nx-border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            gap: 8,
            borderBottom: '1px solid var(--nx-border)',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: 'linear-gradient(135deg, var(--nx-accent), #1a3a8a)',
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 5,
                border: '1.5px solid #0a1518',
                borderRadius: 2,
                display: 'block',
              }}
            />
          </div>
          <span style={{ fontWeight: 600, letterSpacing: '0.02em', fontSize: 13 }}>
            NEXYFAB
          </span>
          <span className="nx-chip" style={{ marginLeft: 'auto', fontSize: 9 }}>
            v2
          </span>
        </div>

        <div style={{ padding: 10 }}>
          <button
            type="button"
            className="nx-pillbtn primary"
            onClick={handleNewDesign}
            style={{
              width: '100%',
              height: 34,
              justifyContent: 'center',
              fontSize: 12,
            }}
          >
            <I.plus size={14} /> {isKo ? '새 디자인' : 'New Design'}
          </button>
        </div>

        <nav
          style={{
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {navItems.map(item => {
            const Icon = I[item.ico] ?? I.cube;
            const isActive = item.id === 'recent';
            const disabled = item.comingSoon || item.disabled;
            const onClick = () => {
              if (disabled) return;
              if (item.href) router.push(item.href);
            };
            return (
              <button
                type="button"
                key={item.id}
                onClick={onClick}
                disabled={disabled}
                title={item.comingSoon ? (isKo ? '곧 출시' : 'Coming soon') : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 5,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  border: 'none',
                  textAlign: 'left',
                  background: isActive ? 'var(--nx-accent-soft)' : 'transparent',
                  color: isActive ? 'var(--nx-accent-2)' : 'var(--nx-text)',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <Icon size={14} /> <span style={{ flex: 1 }}>{item.lbl}</span>
                {item.comingSoon && (
                  <span
                    className="nx-chip"
                    style={{ fontSize: 9, color: 'var(--nx-text-3)' }}
                  >
                    {isKo ? '준비중' : 'Soon'}
                  </span>
                )}
                {item.badge && !item.comingSoon && (
                  <span
                    className="nx-chip"
                    style={{
                      fontSize: 9,
                      color: 'var(--nx-accent)',
                      borderColor: 'var(--nx-accent-line)',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid var(--nx-border)' }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--nx-text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '4px 4px 8px',
            }}
          >
            {isKo ? '저장 용량' : 'Storage'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>
            <span className="mono" style={{ color: 'var(--nx-text)' }}>
              {projects?.length ?? 0}
            </span>{' '}
            / {plan === 'free' ? '3' : '∞'} {isKo ? '프로젝트' : 'projects'}
          </div>
          <div
            style={{
              height: 4,
              background: 'var(--nx-panel-2)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(((projects?.length ?? 0) / 3) * 100, 100)}%`,
                height: '100%',
                background: 'var(--nx-accent)',
              }}
            />
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderTop: '1px solid var(--nx-border)',
          }}
        >
          <span
            className="av"
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'var(--nx-accent)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {userInitials}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--nx-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {userName}
            </div>
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
              {planLabel} · {isKo ? '플랜' : 'plan'}
            </div>
          </div>
          <I.cog size={14} />
        </div>
      </aside>

      {/* Main */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--nx-bg)',
        }}
      >
        {/* Top bar */}
        <div
          style={{
            height: 56,
            flex: '0 0 56px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            borderBottom: '1px solid var(--nx-border)',
            gap: 14,
            background: 'var(--nx-panel)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--nx-text)' }}>
            {isKo ? `다시 오신 것을 환영합니다, ${userName.split(' ')[0]}` : `Welcome back, ${userName.split(' ')[0]}`}
          </div>
          <span style={{ color: 'var(--nx-text-3)', fontSize: 12, marginLeft: 6 }}>
            {(projects?.length ?? 0)} {isKo ? '개 프로젝트' : 'projects'}
          </span>
          <div style={{ flex: 1 }} />
          <label className="nx-search" style={{ width: 320, cursor: 'text' }}>
            <I.search size={12} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isKo ? '파트·프로젝트·브랜치 검색…' : 'Search parts, projects, branches…'}
              style={{
                flex: 1,
                background: 'transparent',
                border: 0,
                outline: 0,
                color: 'var(--nx-text)',
                fontSize: 11,
                minWidth: 0,
              }}
            />
            {!searchQuery && <span className="kbd">⌘K</span>}
          </label>
          <button
            type="button"
            className="nx-pillbtn"
            style={{ height: 32, padding: '0 10px' }}
            onClick={toggleTheme}
            title={isKo ? '테마 전환' : 'Toggle theme'}
            aria-label={isKo ? '테마 전환' : 'Toggle theme'}
          >
            {themeMode === 'dark' ? <I.sun size={14} /> : <I.moon size={14} />}
          </button>
          <button
            type="button"
            className="nx-pillbtn"
            style={{ height: 32 }}
            onClick={() => router.push(`/${lang}/nexyfab/releases`)}
            title={isKo ? '릴리스 노트' : 'Release notes'}
          >
            <I.bolt size={14} /> {isKo ? '새 소식' : "What's new"}
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
          {/* AI hero */}
          <div
            style={{
              background: 'linear-gradient(120deg, #0e2424 0%, #112030 70%, #0e1218 100%)',
              border: '1px solid var(--nx-accent-line)',
              borderRadius: 10,
              padding: '20px 24px',
              marginBottom: 28,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: -40,
                top: -40,
                width: 240,
                height: 240,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(79,139,255,0.22), transparent 70%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <I.ai size={16} />
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--nx-accent)',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Nexy AI · {isKo ? '디자인 어시스트' : 'Design Assist'}
                </span>
              </div>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  margin: '0 0 8px',
                  letterSpacing: '-0.01em',
                  color: 'var(--nx-text)',
                }}
              >
                {isKo
                  ? '자연어로 설명하면 파라메트릭 모델을 즉시 생성합니다.'
                  : 'Describe a part in words — get a parametric 3D model instantly.'}
              </h2>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--nx-text-2)',
                  margin: '0 0 14px',
                  maxWidth: 580,
                  lineHeight: 1.55,
                }}
              >
                {isKo
                  ? 'Nexy AI 가 OpenSCAD 파이프라인으로 즉시 STL 출력까지 도와드립니다. 자동 DFM · 비용 추정 · 제조사 매칭 포함.'
                  : 'Nexy AI ships your idea straight to STL via OpenSCAD, with DFM, cost, and manufacturer matching baked in.'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="nx-pillbtn primary"
                  onClick={handleNewDesign}
                  style={{ height: 30, padding: '0 14px' }}
                >
                  {isKo ? 'AI 스튜디오 열기' : 'Open AI Studio'}
                </button>
                <button
                  type="button"
                  className="nx-pillbtn"
                  onClick={() => router.push(`/${lang}/how-it-works`)}
                  style={{ height: 30, padding: '0 14px' }}
                >
                  {isKo ? '튜토리얼 보기' : 'See tutorial'}
                </button>
              </div>
            </div>
          </div>

          {/* Quick start tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 32,
            }}
          >
            {quickStarts.map((t, i) => {
              const Icon = I[t.ico] ?? I.cube;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => router.push(t.href)}
                  style={{
                    background: 'var(--nx-panel)',
                    border: '1px solid var(--nx-border)',
                    borderRadius: 8,
                    padding: '16px 18px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    minHeight: 90,
                    textAlign: 'left',
                    color: 'var(--nx-text)',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: 'var(--nx-accent-soft)',
                      color: 'var(--nx-accent)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{isKo ? t.lblKo : t.lbl}</div>
                    <div style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
                      {isKo ? t.subKo : t.sub}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Recently opened */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  margin: 0,
                  letterSpacing: '0.02em',
                  color: 'var(--nx-text)',
                }}
              >
                {isKo ? '최근 열어본 항목' : 'Recently opened'}
              </h3>
              <span style={{ color: 'var(--nx-text-3)', fontSize: 11, marginLeft: 8 }}>
                {isKo ? '모든 프로젝트' : 'Across all projects'}
              </span>
              <span style={{ flex: 1 }} />
              <a
                href={`/${lang}/nexyfab/projects`}
                className="nx-link"
                style={{ fontSize: 11 }}
              >
                {isKo ? '모두 보기 →' : 'View all →'}
              </a>
            </div>

            {recentProjects.length === 0 && !isLoading ? (
              <div
                style={{
                  background: 'var(--nx-panel)',
                  border: '1px dashed var(--nx-border)',
                  borderRadius: 8,
                  padding: '40px 24px',
                  textAlign: 'center',
                  color: 'var(--nx-text-3)',
                  fontSize: 12,
                }}
              >
                {isKo
                  ? '아직 프로젝트가 없습니다. "새 디자인"을 눌러 시작해보세요.'
                  : 'No projects yet. Click "New Design" to start.'}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: 12,
                }}
              >
                {recentProjects.map(p => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => router.push(`/${lang}/shape-generator?project=${p.id}`)}
                    style={{
                      background: 'var(--nx-panel)',
                      border: '1px solid var(--nx-border)',
                      borderRadius: 6,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      padding: 0,
                      textAlign: 'left',
                      color: 'var(--nx-text)',
                    }}
                  >
                    <ProjectThumbnail name={p.name} thumbnail={p.thumbnail} />
                    {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
                    <div style={{ padding: '8px 10px' }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 10, color: 'var(--nx-text-3)', marginTop: 2 }}
                      >
                        {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Projects table */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  margin: 0,
                  letterSpacing: '0.02em',
                  color: 'var(--nx-text)',
                }}
              >
                {isKo ? '모든 프로젝트' : 'All projects'}
              </h3>
              <span style={{ flex: 1 }} />
              <a
                href={`/${lang}/nexyfab/dashboard`}
                className="nx-link"
                style={{ fontSize: 11 }}
              >
                {isKo ? '운영 대시보드 (주문·견적·정산) →' : 'Ops dashboard (orders · RFQ · settlements) →'}
              </a>
            </div>

            <div
              style={{
                background: 'var(--nx-panel)',
                border: '1px solid var(--nx-border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  color: 'var(--nx-text)',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: 'var(--nx-panel-2)',
                      borderBottom: '1px solid var(--nx-border)',
                    }}
                  >
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 14px',
                        fontWeight: 600,
                        fontSize: 11,
                        color: 'var(--nx-text-2)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {isKo ? '이름' : 'Name'}
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 14px',
                        fontWeight: 600,
                        fontSize: 11,
                        color: 'var(--nx-text-2)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {isKo ? '유형' : 'Type'}
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 14px',
                        fontWeight: 600,
                        fontSize: 11,
                        color: 'var(--nx-text-2)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {isKo ? '수정일' : 'Updated'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        style={{
                          padding: '24px',
                          textAlign: 'center',
                          color: 'var(--nx-text-3)',
                        }}
                      >
                        {isLoading
                          ? isKo
                            ? '불러오는 중…'
                            : 'Loading…'
                          : searchQuery
                            ? isKo
                              ? `'${searchQuery}' 에 해당하는 프로젝트가 없습니다.`
                              : `No projects match '${searchQuery}'.`
                            : isKo
                              ? '아직 프로젝트가 없습니다.'
                              : 'No projects yet.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProjects.slice(0, 20).map(p => (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: '1px solid var(--nx-border)',
                          cursor: 'pointer',
                        }}
                        onClick={() =>
                          router.push(`/${lang}/shape-generator?project=${p.id}`)
                        }
                      >
                        <td
                          style={{
                            padding: '10px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <I.cube size={14} />
                          <span style={{ fontWeight: 500 }}>{p.name}</span>
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--nx-text-2)' }}>
                          {p.shapeId ?? 'Part'}
                        </td>
                        <td
                          className="mono"
                          style={{ padding: '10px 14px', color: 'var(--nx-text-3)' }}
                        >
                          {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
