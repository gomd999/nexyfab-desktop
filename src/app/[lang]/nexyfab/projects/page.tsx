'use client';

import Link from 'next/link';
import { use, useEffect, useState, useCallback } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/hooks/useToast';
import { isKorean } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';

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

function fmtDate(ts: number, isKo: boolean) {
  return new Date(ts).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const toast = useToast();
  const { user } = useAuthStore();
  const isFreePlan = !user?.plan || user.plan === 'free';

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

  const FREE_LIMIT = 1;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
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
  }, [tab]);

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
      toast.success(isKo ? '프로젝트가 삭제되었습니다.' : 'Project deleted.');
      setPendingDelete(null);
    } catch {
      toast.error(isKo ? '삭제에 실패했습니다.' : 'Failed to delete project.');
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, toast]);

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
      if (!r.ok) throw new Error('Failed');
      setProjects(prev => prev.filter(p => p.id !== project.id));
      setTotal(t => Math.max(0, t - 1));
      toast.success(
        archiving
          ? (isKo ? '보관함으로 이동했습니다.' : 'Moved to archive.')
          : (isKo ? '활성 프로젝트로 복원했습니다.' : 'Restored to active.'),
      );
    } catch {
      toast.error(isKo ? '작업에 실패했습니다.' : 'Action failed.');
    } finally {
      setArchivingId(null);
    }
  }, [toast]);

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
    background: '#161b22', border: '1px solid #30363d',
    color: '#e6edf3', outline: 'none', cursor: 'pointer',
    minWidth: 0, flex: '1 1 110px',
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '16px clamp(16px, 4vw, 32px)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        position: 'sticky', top: 0, background: '#0d1117', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>Fab</span>
        </Link>
        <span style={{ color: '#30363d' }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {isKo ? '내 프로젝트' : 'My Projects'}
        </span>
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
              ⬆ {isKo ? 'Pro 업그레이드' : 'Upgrade to Pro'}
            </a>
          ) : (
            <Link
              prefetch
              href={`/${lang}/shape-generator`}
              style={{
                padding: '8px 16px', borderRadius: 8, background: '#388bfd',
                color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              + {isKo ? '새 프로젝트' : 'New Project'}
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
              {isKo
                ? `무료 플랜은 활성 프로젝트 ${FREE_LIMIT}개까지 허용됩니다. 현재 ${total}개 사용 중 — 더 만들려면 Pro로 업그레이드하세요.`
                : `Free plan allows ${FREE_LIMIT} active projects. You have ${total} — upgrade to Pro for unlimited.`}
            </span>
            <a href={`/${lang}/nexyfab/billing`} style={{
              padding: '4px 12px', borderRadius: 6, background: '#f0883e',
              color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              {isKo ? 'Pro 업그레이드' : 'Upgrade to Pro'}
            </a>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #21262d', paddingBottom: 0 }}>
          {(['active', 'archived'] as TabKey[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0',
              background: tab === t ? '#161b22' : 'transparent',
              border: tab === t ? '1px solid #30363d' : '1px solid transparent',
              borderBottom: tab === t ? '1px solid #161b22' : '1px solid transparent',
              marginBottom: tab === t ? -1 : 0,
              color: tab === t ? '#e6edf3' : '#8b949e',
              fontSize: 13, fontWeight: tab === t ? 700 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {t === 'active' ? (isKo ? '활성' : 'Active') : (isKo ? '보관함' : 'Archived')}
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
              placeholder={isKo ? '이름 검색...' : 'Search by name...'}
              style={{
                ...selectStyle,
                minWidth: 0, flex: '1 1 120px', maxWidth: 260,
              }}
            />
            {allMaterials.length > 0 && (
              <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)} style={selectStyle}>
                <option value="">{isKo ? '재료 전체' : 'All materials'}</option>
                {allMaterials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {allTags.length > 0 && (
              <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={selectStyle}>
                <option value="">{isKo ? '태그 전체' : 'All tags'}</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
              <option value="date">{isKo ? '최근 수정순' : 'Recently updated'}</option>
              <option value="name">{isKo ? '이름순' : 'Name A→Z'}</option>
              <option value="material">{isKo ? '재료순' : 'Material A→Z'}</option>
            </select>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6e7681' }}>
            <div style={{
              width: 40, height: 40, border: '3px solid #30363d',
              borderTopColor: '#388bfd', borderRadius: '50%',
              animation: 'spin 0.9s linear infinite', margin: '0 auto 16px',
            }} />
            {isKo ? '불러오는 중...' : 'Loading...'}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{
            background: '#da363322', border: '1px solid #da363355',
            borderRadius: 8, padding: '14px 16px', color: '#f85149', fontSize: 13, marginBottom: 16,
          }}>
            {error === 'LOAD_FAILED' ? (isKo ? '프로젝트를 불러오지 못했습니다.' : 'Failed to load projects.') : error}
            <button
              onClick={loadProjects}
              style={{
                marginLeft: 12, fontSize: 12, color: '#388bfd', background: 'none',
                border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {isKo ? '다시 시도' : 'Retry'}
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && projects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{tab === 'archived' ? '🗃️' : '📐'}</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#e6edf3', margin: '0 0 8px' }}>
              {tab === 'archived'
                ? (isKo ? '보관된 프로젝트가 없습니다.' : 'No archived projects.')
                : (isKo ? '아직 저장된 프로젝트가 없습니다.' : 'No saved projects yet.')}
            </p>
            {tab === 'active' && (
              <>
                <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 24px' }}>
                  {isKo
                    ? '3D 형상을 설계하고 프로젝트로 저장해 보세요.'
                    : 'Design a 3D shape and save it as a project.'}
                </p>
                <Link
                  prefetch
                  href={`/${lang}/shape-generator`}
                  style={{
                    display: 'inline-block', padding: '10px 24px', borderRadius: 8,
                    background: '#388bfd', color: '#fff', fontWeight: 700,
                    fontSize: 14, textDecoration: 'none',
                  }}
                >
                  {isKo ? '형상 설계 시작' : 'Start Designing'}
                </Link>
              </>
            )}
          </div>
        )}

        {/* ── No filter results ── */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
            {isKo ? '검색 결과가 없습니다.' : 'No matching projects.'}
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
                isKo={isKo}
                tab={tab}
                isDeleting={deletingId === project.id}
                isArchiving={archivingId === project.id}
                onDelete={requestDelete}
                onToggleArchive={toggleArchive}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        title={isKo ? '프로젝트 삭제' : 'Delete project'}
        message={
          pendingDelete
            ? (isKo
                ? `"${pendingDelete.name}" 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
                : `Delete "${pendingDelete.name}"? This cannot be undone.`)
            : ''
        }
        confirmLabel={isKo ? '삭제' : 'Delete'}
        cancelLabel={isKo ? '취소' : 'Cancel'}
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
  project, lang, isKo, tab, isDeleting, isArchiving, onDelete, onToggleArchive,
}: {
  project: NexyfabProject;
  lang: string;
  isKo: boolean;
  tab: TabKey;
  isDeleting: boolean;
  isArchiving: boolean;
  onDelete: (p: NexyfabProject) => void;
  onToggleArchive: (p: NexyfabProject) => void;
}) {
  const busy = isDeleting || isArchiving;

  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: 12, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#388bfd55')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#30363d')}
    >
      {/* Thumbnail */}
      <div style={{
        width: '100%', height: 160,
        background: '#0d1117',
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
            background: '#21262d', borderRadius: 6, padding: '2px 8px',
            fontSize: 10, color: '#8b949e',
          }}>
            {isKo ? '보관됨' : 'Archived'}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: '#e6edf3',
          marginBottom: 6, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </div>

        {project.materialId && (
          <span style={{
            display: 'inline-block', fontSize: 10, padding: '2px 8px',
            borderRadius: 10, background: '#388bfd18', color: '#79c0ff',
            border: '1px solid #388bfd33', marginBottom: 6,
          }}>
            {project.materialId}
          </span>
        )}

        {project.tags && project.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {project.tags.slice(0, 4).map(tag => (
              <span key={tag} style={{
                fontSize: 10, padding: '2px 7px',
                borderRadius: 10, background: '#21262d', color: '#8b949e',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 14 }}>
          {isKo ? '수정' : 'Updated'}: {fmtDate(project.updatedAt, isKo)}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tab === 'active' && (
            <Link
              prefetch
              href={`/${lang}/shape-generator?project=${project.id}`}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7,
                background: '#388bfd22', color: '#388bfd',
                border: '1px solid #388bfd44',
                fontSize: 12, fontWeight: 700, textDecoration: 'none',
                textAlign: 'center', minWidth: 48,
              }}
            >
              {isKo ? '열기' : 'Open'}
            </Link>
          )}
          <button
            onClick={() => onToggleArchive(project)}
            disabled={busy}
            style={{
              padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: 'transparent',
              color: isArchiving ? '#6e7681' : '#8b949e',
              border: '1px solid #30363d',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.55 : 1,
              transition: 'all 0.15s',
            }}
          >
            {isArchiving ? '...' : (tab === 'archived' ? (isKo ? '복원' : 'Restore') : (isKo ? '보관' : 'Archive'))}
          </button>
          <button
            onClick={() => onDelete(project)}
            disabled={busy}
            aria-busy={isDeleting}
            style={{
              padding: '7px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: isDeleting ? '#21262d' : 'transparent',
              color: isDeleting ? '#6e7681' : '#f85149',
              border: '1px solid #da363344',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.55 : 1,
              transition: 'all 0.15s',
            }}
          >
            {isDeleting ? '...' : (isKo ? '삭제' : 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
