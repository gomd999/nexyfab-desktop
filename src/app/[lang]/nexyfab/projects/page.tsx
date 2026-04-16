'use client';

import { use, useEffect, useState, useCallback } from 'react';

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number, isKo: boolean) {
  return new Date(ts).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = lang === 'ko';

  const [projects, setProjects] = useState<NexyfabProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/nexyfab/projects');
      if (!r.ok) throw new Error('Failed to load');
      const data = await r.json() as { projects: NexyfabProject[] };
      setProjects(data.projects ?? []);
    } catch {
      setError(isKo ? '프로젝트를 불러오지 못했습니다.' : 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, [isKo]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (project: NexyfabProject) => {
    const confirmed = window.confirm(
      isKo
        ? `"${project.name}" 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
        : `Delete "${project.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(project.id);
    try {
      const r = await fetch(`/api/nexyfab/projects/${project.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      setProjects(prev => prev.filter(p => p.id !== project.id));
    } catch {
      alert(isKo ? '삭제에 실패했습니다.' : 'Failed to delete project.');
    } finally {
      setDeletingId(null);
    }
  }, [isKo]);

  // ── Filtered ───────────────────────────────────────────────────────────────
  const filtered = projects.filter(p =>
    search.trim() === '' || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        position: 'sticky', top: 0, background: '#0d1117', zIndex: 10,
      }}>
        <a href={`/${lang}/shape-generator`} style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>Fab</span>
        </a>
        <span style={{ color: '#30363d' }}>/</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {isKo ? '내 프로젝트' : 'My Projects'}
        </span>
        <div style={{ flex: 1 }} />
        <a
          href={`/${lang}/shape-generator`}
          style={{
            padding: '8px 16px', borderRadius: 8, background: '#388bfd',
            color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          + {isKo ? '새 프로젝트' : 'New Project'}
        </a>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {/* ── Search ── */}
        {!loading && projects.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isKo ? '프로젝트 이름으로 검색...' : 'Search projects...'}
              style={{
                width: '100%', maxWidth: 380,
                padding: '9px 14px', borderRadius: 8, fontSize: 13,
                background: '#161b22', border: '1px solid #30363d',
                color: '#e6edf3', outline: 'none',
              }}
            />
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
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            {isKo ? '불러오는 중...' : 'Loading...'}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{
            background: '#da363322', border: '1px solid #da363355',
            borderRadius: 8, padding: '14px 16px', color: '#f85149', fontSize: 13, marginBottom: 16,
          }}>
            {error}
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
            <div style={{ fontSize: 56, marginBottom: 16 }}>📐</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#e6edf3', margin: '0 0 8px' }}>
              {isKo ? '아직 저장된 프로젝트가 없습니다.' : 'No saved projects yet.'}
            </p>
            <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 24px' }}>
              {isKo
                ? '3D 형상을 설계하고 프로젝트로 저장해 보세요.'
                : 'Design a 3D shape and save it as a project.'}
            </p>
            <a
              href={`/${lang}/shape-generator`}
              style={{
                display: 'inline-block', padding: '10px 24px', borderRadius: 8,
                background: '#388bfd', color: '#fff', fontWeight: 700,
                fontSize: 14, textDecoration: 'none',
              }}
            >
              {isKo ? '형상 설계 시작' : 'Start Designing'}
            </a>
          </div>
        )}

        {/* ── No search results ── */}
        {!loading && !error && projects.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
            {isKo
              ? `"${search}"에 대한 검색 결과가 없습니다.`
              : `No results for "${search}".`}
          </div>
        )}

        {/* ── Project Grid ── */}
        {!loading && !error && filtered.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 20,
          }}>
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                lang={lang}
                isKo={isKo}
                isDeleting={deletingId === project.id}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, lang, isKo, isDeleting, onDelete,
}: {
  project: NexyfabProject;
  lang: string;
  isKo: boolean;
  isDeleting: boolean;
  onDelete: (p: NexyfabProject) => void;
}) {
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
      }}>
        {project.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.thumbnail}
            alt={project.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontSize: 40, opacity: 0.4 }}>📐</span>
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

        {/* Material tag */}
        {project.materialId && (
          <span style={{
            display: 'inline-block', fontSize: 10, padding: '2px 8px',
            borderRadius: 10, background: '#388bfd18', color: '#79c0ff',
            border: '1px solid #388bfd33', marginBottom: 6,
          }}>
            {project.materialId}
          </span>
        )}

        {/* Tags */}
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
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={`/${lang}/shape-generator?project=${project.id}`}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 7,
              background: '#388bfd22', color: '#388bfd',
              border: '1px solid #388bfd44',
              fontSize: 12, fontWeight: 700, textDecoration: 'none',
              textAlign: 'center',
            }}
          >
            {isKo ? '열기' : 'Open'}
          </a>
          <button
            onClick={() => onDelete(project)}
            disabled={isDeleting}
            style={{
              padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: isDeleting ? '#21262d' : 'transparent',
              color: isDeleting ? '#6e7681' : '#f85149',
              border: '1px solid #da363344',
              cursor: isDeleting ? 'not-allowed' : 'pointer',
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
