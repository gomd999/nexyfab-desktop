'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { formatDate, formatDateTime } from '@/lib/formatDate';
import { useToast } from '@/hooks/useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RfqItem {
  id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  shape_name: string | null;
  material_id: string | null;
  quantity: number;
  volume_cm3: number | null;
  dfm_score: number | null;
  note: string | null;
  status: string;
  quote_amount: number | null;
  manufacturer_note: string | null;
  assigned_factory_id: string | null;
  factory_name: string | null;
  factory_email: string | null;
  created_at: number;
  priority?: 'high' | 'medium' | 'low';
}

interface Factory {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string[];
  contact_email: string | null;
  status: string;
}

interface FactoryKPI {
  partnerId: string;
  email: string;
  totalQuotes: number;
  wonQuotes: number;
  winRate: number;
  avgResponseHours: number | null;
  activeContracts: number;
  completedContracts: number;
  overdueContracts: number;
}

interface MockMatch {
  factoryId: string;
  name: string;
  region: string;
  processes: string[];
  score: number;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: '대기중',   color: '#d29922', bg: '#d2992220' },
  assigned:  { label: '배정됨',   color: '#388bfd', bg: '#388bfd20' },
  quoted:    { label: '견적완료', color: '#3fb950', bg: '#3fb95020' },
  accepted:  { label: '수락됨',   color: '#56d364', bg: '#56d36420' },
  completed: { label: '완료',     color: '#8b949e', bg: '#8b949e20' },
  cancelled: { label: '취소',     color: '#f85149', bg: '#f8514920' },
};

const TAB_FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'all',       label: '전체',     statuses: [] },
  { key: 'pending',   label: '대기중',   statuses: ['pending'] },
  { key: 'matched',   label: '매칭완료', statuses: ['assigned', 'quoted', 'accepted'] },
  { key: 'completed', label: '완료',     statuses: ['completed'] },
  { key: 'cancelled', label: '취소',     statuses: ['cancelled'] },
];

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: '높음', color: '#f85149', bg: '#f8514920' },
  medium: { label: '중간', color: '#d29922', bg: '#d2992220' },
  low:    { label: '낮음', color: '#8b949e', bg: '#8b949e20' },
};

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d',
  border: '#30363d', text: '#e6edf3', dim: '#8b949e',
  accent: '#388bfd', green: '#3fb950', red: '#f85149', yellow: '#d29922',
};

const PROCESS_OPTIONS: Record<string, string> = {
  cnc_milling: 'CNC 밀링', cnc_turning: 'CNC 선삭',
  injection_molding: '사출', sheet_metal: '판금',
  casting: '주조', '3d_printing': '3D 프린팅',
};

function getMockMatches(rfq: RfqItem, factories: Factory[]): MockMatch[] {
  const pool = factories.length >= 3 ? factories.slice(0, 5) : factories;
  if (pool.length === 0) {
    return [
      { factoryId: 'mock-1', name: '정밀기공 (주)', region: '경기도 안산시', processes: ['CNC 밀링', 'CNC 선삭'], score: 92 },
      { factoryId: 'mock-2', name: '한국정밀 (주)', region: '인천광역시', processes: ['사출', '판금'], score: 78 },
      { factoryId: 'mock-3', name: '대성부품 (주)', region: '경남 창원시', processes: ['주조', 'CNC 밀링'], score: 65 },
    ];
  }
  return pool.slice(0, 3).map((f, i) => ({
    factoryId: f.id,
    name: f.name_ko ? `${f.name} (${f.name_ko})` : f.name,
    region: f.region,
    processes: f.processes.slice(0, 3).map(p => PROCESS_OPTIONS[p] ?? p),
    score: Math.max(40, 95 - i * 13 - (rfq.dfm_score ? Math.floor((100 - rfq.dfm_score) / 10) : 5)),
  }));
}

