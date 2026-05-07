'use client';

import { useState, useEffect, use, useCallback } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  rfq: { total: number; pending: number; quoted: number; accepted: number };
  orders: { total: number; placed: number; active: number; delivered: number };
  revenue: { month: number; week: number };
  partners: { total: number; active: number; pendingApplications: number };
  users: { total: number; newThisWeek: number };
  recentRfqs: { id: string; user_email: string | null; shape_name: string | null; status: string; created_at: number }[];
  recentOrders: { id: string; part_name: string; manufacturer_name: string; status: string; total_price_krw: number; created_at: number }[];
}

interface Application {
  id: string; companyName: string; bizNumber: string; ceoName: string;
  contactName: string; contactEmail: string; contactPhone: string;
  processes: string[]; certifications: string[];
  bio: string | null; homepage: string | null; status: string; createdAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3',
  muted: '#8b949e', dim: '#6e7681', accent: '#388bfd', green: '#3fb950',
  orange: '#f0883e', yellow: '#e3b341', red: '#f85149', purple: '#a371f7',
};

function won(n: number) { return n.toLocaleString('ko-KR') + '원'; }
function fmtDate(ts: number) { return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

const STATUS_COLOR: Record<string, string> = {
  pending: C.yellow, quoted: C.accent, accepted: C.green, rejected: C.red,
  placed: C.accent, production: C.orange, qc: C.yellow, shipped: '#79c0ff', delivered: C.green,
};

function StatCard({ label, value, sub, color = C.accent }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminDashboard({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const { token, user } = useAuthStore();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);
  const [error, setError] = useState('');
  const [appMsg, setAppMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'applications' | 'rfqs' | 'orders'>('overview');

  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/nexyfab/admin/stats', { headers: authHeaders });
      if (r.status === 403) { setError(isKo ? '관리자 권한이 필요합니다.' : 'Admin access required.'); return; }
      const d = await r.json() as AdminStats;
      setStats(d);
    } catch {
      setError(isKo ? '데이터를 불러오지 못했습니다.' : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadApplications = useCallback(async (status = 'pending') => {
    if (!token) return;
    setAppLoading(true);
    try {
      const r = await fetch(`/api/nexyfab/admin/applications?status=${status}`, { headers: authHeaders });
      const d = await r.json() as { applications?: Application[] };
      setApps(d.applications ?? []);
    } finally {
      setAppLoading(false);
    }
  }, [token]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (activeTab === 'applications') loadApplications(); }, [activeTab, loadApplications]);

  async function handleApplication(id: string, action: 'approve' | 'reject') {
    setAppMsg('');
    try {
      const r = await fetch('/api/nexyfab/admin/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders, 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setAppMsg(action === 'approve'
          ? (isKo ? '✅ 승인 완료. 파트너에게 로그인 코드가 발송됐습니다.' : '✅ Approved. Login code sent to partner.')
          : (isKo ? '✅ 거절 처리됐습니다.' : '✅ Rejected.'));
        loadApplications();
      } else {
        setAppMsg(`❌ ${d.error ?? (isKo ? '처리 실패' : 'Action failed')}`);
      }
    } catch {
      setAppMsg(isKo ? '❌ 오류가 발생했습니다.' : '❌ An error occurred.');
    }
  }

  const tabs = [
    { id: 'overview' as const, label: isKo ? '📊 개요' : '📊 Overview' },
    { id: 'applications' as const, label: `📋 ${isKo ? '파트너 신청' : 'Applications'}${stats?.partners.pendingApplications ? ` (${stats.partners.pendingApplications})` : ''}` },
    { id: 'rfqs' as const, label: isKo ? '📝 최근 RFQ' : '📝 Recent RFQs' },
    { id: 'orders' as const, label: isKo ? '📦 최근 주문' : '📦 Recent Orders' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, background: C.bg, zIndex: 10 }}>
        <a href={`/${lang}/nexyfab`} style={{ fontSize: 18, fontWeight: 900, color: C.text, textDecoration: 'none' }}>
          <span style={{ color: C.accent }}>Nexy</span>Fab
        </a>
        <span style={{ color: C.border }}>|</span>
        <span style={{ fontSize: 14, color: C.muted }}>{isKo ? '어드민 대시보드' : 'Admin Dashboard'}</span>
        <div style={{ flex: 1 }} />
        {user && <span style={{ fontSize: 12, color: C.dim }}>{user.email}</span>}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>
        {error && (
          <div style={{ background: '#f8514922', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '14px 20px', color: C.red, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>{isKo ? '데이터 로딩 중...' : 'Loading...'}</div>
        )}

        {!loading && stats && (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${activeTab === t.id ? C.accent : C.border}`,
                  background: activeTab === t.id ? C.accent + '22' : 'transparent',
                  color: activeTab === t.id ? C.accent : C.muted,
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── OVERVIEW ── */}
            {activeTab === 'overview' && (
              <>
                <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: C.muted }}>{isKo ? '플랫폼 현황' : 'Platform Overview'}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14, marginBottom: 32 }}>
                  <StatCard label={isKo ? '전체 RFQ' : 'Total RFQs'} value={stats.rfq.total} sub={isKo ? `대기 ${stats.rfq.pending} · 견적완료 ${stats.rfq.quoted}` : `Pending ${stats.rfq.pending} · Quoted ${stats.rfq.quoted}`} color={C.accent} />
                  <StatCard label={isKo ? '전체 주문' : 'Total Orders'} value={stats.orders.total} sub={isKo ? `진행 중 ${stats.orders.active} · 납품완료 ${stats.orders.delivered}` : `Active ${stats.orders.active} · Delivered ${stats.orders.delivered}`} color={C.orange} />
                  <StatCard label={isKo ? '이번달 매출' : 'Monthly Revenue'} value={won(stats.revenue.month)} sub={isKo ? `이번주 ${won(stats.revenue.week)}` : `This week ${won(stats.revenue.week)}`} color={C.green} />
                  <StatCard label={isKo ? '활성 파트너' : 'Active Partners'} value={stats.partners.active} sub={isKo ? `전체 제조사 ${stats.partners.total}` : `Total manufacturers ${stats.partners.total}`} color={C.purple} />
                  <StatCard label={isKo ? '전체 회원' : 'Total Users'} value={stats.users.total} sub={isKo ? `이번주 신규 +${stats.users.newThisWeek}` : `New this week +${stats.users.newThisWeek}`} color={C.yellow} />
                  {stats.partners.pendingApplications > 0 && (
                    <StatCard label={isKo ? '대기 중 신청' : 'Pending Applications'} value={stats.partners.pendingApplications} sub={isKo ? '파트너 승인 필요' : 'Partner approval required'} color={C.red} />
                  )}
                </div>

                {/* RFQ by status */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: C.muted }}>{isKo ? 'RFQ 상태 분포' : 'RFQ Status'}</h3>
                    {[
                      { label: isKo ? '대기(pending)' : 'Pending', val: stats.rfq.pending, color: C.yellow },
                      { label: isKo ? '견적완료(quoted)' : 'Quoted', val: stats.rfq.quoted, color: C.accent },
                      { label: isKo ? '수락(accepted)' : 'Accepted', val: stats.rfq.accepted, color: C.green },
                      { label: isKo ? '기타' : 'Other', val: Math.max(0, stats.rfq.total - stats.rfq.pending - stats.rfq.quoted - stats.rfq.accepted), color: C.dim },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{item.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.val}</span>
                        <div style={{ width: 80, height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${stats.rfq.total ? (item.val / stats.rfq.total * 100) : 0}%`, background: item.color, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: C.muted }}>{isKo ? '주문 상태 분포' : 'Order Status'}</h3>
                    {[
                      { label: isKo ? '접수(placed)' : 'Placed', val: stats.orders.placed, color: C.accent },
                      { label: isKo ? '진행 중' : 'Active', val: stats.orders.active, color: C.orange },
                      { label: isKo ? '납품완료' : 'Delivered', val: stats.orders.delivered, color: C.green },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{item.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.val}</span>
                        <div style={{ width: 80, height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${stats.orders.total ? (item.val / stats.orders.total * 100) : 0}%`, background: item.color, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick links */}
                <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    { label: isKo ? '📧 이메일 로그' : '📧 Email Logs', href: `/${lang}/nexyfab/admin/email-logs` },
                    { label: isKo ? '📄 이메일 템플릿' : '📄 Email Templates', href: `/${lang}/nexyfab/admin/email-templates` },
                    { label: isKo ? '🔗 RFQ 매칭' : '🔗 RFQ Matching', href: `/${lang}/nexyfab/admin/rfq-matching` },
                  ].map(link => (
                    <a key={link.href} href={link.href} style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: `1px solid ${C.border}`, color: C.muted, textDecoration: 'none',
                      background: 'transparent',
                    }}>
                      {link.label}
                    </a>
                  ))}
                </div>
              </>
            )}

            {/* ── APPLICATIONS ── */}
            {activeTab === 'applications' && (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {['pending', 'approved', 'rejected'].map(s => (
                    <button key={s} onClick={() => loadApplications(s)} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${C.border}`, background: 'transparent', color: C.muted,
                    }}>
                      {s === 'pending' ? (isKo ? '대기 중' : 'Pending') : s === 'approved' ? (isKo ? '승인됨' : 'Approved') : (isKo ? '거절됨' : 'Rejected')}
                    </button>
                  ))}
                </div>
                {appMsg && (
                  <div style={{
                    padding: '8px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12,
                    background: appMsg.startsWith('✅') ? C.green + '18' : C.red + '18',
                    color: appMsg.startsWith('✅') ? C.green : C.red,
                    border: `1px solid ${appMsg.startsWith('✅') ? C.green : C.red}44`,
                  }}>{appMsg}</div>
                )}
                {appLoading && <div style={{ color: C.dim, textAlign: 'center', padding: 40 }}>{isKo ? '로딩 중...' : 'Loading...'}</div>}
                {!appLoading && apps.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 60, color: C.dim, fontSize: 13 }}>{isKo ? '신청 내역이 없습니다.' : 'No applications found.'}</div>
                )}
                {!appLoading && apps.map(app => (
                  <div key={app.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 20px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{app.companyName}</span>
                          <span style={{ fontSize: 10, color: C.dim }}>{app.bizNumber}</span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                            background: app.status === 'pending' ? C.yellow + '22' : app.status === 'approved' ? C.green + '22' : C.red + '22',
                            color: app.status === 'pending' ? C.yellow : app.status === 'approved' ? C.green : C.red,
                          }}>
                            {app.status === 'pending' ? (isKo ? '대기' : 'Pending') : app.status === 'approved' ? (isKo ? '승인' : 'Approved') : (isKo ? '거절' : 'Rejected')}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 5 }}>
                          {app.contactName} · {app.contactEmail} · {app.contactPhone}
                        </div>
                        {app.processes.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                            {app.processes.map(p => (
                              <span key={p} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: C.accent + '18', color: C.accent, border: `1px solid ${C.accent}33` }}>{p}</span>
                            ))}
                          </div>
                        )}
                        {app.bio && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{app.bio.slice(0, 100)}</div>}
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{fmtDate(app.createdAt)}</div>
                      </div>
                      {app.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <button onClick={() => handleApplication(app.id, 'approve')} style={{
                            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                            border: 'none', cursor: 'pointer', background: C.green, color: '#fff',
                          }}>✓ {isKo ? '승인' : 'Approve'}</button>
                          <button onClick={() => handleApplication(app.id, 'reject')} style={{
                            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                            border: 'none', cursor: 'pointer', background: C.red + '22', color: C.red,
                            border2: `1px solid ${C.red}55`,
                          } as any}>✕ {isKo ? '거절' : 'Reject'}</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── RECENT RFQs ── */}
            {activeTab === 'rfqs' && (
              <div>
                <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: C.muted }}>{isKo ? `최근 RFQ (${stats.recentRfqs.length}건)` : `Recent RFQs (${stats.recentRfqs.length})`}</h2>
                {stats.recentRfqs.length === 0 && <div style={{ color: C.dim, textAlign: 'center', padding: 40 }}>{isKo ? 'RFQ 없음' : 'No RFQs'}</div>}
                {stats.recentRfqs.map(rfq => (
                  <div key={rfq.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{rfq.shape_name ?? rfq.id.slice(0, 12)}</div>
                      <div style={{ fontSize: 11, color: C.dim }}>{rfq.user_email ?? '—'} · {fmtDate(rfq.created_at)}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: (STATUS_COLOR[rfq.status] ?? C.dim) + '22', color: STATUS_COLOR[rfq.status] ?? C.dim }}>
                      {rfq.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ── RECENT ORDERS ── */}
            {activeTab === 'orders' && (
              <div>
                <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: C.muted }}>{isKo ? `최근 주문 (${stats.recentOrders.length}건)` : `Recent Orders (${stats.recentOrders.length})`}</h2>
                {stats.recentOrders.length === 0 && <div style={{ color: C.dim, textAlign: 'center', padding: 40 }}>{isKo ? '주문 없음' : 'No orders'}</div>}
                {stats.recentOrders.map(order => (
                  <div key={order.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{order.part_name}</div>
                      <div style={{ fontSize: 11, color: C.dim }}>{order.manufacturer_name} · {fmtDate(order.created_at)}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{won(order.total_price_krw)}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: (STATUS_COLOR[order.status] ?? C.dim) + '22', color: STATUS_COLOR[order.status] ?? C.dim }}>
                      {order.status}
                    </span>
                    <a href={`/api/nexyfab/orders/${order.id}/pdf`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.muted, textDecoration: 'none' }}>📄</a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
