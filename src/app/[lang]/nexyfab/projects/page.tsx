'use client';

import Link from 'next/link';
import { use, useEffect, useState, useCallback } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/hooks/useToast';
import { toIsoLang } from '@/lib/i18n/normalize';
import { formatDate } from '@/lib/i18n/format';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useAuthStore } from '@/hooks/useAuth';

const NEXYCAD_HANDOFF_ENABLED = process.env.NEXT_PUBLIC_NEXYCAD_HANDOFF_ENABLED === '1';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NexyfabProject {
  id: string;
  name: string;
  thumbnail?: string;
  shapeId?: string;
  materialId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

type SortKey = 'date' | 'name' | 'material';
type TabKey = 'active' | 'archived';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number, lang: string) {
  return formatDate(ts, toIsoLang(lang), { year: 'numeric', month: 'short', day: 'numeric' }) ?? '';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const copy = useCallback(
    (ko: string, en: string) => createCommercialLocalizer(lang)(ko, en),
    [lang],
  );
  const toast = useToast();
  const { user, refreshPlan } = useAuthStore();
  // plan 캐시 stale 방지(감사 2026-07-16) — 결제 직후에도 이 페이지가 최신 플랜을 보게
  useEffect(() => { void refreshPlan().catch(() => {}); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isFreePlan = !user?.plan || user.plan === 'free';
  // "공유된 항목" nav links here with ?filter=shared. Project-level sharing has
  // no backend yet (the projects API is owner-scoped), so we show an honest
  // "nothing shared with you yet" state rather than mislabeling owned projects
  // as shared. Read from window (not useSearchParams) to avoid a Suspense
  // build requirement. (2026-06-09 follow-up #2)
  const [sharedView, setSharedView] = useState(false);
  useEffect(() => {
    try { setSharedView(new URLSearchParams(window.location.search).get('filter') === 'shared'); } catch { /* ignore */ }
  }, []);

  const [projects, setProjects] = useState<NexyfabProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [tab, setTab] = useState<TabKey>('active');
  const [sort, setSort] = useState<SortKey>('date');
  const [search, setSearch] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NexyfabProject | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [launchingNexyCadId, setLaunchingNexyCadId] = useState<string | null>(null);

  const FREE_LIMIT = 1;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Guests have no server-side projects — the API 401s, which previously
    // surfaced as a red "Failed to load" error. Show a friendly sign-in nudge
    // instead. (2026-06-09)
    if (!user) {
      setProjects([]);
      setTotal(0);
      setError('GUEST');
      setLoading(false);
      return;
    }
    if (sharedView) {
      // Projects shared WITH me (nf_project_members ACL). Empty → honest
      // "nothing shared yet" state. (2026-06-09 P2)
      try {
        const r = await fetch('/api/nexyfab/projects?shared=true');
        if (!r.ok) throw new Error('Failed to load');
        const data = await r.json() as { projects: NexyfabProject[]; pagination: { total: number } };
        const list = data.projects ?? [];
        setProjects(list);
        setTotal(data.pagination?.total ?? 0);
        setError(list.length === 0 ? 'SHARED_EMPTY' : null);
      } catch {
        setError('SHARED_EMPTY');
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const url = tab === 'archived'
        ? '/api/nexyfab/projects?archived=true'
        : '/api/nexyfab/projects';
      const r = await fetch(url);
      if (!r.ok) throw new Error('Failed to load');
      const data = await r.json() as { projects: NexyfabProject[]; pagination: { total: number } };
      setProjects(data.projects ?? []);
      setTotal(data.pagination?.total ?? 0);
    } catch {
      setError('LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [tab, user, sharedView]);

  useEffect(() => {
    loadProjects();
    setSearch('');
    setMaterialFilter('');
    setTagFilter('');
  }, [loadProjects]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const requestDelete = useCallback((project: NexyfabProject) => {
    setPendingDelete(project);
  }, []);

  const confirmDelete = useCallback(async () => {
    const project = pendingDelete;
    if (!project) return;
    setDeletingId(project.id);
    try {
      const r = await fetch(`/api/nexyfab/projects/${project.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      setProjects(prev => prev.filter(p => p.id !== project.id));
      setTotal(t => Math.max(0, t - 1));
      toast.success(copy('프로젝트가 삭제되었습니다.', 'Project deleted.'));
      setPendingDelete(null);
    } catch {
      toast.error(copy('삭제에 실패했습니다.', 'Failed to delete project.'));
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, toast, copy]);

  // ── Archive / Unarchive ────────────────────────────────────────────────────
  const toggleArchive = useCallback(async (project: NexyfabProject) => {
    const archiving = !project.archivedAt;
    setArchivingId(project.id);
    try {
      const r = await fetch(`/api/nexyfab/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: archiving }),
      });
      // Free plan limit reached on unarchive — surface as actionable upgrade
      // toast instead of generic failure (Round 28 ergonomics).
      if (r.status === 403) {
        const errBody = await r.json().catch(() => ({} as { code?: string; error?: string }));
        if (errBody.code === 'FREE_PROJECT_LIMIT') {
          toast.warning(
            copy(
              '활성 프로젝트가 1개 한도를 채웠습니다. 복원하려면 Pro로 업그레이드하거나 다른 프로젝트를 보관하세요.',
              'You already have 1 active project. Upgrade to Pro or archive another to restore this one.',
            ),
          );
          return;
        }
      }
      if (!r.ok) throw new Error('Failed');
      setProjects(prev => prev.filter(p => p.id !== project.id));
      setTotal(t => Math.max(0, t - 1));
      toast.success(
        archiving
          ? copy('보관함으로 이동했습니다.', 'Moved to archive.')
          : copy('활성 프로젝트로 복원했습니다.', 'Restored to active.'),
      );
    } catch {
      toast.error(copy('작업에 실패했습니다.', 'Action failed.'));
    } finally {
      setArchivingId(null);
    }
  }, [toast, copy]);

  const launchNexyCad = useCallback(async (project: NexyfabProject) => {
    setLaunchingNexyCadId(project.id);
    try {
      const response = await fetch('/api/integrations/nexycad/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const payload = await response.json().catch(() => null) as { launchUrl?: string; code?: string } | null;
      if (!response.ok || !payload?.launchUrl) throw new Error(payload?.code || 'NEXYCAD_HANDOFF_FAILED');
      window.location.assign(payload.launchUrl);
    } catch (error) {
      console.error('[projects] NEXYCAD launch failed:', error instanceof Error ? error.message : String(error));
      toast.error(copy('기계 CAD를 열 수 없습니다. 잠시 후 다시 시도해 주세요.', 'Mechanical CAD could not be opened. Try again shortly.'));
    } finally {
      setLaunchingNexyCadId(null);
    }
  }, [toast, copy]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const allMaterials = Array.from(new Set(projects.map(p => p.materialId).filter((m): m is string => !!m)));
  const allTags = Array.from(new Set(projects.flatMap(p => p.tags ?? [])));

  const filtered = projects
    .filter(p => search.trim() === '' || p.name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => materialFilter === '' || p.materialId === materialFilter)
    .filter(p => tagFilter === '' || (p.tags ?? []).includes(tagFilter))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'material') return (a.materialId ?? '').localeCompare(b.materialId ?? '');
      return b.updatedAt - a.updatedAt;
    });

  const showPlanBanner = tab === 'active' && !loading && total >= FREE_LIMIT && isFreePlan;

  const selectStyle: React.CSSProperties = {
    padding: '8px 10px', minHeight: 36, borderRadius: 7, fontSize: 12,
    background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
    color: 'var(--nx-text)', outline: 'none', cursor: 'pointer',
    minWidth: 0, flex: '1 1 110px',
  };

  return (
    <div style={{
      // No minHeight:100vh — the nexyfab layout's <main> already owns the
      // viewport height + scroll; forcing 100vh here stacked on top of the
      // footer and created extra space. (2026-06-09)
      minHeight: '100%', background: 'var(--nx-bg)', color: 'var(--nx-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)', padding: '16px clamp(16px, 4vw, 32px)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        position: 'sticky', top: 0, background: 'var(--nx-bg)', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--nx-text)' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#0b5cff' }}>Fab</span>
        </Link>
        <span style={{ color: 'var(--nx-border)' }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {copy('내 프로젝트', 'My Projects')}
        </span>
        {/* 내 것 | 공유됨 탭 — 구 사이드바 '공유된 항목'의 새 집(2026-07-16 IA) */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          <button
            type="button"
            onClick={() => { setSharedView(false); try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ } }}
            style={{
              padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${!sharedView ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              background: !sharedView ? 'var(--nx-accent-soft, rgba(37,99,235,0.12))' : 'transparent',
              color: !sharedView ? 'var(--nx-accent)' : 'var(--nx-text-2)',
            }}
          >
            {copy('내 것', 'Mine')}
          </button>
          <button
            type="button"
            onClick={() => { setSharedView(true); try { window.history.replaceState(null, '', '?filter=shared'); } catch { /* ignore */ } }}
            style={{
              padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${sharedView ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              background: sharedView ? 'var(--nx-accent-soft, rgba(37,99,235,0.12))' : 'transparent',
              color: sharedView ? 'var(--nx-accent)' : 'var(--nx-text-2)',
            }}
          >
            🔗 {copy('공유됨', 'Shared')}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'active' && (
          isFreePlan && total >= FREE_LIMIT ? (
            <a
              href={`/${lang}/nexyfab/billing`}
              style={{
                padding: '8px 16px', borderRadius: 8, background: '#f0883e',
                color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              ⬆ {copy('Pro 업그레이드', 'Upgrade to Pro')}
            </a>
          ) : (
            <Link
              prefetch
              href={`/${lang}/shape-generator`}
              style={{
                padding: '8px 16px', borderRadius: 8, background: 'var(--nx-accent)',
                color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              + {copy('새 프로젝트', 'New Project')}
            </Link>
          )
        )}
      </div>

      <div style={{
        maxWidth: 1100, margin: '0 auto',
        padding: 'clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px)',
      }}>

        {/* ── Plan limit banner ── */}
        {showPlanBanner && (
          <div style={{
            background: '#f0883e18', border: '1px solid #f0883e44',
            borderRadius: 8, padding: '10px 16px',
            marginBottom: 16, fontSize: 13, color: '#f0883e',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>
              {copy(
                '무료 플랜은 활성 프로젝트 {{0}}개까지 허용됩니다. 현재 {{1}}개 사용 중 — 더 만들려면 Pro로 업그레이드하세요.',
                'Free plan allows {{0}} active projects. You have {{1}} — upgrade to Pro for unlimited.',
              ).replace('{{0}}', String(FREE_LIMIT)).replace('{{1}}', String(total))}
            </span>
            <a href={`/${lang}/nexyfab/billing`} style={{
              padding: '4px 12px', borderRadius: 6, background: '#f0883e',
              color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              {copy('Pro 업그레이드', 'Upgrade to Pro')}
            </a>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--nx-panel-2)', paddingBottom: 0 }}>
          {(['active', 'archived'] as TabKey[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0',
              background: tab === t ? 'var(--nx-panel)' : 'transparent',
              border: tab === t ? '1px solid var(--nx-border)' : '1px solid transparent',
              borderBottom: tab === t ? '1px solid var(--nx-panel)' : '1px solid transparent',
              marginBottom: tab === t ? -1 : 0,
              color: tab === t ? 'var(--nx-text)' : 'var(--nx-text-2)',
              fontSize: 13, fontWeight: tab === t ? 700 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {t === 'active' ? copy('활성', 'Active') : copy('보관함', 'Archived')}
            </button>
          ))}
        </div>

        {/* ── Filter / Sort bar ── */}
        {!loading && projects.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={copy('이름 검색...', 'Search by name...')}
              style={{
                ...selectStyle,
                minWidth: 0, flex: '1 1 120px', maxWidth: 260,
              }}
            />
            {allMaterials.length > 0 && (
              <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)} style={selectStyle}>
                <option value="">{copy('재료 전체', 'All materials')}</option>
                {allMaterials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {allTags.length > 0 && (
              <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={selectStyle}>
                <option value="">{copy('태그 전체', 'All tags')}</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
              <option value="date">{copy('최근 수정순', 'Recently updated')}</option>
              <option value="name">{copy('이름순', 'Name A→Z')}</option>
              <option value="material">{copy('재료순', 'Material A→Z')}</option>
            </select>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--nx-text-3)' }}>
            <div style={{
              width: 40, height: 40, border: '3px solid var(--nx-border)',
              borderTopColor: 'var(--nx-accent)', borderRadius: '50%',
              animation: 'spin 0.9s linear infinite', margin: '0 auto 16px',
            }} />
            {copy('불러오는 중...', 'Loading...')}
          </div>
        )}

        {/* ── Error (real load failure only) ── */}
        {error && error !== 'GUEST' && error !== 'SHARED_EMPTY' && (
          <div style={{
            background: '#da363322', border: '1px solid #da363355',
            borderRadius: 8, padding: '14px 16px', color: 'var(--nx-error)', fontSize: 13, marginBottom: 16,
          }}>
            {error === 'LOAD_FAILED' ? copy('프로젝트를 불러오지 못했습니다.', 'Failed to load projects.') : error}
            <button
              onClick={loadProjects}
              style={{
                marginLeft: 12, fontSize: 12, color: 'var(--nx-accent)', background: 'none',
                border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {copy('다시 시도', 'Retry')}
            </button>
          </div>
        )}

        {/* ── Shared-with-me empty state (no project-share backend yet) ── */}
        {error === 'SHARED_EMPTY' && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔗</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--nx-text)', margin: '0 0 8px' }}>
              {copy('아직 공유받은 프로젝트가 없습니다.', 'Nothing shared with you yet.')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: '0 0 24px' }}>
              {copy(
                '다른 사용자가 프로젝트를 공유하면 여기에 표시됩니다. 팀 공유 기능은 준비 중입니다.',
                'Projects others share with you will appear here. Team sharing is coming soon.',
              )}
            </p>
            <Link
              prefetch
              href={`/${lang}/nexyfab/projects`}
              style={{
                display: 'inline-block', padding: '10px 20px', borderRadius: 8,
                background: 'var(--nx-panel-2, var(--nx-panel-2))', border: '1px solid var(--nx-border)',
                color: 'var(--nx-text)', fontSize: 13, fontWeight: 600, textDecoration: 'none',
              }}
            >
              {copy('내 프로젝트 보기', 'View my projects')}
            </Link>
          </div>
        )}

        {/* ── Guest sign-in nudge (no red error) ── */}
        {error === 'GUEST' && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--nx-text)', margin: '0 0 8px' }}>
              {copy('로그인하면 저장한 프로젝트가 여기에 표시됩니다.', 'Sign in to see your saved projects here.')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: '0 0 24px' }}>
              {copy(
                '게스트 작업은 이 브라우저에만 저장됩니다. 로그인하면 클라우드에 영구 저장돼요.',
                'Guest work stays in this browser only — sign in to save it to the cloud.',
              )}
            </p>
            <Link
              prefetch
              href={`/${lang}/shape-generator`}
              style={{
                display: 'inline-block', padding: '10px 20px', borderRadius: 8,
                background: 'linear-gradient(135deg, var(--nx-accent), #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              {copy('3D 설계 시작 →', 'Start designing →')}
            </Link>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && projects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{tab === 'archived' ? '🗃️' : '📐'}</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--nx-text)', margin: '0 0 8px' }}>
              {tab === 'archived'
                ? copy('보관된 프로젝트가 없습니다.', 'No archived projects.')
                : copy('아직 저장된 프로젝트가 없습니다.', 'No saved projects yet.')}
            </p>
            {tab === 'active' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: '0 0 24px' }}>
                  {copy('3D 형상을 설계하고 프로젝트로 저장해 보세요.', 'Design a 3D shape and save it as a project.')}
                </p>
                <Link
                  prefetch
                  href={`/${lang}/shape-generator`}
                  style={{
                    display: 'inline-block', padding: '10px 24px', borderRadius: 8,
                    background: 'var(--nx-accent)', color: '#fff', fontWeight: 700,
                    fontSize: 14, textDecoration: 'none',
                  }}
                >
                  {copy('형상 설계 시작', 'Start Designing')}
                </Link>
              </>
            )}
          </div>
        )}

        {/* ── No filter results ── */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--nx-text-2)' }}>
            {copy('검색 결과가 없습니다.', 'No matching projects.')}
          </div>
        )}

        {/* ── Project Grid ── */}
        {!loading && !error && filtered.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))',
            gap: 'clamp(12px, 2.5vw, 20px)',
          }}>
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                lang={lang}
                tab={tab}
                isDeleting={deletingId === project.id}
                isArchiving={archivingId === project.id}
                isLaunchingNexyCad={launchingNexyCadId === project.id}
                onDelete={requestDelete}
                onToggleArchive={toggleArchive}
                onLaunchNexyCad={launchNexyCad}
                canManage={!sharedView}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        title={copy('프로젝트 삭제', 'Delete project')}
        message={
          pendingDelete
            ? copy(
                '"{{0}}" 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
                'Delete "{{0}}"? This cannot be undone.',
              ).replace('{{0}}', pendingDelete.name)
            : ''
        }
        confirmLabel={copy('삭제', 'Delete')}
        cancelLabel={copy('취소', 'Cancel')}
        destructive
        busy={deletingId !== null}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
      />
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, lang, tab, isDeleting, isArchiving, isLaunchingNexyCad, onDelete, onToggleArchive, onLaunchNexyCad, canManage = true,
}: {
  project: NexyfabProject;
  lang: string;
  tab: TabKey;
  isDeleting: boolean;
  isArchiving: boolean;
  isLaunchingNexyCad: boolean;
  onDelete: (p: NexyfabProject) => void;
  onToggleArchive: (p: NexyfabProject) => void;
  onLaunchNexyCad: (p: NexyfabProject) => void;
  /** Owner-only actions (archive/delete) — hidden for shared (non-owner) cards. */
  canManage?: boolean;
}) {
  const busy = isDeleting || isArchiving || isLaunchingNexyCad;
  const copy = (ko: string, en: string) => createCommercialLocalizer(lang)(ko, en);

  return (
    <div style={{
      background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
      borderRadius: 12, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--nx-accent-line)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--nx-border)')}
    >
      {/* Thumbnail */}
      <div style={{
        width: '100%', height: 160,
        background: 'var(--nx-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        opacity: tab === 'archived' ? 0.6 : 1,
      }}>
        {project.thumbnail ? (
          <img
            src={project.thumbnail}
            alt={project.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 40, opacity: 0.4 }}>📐</span>
          </div>
        )}
        {tab === 'archived' && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'var(--nx-panel-2)', borderRadius: 6, padding: '2px 8px',
            fontSize: 10, color: 'var(--nx-text-2)',
          }}>
            {copy('보관됨', 'Archived')}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--nx-text)',
          marginBottom: 6, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </div>

        {project.materialId && (
          <span style={{
            display: 'inline-block', fontSize: 10, padding: '2px 8px',
            borderRadius: 10, background: 'var(--nx-accent-soft)', color: 'var(--nx-accent-2)',
            border: '1px solid var(--nx-accent-line)', marginBottom: 6,
          }}>
            {project.materialId}
          </span>
        )}

        {project.tags && project.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {project.tags.slice(0, 4).map(tag => (
              <span key={tag} style={{
                fontSize: 10, padding: '2px 7px',
                borderRadius: 10, background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 14 }}>
              {copy('수정', 'Updated')}: {fmtDate(project.updatedAt, lang)}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tab === 'active' && (
            <Link
              prefetch
              href={`/${lang}/nexyfab/ai?projectId=${encodeURIComponent(project.id)}&new=1`}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7,
                background: '#1f6feb22', color: '#58a6ff',
                border: '1px solid #388bfd66',
                fontSize: 12, fontWeight: 700, textDecoration: 'none',
                textAlign: 'center', minWidth: 88,
              }}
            >
              {copy('AI 설계', 'AI Design')}
            </Link>
          )}
          {tab === 'active' && NEXYCAD_HANDOFF_ENABLED && (
            <button
              type="button"
              onClick={() => onLaunchNexyCad(project)}
              disabled={busy}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7,
                background: 'var(--nx-accent)', color: '#fff',
                border: '1px solid var(--nx-accent)',
                fontSize: 12, fontWeight: 700,
                textAlign: 'center', minWidth: 88,
                cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1,
              }}
            >
              {isLaunchingNexyCad ? '...' : copy('기계 CAD', 'Mechanical CAD')}
            </button>
          )}
          {tab === 'active' && (
            <Link
              prefetch
              href={`/${lang}/shape-generator?project=${project.id}`}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7,
                background: 'var(--nx-accent-soft)', color: 'var(--nx-accent)',
                border: '1px solid var(--nx-accent-line)',
                fontSize: 12, fontWeight: 700, textDecoration: 'none',
                textAlign: 'center', minWidth: 48,
              }}
            >
              {copy('열기', 'Open')}
            </Link>
          )}
          {canManage && (
            <button
              onClick={() => onToggleArchive(project)}
              disabled={busy}
              style={{
                padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: 'transparent',
                color: isArchiving ? 'var(--nx-text-3)' : 'var(--nx-text-2)',
                border: '1px solid var(--nx-border)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.55 : 1,
                transition: 'all 0.15s',
              }}
            >
              {isArchiving ? '...' : (tab === 'archived' ? copy('복원', 'Restore') : copy('보관', 'Archive'))}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => onDelete(project)}
              disabled={busy}
              aria-busy={isDeleting}
              style={{
                padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: isDeleting ? 'var(--nx-panel-2)' : 'transparent',
                color: isDeleting ? 'var(--nx-text-3)' : 'var(--nx-error)',
                border: '1px solid #da363344',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.55 : 1,
                transition: 'all 0.15s',
              }}
            >
              {isDeleting ? '...' : copy('삭제', 'Delete')}
            </button>
          )}
          {!canManage && (
            <span style={{ padding: '7px 10px', fontSize: 11, color: 'var(--nx-text-3)' }}>
              {copy('공유받음', 'Shared')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