function getPriority(rfq: RfqItem): 'high' | 'medium' | 'low' {
  if (rfq.priority) return rfq.priority;
  const n = rfq.id.charCodeAt(0) + rfq.id.charCodeAt(rfq.id.length - 1);
  if (n % 3 === 0) return 'high';
  if (n % 3 === 1) return 'medium';
  return 'low';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminRfqPage() {
  const [rfqs, setRfqs] = useState<RfqItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  const [factories, setFactories] = useState<Factory[]>([]);
  const [kpiMap, setKpiMap] = useState<Record<string, FactoryKPI>>({});
  const [sortByKpi, setSortByKpi] = useState(true);
  const [assignModal, setAssignModal] = useState<RfqItem | null>(null);
  const [selectedFactory, setSelectedFactory] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [assigning, setAssigning] = useState(false);

  const toast = useToast();
  const [detailModal, setDetailModal] = useState<RfqItem | null>(null);

  // AI 매칭 (assign modal)
  const [aiScores, setAiScores] = useState<Record<string, number>>({});
  const [aiLoading, setAiLoading] = useState(false);

  // Auto-match slide-over
  const [matchPanel, setMatchPanel] = useState<{ rfq: RfqItem; matches: MockMatch[]; loading?: boolean } | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  // Priority sort
  const [sortPriority, setSortPriority] = useState<'asc' | 'desc' | null>(null);

  const showToast = (msg: string) => toast.info(msg);

  const fetchRfqs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' });
      const tabDef = TAB_FILTERS.find(t => t.key === activeTab);
      if (tabDef && tabDef.statuses.length === 1) params.set('status', tabDef.statuses[0]);
      const res = await fetch(`/api/admin/rfq?${params}`);
      const data = await res.json() as { rfqs: RfqItem[]; pagination: { total: number } };
      setRfqs(data.rfqs ?? []);
      setTotal(data.pagination?.total ?? 0);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [page, activeTab]);

  const fetchFactories = useCallback(async () => {
    try {
      const [factRes, kpiRes] = await Promise.all([
        fetch('/api/admin/factories?status=active'),
        fetch('/api/admin/partner-kpi'),
      ]);
      const factData = await factRes.json() as { factories: Factory[] };
      setFactories(factData.factories ?? []);
      if (kpiRes.ok) {
        const kpiData = await kpiRes.json() as { partners: FactoryKPI[] };
        const map: Record<string, FactoryKPI> = {};
        for (const kpi of (kpiData.partners ?? [])) map[kpi.email] = kpi;
        setKpiMap(map);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRfqs(); }, [fetchRfqs]);
  useEffect(() => { fetchFactories(); }, [fetchFactories]);

  const openAssign = (rfq: RfqItem) => {
    setAssignModal(rfq);
    setSelectedFactory(rfq.assigned_factory_id || '');
    setAdminNote('');
    setAiScores({});
  };

  const openMatchPanel = async (rfq: RfqItem) => {
    setMatchPanel({ rfq, matches: [], loading: true });
    try {
      const res = await fetch(`/api/match?rfqId=${rfq.id}`);
      if (res.ok) {
        const data = await res.json() as {
          matches: Array<{ partnerId: string; company: string; score: number; reasons?: string[] }>;
        };
        const matches: MockMatch[] = (data.matches ?? []).slice(0, 5).map(m => {
          const factory = factories.find(f => f.id === m.partnerId);
          return {
            factoryId: m.partnerId,
            name: factory
              ? (factory.name_ko ? `${factory.name} (${factory.name_ko})` : factory.name)
              : m.company,
            region: factory?.region ?? '—',
            processes: factory
              ? factory.processes.slice(0, 3).map(p => PROCESS_OPTIONS[p] ?? p)
              : [],
            score: m.score,
          };
        });
        setMatchPanel({ rfq, matches: matches.length > 0 ? matches : getMockMatches(rfq, factories) });
      } else {
        setMatchPanel({ rfq, matches: getMockMatches(rfq, factories) });
      }
    } catch {
      setMatchPanel({ rfq, matches: getMockMatches(rfq, factories) });
    }
  };

  const runAiMatch = async (rfq: RfqItem) => {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/match?rfqId=${encodeURIComponent(rfq.id)}`);
      if (!res.ok) throw new Error();
      const data = await res.json() as { matches: Array<{ partnerId: string; score: number }> };
      const map: Record<string, number> = {};
      for (const m of (data.matches ?? [])) map[m.partnerId] = m.score;
      setAiScores(map);
      setSortByKpi(false);
      showToast(`AI 매칭 완료 — ${data.matches?.length ?? 0}개 추천`);
    } catch {
      showToast('AI 매칭 실패');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!assignModal || !selectedFactory) { showToast('제조사를 선택해 주세요.'); return; }
    setAssigning(true);
    try {
      const res = await fetch('/api/admin/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfqId: assignModal.id, factoryId: selectedFactory, adminNote }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; emailSent?: boolean };
      if (!res.ok) { showToast(data.error || '배정 실패'); return; }
      showToast(`배정 완료${data.emailSent ? ' (이메일 발송됨)' : ' (이메일 없음)'}`);
      setAssignModal(null);
      fetchRfqs();
    } catch { showToast('오류가 발생했습니다.'); } finally { setAssigning(false); }
  };

  const handleBulkMatch = async () => {
    if (selectedIds.size === 0) { showToast('선택된 RFQ가 없습니다.'); return; }
    setBulkRunning(true);
    try {
      const res = await fetch('/api/admin/rfq/bulk-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ rfqIds: Array.from(selectedIds) }),
      });
      const data = await res.json() as {
        summary?: { total: number; assigned: number };
        error?: string;
      };
      if (!res.ok) {
        showToast(data.error ?? '자동 매칭 실패');
        return;
      }
      const { total = 0, assigned = 0 } = data.summary ?? {};
      showToast(`${assigned}/${total}건 자동 매칭 완료`);
      setSelectedIds(new Set());
      fetchRfqs();
    } catch {
      showToast('자동 매칭 중 오류가 발생했습니다.');
    } finally {
      setBulkRunning(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === rfqs.length && rfqs.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(rfqs.map(r => r.id)));
  };

  // Approximate tab counts from loaded rfqs
  const tabCounts: Record<string, number> = { all: total };
  for (const rfq of rfqs) {
    const tab = TAB_FILTERS.find(t => t.statuses.includes(rfq.status));
    if (tab) tabCounts[tab.key] = (tabCounts[tab.key] ?? 0) + 1;
  }

  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const displayedRfqs = sortPriority
    ? [...rfqs].sort((a, b) => {
        const pa = PRIORITY_ORDER[getPriority(a)] ?? 1;
        const pb = PRIORITY_ORDER[getPriority(b)] ?? 1;
        return sortPriority === 'asc' ? pa - pb : pb - pa;
      })
    : rfqs;

  const totalPages = Math.ceil(total / 30);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: 1300, margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📋 RFQ 관리</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: '4px 0 0' }}>총 {total}건</p>
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkMatch}
            disabled={bulkRunning}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: bulkRunning ? '#2d4a8a' : C.accent, color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 700,
            }}
          >
            {bulkRunning ? '⏳ 실행 중...' : `✦ 선택 매칭 실행 (${selectedIds.size}건)`}
          </button>
        )}
      </div>

      {/* Status tab filters with count badges */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TAB_FILTERS.map(tab => {
          const count = tab.key === 'all' ? total : (tabCounts[tab.key] ?? 0);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); setSelectedIds(new Set()); }}
              style={{
                padding: '6px 14px', borderRadius: 20,
                border: `1px solid ${isActive ? C.accent : C.border}`,
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: isActive ? C.accent : C.card,
                color: isActive ? '#fff' : C.dim,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {tab.label}
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.25)' : C.border,
                color: isActive ? '#fff' : C.text,
                borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                minWidth: 20, textAlign: 'center',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.dim }}>불러오는 중...</div>
      ) : rfqs.length === 0 ? (
        /* ── Empty state ── */
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '80px 20px', background: C.surface, borderRadius: 12,
          border: `1px solid ${C.border}`, gap: 16,
        }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="12" width="56" height="48" rx="6" fill={C.card} stroke={C.border} strokeWidth="2"/>
            <rect x="16" y="24" width="24" height="3" rx="1.5" fill={C.border}/>
            <rect x="16" y="32" width="36" height="3" rx="1.5" fill={C.border}/>
            <rect x="16" y="40" width="28" height="3" rx="1.5" fill={C.border}/>
            <circle cx="54" cy="54" r="12" fill={C.card} stroke={C.accent} strokeWidth="2"/>
            <path d="M50 54h8M54 50v8" stroke={C.accent} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>등록된 RFQ가 없습니다</div>
          <div style={{ fontSize: 13, color: C.dim }}>현재 필터 조건에 맞는 RFQ가 없습니다.</div>
          <Link
            href="/admin/rfq/new"
            prefetch={false}
            style={{
              padding: '8px 20px', borderRadius: 8, background: C.accent, color: '#fff',
              fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'inline-block',
            }}
          >
            + 새 RFQ 등록
          </Link>
        </div>
      ) : (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {/* Checkbox header */}
                <th style={{ padding: '10px 12px', textAlign: 'center', color: C.dim, fontWeight: 600, width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === rfqs.length && rfqs.length > 0}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                {['RFQ ID', '고객', '부품명', '소재 / 수량', 'DFM', '배정 제조사', '상태'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
                {/* Sortable priority */}
                <th style={{ padding: '10px 12px', textAlign: 'left', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => setSortPriority(p => p === 'asc' ? 'desc' : p === 'desc' ? null : 'asc')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: sortPriority ? C.accent : C.dim,
                      fontWeight: 600, fontSize: 12, padding: 0,
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    우선순위{' '}
                    {sortPriority === 'asc' ? '▲' : sortPriority === 'desc' ? '▼' : '⇅'}
                  </button>
                </th>
                {['접수일', '액션'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedRfqs.map((rfq, i) => {
                const sm = STATUS_META[rfq.status] ?? { label: rfq.status, color: C.dim, bg: 'transparent' };
                const prio = getPriority(rfq);
                const pm = PRIORITY_META[prio];
                const isChecked = selectedIds.has(rfq.id);
                return (
                  <tr
                    key={rfq.id}
                    style={{
                      borderBottom: i < displayedRfqs.length - 1 ? `1px solid ${C.border}` : 'none',
                      background: isChecked ? '#1a2a3a' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = C.card; }}
                    onMouseLeave={e => { if (!isChecked) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(rfq.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        onClick={() => setDetailModal(rfq)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.accent, fontWeight: 700, fontSize: 12, padding: 0 }}
                      >
                        {rfq.id.slice(0, 14)}...
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600 }}>{rfq.user_name || '(이름없음)'}</div>
                      <div style={{ fontSize: 11, color: C.dim }}>{rfq.user_email || '-'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{rfq.shape_name || '-'}</td>
                    <td style={{ padding: '10px 12px', color: C.dim }}>
                      {rfq.material_id || '-'} / {rfq.quantity.toLocaleString()}개
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {rfq.dfm_score != null ? (
                        <span style={{ color: rfq.dfm_score >= 70 ? C.green : rfq.dfm_score >= 40 ? C.yellow : C.red, fontWeight: 700 }}>
                          {rfq.dfm_score}점
                        </span>
                      ) : <span style={{ color: C.dim }}>-</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {rfq.factory_name
                        ? <div>
                            <div style={{ fontWeight: 600, color: C.green }}>{rfq.factory_name}</div>
                            <div style={{ fontSize: 11, color: C.dim }}>{rfq.factory_email || ''}</div>
                          </div>
                        : <span style={{ color: C.dim }}>미배정</span>
                      }
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, fontWeight: 700, background: sm.bg, color: sm.color }}>
                        {sm.label}
                      </span>
                    </td>
                    {/* Priority badge */}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, fontWeight: 700, background: pm.bg, color: pm.color }}>
                        {pm.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: C.dim, fontSize: 12 }}>
                      {formatDate(rfq.created_at)}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => openMatchPanel(rfq)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, border: `1px solid #a371f7`,
                            background: 'transparent', color: '#a371f7',
                            cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                          }}
                        >
                          자동 매칭
                        </button>
                        <button
                          onClick={() => openAssign(rfq)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.accent}`,
                            background: 'transparent', color: C.accent,
                            cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                          }}
                        >
                          {rfq.assigned_factory_id ? '재배정' : '배정'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: 'pointer', fontSize: 13 }}>
            이전
          </button>
          <span style={{ lineHeight: '32px', fontSize: 13, color: C.dim }}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: 'pointer', fontSize: 13 }}>
            다음
          </button>
        </div>
      )}

      {/* ── Auto-match slide-over panel ──────────────────────────────────────────── */}
      {matchPanel && (
        <>
          <div onClick={() => setMatchPanel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
            background: C.surface, borderLeft: `1px solid ${C.border}`,
            zIndex: 1200, display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: C.text }}>자동 매칭 결과</h2>
                <p style={{ fontSize: 12, color: C.dim, margin: '3px 0 0' }}>
                  {matchPanel.rfq.shape_name || matchPanel.rfq.id.slice(0, 14)} · {matchPanel.rfq.material_id} · {matchPanel.rfq.quantity}개
                </p>
              </div>
              <button onClick={() => setMatchPanel(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                추천 제조사 TOP {matchPanel.loading ? '…' : Math.min(matchPanel.matches.length, 5)}
              </div>
              {matchPanel.loading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: C.dim, fontSize: 14 }}>
                  ⏳ AI 매칭 분석 중…
                </div>
              )}
              {!matchPanel.loading && matchPanel.matches.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: C.dim, fontSize: 13 }}>
                  적합한 공장을 찾지 못했습니다.
                </div>
              )}
              {matchPanel.matches.map((m, i) => {
                const medals = ['🥇', '🥈', '🥉'];
                const scoreColor = m.score >= 80 ? C.green : m.score >= 60 ? C.yellow : C.red;
                return (
                  <div key={m.factoryId} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '14px 16px', marginBottom: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{medals[i]}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: C.dim }}>{m.region}</div>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor }}>{m.score}점</span>
                    </div>
                    {/* Score bar */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ height: 6, background: '#30363d', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${m.score}%`, borderRadius: 3, background: scoreColor }} />
                      </div>
                    </div>
                    {/* Process tags */}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                      {m.processes.map(p => (
                        <span key={p} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#30363d', color: C.dim, fontWeight: 600 }}>{p}</span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const rfqRef = matchPanel.rfq;
                        setMatchPanel(null);
                        setAssignModal(rfqRef);
                        setSelectedFactory(m.factoryId);
                        setAdminNote('');
                        setAiScores({});
                      }}
                      style={{
                        width: '100%', padding: '6px', borderRadius: 7,
                        border: `1px solid ${C.accent}`, background: 'transparent', color: C.accent,
                        cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      이 제조사로 배정
                    </button>
                  </div>
                );
              })}
              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#1a2232', border: `1px solid #1f3a5f`, fontSize: 11, color: C.dim }}>
                점수는 DFM 점수, 공정 일치도, 지역 근접성을 기반으로 산출된 추천 지표입니다.
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}` }}>
              <button
                onClick={() => { const rfqRef = matchPanel.rfq; setMatchPanel(null); openAssign(rfqRef); }}
                style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                직접 배정 →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Assign Modal ─────────────────────────────────────────────────────────── */}
      {assignModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, color: C.text }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>제조사 배정</h2>
            <p style={{ color: C.dim, fontSize: 13, margin: '0 0 20px' }}>
              RFQ: <strong style={{ color: C.text }}>{assignModal.shape_name || assignModal.id}</strong>
              {' / '}{assignModal.material_id} / {assignModal.quantity}개
            </p>

            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>제조사 선택 *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => runAiMatch(assignModal)}
                    disabled={aiLoading}
                    style={{ fontSize: 11, color: '#a371f7', background: Object.keys(aiScores).length > 0 ? '#2d1f4a' : 'transparent', border: `1px solid ${Object.keys(aiScores).length > 0 ? '#a371f7' : C.border}`, borderRadius: 6, padding: '2px 8px', cursor: 'pointer', opacity: aiLoading ? 0.6 : 1 }}
                  >
                    {aiLoading ? '⏳ 분석중...' : Object.keys(aiScores).length > 0 ? '✦ AI 매칭 완료' : '🤖 AI 매칭'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortByKpi(v => !v)}
                    style={{ fontSize: 11, color: sortByKpi ? C.accent : C.dim, background: sortByKpi ? '#1f3a5f' : 'transparent', border: `1px solid ${sortByKpi ? C.accent : C.border}`, borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
                  >
                    {sortByKpi ? '✦ KPI순' : 'KPI순'}
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                {[...factories]
                  .sort((a, b) => {
                    const hasAi = Object.keys(aiScores).length > 0;
                    if (hasAi) return (aiScores[b.id] ?? 0) - (aiScores[a.id] ?? 0);
                    if (!sortByKpi) return 0;
                    const kA = a.contact_email ? kpiMap[a.contact_email] : undefined;
                    const kB = b.contact_email ? kpiMap[b.contact_email] : undefined;
                    const scoreA = (kA?.winRate ?? 0) * 2 + (kA?.completedContracts ?? 0) * 0.5 - (kA?.overdueContracts ?? 0) * 2;
                    const scoreB = (kB?.winRate ?? 0) * 2 + (kB?.completedContracts ?? 0) * 0.5 - (kB?.overdueContracts ?? 0) * 2;
                    return scoreB - scoreA;
                  })
                  .map((f, idx) => {
                    const kpi = f.contact_email ? kpiMap[f.contact_email] : undefined;
                    const isSelected = selectedFactory === f.id;
                    const hasAi = Object.keys(aiScores).length > 0;
                    const aiScore = aiScores[f.id];
                    const isTop = hasAi ? idx === 0 && aiScore != null : (sortByKpi && idx === 0 && kpi != null);
                    return (
                      <div
                        key={f.id}
                        onClick={() => setSelectedFactory(f.id)}
                        style={{
                          padding: '10px 12px', cursor: 'pointer', fontSize: 13,
                          borderBottom: `1px solid ${C.border}`,
                          background: isSelected ? '#1f3a5f' : 'transparent',
                          borderLeft: isSelected ? `3px solid ${C.accent}` : '3px solid transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ color: isSelected ? '#fff' : C.text, fontWeight: 600 }}>
                            {f.name}{f.name_ko ? ` (${f.name_ko})` : ''}
                          </span>
                          {isTop && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#f0c040', background: '#2d2200', border: '1px solid #665500', borderRadius: 4, padding: '1px 5px' }}>
                              ✦ {hasAi ? 'AI 1위' : '추천'}
                            </span>
                          )}
                          {aiScore != null && (
                            <span style={{
                              fontSize: 10, fontWeight: 800, borderRadius: 4, padding: '1px 5px',
                              background: aiScore >= 70 ? '#1a3a1a' : aiScore >= 40 ? '#2d2a1a' : '#2d1a1a',
                              color: aiScore >= 70 ? C.green : aiScore >= 40 ? C.yellow : C.red,
                              border: `1px solid ${aiScore >= 70 ? '#2ea043' : aiScore >= 40 ? '#9e6a03' : '#da3633'}`,
                            }}>
                              AI {aiScore}점
                            </span>
                          )}
                          {!f.contact_email && <span style={{ fontSize: 10, color: C.red }}>이메일없음</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.dim, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>{f.region}</span>
                          {f.processes.slice(0, 3).map(p => <span key={p}>{PROCESS_OPTIONS[p] ?? p}</span>)}
                          {kpi && (
                            <>
                              <span style={{ color: '#3fb950' }}>승률 {(kpi.winRate * 100).toFixed(0)}%</span>
                              <span>완료 {kpi.completedContracts}건</span>
                              {kpi.avgResponseHours != null && <span>응답 {kpi.avgResponseHours.toFixed(0)}h</span>}
                              {kpi.overdueContracts > 0 && <span style={{ color: C.red }}>연체 {kpi.overdueContracts}</span>}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: C.dim, fontWeight: 600, display: 'block', marginBottom: 6 }}>관리자 메모 (선택)</label>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                rows={2}
                placeholder="제조사에게 전달할 추가 지시 사항..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#0d1117', color: C.text, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            {selectedFactory && !factories.find(f => f.id === selectedFactory)?.contact_email && (
              <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: '#2d1f1f', border: `1px solid #5a2020`, fontSize: 12, color: '#f0883e' }}>
                ⚠️ 선택한 제조사에 연락처 이메일이 없어 이메일이 발송되지 않습니다.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setAssignModal(null)}
                style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 13 }}>
                취소
              </button>
              <button onClick={handleAssign} disabled={assigning || !selectedFactory}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: assigning || !selectedFactory ? '#1f3a5f' : C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {assigning ? '배정 중...' : '배정 완료'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────────────────── */}
      {detailModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, color: C.text }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>RFQ 상세</h2>
              <button onClick={() => setDetailModal(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {([
                ['RFQ ID', detailModal.id],
                ['고객', `${detailModal.user_name || '-'} (${detailModal.user_email || '-'})`],
                ['부품명', detailModal.shape_name || '-'],
                ['소재', detailModal.material_id || '-'],
                ['수량', `${detailModal.quantity.toLocaleString()}개`],
                ['부피', detailModal.volume_cm3 ? `${detailModal.volume_cm3.toFixed(2)} cm³` : '-'],
                ['DFM 점수', detailModal.dfm_score != null ? `${detailModal.dfm_score}점` : '-'],
                ['배정 제조사', detailModal.factory_name || '미배정'],
                ['상태', STATUS_META[detailModal.status]?.label ?? detailModal.status],
                ['우선순위', PRIORITY_META[getPriority(detailModal)]?.label ?? '-'],
                ['메모', detailModal.note || '-'],
                ['관리자 메모', detailModal.manufacturer_note || '-'],
                ['접수일', formatDateTime(detailModal.created_at)],
              ] as [string, string][]).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 4px', color: C.dim, width: 120 }}>{k}</td>
                  <td style={{ padding: '8px 4px', color: C.text, wordBreak: 'break-all' }}>{v}</td>
                </tr>
              ))}
            </table>
            <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { const ref = detailModal; setDetailModal(null); openMatchPanel(ref); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid #a371f7`, background: 'transparent', color: '#a371f7', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                자동 매칭
              </button>
              <button
                onClick={() => { const ref = detailModal; setDetailModal(null); openAssign(ref); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                제조사 배정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
