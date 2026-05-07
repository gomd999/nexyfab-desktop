'use client';

import { useEffect, useState, useCallback, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';
import { useProjectsStore } from '@/hooks/useProjects';
import AuthModal from '@/components/nexyfab/AuthModal';
import VerificationBanner from '@/components/nexyfab/VerificationBanner';
import OnboardingChecklist from '@/components/nexyfab/OnboardingChecklist';
import { useToast } from '@/components/ToastProvider';
import { formatDateTime } from '@/lib/formatDate';

// ─── Client-side 5-min cache ──────────────────────────────────────────────────
interface CachedActivity { id: string; type: 'rfq_submitted' | 'quote_received' | 'order_milestone' | 'contract_signed' | 'project_created'; message: string; createdAt: number }
const _cache: {
  summary?: { data: { activeProjects: number; pendingRfqs: number; activeOrders: number; monthlySpend: number }; ts: number };
  activity?: { data: CachedActivity[]; ts: number };
} = {};
const CACHE_TTL = 5 * 60 * 1000;

// ─── Dashboard summary types ───────────────────────────────────────────────────
interface DashboardSummary {
  activeProjects: number;
  pendingRfqs: number;
  activeOrders: number;
  monthlySpend: number;
}

interface ActivityItem {
  id: string;
  type: 'rfq_submitted' | 'quote_received' | 'order_milestone' | 'contract_signed' | 'project_created';
  message: string;
  createdAt: number;
}

interface R2File {
  id: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  category: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: number;
}

interface FilesStorage {
  used_bytes: number;
  used_gb: number;
  limit_gb: number;
  usage_percent: number;
}

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔵', sphere: '⚽', gear: '⚙️', pipe: '🔩',
  flange: '🔘', cone: '🔺', torus: '💿', sweep: '〰️', loft: '🌊',
  sketch: '✏️', default: '🧊',
};

// ─── AI Insight Panel ─────────────────────────────────────────────────────────
function NexyfabAIInsight({ summary, isKo, token }: {
  summary: { activeProjects: number; pendingRfqs: number; activeOrders: number; monthlySpend: number };
  isKo: boolean;
  token: string | null;
}) {
  const [insight, setInsight] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchInsight() {
    if (insight || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/ai-dashboard-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ summary, lang: isKo ? 'ko' : 'en' }),
      });
      const data = await res.json();
      setInsight(data.insight || '');
    } catch { setInsight(isKo ? '인사이트를 불러올 수 없습니다.' : 'Could not load insight.'); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, #1a1f35 0%, #161b22 100%)', border: '1px solid #30363d', borderRadius: 16, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 20 }}>✨</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: '0 0 2px', fontSize: 11, color: '#8b9cf4', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          AI {isKo ? '인사이트' : 'Insight'}
        </p>
        {insight ? (
          <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', lineHeight: 1.5 }}>{insight}</p>
        ) : loading ? (
          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>{isKo ? 'AI가 분석 중…' : 'Analyzing…'}</p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>{isKo ? '현황을 AI로 분석해보세요.' : 'Get AI analysis of your current status.'}</p>
        )}
      </div>
      {!insight && !loading && (
        <button
          onClick={fetchInsight}
          style={{ background: '#8b9cf4', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {isKo ? '분석 시작' : 'Analyze'}
        </button>
      )}
    </div>
  );
}

const PLAN_INFO: Record<string, { label: string; color: string; projectLimit: number }> = {
  free:       { label: 'Free',       color: '#6e7681', projectLimit: 3 },
  pro:        { label: 'Pro',        color: '#388bfd', projectLimit: Infinity },
  team:       { label: 'Team',       color: '#a371f7', projectLimit: Infinity },
  enterprise: { label: 'Enterprise', color: '#d29922', projectLimit: Infinity },
};

function NexyfabDashboardInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setUser, token } = useAuthStore();
  const { projects, isLoading, fetchProjects, deleteProject, duplicateProject } = useProjectsStore();
  const [showAuth, setShowAuth] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [upgradeToast, setUpgradeToast] = useState('');
  const { toast } = useToast();

  // Handle Stripe redirect with ?upgraded=true&plan=pro
  useEffect(() => {
    const upgraded = searchParams.get('upgraded');
    const plan = searchParams.get('plan') as 'pro' | 'team' | null;
    if (upgraded === 'true' && plan && user) {
      setUser({ ...user, plan }, token);
      setUpgradeToast(isKorean(lang) ? `${plan.toUpperCase()} 플랜으로 업그레이드되었습니다! 🎉` : `Upgraded to ${plan.toUpperCase()}! 🎉`);
      setTimeout(() => setUpgradeToast(''), 5000);
      router.replace(`/${lang}/nexyfab/dashboard`);
    }
  }, [searchParams]);
  const [activeTab, setActiveTab] = useState<'projects' | 'files' | 'teams' | 'rfqs' | 'orders'>('projects');
  const [r2Files, setR2Files] = useState<R2File[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesStorage, setFilesStorage] = useState<FilesStorage | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [shareToast, setShareToast] = useState('');

  // ── Teams state ─────────────────────────────────────────────────────────────
  interface TeamItem { id: string; name: string; plan: string; created_at?: number; role?: string }
  interface TeamMember { id: string; user_id: string; email: string; role: string; joined_at: number | null; display_name: string | null }
  interface TeamInvite { id: string; email: string; role: string; expires_at: number; created_at: number }
  const [ownedTeams, setOwnedTeams] = useState<TeamItem[]>([]);
  const [memberTeams, setMemberTeams] = useState<TeamItem[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [teamActionMsg, setTeamActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  interface TeamProject {
    id: string; userId: string; ownerEmail: string;
    name: string; shapeId?: string; updatedAt: number;
  }
  const [teamProjects, setTeamProjects] = useState<TeamProject[]>([]);
  const [teamProjectsLoading, setTeamProjectsLoading] = useState(false);
  const [showTeamProjects, setShowTeamProjects] = useState(false);

  // ── RFQ state ────────────────────────────────────────────────────────────────
  interface RFQItem {
    rfqId: string; shapeName: string; materialId: string;
    quantity: number; status: 'pending' | 'quoted' | 'accepted' | 'rejected';
    quoteAmount?: number; manufacturerNote?: string;
    createdAt: string; updatedAt: string;
  }
  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [rfqsLoading, setRfqsLoading] = useState(false);
  const [rfqTotal, setRfqTotal] = useState(0);
  const [acceptingRfq, setAcceptingRfq] = useState<string | null>(null);

  // ── Orders state ─────────────────────────────────────────────────────────────
  interface OrderItem {
    id: string; partName: string; manufacturerName: string;
    quantity: number; totalPriceKRW: number;
    status: 'placed' | 'production' | 'qc' | 'shipped' | 'delivered';
    paymentStatus: string | null; createdAt: number; estimatedDeliveryAt: number;
  }
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setOrdersLoading(true);
    try {
      const res = await fetch('/api/nexyfab/orders', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setOrders(d.orders ?? []);
      }
    } catch { /* ignore */ }
    finally { setOrdersLoading(false); }
  }, [token]);

  // ── Dashboard summary & activity ─────────────────────────────────────────────
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const isKo = isKorean(lang);

  const fetchFiles = useCallback(async () => {
    if (!token) return;
    setFilesLoading(true);
    try {
      const res = await fetch('/api/nexyfab/files?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setR2Files(data.files ?? []);
        setFilesStorage(data.storage ?? null);
        setLastRefreshed(new Date());
      } else {
        toast('error', isKo ? '파일 목록을 불러오지 못했습니다.' : 'Failed to load files.');
      }
    } catch {
      toast('error', isKo ? '파일 목록을 불러오지 못했습니다.' : 'Failed to load files.');
    } finally {
      setFilesLoading(false);
    }
  }, [token, isKo, toast]);

  const deleteFile = useCallback(async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/nexyfab/files?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setR2Files(prev => prev.filter(f => f.id !== id));
        setLastRefreshed(new Date());
      } else {
        toast('error', isKo ? '파일 삭제에 실패했습니다.' : 'Failed to delete file.');
      }
    } catch {
      toast('error', isKo ? '파일 삭제에 실패했습니다.' : 'Failed to delete file.');
    }
  }, [token, isKo, toast]);

  // ── Teams callbacks ──────────────────────────────────────────────────────────
  const fetchTeams = useCallback(async () => {
    if (!token) return;
    setTeamsLoading(true);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { owned: typeof ownedTeams; member: typeof memberTeams };
        setOwnedTeams(data.owned ?? []);
        setMemberTeams(data.member ?? []);
        if (!selectedTeamId && (data.owned?.length ?? 0) > 0) {
          setSelectedTeamId(data.owned[0].id);
        }
      } else {
        toast('error', isKo ? '팀 목록을 불러오지 못했습니다.' : 'Failed to load teams.');
      }
    } catch {
      toast('error', isKo ? '팀 목록을 불러오지 못했습니다.' : 'Failed to load teams.');
    } finally {
      setTeamsLoading(false);
    }
  }, [token, selectedTeamId, isKo, toast]);

  const fetchTeamMembers = useCallback(async (teamId: string) => {
    if (!token) return;
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/nexyfab/teams/${teamId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { members: TeamMember[]; pendingInvites: TeamInvite[] };
        setTeamMembers(data.members ?? []);
        setTeamInvites(data.pendingInvites ?? []);
      }
    } catch { /* ignore */ } finally {
      setMembersLoading(false);
    }
  }, [token]);

  const createTeam = useCallback(async () => {
    if (!token || !newTeamName.trim()) return;
    setCreatingTeam(true);
    setTeamActionMsg(null);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewTeamName('');
        setTeamActionMsg({ text: isKo ? '팀이 생성되었습니다!' : 'Team created!', ok: true });
        await fetchTeams();
        if (data.team?.id) setSelectedTeamId(data.team.id);
      } else {
        setTeamActionMsg({ text: data.error ?? (isKo ? '팀 생성 실패' : 'Failed to create team'), ok: false });
      }
    } catch {
      setTeamActionMsg({ text: isKo ? '팀 생성 중 오류가 발생했습니다.' : 'An error occurred.', ok: false });
    } finally {
      setCreatingTeam(false);
    }
  }, [token, newTeamName, isKo, fetchTeams]);

  const inviteMember = useCallback(async () => {
    if (!token || !selectedTeamId || !inviteEmail.trim()) return;
    setInviting(true);
    setTeamActionMsg(null);
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteEmail('');
        setTeamActionMsg({ text: isKo ? `초대 이메일을 발송했습니다!` : 'Invite sent!', ok: true });
        await fetchTeamMembers(selectedTeamId);
      } else {
        setTeamActionMsg({ text: data.error ?? (isKo ? '초대 실패' : 'Invite failed'), ok: false });
      }
    } catch {
      setTeamActionMsg({ text: isKo ? '초대 중 오류가 발생했습니다.' : 'An error occurred.', ok: false });
    } finally {
      setInviting(false);
    }
  }, [token, selectedTeamId, inviteEmail, inviteRole, isKo, fetchTeamMembers]);

  const revokeInvite = useCallback(async (inviteId: string) => {
    if (!token || !selectedTeamId) return;
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeamId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inviteId }),
      });
      if (res.ok) {
        setTeamInvites(prev => prev.filter(i => i.id !== inviteId));
      } else {
        toast('error', isKo ? '초대 취소에 실패했습니다.' : 'Failed to revoke invite.');
      }
    } catch {
      toast('error', isKo ? '초대 취소에 실패했습니다.' : 'Failed to revoke invite.');
    }
  }, [token, selectedTeamId, isKo, toast]);

  const removeMember = useCallback(async (memberId: string) => {
    if (!token || !selectedTeamId) return;
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeamId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        setTeamMembers(prev => prev.filter(m => m.id !== memberId));
      } else {
        toast('error', isKo ? '팀원 제거에 실패했습니다.' : 'Failed to remove member.');
      }
    } catch {
      toast('error', isKo ? '팀원 제거에 실패했습니다.' : 'Failed to remove member.');
    }
  }, [token, selectedTeamId, isKo, toast]);

  const fetchTeamProjects = useCallback(async (teamId: string) => {
    if (!token) return;
    setTeamProjectsLoading(true);
    try {
      const res = await fetch(`/api/nexyfab/teams/${teamId}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { projects: TeamProject[] };
        setTeamProjects(data.projects ?? []);
      }
    } catch { /* ignore */ } finally {
      setTeamProjectsLoading(false);
    }
  }, [token]);

  const fetchRfqs = useCallback(async () => {
    if (!token) return;
    setRfqsLoading(true);
    try {
      const res = await fetch('/api/nexyfab/rfq?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { rfqs: RFQItem[]; pagination: { total: number } };
        setRfqs(data.rfqs ?? []);
        setRfqTotal(data.pagination?.total ?? 0);
      }
    } catch { /* ignore */ } finally {
      setRfqsLoading(false);
    }
  }, [token]);

  const fetchSummary = useCallback(async () => {
    if (!token) return;
    const cached = _cache.summary;
    if (cached && Date.now() - cached.ts < CACHE_TTL) { setSummary(cached.data); return; }
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/nexyfab/dashboard/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as DashboardSummary;
        _cache.summary = { data, ts: Date.now() };
        setSummary(data);
      }
    } catch { /* silent */ } finally {
      setSummaryLoading(false);
    }
  }, [token]);

  const fetchActivity = useCallback(async () => {
    if (!token) return;
    const cached = _cache.activity;
    if (cached && Date.now() - cached.ts < CACHE_TTL) { setActivity(cached.data); return; }
    setActivityLoading(true);
    try {
      const res = await fetch('/api/nexyfab/dashboard/activity', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { activity: ActivityItem[] };
        const items = data.activity ?? [];
        _cache.activity = { data: items, ts: Date.now() };
        setActivity(items);
      }
    } catch { /* silent */ } finally {
      setActivityLoading(false);
    }
  }, [token]);

  const refreshAll = useCallback(() => {
    if (!user) return;
    delete _cache.summary;
    delete _cache.activity;
    fetchProjects();
    fetchFiles();
    fetchSummary();
    fetchActivity();
  }, [user, fetchProjects, fetchFiles, fetchSummary, fetchActivity]);

  useEffect(() => {
    if (user && token) {
      fetch('/api/nexyfab/onboarding', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => { if (!d.done) setShowOnboarding(true); })
        .catch(() => { if (!localStorage.getItem('nf_onboarding_done')) setShowOnboarding(true); });
    }
  }, [user, token]);

  useEffect(() => {
    if (user) {
      fetchProjects();
      fetchFiles();
      fetchRfqs(); // for onboarding checklist RFQ done status
      fetchSummary();
      fetchActivity();
    }
  }, [user, fetchProjects, fetchFiles, fetchRfqs, fetchSummary, fetchActivity]);

  useEffect(() => {
    if (activeTab === 'teams' && token) fetchTeams();
  }, [activeTab, token, fetchTeams]);

  useEffect(() => {
    if (activeTab === 'rfqs' && token) fetchRfqs();
  }, [activeTab, token, fetchRfqs]);

  useEffect(() => {
    if (activeTab === 'orders' && token) fetchOrders();
  }, [activeTab, token, fetchOrders]);

  useEffect(() => {
    if (selectedTeamId && token) fetchTeamMembers(selectedTeamId);
  }, [selectedTeamId, token, fetchTeamMembers]);

  // Auto-refresh when window regains focus
  useEffect(() => {
    if (!user) return;
    const onFocus = () => refreshAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, refreshAll]);

  const planInfo = PLAN_INFO[user?.plan ?? 'free'];
  const atLimit = user != null && projects.length >= planInfo.projectLimit;

  // Storage usage: sum sceneData lengths as proxy for R2 usage
  const storageBytesUsed = projects.reduce((s, p) => s + (p.sceneData?.length ?? 0), 0);
  const FREE_STORAGE_MB = 50;
  const storageLimitMB = (user?.plan === 'free' || !user?.plan) ? FREE_STORAGE_MB : Infinity;
  const storageUsedMB = storageBytesUsed / (1024 * 1024);
  const storagePercent = storageLimitMB === Infinity ? 0 : Math.min(100, (storageUsedMB / storageLimitMB) * 100);
  const storageNearLimit = storagePercent >= 80;

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.tags ?? []).some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117',
      fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e6edf3',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #21262d', padding: '16px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, background: '#0d1117', zIndex: 10,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{
          fontSize: 18, fontWeight: 800, color: '#e6edf3', textDecoration: 'none',
        }}>
          <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
        </Link>
        <span style={{ color: '#30363d' }}>|</span>
        <span style={{ fontSize: 14, color: '#6e7681' }}>{isKo ? '내 프로젝트' : 'My Projects'}</span>
        <div style={{ flex: 1 }} />
        {user && (
          <div style={{
            fontSize: 12, color: planInfo.color, fontWeight: 700,
            background: `${planInfo.color}18`, borderRadius: 6, padding: '3px 10px',
          }}>
            {planInfo.label}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {!user ? (
          /* Not logged in — demo banner + locked KPI cards */
          <>
            {/* Demo banner */}
            <div style={{
              background: 'linear-gradient(135deg, #1c2540, #1a1f2e)',
              border: '1px solid #388bfd55',
              borderRadius: 14, padding: '18px 24px', marginBottom: 28,
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <span style={{ fontSize: 28 }}>🔒</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, color: '#e6edf3' }}>
                  {isKo ? '로그인 후 대시보드를 이용하세요' : 'Sign in to access your dashboard'}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: '#6e7681' }}>
                  {isKo ? '프로젝트, RFQ, 주문, 지출을 한 눈에 확인할 수 있습니다.' : 'Track your projects, RFQs, orders, and spending in one place.'}
                </p>
              </div>
              <button onClick={() => setShowAuth(true)} style={{
                padding: '9px 22px', borderRadius: 8,
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
                {isKo ? '무료로 시작' : 'Get started free'}
              </button>
            </div>

            {/* Locked KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
              {[
                { label: isKo ? '활성 프로젝트' : 'Active Projects', icon: '📁' },
                { label: isKo ? '대기 중 RFQ' : 'Pending RFQs', icon: '📋' },
                { label: isKo ? '진행 중 주문' : 'Active Orders', icon: '🏭' },
                { label: isKo ? '이번달 지출' : 'Monthly Spend', icon: '💰' },
              ].map(card => (
                <div key={card.label} style={{
                  background: '#161b22', border: '1px solid #30363d',
                  borderRadius: 16, padding: '20px', position: 'relative', overflow: 'hidden',
                }}>
                  <p style={{ margin: '0 0 8px', fontSize: 11, color: '#6e7681', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {card.icon} {card.label}
                  </p>
                  <p style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: '#30363d' }}>—</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#388bfd', opacity: 0.7 }}>
                    {isKo ? '로그인 후 확인' : 'Sign in to view'}
                  </p>
                  <div style={{
                    position: 'absolute', inset: 0, backdropFilter: 'blur(2px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(13,17,23,0.25)',
                  }}>
                    <span style={{ fontSize: 20 }}>🔒</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick actions preview */}
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: '#6e7681', fontSize: 14, marginBottom: 20 }}>
                {isKo ? 'NexyFab에서 설계부터 제조까지 한 번에' : 'From design to manufacturing — all in one place'}
              </p>
              <button onClick={() => setShowAuth(true)} style={{
                padding: '10px 28px', borderRadius: 8,
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                {isKo ? '지금 시작하기 →' : 'Get started →'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                {isKo ? `${user.name}의 워크스페이스` : `${user.name}'s Workspace`}
              </h1>
              <div style={{ flex: 1 }} />
              {/* Refresh button + timestamp */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {lastRefreshed && (
                  <span style={{ fontSize: 10, color: '#6e7681' }}>
                    {isKo ? '최근 업데이트' : 'Updated'} {lastRefreshed.toLocaleTimeString()}
                  </span>
                )}
                <button
                  onClick={refreshAll}
                  disabled={isLoading || filesLoading}
                  title={isKo ? '새로고침' : 'Refresh'}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: '1px solid #30363d',
                    background: 'transparent', color: '#8b949e', fontSize: 13,
                    cursor: isLoading || filesLoading ? 'default' : 'pointer',
                    opacity: isLoading || filesLoading ? 0.5 : 1,
                  }}
                >
                  {isLoading || filesLoading ? '⏳' : '↺'}
                </button>
              </div>
              {/* Search (projects only) */}
              {activeTab === 'projects' && (
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={isKo ? '프로젝트 검색...' : 'Search projects...'}
                  style={{
                    padding: '7px 12px', borderRadius: 8, width: 200,
                    background: '#161b22', border: '1px solid #30363d',
                    color: '#e6edf3', fontSize: 13, outline: 'none',
                  }}
                />
              )}
              {/* New project button */}
              {activeTab === 'projects' && (
                <button
                  onClick={() => {
                    if (atLimit) {
                      toast('warning', isKo
                        ? 'Free 플랜은 3개까지 저장 가능합니다. Pro로 업그레이드하세요.'
                        : 'Upgrade to Pro for unlimited projects.');
                    } else {
                      router.push(`/${lang}/shape-generator`);
                    }
                  }}
                  style={{
                    padding: '8px 18px', borderRadius: 8, border: 'none',
                    background: atLimit ? '#21262d' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                    color: atLimit ? '#6e7681' : '#fff',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  + {isKo ? '새 프로젝트' : 'New Project'}
                </button>
              )}
            </div>

            {/* ── KPI Summary Cards ─────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
              {[
                {
                  label: isKo ? '활성 프로젝트' : 'Active Projects',
                  icon: '📁',
                  value: summaryLoading ? '...' : (summary?.activeProjects ?? 0).toString(),
                  trend: summaryLoading ? '' : (summary?.activeProjects ?? 0) > 0
                    ? (isKo ? `총 ${summary?.activeProjects}개 프로젝트` : `${summary?.activeProjects} total`)
                    : (isKo ? '아직 프로젝트 없음' : 'No projects yet'),
                  trendColor: '#6e7681',
                },
                {
                  label: isKo ? '대기 중 RFQ' : 'Pending RFQs',
                  icon: '📋',
                  value: summaryLoading ? '...' : (summary?.pendingRfqs ?? 0).toString(),
                  trend: summaryLoading ? '' : (summary?.pendingRfqs ?? 0) > 0
                    ? (isKo ? '검토 대기 중' : 'Awaiting review')
                    : (isKo ? '없음' : 'None pending'),
                  trendColor: (summary?.pendingRfqs ?? 0) > 0 ? '#d29922' : '#6e7681',
                },
                {
                  label: isKo ? '진행 중 주문' : 'Active Orders',
                  icon: '🏭',
                  value: summaryLoading ? '...' : (summary?.activeOrders ?? 0).toString(),
                  trend: summaryLoading ? '' : (summary?.activeOrders ?? 0) > 0
                    ? (isKo ? '생산/배송 중' : 'In production/shipping')
                    : (isKo ? '진행 중 없음' : 'None active'),
                  trendColor: (summary?.activeOrders ?? 0) > 0 ? '#3fb950' : '#6e7681',
                },
                {
                  label: isKo ? '이번달 지출' : 'Monthly Spend',
                  icon: '💰',
                  value: summaryLoading ? '...' : `₩${(summary?.monthlySpend ?? 0).toLocaleString('ko-KR')}`,
                  trend: summaryLoading ? '' : (isKo ? '이번달 주문 합계' : 'Total this month'),
                  trendColor: '#8b9cf4',
                },
              ].map(card => (
                <div key={card.label} style={{
                  background: '#161b22', border: '1px solid #30363d',
                  borderRadius: 16, padding: '20px', transition: 'border-color 0.15s',
                }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, color: '#6e7681', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {card.icon} {card.label}
                  </p>
                  <p style={{ margin: '0 0 5px', fontSize: 26, fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.02em' }}>
                    {card.value}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: card.trendColor }}>
                    {card.trend}
                  </p>
                </div>
              ))}
            </div>

            {/* ── AI 인사이트 ────────────────────────────────────────────── */}
            {summary && (summary.pendingRfqs > 0 || summary.activeOrders > 0 || summary.monthlySpend > 0) && (
              <NexyfabAIInsight
                summary={summary}
                isKo={isKo}
                token={token}
              />
            )}

            {/* ── Recent Activity Feed ──────────────────────────────────── */}
            <div style={{
              background: '#161b22', border: '1px solid #30363d',
              borderRadius: 16, padding: '18px 20px', marginBottom: 24,
            }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 800, color: '#e6edf3' }}>
                🕐 {isKo ? '최근 활동' : 'Recent Activity'}
              </h2>
              {activityLoading ? (
                <p style={{ color: '#6e7681', fontSize: 13, margin: 0, padding: '12px 0' }}>
                  {isKo ? '불러오는 중...' : 'Loading...'}
                </p>
              ) : activity.length === 0 ? (
                <p style={{ color: '#6e7681', fontSize: 13, margin: 0, padding: '8px 0' }}>
                  {isKo ? '아직 활동 내역이 없습니다.' : 'No recent activity yet.'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {activity.map((item, i) => {
                    const typeConfig: Record<ActivityItem['type'], { icon: string; border: string }> = {
                      rfq_submitted:  { icon: '📋', border: '#d29922' },
                      quote_received: { icon: '💬', border: '#388bfd' },
                      order_milestone:{ icon: '🏭', border: '#3fb950' },
                      contract_signed:{ icon: '📝', border: '#a371f7' },
                      project_created:{ icon: '📁', border: '#8b9cf4' },
                    };
                    const cfg = typeConfig[item.type] ?? { icon: '•', border: '#30363d' };
                    return (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: '10px 0',
                        borderBottom: i < activity.length - 1 ? '1px solid #21262d' : 'none',
                        borderLeft: `3px solid ${cfg.border}`,
                        paddingLeft: 12,
                        marginLeft: -12,
                      }}>
                        <span style={{ fontSize: 16, lineHeight: 1.4 }}>{cfg.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', fontWeight: 500 }}>
                            {item.message}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6e7681' }}>
                            {formatDateTime(item.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Quick Actions ─────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
              {[
                { icon: '✏️', title: isKo ? '새 설계 시작' : 'New Design', href: `/${lang}/shape-generator` },
                { icon: '📋', title: isKo ? 'RFQ 요청' : 'Request RFQ', href: `/${lang}/nexyfab/rfq` },
                { icon: '📦', title: isKo ? '주문 추적' : 'Track Orders', href: `/${lang}/nexyfab/orders` },
                { icon: '🏭', title: isKo ? '제조사 찾기' : 'Find Manufacturers', href: `/${lang}/nexyfab/marketplace` },
              ].map(action => (
                <Link
                  prefetch={action.href.includes('shape-generator')}
                  key={action.href}
                  href={action.href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: '#161b22', border: '1px solid #30363d',
                    borderRadius: 12, padding: '14px 16px',
                    textDecoration: 'none', color: '#e6edf3',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = '#58a6ff';
                    (e.currentTarget as HTMLAnchorElement).style.background = '#1c2c3e';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = '#30363d';
                    (e.currentTarget as HTMLAnchorElement).style.background = '#161b22';
                  }}
                >
                  <span style={{ fontSize: 20 }}>{action.icon}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{action.title}</span>
                  <span style={{ fontSize: 16, color: '#6e7681' }}>→</span>
                </Link>
              ))}
            </div>

            {/* Tab switcher */}
            <div style={{
              display: 'flex', gap: 0, marginBottom: 24,
              borderBottom: '1px solid #21262d',
            }}>
              {(['projects', 'rfqs', 'orders', 'files', 'teams'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '8px 20px', border: 'none', background: 'transparent',
                    color: activeTab === tab ? '#e6edf3' : '#6e7681',
                    fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                    cursor: 'pointer',
                    borderBottom: `2px solid ${activeTab === tab ? '#388bfd' : 'transparent'}`,
                    marginBottom: -1,
                    transition: 'color 0.15s',
                  }}
                >
                  {tab === 'projects'
                    ? `📁 ${isKo ? '프로젝트' : 'Projects'} (${projects.length})`
                    : tab === 'files'
                    ? `🗄️ ${isKo ? '파일' : 'Files'} (${r2Files.length})`
                    : tab === 'teams'
                    ? `👥 ${isKo ? '팀' : 'Teams'} (${ownedTeams.length + memberTeams.length})`
                    : tab === 'rfqs'
                    ? `📋 ${isKo ? '견적 요청' : 'RFQs'} (${rfqTotal})`
                    : `📦 ${isKo ? '주문' : 'Orders'} (${orders.length})`}
                </button>
              ))}
            </div>

            {/* Onboarding checklist */}
            {showOnboarding && (
              <OnboardingChecklist
                lang={lang}
                projects={projects}
                rfqCount={rfqTotal}
                user={user}
                onDismiss={() => {
                  setShowOnboarding(false);
                  localStorage.setItem('nf_onboarding_done', '1');
                  if (token) fetch('/api/nexyfab/onboarding', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
                }}
              />
            )}

            {/* Plan usage bar (only for limited plans) */}
            {planInfo.projectLimit !== Infinity && (
              <div style={{
                background: '#161b22', border: '1px solid #30363d',
                borderRadius: 10, padding: '12px 16px', marginBottom: 24,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#8b949e' }}>
                      {isKo ? '프로젝트 사용량' : 'Project usage'}
                    </span>
                    <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>
                      {projects.length} / {planInfo.projectLimit}
                    </span>
                  </div>
                  <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${Math.min(100, (projects.length / planInfo.projectLimit) * 100)}%`,
                      background: atLimit ? '#f85149' : '#388bfd',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
                {atLimit && (
                  <a href={`/${lang}/pricing`} style={{
                    padding: '6px 14px', borderRadius: 6,
                    background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                    color: '#fff', fontSize: 11, fontWeight: 700, textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}>
                    ⚡ Pro {isKo ? '업그레이드' : 'Upgrade'}
                  </a>
                )}
              </div>
            )}

            {/* Storage usage bar (free plan only) */}
            {storageLimitMB !== Infinity && (
              <div style={{
                background: '#161b22', border: `1px solid ${storageNearLimit ? '#d29922' : '#30363d'}`,
                borderRadius: 10, padding: '10px 16px', marginBottom: 16,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 14 }}>🗄️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>
                      {isKo ? '클라우드 저장 용량' : 'Cloud storage'}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: storageNearLimit ? '#d29922' : '#e6edf3' }}>
                      {storageUsedMB < 1 ? `${(storageUsedMB * 1024).toFixed(0)} KB` : `${storageUsedMB.toFixed(1)} MB`} / {storageLimitMB} MB
                    </span>
                  </div>
                  <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${storagePercent}%`,
                      background: storageNearLimit ? '#d29922' : '#3fb950',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
                {storageNearLimit && (
                  <a href={`/${lang}/pricing`} style={{
                    fontSize: 10, fontWeight: 700, color: '#d29922', textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}>
                    {isKo ? '용량 늘리기 →' : 'Increase →'}
                  </a>
                )}
              </div>
            )}

            {/* ── Projects tab ─────────────────────────────────────────────── */}
            {activeTab === 'projects' && (
              isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#6e7681' }}>
                  {isKo ? '불러오는 중...' : 'Loading...'}
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✏️</div>
                  <p style={{ color: '#6e7681', fontSize: 14 }}>
                    {search
                      ? (isKo ? '검색 결과가 없습니다' : 'No projects match your search')
                      : (isKo ? '아직 저장된 프로젝트가 없습니다. 새 프로젝트를 시작하세요!' : 'No projects yet. Start a new one!')}
                  </p>
                  {!search && (
                    <button onClick={() => router.push(`/${lang}/shape-generator`)} style={{
                      marginTop: 12, padding: '9px 22px', borderRadius: 8,
                      background: '#388bfd', border: 'none',
                      color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>
                      {isKo ? '첫 프로젝트 만들기' : 'Create your first project'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 16,
                }}>
                  {filtered.map(project => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      lang={lang}
                      isKo={isKo}
                      onOpen={() => router.push(`/${lang}/shape-generator?project=${project.id}`)}
                      onDelete={() => setDeleteConfirm(project.id)}
                      onDuplicate={async () => {
                        setDuplicating(project.id);
                        await duplicateProject(project.id);
                        setDuplicating(null);
                      }}
                      onShare={() => {
                        const url = `${window.location.origin}/${lang}/shape-generator?share=${project.id}`;
                        navigator.clipboard.writeText(url).then(() => {
                          setShareToast(isKo ? '공유 링크가 복사되었습니다!' : 'Share link copied!');
                          setTimeout(() => setShareToast(''), 3000);
                        });
                      }}
                      isDuplicating={duplicating === project.id}
                    />
                  ))}
                </div>
              )
            )}

            {/* ── RFQs tab ─────────────────────────────────────────────────── */}
            {activeTab === 'rfqs' && (
              <div>
                {rfqsLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#6e7681' }}>
                    {isKo ? '불러오는 중...' : 'Loading...'}
                  </div>
                ) : rfqs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '80px 0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <p style={{ color: '#6e7681', fontSize: 14 }}>
                      {isKo ? '아직 견적 요청이 없습니다.' : 'No quote requests yet.'}
                    </p>
                    <button
                      onClick={() => router.push(`/${lang}/shape-generator`)}
                      style={{
                        marginTop: 12, padding: '9px 22px', borderRadius: 8,
                        background: '#388bfd', border: 'none',
                        color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      {isKo ? '설계 시작하기' : 'Start designing'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid #21262d' }}>
                    {/* Header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 90px 70px 80px 100px 80px 90px',
                      padding: '9px 16px', background: '#161b22',
                      borderBottom: '1px solid #21262d',
                      fontSize: 11, fontWeight: 700, color: '#6e7681', letterSpacing: '0.04em',
                    }}>
                      <span>{isKo ? '부품명' : 'Part'}</span>
                      <span>{isKo ? '재질' : 'Material'}</span>
                      <span>{isKo ? '수량' : 'Qty'}</span>
                      <span>{isKo ? '상태' : 'Status'}</span>
                      <span>{isKo ? '견적가' : 'Quote'}</span>
                      <span>{isKo ? '요청일' : 'Date'}</span>
                      <span></span>
                    </div>
                    {rfqs.map((rfq, i) => {
                      const statusColor: Record<string, string> = {
                        pending: '#d29922', quoted: '#388bfd',
                        accepted: '#3fb950', rejected: '#f85149',
                      };
                      const statusLabel: Record<string, { ko: string; en: string }> = {
                        pending: { ko: '검토 중', en: 'Pending' },
                        quoted:  { ko: '견적 수신', en: 'Quoted' },
                        accepted: { ko: '수락됨', en: 'Accepted' },
                        rejected: { ko: '거절됨', en: 'Rejected' },
                      };
                      const isAccepting = acceptingRfq === rfq.rfqId;
                      return (
                        <div key={rfq.rfqId} style={{
                          display: 'grid', gridTemplateColumns: '1fr 90px 70px 80px 100px 80px 90px',
                          alignItems: 'center', padding: '11px 16px', gap: 4,
                          background: i % 2 === 0 ? '#0d1117' : '#161b22',
                          borderBottom: i < rfqs.length - 1 ? '1px solid #21262d' : 'none',
                        }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
                              {rfq.shapeName || `RFQ #${rfq.rfqId.slice(4, 12).toUpperCase()}`}
                            </div>
                            {rfq.manufacturerNote && (
                              <div style={{ fontSize: 10, color: '#6e7681', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                                💬 {rfq.manufacturerNote}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: '#8b949e' }}>{rfq.materialId}</div>
                          <div style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600 }}>{rfq.quantity.toLocaleString()}</div>
                          <div style={{
                            fontSize: 11, fontWeight: 700,
                            color: statusColor[rfq.status] ?? '#6e7681',
                            background: `${statusColor[rfq.status] ?? '#6e7681'}18`,
                            borderRadius: 4, padding: '2px 7px', textAlign: 'center',
                            display: 'inline-block',
                          }}>
                            {(statusLabel[rfq.status]?.[isKo ? 'ko' : 'en']) ?? rfq.status}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: rfq.quoteAmount ? '#3fb950' : '#6e7681' }}>
                            {rfq.quoteAmount
                              ? (isKo ? `₩${rfq.quoteAmount.toLocaleString()}` : `$${rfq.quoteAmount.toLocaleString()}`)
                              : '—'}
                          </div>
                          <div style={{ fontSize: 11, color: '#6e7681' }}>
                            {new Date(rfq.createdAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}
                          </div>
                          <div>
                            {rfq.status === 'quoted' && (
                              <button
                                disabled={isAccepting}
                                onClick={async () => {
                                  setAcceptingRfq(rfq.rfqId);
                                  try {
                                    const res = await fetch(`/api/nexyfab/rfq/${rfq.rfqId}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ status: 'accepted' }),
                                    });
                                    if (res.ok) {
                                      setRfqs(prev => prev.map(r => r.rfqId === rfq.rfqId ? { ...r, status: 'accepted' } : r));
                                      delete _cache.summary;
                                      delete _cache.activity;
                                      toast('success', isKo ? '견적을 수락했습니다.' : 'Quote accepted.');
                                    } else {
                                      toast('error', isKo ? '수락에 실패했습니다.' : 'Failed to accept quote.');
                                    }
                                  } catch {
                                    toast('error', isKo ? '수락에 실패했습니다.' : 'Failed to accept quote.');
                                  } finally {
                                    setAcceptingRfq(null);
                                  }
                                }}
                                style={{
                                  padding: '4px 10px', borderRadius: 5, border: 'none',
                                  background: isAccepting ? '#21262d' : '#3fb950',
                                  color: isAccepting ? '#6e7681' : '#fff',
                                  fontSize: 11, fontWeight: 700,
                                  cursor: isAccepting ? 'default' : 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isAccepting ? '...' : (isKo ? '✓ 수락' : '✓ Accept')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {rfqTotal > rfqs.length && (
                  <p style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#6e7681' }}>
                    {isKo ? `전체 ${rfqTotal}건 중 최근 50건 표시` : `Showing 50 of ${rfqTotal} total`}
                  </p>
                )}
              </div>
            )}

            {/* ── Orders tab ───────────────────────────────────────────────── */}
            {activeTab === 'orders' && (() => {
              const STATUS_LABEL: Record<string, { ko: string; en: string; color: string }> = {
                placed:     { ko: '주문 완료',  en: 'Placed',     color: '#388bfd' },
                production: { ko: '생산 중',    en: 'Production', color: '#f0883e' },
                qc:         { ko: '품질 검사',  en: 'QC',         color: '#e3b341' },
                shipped:    { ko: '배송 중',    en: 'Shipped',    color: '#79c0ff' },
                delivered:  { ko: '납품 완료',  en: 'Delivered',  color: '#3fb950' },
              };
              const STEP_IDX: Record<string, number> = { placed: 0, production: 1, qc: 2, shipped: 3, delivered: 4 };
              return (
                <div>
                  {ordersLoading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: '#6e7681' }}>
                      {isKo ? '불러오는 중...' : 'Loading...'}
                    </div>
                  ) : orders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '80px 0' }}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
                      <p style={{ color: '#6e7681', fontSize: 14 }}>
                        {isKo ? '아직 주문이 없습니다. 견적 요청을 수락하면 주문이 생성됩니다.' : 'No orders yet. Accept a quote to create an order.'}
                      </p>
                      <button
                        onClick={() => setActiveTab('rfqs')}
                        style={{
                          marginTop: 12, padding: '9px 22px', borderRadius: 8,
                          background: '#388bfd', border: 'none',
                          color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {isKo ? '견적 요청 보기' : 'View RFQs'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {orders.map(order => {
                        const sl = STATUS_LABEL[order.status];
                        const stepIdx = STEP_IDX[order.status] ?? 0;
                        const pct = Math.round((stepIdx / 4) * 100);
                        const isPaid = order.paymentStatus === 'paid';
                        const dday = Math.ceil((order.estimatedDeliveryAt - Date.now()) / 86400000);
                        return (
                          <div key={order.id} style={{
                            background: '#161b22', border: '1px solid #30363d',
                            borderRadius: 10, padding: '14px 18px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{order.partName}</span>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                                    background: (sl?.color ?? '#6e7681') + '22', color: sl?.color ?? '#6e7681',
                                  }}>{sl?.[isKo ? 'ko' : 'en'] ?? order.status}</span>
                                  {isPaid && (
                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: '#3fb95022', color: '#3fb950' }}>
                                      {isKo ? '결제완료' : 'Paid'}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>
                                  {order.manufacturerName} · {order.quantity.toLocaleString()}{isKo ? '개' : 'ea'} · ₩{order.totalPriceKRW.toLocaleString('ko-KR')}
                                </div>
                                <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 8 }}>
                                  {isKo ? '납기 예정' : 'ETA'}:{' '}
                                  {new Date(order.estimatedDeliveryAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}
                                  {dday > 0
                                    ? <span style={{ marginLeft: 6, color: '#e3b341', fontWeight: 700 }}>D-{dday}</span>
                                    : dday === 0
                                    ? <span style={{ marginLeft: 6, color: '#3fb950', fontWeight: 700 }}>D-Day</span>
                                    : <span style={{ marginLeft: 6, color: '#f85149', fontWeight: 700 }}>D+{Math.abs(dday)}</span>
                                  }
                                </div>
                                {/* Progress bar */}
                                <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: sl?.color ?? '#388bfd', transition: 'width 0.4s' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
                                  {(isKo ? ['주문', '생산', 'QC', '배송', '완료'] : ['Order', 'Prod', 'QC', 'Ship', 'Done']).map((s, i) => (
                                    <span key={i} style={{ color: i <= stepIdx ? sl?.color ?? '#388bfd' : '#484f58', fontWeight: i === stepIdx ? 700 : 400 }}>{s}</span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                                <a
                                  href={`/${lang}/nexyfab/orders`}
                                  style={{
                                    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    background: '#388bfd22', color: '#388bfd', textDecoration: 'none',
                                    border: '1px solid #388bfd44', textAlign: 'center', whiteSpace: 'nowrap',
                                  }}
                                >
                                  {isKo ? '상세 보기' : 'Details'}
                                </a>
                                <a
                                  href={`/api/nexyfab/orders/${order.id}/tax-invoice`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    background: 'transparent', color: '#e3b341', textDecoration: 'none',
                                    border: '1px solid #e3b34144', textAlign: 'center', whiteSpace: 'nowrap',
                                  }}
                                >
                                  🧾 {isKo ? '계산서' : 'Invoice'}
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ textAlign: 'center', marginTop: 8 }}>
                        <a
                          href={`/${lang}/nexyfab/orders`}
                          style={{ fontSize: 12, color: '#388bfd', textDecoration: 'none', fontWeight: 600 }}
                        >
                          {isKo ? '전체 주문 관리 →' : 'Manage all orders →'}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Teams tab ────────────────────────────────────────────────── */}
            {activeTab === 'teams' && (
              <div>
                {/* Team plan gate */}
                {user && !['team', 'enterprise'].includes(user.plan ?? '') ? (
                  <div style={{
                    background: '#161b22', border: '1px solid #a371f7',
                    borderRadius: 14, padding: '32px', textAlign: 'center',
                    maxWidth: 480, margin: '0 auto',
                  }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
                    <h3 style={{ margin: '0 0 8px', color: '#e6edf3', fontSize: 16, fontWeight: 800 }}>
                      {isKo ? '팀 협업은 Team 플랜부터' : 'Team collaboration requires Team plan'}
                    </h3>
                    <p style={{ margin: '0 0 20px', color: '#6e7681', fontSize: 13 }}>
                      {isKo
                        ? '팀원 초대, 공유 프로젝트, 실시간 협업 기능은 Team 플랜에서 사용 가능합니다.'
                        : 'Invite members, share projects, and collaborate in real-time with Team plan.'}
                    </p>
                    <a
                      href={`/${lang}/nexyfab/pricing`}
                      style={{
                        display: 'inline-block', padding: '10px 28px', borderRadius: 8,
                        background: 'linear-gradient(135deg, #a371f7, #388bfd)',
                        color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none',
                      }}
                    >
                      ⚡ {isKo ? 'Team으로 업그레이드' : 'Upgrade to Team'}
                    </a>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>
                    {/* Left: team list + create */}
                    <div>
                      {/* Create team */}
                      <div style={{
                        background: '#161b22', border: '1px solid #30363d',
                        borderRadius: 10, padding: '14px', marginBottom: 14,
                      }}>
                        <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#8b949e' }}>
                          {isKo ? '새 팀 만들기' : 'Create Team'}
                        </p>
                        <input
                          value={newTeamName}
                          onChange={e => setNewTeamName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void createTeam(); }}
                          placeholder={isKo ? '팀 이름...' : 'Team name...'}
                          style={{
                            width: '100%', padding: '7px 10px', borderRadius: 6,
                            background: '#0d1117', border: '1px solid #30363d',
                            color: '#e6edf3', fontSize: 12, outline: 'none',
                            boxSizing: 'border-box', marginBottom: 8,
                          }}
                        />
                        <button
                          onClick={() => void createTeam()}
                          disabled={creatingTeam || !newTeamName.trim()}
                          style={{
                            width: '100%', padding: '7px 0', borderRadius: 6, border: 'none',
                            background: newTeamName.trim() ? 'linear-gradient(135deg,#388bfd,#8b5cf6)' : '#21262d',
                            color: newTeamName.trim() ? '#fff' : '#6e7681',
                            fontSize: 12, fontWeight: 700, cursor: newTeamName.trim() ? 'pointer' : 'default',
                          }}
                        >
                          {creatingTeam ? '...' : (isKo ? '+ 팀 생성' : '+ Create')}
                        </button>
                      </div>

                      {/* Team list */}
                      {teamsLoading ? (
                        <div style={{ color: '#6e7681', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                          {isKo ? '불러오는 중...' : 'Loading...'}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {ownedTeams.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setSelectedTeamId(t.id)}
                              style={{
                                width: '100%', textAlign: 'left', padding: '9px 12px',
                                borderRadius: 8, border: `1px solid ${selectedTeamId === t.id ? '#388bfd' : '#30363d'}`,
                                background: selectedTeamId === t.id ? '#1c2c3e' : '#161b22',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>👑 {t.name}</div>
                              <div style={{ fontSize: 10, color: '#6e7681', marginTop: 2 }}>
                                {isKo ? '소유자' : 'Owner'}
                              </div>
                            </button>
                          ))}
                          {memberTeams.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setSelectedTeamId(t.id)}
                              style={{
                                width: '100%', textAlign: 'left', padding: '9px 12px',
                                borderRadius: 8, border: `1px solid ${selectedTeamId === t.id ? '#388bfd' : '#30363d'}`,
                                background: selectedTeamId === t.id ? '#1c2c3e' : '#161b22',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>🏢 {t.name}</div>
                              <div style={{ fontSize: 10, color: '#6e7681', marginTop: 2 }}>
                                {t.role === 'manager' ? (isKo ? '매니저' : 'Manager') : (isKo ? '뷰어' : 'Viewer')}
                              </div>
                            </button>
                          ))}
                          {ownedTeams.length === 0 && memberTeams.length === 0 && (
                            <p style={{ color: '#6e7681', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
                              {isKo ? '아직 팀이 없습니다' : 'No teams yet'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: team detail */}
                    <div>
                      {selectedTeamId ? (
                        <div style={{
                          background: '#161b22', border: '1px solid #30363d',
                          borderRadius: 12, overflow: 'hidden',
                        }}>
                          {/* Members section */}
                          <div style={{ padding: '16px 20px', borderBottom: '1px solid #21262d' }}>
                            <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 800, color: '#e6edf3' }}>
                              👥 {isKo ? '팀원' : 'Members'}
                            </h3>
                            {membersLoading ? (
                              <p style={{ color: '#6e7681', fontSize: 12 }}>{isKo ? '불러오는 중...' : 'Loading...'}</p>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #21262d' }}>
                                {teamMembers.length === 0 ? (
                                  <p style={{ padding: '12px 16px', color: '#6e7681', fontSize: 12, margin: 0 }}>
                                    {isKo ? '팀원이 없습니다. 아래에서 초대하세요.' : 'No members yet. Invite below.'}
                                  </p>
                                ) : teamMembers.map((m, i) => (
                                  <div key={m.id} style={{
                                    display: 'grid', gridTemplateColumns: '1fr 80px 80px 32px',
                                    alignItems: 'center', padding: '9px 14px', gap: 8,
                                    background: i % 2 === 0 ? '#0d1117' : '#161b22',
                                    borderBottom: i < teamMembers.length - 1 ? '1px solid #21262d' : 'none',
                                  }}>
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>
                                        {m.display_name ?? m.email}
                                      </div>
                                      <div style={{ fontSize: 10, color: '#6e7681' }}>{m.email}</div>
                                    </div>
                                    <div style={{
                                      fontSize: 10, fontWeight: 700,
                                      color: m.role === 'owner' ? '#d29922' : m.role === 'manager' ? '#388bfd' : '#6e7681',
                                      textAlign: 'center',
                                    }}>
                                      {m.role === 'owner' ? '👑 Owner' : m.role === 'manager' ? 'Manager' : 'Viewer'}
                                    </div>
                                    <div style={{ fontSize: 10, color: '#6e7681', textAlign: 'center' }}>
                                      {m.joined_at ? new Date(m.joined_at).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' }) : '-'}
                                    </div>
                                    {m.role !== 'owner' && ownedTeams.some(t => t.id === selectedTeamId) ? (
                                      <button
                                        onClick={() => void removeMember(m.id)}
                                        title={isKo ? '내보내기' : 'Remove'}
                                        style={{
                                          padding: 0, width: 24, height: 24, borderRadius: 4,
                                          border: 'none', background: 'transparent',
                                          color: '#6e7681', cursor: 'pointer', fontSize: 13,
                                        }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f85149'; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6e7681'; }}
                                      >✕</button>
                                    ) : <div />}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Invite form (owner/manager only) */}
                          {ownedTeams.some(t => t.id === selectedTeamId) && (
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid #21262d' }}>
                              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#8b949e' }}>
                                ✉️ {isKo ? '팀원 초대' : 'Invite member'}
                              </h4>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input
                                  value={inviteEmail}
                                  onChange={e => setInviteEmail(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') void inviteMember(); }}
                                  placeholder={isKo ? '이메일 주소...' : 'Email address...'}
                                  type="email"
                                  style={{
                                    flex: 1, padding: '8px 12px', borderRadius: 6,
                                    background: '#0d1117', border: '1px solid #30363d',
                                    color: '#e6edf3', fontSize: 12, outline: 'none',
                                  }}
                                />
                                <select
                                  value={inviteRole}
                                  onChange={e => setInviteRole(e.target.value as 'manager' | 'viewer')}
                                  style={{
                                    padding: '8px 6px', borderRadius: 6,
                                    background: '#0d1117', border: '1px solid #30363d',
                                    color: '#e6edf3', fontSize: 12, outline: 'none',
                                  }}
                                >
                                  <option value="viewer">{isKo ? '뷰어' : 'Viewer'}</option>
                                  <option value="manager">{isKo ? '매니저' : 'Manager'}</option>
                                </select>
                                <button
                                  onClick={() => void inviteMember()}
                                  disabled={inviting || !inviteEmail.trim()}
                                  style={{
                                    padding: '8px 16px', borderRadius: 6, border: 'none',
                                    background: inviteEmail.trim() ? '#388bfd' : '#21262d',
                                    color: inviteEmail.trim() ? '#fff' : '#6e7681',
                                    fontSize: 12, fontWeight: 700,
                                    cursor: inviteEmail.trim() ? 'pointer' : 'default',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {inviting ? '...' : (isKo ? '초대' : 'Invite')}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Pending invites */}
                          {teamInvites.length > 0 && (
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d' }}>
                              <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#8b949e' }}>
                                ⏳ {isKo ? '대기 중인 초대' : 'Pending invites'} ({teamInvites.length})
                              </h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {teamInvites.map(inv => (
                                  <div key={inv.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 10px', borderRadius: 7,
                                    background: '#0d1117', border: '1px solid #21262d',
                                  }}>
                                    <span style={{ flex: 1, fontSize: 12, color: '#8b949e' }}>{inv.email}</span>
                                    <span style={{ fontSize: 10, color: '#6e7681' }}>
                                      {inv.role === 'manager' ? (isKo ? '매니저' : 'Manager') : (isKo ? '뷰어' : 'Viewer')}
                                    </span>
                                    <span style={{ fontSize: 10, color: '#6e7681' }}>
                                      {isKo ? '만료' : 'Exp'}: {new Date(inv.expires_at).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                    <button
                                      onClick={() => void revokeInvite(inv.id)}
                                      title={isKo ? '초대 취소' : 'Revoke invite'}
                                      style={{
                                        padding: 0, width: 22, height: 22, borderRadius: 4,
                                        border: 'none', background: 'transparent',
                                        color: '#6e7681', cursor: 'pointer', fontSize: 12,
                                      }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f85149'; }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6e7681'; }}
                                    >✕</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Team shared projects */}
                          <div style={{ padding: '14px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#8b949e' }}>
                                📂 {isKo ? '팀 공유 설계' : 'Shared Designs'}
                              </h4>
                              <button
                                onClick={() => {
                                  setShowTeamProjects(true);
                                  void fetchTeamProjects(selectedTeamId);
                                }}
                                style={{
                                  padding: '4px 10px', borderRadius: 5, border: '1px solid #30363d',
                                  background: 'transparent', color: '#8b949e', fontSize: 11,
                                  cursor: 'pointer',
                                }}
                              >
                                {teamProjectsLoading ? '...' : (isKo ? '불러오기' : 'Load')}
                              </button>
                            </div>
                            {showTeamProjects && (
                              teamProjectsLoading ? (
                                <p style={{ color: '#6e7681', fontSize: 12 }}>{isKo ? '불러오는 중...' : 'Loading...'}</p>
                              ) : teamProjects.length === 0 ? (
                                <p style={{ color: '#6e7681', fontSize: 12 }}>
                                  {isKo ? '팀원 중 공유된 프로젝트가 없습니다.' : 'No shared projects from team members yet.'}
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #21262d' }}>
                                  {teamProjects.map((tp, i) => (
                                    <div key={tp.id} style={{
                                      display: 'grid', gridTemplateColumns: '28px 1fr 120px 80px',
                                      alignItems: 'center', padding: '9px 14px', gap: 8,
                                      background: i % 2 === 0 ? '#0d1117' : '#161b22',
                                      borderBottom: i < teamProjects.length - 1 ? '1px solid #21262d' : 'none',
                                    }}>
                                      <span style={{ fontSize: 18, textAlign: 'center' }}>
                                        {SHAPE_ICONS[tp.shapeId ?? ''] ?? SHAPE_ICONS.default}
                                      </span>
                                      <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{tp.name}</div>
                                        <div style={{ fontSize: 10, color: '#6e7681' }}>{tp.ownerEmail}</div>
                                      </div>
                                      <div style={{ fontSize: 10, color: '#6e7681', textAlign: 'right' }}>
                                        {new Date(tp.updatedAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' })}
                                      </div>
                                      <button
                                        onClick={() => router.push(`/${lang}/shape-generator?project=${tp.id}`)}
                                        style={{
                                          padding: '5px 10px', borderRadius: 5, border: '1px solid #30363d',
                                          background: '#21262d', color: '#8b949e',
                                          fontSize: 11, cursor: 'pointer',
                                        }}
                                      >
                                        {isKo ? '열기' : 'Open'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          background: '#161b22', border: '1px solid #30363d',
                          borderRadius: 12, padding: '40px', textAlign: 'center',
                        }}>
                          <p style={{ color: '#6e7681', fontSize: 13 }}>
                            {isKo ? '왼쪽에서 팀을 선택하거나 새 팀을 만드세요.' : 'Select a team or create a new one.'}
                          </p>
                        </div>
                      )}

                      {/* Action message */}
                      {teamActionMsg && (
                        <div style={{
                          marginTop: 10, padding: '8px 14px', borderRadius: 7,
                          background: teamActionMsg.ok ? '#1a2e1a' : '#2e1a1a',
                          border: `1px solid ${teamActionMsg.ok ? '#3fb950' : '#f85149'}`,
                          color: teamActionMsg.ok ? '#3fb950' : '#f85149',
                          fontSize: 12, fontWeight: 700,
                        }}>
                          {teamActionMsg.ok ? '✓' : '✕'} {teamActionMsg.text}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Files tab ────────────────────────────────────────────────── */}
            {activeTab === 'files' && (
              <div>
                {/* R2 storage bar */}
                {filesStorage && (
                  <div style={{
                    background: '#161b22', border: `1px solid ${filesStorage.usage_percent >= 80 ? '#d29922' : '#30363d'}`,
                    borderRadius: 10, padding: '10px 16px', marginBottom: 16,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span style={{ fontSize: 14 }}>☁️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#8b949e' }}>
                          {isKo ? 'R2 저장소 사용량' : 'R2 Storage used'}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: filesStorage.usage_percent >= 80 ? '#d29922' : '#e6edf3' }}>
                          {filesStorage.used_gb < 0.001
                            ? `${(filesStorage.used_bytes / 1024).toFixed(0)} KB`
                            : `${filesStorage.used_gb.toFixed(2)} GB`}
                          {' '}/ {filesStorage.limit_gb} GB
                        </span>
                      </div>
                      <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${Math.min(100, filesStorage.usage_percent)}%`,
                          background: filesStorage.usage_percent >= 80 ? '#d29922' : '#3fb950',
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  </div>
                )}

                {filesLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#6e7681' }}>
                    {isKo ? '불러오는 중...' : 'Loading...'}
                  </div>
                ) : r2Files.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '80px 0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🗄️</div>
                    <p style={{ color: '#6e7681', fontSize: 14 }}>
                      {isKo ? '업로드된 파일이 없습니다' : 'No files uploaded yet'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid #21262d' }}>
                    {/* Table header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 100px 100px 140px 80px',
                      padding: '8px 14px', background: '#161b22',
                      borderBottom: '1px solid #21262d',
                      fontSize: 11, fontWeight: 700, color: '#6e7681', letterSpacing: '0.05em',
                    }}>
                      <span>{isKo ? '파일명' : 'Filename'}</span>
                      <span>{isKo ? '종류' : 'Type'}</span>
                      <span>{isKo ? '크기' : 'Size'}</span>
                      <span>{isKo ? '업로드 일시' : 'Uploaded'}</span>
                      <span></span>
                    </div>

                    {r2Files.map((file, i) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        isKo={isKo}
                        isEven={i % 2 === 0}
                        token={token}
                        onDelete={() => setDeleteFileConfirm(file.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirm dialog */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d',
            borderRadius: 12, padding: '24px', width: 320, textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#e6edf3' }}>
              {isKo ? '이 프로젝트를 삭제하시겠습니까?' : 'Delete this project?'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                padding: '8px 20px', borderRadius: 6, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', cursor: 'pointer',
              }}>
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  await deleteProject(deleteConfirm);
                  setDeleteConfirm(null);
                }}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: '#da3633', color: '#fff', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {isKo ? '삭제' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File delete confirm dialog */}
      {deleteFileConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#161b22', border: '1px solid #30363d',
            borderRadius: 12, padding: '24px', width: 320, textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#e6edf3' }}>
              {isKo ? '이 파일을 R2에서 영구 삭제하시겠습니까?' : 'Permanently delete this file from R2?'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setDeleteFileConfirm(null)} style={{
                padding: '8px 20px', borderRadius: 6, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', cursor: 'pointer',
              }}>
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  await deleteFile(deleteFileConfirm);
                  setDeleteFileConfirm(null);
                }}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: '#da3633', color: '#fff', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {isKo ? '삭제' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
      <VerificationBanner lang={lang} />

      {/* Share link copied toast */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
          background: '#1a2332', border: '1px solid #388bfd', borderRadius: 10,
          padding: '10px 20px', color: '#58a6ff', fontSize: 13, fontWeight: 700,
          zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          🔗 {shareToast}
        </div>
      )}

      {/* Upgrade success toast */}
      {upgradeToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1a2e1a', border: '1px solid #3fb950', borderRadius: 10,
          padding: '12px 24px', color: '#3fb950', fontSize: 14, fontWeight: 700,
          zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {upgradeToast}
        </div>
      )}

      <style precedence="default" href="nexyfab-dashboard">{`
        .project-card:hover .delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

// ─── ProjectCard subcomponent ─────────────────────────────────────────────────

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    thumbnail?: string;
    shapeId?: string;
    materialId?: string;
    tags?: string[];
    updatedAt: number;
  };
  lang: string;
  isKo: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  isDuplicating: boolean;
}

function ProjectCard({ project, lang, isKo, onOpen, onDelete, onDuplicate, onShare, isDuplicating }: ProjectCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="project-card"
      style={{
        background: '#161b22',
        border: `1px solid ${hovered ? '#58a6ff' : '#30363d'}`,
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'border-color 0.15s, transform 0.15s',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      {/* Thumbnail */}
      <div style={{
        height: 140, background: '#0d1117',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid #21262d', fontSize: 48,
      }}>
        {project.thumbnail
          ? <img src={project.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : (SHAPE_ICONS[project.shapeId ?? 'default'] ?? '🧊')}
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px' }}>
        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
          {project.name}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>
          {new Date(project.updatedAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}
          {project.materialId && <span style={{ marginLeft: 6, color: '#388bfd' }}>· {project.materialId}</span>}
        </p>
        {project.tags && project.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
            {project.tags.slice(0, 3).map(tag => (
              <span key={tag} style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4,
                background: '#21262d', color: '#8b949e',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons row */}
        <div style={{
          display: 'flex', gap: 4, marginTop: 8,
          borderTop: '1px solid #21262d', paddingTop: 8,
        }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onDuplicate}
            disabled={isDuplicating}
            title={isKo ? '복제' : 'Duplicate'}
            style={{
              flex: 1, padding: '4px 0', borderRadius: 5,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 11, cursor: isDuplicating ? 'default' : 'pointer',
              opacity: isDuplicating ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!isDuplicating) e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#58a6ff'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          >
            {isDuplicating ? '⏳' : '📋'} {isKo ? '복제' : 'Copy'}
          </button>
          <button
            onClick={onShare}
            title={isKo ? '공유 링크 복사' : 'Copy share link'}
            style={{
              flex: 1, padding: '4px 0', borderRadius: 5,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 11, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#3fb950'; e.currentTarget.style.color = '#3fb950'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          >
            🔗 {isKo ? '공유' : 'Share'}
          </button>
          <button
            onClick={onDelete}
            title={isKo ? '삭제' : 'Delete'}
            style={{
              padding: '4px 10px', borderRadius: 5,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 11, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f85149'; e.currentTarget.style.color = '#f85149'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          >
            🗑
          </button>
        </div>
      </div>

      {/* Delete button — shown on card hover via CSS (top right) */}
      <div
        className="delete-btn"
        style={{
          position: 'absolute', top: 8, right: 8,
          opacity: 0, transition: 'opacity 0.15s',
        }}
      />
    </div>
  );
}

// ─── FileRow subcomponent ─────────────────────────────────────────────────────

const FILE_EXT_ICON: Record<string, string> = {
  step: '🔩', stp: '🔩', stl: '🖨️', obj: '🧊', blend: '🎨',
  pdf: '📄', dwg: '📐', dxf: '📐', doc: '📝', docx: '📝',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️', gif: '🖼️',
  zip: '🗜️', rar: '🗜️',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileRowProps {
  file: R2File;
  isKo: boolean;
  isEven: boolean;
  token: string | null;
  onDelete: () => void;
}

function FileRow({ file, isKo, isEven, token, onDelete }: FileRowProps) {
  const [hovered, setHovered] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
  const icon = FILE_EXT_ICON[ext] ?? '📎';
  const date = new Date(file.created_at);

  async function handleDownload() {
    if (!token) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/nexyfab/files/${file.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '1fr 100px 100px 140px 80px',
        padding: '9px 14px', alignItems: 'center',
        background: hovered ? '#1c2128' : isEven ? '#0d1117' : '#161b22',
        borderBottom: '1px solid #21262d',
        transition: 'background 0.1s',
        fontSize: 12,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ color: '#e6edf3', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        <span>{icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.filename}
        </span>
        {file.category !== 'general' && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3,
            background: '#21262d', color: '#8b949e', flexShrink: 0,
          }}>
            {file.category}
          </span>
        )}
      </span>
      <span style={{ color: '#6e7681', fontSize: 11 }}>{ext.toUpperCase() || '—'}</span>
      <span style={{ color: '#6e7681', fontSize: 11 }}>{formatBytes(file.size_bytes)}</span>
      <span style={{ color: '#6e7681', fontSize: 11 }}>
        {date.toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}
        {' '}
        <span style={{ color: '#30363d' }}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </span>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            padding: '3px 8px', borderRadius: 4, border: '1px solid #30363d',
            background: 'transparent', color: downloading ? '#3fb950' : '#8b949e',
            fontSize: 11, cursor: downloading ? 'default' : 'pointer',
          }}
          onMouseEnter={e => { if (!downloading) { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#58a6ff'; }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          title={isKo ? '다운로드' : 'Download'}
        >
          {downloading ? '⏳' : '↓'}
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: '3px 7px', borderRadius: 4, border: '1px solid #30363d',
            background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f85149'; e.currentTarget.style.color = '#f85149'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          title={isKo ? '삭제' : 'Delete'}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

export default function NexyfabDashboard({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0d1117' }} />}>
      <NexyfabDashboardInner params={params} />
    </Suspense>
  );
}
