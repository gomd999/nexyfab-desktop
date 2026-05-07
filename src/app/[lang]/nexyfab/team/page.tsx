'use client';

import { useEffect, useState, use, Suspense, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  plan: string;
  created_at?: number;
}

interface Member {
  id: string;
  user_id: string;
  email: string;
  role: 'owner' | 'manager' | 'viewer';
  joined_at: number | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expires_at: number;
  created_at: number;
}

interface TeamAuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resourceId?: string;
  createdAt: number;
}

interface TeamProject {
  id: string;
  userId: string;
  ownerEmail: string;
  name: string;
  shapeId?: string;
  tags?: string[];
  updatedAt: number;
}

interface TeamBom {
  id: string;
  name: string;
  userId: string;
  status: string;
  updatedAt: number;
}

type TabKey = 'overview' | 'members' | 'projects' | 'activity' | 'settings' | 'bom';

// ─── Action labels ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { ko: string; en: string; icon: string }> = {
  'rfq.create':      { ko: 'RFQ 생성',      en: 'RFQ created',        icon: '📋' },
  'rfq.quoted':      { ko: 'RFQ 견적',       en: 'RFQ quoted',         icon: '💬' },
  'rfq.accepted':    { ko: 'RFQ 수락',       en: 'RFQ accepted',       icon: '✅' },
  'share.create':    { ko: '공유 링크 생성',  en: 'Share link created', icon: '🔗' },
  'contract.create': { ko: '계약 생성',       en: 'Contract created',   icon: '📄' },
  'login':           { ko: '로그인',          en: 'Logged in',          icon: '🔑' },
  'project.save':    { ko: '프로젝트 저장',   en: 'Project saved',      icon: '💾' },
  'bom.export':      { ko: 'BOM 내보내기',    en: 'BOM exported',       icon: '📊' },
  'api_key.create':  { ko: 'API 키 생성',     en: 'API key created',    icon: '🔐' },
  'bom.create':      { ko: 'BOM 생성',        en: 'BOM created',        icon: '📦' },
  'annotation':      { ko: '주석 추가',        en: 'Annotation added',   icon: '📝' },
};

function actionLabel(action: string, isKo: boolean): { label: string; icon: string } {
  const found = Object.entries(ACTION_LABELS).find(([k]) => action.startsWith(k));
  if (found) return { label: isKo ? found[1].ko : found[1].en, icon: found[1].icon };
  return { label: action, icon: '📌' };
}

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔵', sphere: '⚽', gear: '⚙️', pipe: '🔩',
  flange: '🔘', cone: '🔺', torus: '💿', default: '🧊',
};

function timeAgo(ts: number, isKo: boolean): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return isKo ? '방금 전' : 'just now';
  if (m < 60) return isKo ? `${m}분 전` : `${m}m ago`;
  if (h < 24) return isKo ? `${h}시간 전` : `${h}h ago`;
  return isKo ? `${d}일 전` : `${d}d ago`;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 7,
  background: '#0d1117', border: '1px solid #30363d',
  color: '#e6edf3', fontSize: 13, outline: 'none',
};

// ─── Component ────────────────────────────────────────────────────────────────

function TeamDashboardInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const { user, token } = useAuthStore();
  const isKo = isKorean(lang);

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [teams, setTeams] = useState<{ owned: Team[]; member: Team[] }>({ owned: [], member: [] });
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [teamProjects, setTeamProjects] = useState<TeamProject[]>([]);
  const [activityLogs, setActivityLogs] = useState<TeamAuditLog[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all'); // userId or 'all'
  const [teamBoms, setTeamBoms] = useState<TeamBom[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

  // Invite
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteIsError, setInviteIsError] = useState(false);

  // Create team
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Settings
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);

  // Transfer ownership
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState('');
  const [transferIsError, setTransferIsError] = useState(false);

  // Leave team
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Member ops
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  const isTeamPlan = user && ['team', 'enterprise'].includes(user.plan);

  // ── Fetch teams ─────────────────────────────────────────────────────────────

  const fetchTeams = useCallback(async () => {
    if (!token) return;
    setLoadingTeams(true);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { owned: Team[]; member: Team[] };
        setTeams(data);
        const all = [...data.owned, ...data.member];
        if (all.length > 0) {
          setSelectedTeam(prev => prev ? (all.find(t => t.id === prev.id) ?? all[0]) : all[0]);
        } else {
          setSelectedTeam(null);
        }
      }
    } finally { setLoadingTeams(false); }
  }, [token]);

  useEffect(() => { if (user && token) fetchTeams(); }, [user, token]);

  // ── Fetch members ─────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async (teamId: string) => {
    if (!token) return;
    const res = await fetch(`/api/nexyfab/teams/${teamId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { members: Member[]; pendingInvites?: PendingInvite[] };
      setMembers(data.members);
      setPendingInvites(data.pendingInvites ?? []);
    }
  }, [token]);

  // ── Fetch team projects ───────────────────────────────────────────────────

  const fetchTeamProjects = useCallback(async (teamId: string) => {
    if (!token) return;
    const res = await fetch(`/api/nexyfab/teams/${teamId}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { projects: TeamProject[] };
      setTeamProjects(data.projects ?? []);
    }
  }, [token]);

  // ── Fetch team activity ────────────────────────────────────────────────────

  const fetchActivity = useCallback(async (teamId: string) => {
    if (!token) return;
    const res = await fetch(`/api/nexyfab/teams/${teamId}/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { logs: TeamAuditLog[] };
      setActivityLogs(data.logs ?? []);
    }
  }, [token]);

  // ── Fetch team BOMs ───────────────────────────────────────────────────────

  const fetchTeamBoms = useCallback(async (teamId: string) => {
    if (!token) return;
    const res = await fetch(`/api/nexyfab/bom?teamId=${teamId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json() as { boms: { id: string; name: string; user_id: string; status: string; updated_at: number }[] };
      setTeamBoms(data.boms.map(b => ({ id: b.id, name: b.name, userId: b.user_id, status: b.status, updatedAt: b.updated_at })));
    }
  }, [token]);

  useEffect(() => {
    if (!selectedTeam || !token) return;
    setEditingName(selectedTeam.name);
    setActivityFilter('all');
    setLoadingContent(true);
    Promise.all([
      fetchMembers(selectedTeam.id),
      fetchTeamProjects(selectedTeam.id),
      fetchActivity(selectedTeam.id),
      fetchTeamBoms(selectedTeam.id),
    ]).finally(() => setLoadingContent(false));
  }, [selectedTeam?.id, token]);

  // ── Create team ─────────────────────────────────────────────────────────────

  const handleCreateTeam = async () => {
    if (!newTeamName.trim() || !token) return;
    setCreatingTeam(true);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (res.ok) { setNewTeamName(''); setShowCreateForm(false); await fetchTeams(); }
      else { const err = await res.json() as { error?: string }; alert(err.error ?? 'Error'); }
    } finally { setCreatingTeam(false); }
  };

  // ── Invite ───────────────────────────────────────────────────────────────────

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !selectedTeam || !token) return;
    setInviting(true); setInviteMsg('');
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeam.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (res.ok) { setInviteMsg(data.message ?? (isKo ? '초대 이메일을 발송했습니다.' : 'Invite sent.')); setInviteIsError(false); setInviteEmail(''); await fetchMembers(selectedTeam.id); }
      else { setInviteMsg(data.error ?? 'Error'); setInviteIsError(true); }
    } finally { setInviting(false); }
  };

  // ── Remove / revoke ──────────────────────────────────────────────────────────

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedTeam || !token) return;
    setRemovingId(memberId);
    try {
      await fetch(`/api/nexyfab/teams/${selectedTeam.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ memberId }),
      });
      await fetchMembers(selectedTeam.id);
    } finally { setRemovingId(null); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!selectedTeam || !token) return;
    setRemovingId(inviteId);
    try {
      await fetch(`/api/nexyfab/teams/${selectedTeam.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ inviteId }),
      });
      await fetchMembers(selectedTeam.id);
    } finally { setRemovingId(null); }
  };

  // ── Change role ──────────────────────────────────────────────────────────────

  const handleChangeRole = async (memberId: string, newRole: 'manager' | 'viewer') => {
    if (!selectedTeam || !token) return;
    setChangingRoleId(memberId);
    try {
      await fetch(`/api/nexyfab/teams/${selectedTeam.id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ memberId, role: newRole }),
      });
      await fetchMembers(selectedTeam.id);
    } finally { setChangingRoleId(null); }
  };

  const handleChangeInviteRole = async (inviteId: string, newRole: 'manager' | 'viewer') => {
    if (!selectedTeam || !token) return;
    setChangingRoleId(inviteId);
    try {
      await fetch(`/api/nexyfab/teams/${selectedTeam.id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ inviteId, role: newRole }),
      });
      await fetchMembers(selectedTeam.id);
    } finally { setChangingRoleId(null); }
  };

  // ── Rename / delete team ──────────────────────────────────────────────────────

  const handleRenameTeam = async () => {
    if (!selectedTeam || !editingName.trim() || !token) return;
    setSavingName(true);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ teamId: selectedTeam.id, name: editingName.trim() }),
      });
      if (res.ok) await fetchTeams();
    } finally { setSavingName(false); }
  };

  const handleDeleteTeam = async () => {
    if (!selectedTeam || !token) return;
    setDeletingTeam(true);
    try {
      const res = await fetch('/api/nexyfab/teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ teamId: selectedTeam.id }),
      });
      if (res.ok) { setSelectedTeam(null); setDeleteConfirm(false); await fetchTeams(); }
    } finally { setDeletingTeam(false); }
  };

  // ── Transfer ownership ────────────────────────────────────────────────────────

  const handleTransfer = async () => {
    if (!selectedTeam || !transferTargetId || !token) return;
    setTransferring(true); setTransferMsg('');
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeam.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
        body: JSON.stringify({ newOwnerId: transferTargetId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok) {
        setTransferMsg(isKo ? '소유권이 이전되었습니다.' : 'Ownership transferred.');
        setTransferIsError(false);
        setTransferConfirm(false); setTransferTargetId('');
        await fetchTeams(); await fetchMembers(selectedTeam.id);
      } else { setTransferMsg(data.error ?? 'Error'); setTransferIsError(true); }
    } finally { setTransferring(false); }
  };

  // ── Leave team ────────────────────────────────────────────────────────────────

  const handleLeaveTeam = async () => {
    if (!selectedTeam || !token) return;
    setLeaving(true);
    try {
      const res = await fetch(`/api/nexyfab/teams/${selectedTeam.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: window.location.origin },
      });
      if (res.ok) { setLeaveConfirm(false); setSelectedTeam(null); await fetchTeams(); }
    } finally { setLeaving(false); }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e6edf3' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <p style={{ color: '#6e7681' }}>{isKo ? '로그인이 필요합니다' : 'Sign in required'}</p>
          <button onClick={() => router.push(`/${lang}/nexyfab`)} style={{ marginTop: 12, padding: '10px 24px', borderRadius: 8, background: 'linear-gradient(135deg, #388bfd, #8b5cf6)', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            {isKo ? '홈으로' : 'Go home'}
          </button>
        </div>
      </div>
    );
  }

  if (!isTeamPlan) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', padding: '60px 32px', textAlign: 'center' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>👥</div>
          <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800 }}>
            {isKo ? '팀 협업은 Team 플랜에서' : 'Team Collaboration'}
          </h2>
          <p style={{ color: '#8b949e', marginBottom: 28, lineHeight: 1.6 }}>
            {isKo ? 'Team 플랜으로 업그레이드하면 팀원 초대, 공유 프로젝트, 활동 피드 등 협업 기능을 모두 사용할 수 있습니다.' : 'Upgrade to Team to invite members, share projects, view activity feeds, and more.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28, textAlign: 'left' }}>
            {[['👤','팀원 초대 & 역할 관리','Invite & manage roles'],['📁','팀 공유 프로젝트','Shared team projects'],['📋','팀 전체 활동 피드','Team activity feed'],['🔗','영구 공유 링크','Permanent share links'],['🔒','SSO / SAML 로그인','SSO / SAML login'],['🪝','웹훅 & API 통합','Webhooks & API']].map(([icon,ko,en]) => (
              <div key={en} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#c9d1d9' }}>
                <span>{icon}</span><span>{isKo ? ko : en}</span>
              </div>
            ))}
          </div>
          <a href={`/${lang}/nexyfab/pricing`} style={{ display: 'inline-block', padding: '12px 36px', borderRadius: 10, background: 'linear-gradient(135deg, #a371f7, #388bfd)', color: '#fff', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}>
            {isKo ? '⚡ Team 플랜으로 업그레이드' : '⚡ Upgrade to Team'}
          </a>
          <p style={{ marginTop: 16, color: '#6e7681', fontSize: 12 }}>
            {isKo ? '현재 플랜: ' : 'Current plan: '}<strong style={{ color: '#8b949e' }}>{user.plan.toUpperCase()}</strong>
          </p>
        </div>
      </div>
    );
  }

  const allTeams = [...teams.owned, ...teams.member];
  const isOwner = selectedTeam ? teams.owned.some(t => t.id === selectedTeam.id) : false;

  const TABS: { key: TabKey; icon: string; ko: string; en: string }[] = [
    { key: 'overview',  icon: '🏠', ko: '개요',    en: 'Overview'  },
    { key: 'members',   icon: '👥', ko: '팀원',    en: 'Members'   },
    { key: 'projects',  icon: '📁', ko: '프로젝트', en: 'Projects'  },
    { key: 'activity',  icon: '📋', ko: '활동',    en: 'Activity'  },
    { key: 'bom',       icon: '📦', ko: 'BOM',     en: 'BOM'       },
    { key: 'settings',  icon: '⚙️', ko: '설정',    en: 'Settings'  },
  ];

  // Filtered activity
  const filteredActivity = activityFilter === 'all'
    ? activityLogs
    : activityLogs.filter(l => l.userId === activityFilter);

  // Member map for transfer select
  const transferableMembers = members.filter(m => m.role !== 'owner');

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e6edf3' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #21262d', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: '#0d1117', zIndex: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 800 }}><span style={{ color: '#8b9cf4' }}>Nexy</span>Fab</span>
        <span style={{ color: '#30363d' }}>|</span>
        <span style={{ fontSize: 14, color: '#6e7681' }}>{isKo ? '팀 대시보드' : 'Team Dashboard'}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#a371f7', background: '#a371f718', borderRadius: 5, padding: '3px 10px' }}>TEAM</span>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px' }}>
        {loadingTeams ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6e7681' }}>{isKo ? '불러오는 중...' : 'Loading...'}</div>
        ) : (
          <>
          <style precedence="default" href="nexyfab-team">{`
            @media (max-width: 768px) {
              .team-sidebar { width: 100% !important; }
              .team-main { width: 100% !important; }
            }
          `}</style>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <div className="team-sidebar" style={{ width: 220, flexShrink: 0 }}>
              <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px 8px', fontSize: 11, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #21262d' }}>
                  {isKo ? '내 팀' : 'My Teams'}
                </div>
                {allTeams.length === 0 ? (
                  <div style={{ padding: '16px 14px', fontSize: 12, color: '#6e7681', textAlign: 'center' }}>{isKo ? '팀이 없습니다' : 'No teams yet'}</div>
                ) : allTeams.map(team => {
                  const active = selectedTeam?.id === team.id;
                  return (
                    <button key={team.id} onClick={() => { setSelectedTeam(team); setActiveTab('overview'); }} style={{ width: '100%', textAlign: 'left', border: 'none', background: active ? '#21262d' : 'transparent', borderLeft: `3px solid ${active ? '#a371f7' : 'transparent'}`, padding: '10px 14px', cursor: 'pointer', color: active ? '#e6edf3' : '#8b949e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #a371f7, #388bfd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                        {team.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{team.name}</span>
                      {teams.owned.some(t => t.id === team.id) && <span style={{ fontSize: 9, color: '#a371f7', fontWeight: 700 }}>{isKo ? '소유' : 'Own'}</span>}
                    </button>
                  );
                })}
                <div style={{ borderTop: '1px solid #21262d', padding: 10 }}>
                  {!showCreateForm ? (
                    <button onClick={() => setShowCreateForm(true)} style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: '1px dashed #30363d', background: 'transparent', color: '#6e7681', fontSize: 12, cursor: 'pointer' }}>
                      + {isKo ? '새 팀 만들기' : 'New team'}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input autoFocus value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleCreateTeam(); if (e.key === 'Escape') setShowCreateForm(false); }} placeholder={isKo ? '팀 이름' : 'Team name'} style={{ ...inputStyle, fontSize: 12 }} />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={handleCreateTeam} disabled={creatingTeam || !newTeamName.trim()} style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', background: '#388bfd', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                          {creatingTeam ? '...' : (isKo ? '생성' : 'Create')}
                        </button>
                        <button onClick={() => { setShowCreateForm(false); setNewTeamName(''); }} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid #30363d', background: 'transparent', color: '#6e7681', fontSize: 11, cursor: 'pointer' }}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Main ────────────────────────────────────────────────────── */}
            {selectedTeam ? (
              <div className="team-main" style={{ flex: 1, minWidth: 0 }}>
                {/* Title + tabs */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #a371f7, #388bfd)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                      {selectedTeam.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{selectedTeam.name}</h1>
                      <span style={{ fontSize: 12, color: '#6e7681' }}>
                        {members.length}{isKo ? '명' : ' members'}
                        {pendingInvites.length > 0 && ` · ${pendingInvites.length}${isKo ? '명 대기' : ' pending'}`}
                        {' · '}{isOwner ? (isKo ? '소유자' : 'Owner') : (isKo ? '멤버' : 'Member')}
                      </span>
                    </div>
                    {/* Leave team button (non-owner) */}
                    {!isOwner && (
                      <button onClick={() => setLeaveConfirm(true)} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer' }}>
                        {isKo ? '팀 탈퇴' : 'Leave team'}
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #21262d' }}>
                    {TABS.filter(t => t.key !== 'settings' || isOwner).map(tab => (
                      <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ padding: '8px 14px', border: 'none', background: 'transparent', color: activeTab === tab.key ? '#e6edf3' : '#6e7681', fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 400, cursor: 'pointer', borderBottom: `2px solid ${activeTab === tab.key ? '#a371f7' : 'transparent'}`, marginBottom: -1, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12 }}>{tab.icon}</span>
                        <span>{isKo ? tab.ko : tab.en}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {loadingContent ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#6e7681' }}>{isKo ? '불러오는 중...' : 'Loading...'}</div>
                ) : (
                  <>
                    {/* ═══ OVERVIEW ═══════════════════════════════════════ */}
                    {activeTab === 'overview' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
                        {[
                          { icon: '👥', label: isKo ? '팀원' : 'Members',   value: members.length },
                          { icon: '⏳', label: isKo ? '초대 대기' : 'Pending',  value: pendingInvites.length },
                          { icon: '📁', label: isKo ? '프로젝트' : 'Projects',  value: teamProjects.length },
                          { icon: '📋', label: isKo ? '활동 수' : 'Actions',   value: activityLogs.length },
                        ].map(s => (
                          <div key={s.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 18px' }}>
                            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                            <div style={{ fontSize: 22, fontWeight: 800 }}>{s.value}</div>
                            <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>{s.label}</div>
                          </div>
                        ))}
                        <div style={{ gridColumn: '1 / -1', background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 20px' }}>
                          <h3 style={{ margin: '0 0 12px', fontSize: 12, color: '#6e7681', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{isKo ? '최근 팀 활동' : 'Recent Team Activity'}</h3>
                          {activityLogs.slice(0, 6).length === 0 ? (
                            <p style={{ color: '#6e7681', fontSize: 13, margin: 0 }}>{isKo ? '아직 활동 기록이 없습니다.' : 'No activity yet.'}</p>
                          ) : activityLogs.slice(0, 6).map(log => {
                            const { label, icon } = actionLabel(log.action, isKo);
                            return (
                              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #21262d' }}>
                                <span style={{ fontSize: 15 }}>{icon}</span>
                                <span style={{ fontSize: 13, color: '#c9d1d9', flex: 1 }}>{label}</span>
                                <span style={{ fontSize: 11, color: '#8b949e', background: '#21262d', borderRadius: 4, padding: '1px 6px' }}>{log.userEmail}</span>
                                <span style={{ fontSize: 11, color: '#6e7681', whiteSpace: 'nowrap' }}>{timeAgo(log.createdAt, isKo)}</span>
                              </div>
                            );
                          })}
                          {activityLogs.length > 6 && (
                            <button onClick={() => setActiveTab('activity')} style={{ marginTop: 8, background: 'none', border: 'none', color: '#388bfd', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                              {isKo ? `+${activityLogs.length - 6}개 더 보기` : `View ${activityLogs.length - 6} more`}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ═══ MEMBERS ════════════════════════════════════════ */}
                    {activeTab === 'members' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {isOwner && (
                          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '16px 20px' }}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>{isKo ? '팀원 초대' : 'Invite Member'}</h3>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }} placeholder={isKo ? '이메일 주소' : 'Email address'} type="email" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'manager' | 'viewer')} style={inputStyle}>
                                <option value="viewer">{isKo ? '뷰어' : 'Viewer'}</option>
                                <option value="manager">{isKo ? '매니저' : 'Manager'}</option>
                              </select>
                              <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: inviteEmail.trim() ? '#388bfd' : '#21262d', color: inviteEmail.trim() ? '#fff' : '#6e7681', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                                {inviting ? '...' : (isKo ? '초대 발송' : 'Send invite')}
                              </button>
                            </div>
                            {inviteMsg && <p style={{ margin: '8px 0 0', fontSize: 12, color: inviteIsError ? '#f85149' : '#3fb950' }}>{inviteMsg}</p>}
                          </div>
                        )}

                        {/* Active members */}
                        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 20px', borderBottom: '1px solid #21262d', fontSize: 12, color: '#6e7681', fontWeight: 600 }}>
                            {isKo ? `활성 팀원 ${members.length}명` : `${members.length} active members`}
                          </div>
                          {members.length === 0 ? (
                            <div style={{ padding: '28px 20px', textAlign: 'center', color: '#6e7681', fontSize: 13 }}>{isKo ? '아직 팀원이 없습니다.' : 'No members yet.'}</div>
                          ) : members.map(member => (
                            <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid #21262d' }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: member.role === 'owner' ? 'linear-gradient(135deg,#d29922,#f0883e)' : member.role === 'manager' ? 'linear-gradient(135deg,#388bfd,#8b5cf6)' : 'linear-gradient(135deg,#3fb950,#388bfd)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                                {member.email.slice(0, 2).toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</p>
                                {member.joined_at && <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>{isKo ? '가입: ' : 'Joined: '}{new Date(member.joined_at).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}</p>}
                              </div>
                              {isOwner && member.role !== 'owner' ? (
                                <select value={member.role} disabled={changingRoleId === member.id} onChange={e => handleChangeRole(member.id, e.target.value as 'manager' | 'viewer')} style={{ ...inputStyle, fontSize: 11, padding: '4px 8px' }}>
                                  <option value="viewer">{isKo ? '뷰어' : 'Viewer'}</option>
                                  <option value="manager">{isKo ? '매니저' : 'Manager'}</option>
                                </select>
                              ) : (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: member.role === 'owner' ? '#d2992218' : member.role === 'manager' ? '#388bfd18' : '#3fb95018', color: member.role === 'owner' ? '#d29922' : member.role === 'manager' ? '#388bfd' : '#3fb950' }}>
                                  {member.role === 'owner' ? (isKo ? '소유자' : 'Owner') : member.role === 'manager' ? (isKo ? '매니저' : 'Manager') : (isKo ? '뷰어' : 'Viewer')}
                                </span>
                              )}
                              {isOwner && member.role !== 'owner' && (
                                <button onClick={() => handleRemoveMember(member.id)} disabled={removingId === member.id} style={{ background: 'none', border: '1px solid #30363d', borderRadius: 5, padding: '4px 8px', color: '#f85149', fontSize: 11, cursor: 'pointer' }}>
                                  {removingId === member.id ? '...' : (isKo ? '제거' : 'Remove')}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Pending invites */}
                        {pendingInvites.length > 0 && (
                          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 20px', borderBottom: '1px solid #21262d', fontSize: 12, color: '#f0883e', fontWeight: 600 }}>
                              ⏳ {isKo ? `초대 대기 ${pendingInvites.length}명` : `${pendingInvites.length} pending`}
                            </div>
                            {pendingInvites.map(inv => (
                              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid #21262d' }}>
                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#21262d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>📧</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.email}</p>
                                  <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>{isKo ? '만료: ' : 'Exp: '}{new Date(inv.expires_at).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}</p>
                                </div>
                                {isOwner && (
                                  <select value={inv.role} disabled={changingRoleId === inv.id} onChange={e => handleChangeInviteRole(inv.id, e.target.value as 'manager' | 'viewer')} style={{ ...inputStyle, fontSize: 11, padding: '4px 8px' }}>
                                    <option value="viewer">{isKo ? '뷰어' : 'Viewer'}</option>
                                    <option value="manager">{isKo ? '매니저' : 'Manager'}</option>
                                  </select>
                                )}
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#f0883e18', color: '#f0883e' }}>{isKo ? '대기' : 'Pending'}</span>
                                {isOwner && (
                                  <button onClick={() => handleRevokeInvite(inv.id)} disabled={removingId === inv.id} style={{ background: 'none', border: '1px solid #30363d', borderRadius: 5, padding: '4px 8px', color: '#f85149', fontSize: 11, cursor: 'pointer' }}>
                                    {removingId === inv.id ? '...' : (isKo ? '취소' : 'Revoke')}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══ PROJECTS ═══════════════════════════════════════ */}
                    {activeTab === 'projects' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>
                            {isKo ? `팀원 전체 프로젝트 ${teamProjects.length}개` : `${teamProjects.length} projects across team`}
                          </p>
                          <button
                            onClick={() => {
                              downloadCsv(`team-projects-${selectedTeam.id}.csv`, [
                                [isKo ? '이름' : 'Name', isKo ? '소유자' : 'Owner', isKo ? '수정일' : 'Updated'],
                                ...teamProjects.map(p => [p.name, p.ownerEmail, new Date(p.updatedAt).toISOString()]),
                              ]);
                            }}
                            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#6e7681', fontSize: 12, cursor: 'pointer' }}
                          >
                            ⬇ CSV
                          </button>
                          <button onClick={() => router.push(`/${lang}/shape-generator`)} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#388bfd,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            + {isKo ? '새 프로젝트' : 'New Project'}
                          </button>
                        </div>
                        {teamProjects.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '80px 0', background: '#161b22', border: '1px solid #30363d', borderRadius: 10 }}>
                            <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
                            <p style={{ color: '#6e7681', fontSize: 13 }}>{isKo ? '아직 팀 프로젝트가 없습니다.' : 'No team projects yet.'}</p>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 14 }}>
                            {teamProjects.map(p => (
                              <div key={p.id} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' }}
                                onClick={() => router.push(`/${lang}/shape-generator`)}
                                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#58a6ff'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#30363d'; }}
                              >
                                <div style={{ height: 90, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, borderBottom: '1px solid #21262d' }}>
                                  {SHAPE_ICONS[p.shapeId ?? 'default'] ?? '🧊'}
                                </div>
                                <div style={{ padding: '10px 12px' }}>
                                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.ownerEmail}</p>
                                  <p style={{ margin: '2px 0 0', fontSize: 10, color: '#6e7681' }}>{new Date(p.updatedAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══ ACTIVITY ════════════════════════════════════════ */}
                    {activeTab === 'activity' && (
                      <div>
                        {/* Filter bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#6e7681' }}>{isKo ? '필터:' : 'Filter:'}</span>
                          <button onClick={() => setActivityFilter('all')} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${activityFilter === 'all' ? '#a371f7' : '#30363d'}`, background: activityFilter === 'all' ? '#a371f718' : 'transparent', color: activityFilter === 'all' ? '#a371f7' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>
                            {isKo ? '전체' : 'All'}
                          </button>
                          {members.map(m => (
                            <button key={m.user_id} onClick={() => setActivityFilter(m.user_id)} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${activityFilter === m.user_id ? '#388bfd' : '#30363d'}`, background: activityFilter === m.user_id ? '#388bfd18' : 'transparent', color: activityFilter === m.user_id ? '#388bfd' : '#8b949e', fontSize: 12, cursor: 'pointer', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.email.split('@')[0]}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              downloadCsv(`team-activity-${selectedTeam.id}.csv`, [
                                [isKo ? '시간' : 'Time', isKo ? '팀원' : 'Member', isKo ? '작업' : 'Action', 'Resource ID'],
                                ...filteredActivity.map(l => [
                                  new Date(l.createdAt).toISOString(),
                                  l.userEmail,
                                  l.action,
                                  l.resourceId ?? '',
                                ]),
                              ]);
                            }}
                            style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#6e7681', fontSize: 12, cursor: 'pointer' }}
                          >
                            ⬇ CSV
                          </button>
                        </div>

                        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '12px 20px', borderBottom: '1px solid #21262d', fontSize: 12, color: '#6e7681', fontWeight: 600 }}>
                            {isKo ? '팀 활동 로그' : 'Team Activity Log'} ({filteredActivity.length})
                          </div>
                          {filteredActivity.length === 0 ? (
                            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#6e7681', fontSize: 13 }}>{isKo ? '활동 기록이 없습니다.' : 'No activity recorded.'}</div>
                          ) : filteredActivity.map((log, idx) => {
                            const { label, icon } = actionLabel(log.action, isKo);
                            return (
                              <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderBottom: idx < filteredActivity.length - 1 ? '1px solid #21262d' : 'none' }}>
                                <span style={{ width: 32, height: 32, borderRadius: 8, background: '#21262d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{icon}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: '0 0 2px', fontSize: 13, color: '#c9d1d9', fontWeight: 500 }}>{label}</p>
                                  <p style={{ margin: 0, fontSize: 11, color: '#8b949e' }}>{log.userEmail}</p>
                                  {log.resourceId && <p style={{ margin: 0, fontSize: 11, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ID: {log.resourceId}</p>}
                                </div>
                                <span style={{ fontSize: 11, color: '#6e7681', whiteSpace: 'nowrap', paddingTop: 2 }}>{timeAgo(log.createdAt, isKo)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ═══ BOM ═════════════════════════════════════════════ */}
                    {activeTab === 'bom' && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>
                            {isKo ? `팀 공유 BOM ${teamBoms.length}개` : `${teamBoms.length} shared BOMs`}
                          </p>
                        </div>
                        {teamBoms.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '60px 0', background: '#161b22', border: '1px solid #30363d', borderRadius: 10 }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                            <p style={{ color: '#6e7681', fontSize: 13 }}>
                              {isKo ? '팀과 공유된 BOM이 없습니다.' : 'No BOMs shared with team.'}
                            </p>
                            <p style={{ color: '#6e7681', fontSize: 11, marginTop: 4 }}>
                              {isKo ? 'BOM 생성 시 팀 ID를 지정하면 팀과 공유됩니다.' : 'Create a BOM with teamId to share with team.'}
                            </p>
                          </div>
                        ) : (
                          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden' }}>
                            {teamBoms.map((bom, idx) => (
                              <div key={bom.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: idx < teamBoms.length - 1 ? '1px solid #21262d' : 'none' }}>
                                <span style={{ fontSize: 22 }}>📦</span>
                                <div style={{ flex: 1 }}>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>{bom.name}</p>
                                  <p style={{ margin: 0, fontSize: 11, color: '#6e7681' }}>
                                    {new Date(bom.updatedAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US')}
                                  </p>
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: bom.status === 'draft' ? '#21262d' : '#3fb95018', color: bom.status === 'draft' ? '#6e7681' : '#3fb950' }}>
                                  {bom.status.toUpperCase()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══ SETTINGS ════════════════════════════════════════ */}
                    {activeTab === 'settings' && isOwner && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Rename */}
                        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '20px 24px' }}>
                          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>{isKo ? '팀 이름 변경' : 'Rename Team'}</h3>
                          <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6e7681' }}>{isKo ? '팀의 표시 이름을 변경합니다.' : 'Change how your team is displayed.'}</p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input value={editingName} onChange={e => setEditingName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRenameTeam(); }} style={{ ...inputStyle, flex: 1 }} />
                            <button onClick={handleRenameTeam} disabled={savingName || !editingName.trim() || editingName === selectedTeam.name} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: editingName.trim() && editingName !== selectedTeam.name ? '#388bfd' : '#21262d', color: editingName.trim() && editingName !== selectedTeam.name ? '#fff' : '#6e7681', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              {savingName ? '...' : (isKo ? '저장' : 'Save')}
                            </button>
                          </div>
                        </div>

                        {/* Team info */}
                        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '20px 24px' }}>
                          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>{isKo ? '팀 정보' : 'Team Info'}</h3>
                          {[
                            [isKo ? '팀 ID' : 'Team ID', selectedTeam.id],
                            [isKo ? '플랜' : 'Plan', (selectedTeam.plan ?? 'team').toUpperCase()],
                            [isKo ? '팀원 수' : 'Members', `${members.length}${isKo ? '명' : ''}`],
                            [isKo ? '초대 대기' : 'Pending', `${pendingInvites.length}${isKo ? '명' : ''}`],
                          ].map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #21262d', fontSize: 13 }}>
                              <span style={{ color: '#6e7681' }}>{k}</span>
                              <span style={{ color: '#c9d1d9', fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
                            </div>
                          ))}
                        </div>

                        {/* Transfer ownership */}
                        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '20px 24px' }}>
                          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>{isKo ? '소유권 이전' : 'Transfer Ownership'}</h3>
                          <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6e7681' }}>{isKo ? '소유권을 다른 팀원에게 이전합니다. 이전 후 본인은 매니저로 유지됩니다.' : 'Transfer ownership to another member. You will remain as manager.'}</p>
                          {transferableMembers.length === 0 ? (
                            <p style={{ margin: 0, fontSize: 13, color: '#6e7681' }}>{isKo ? '이전 가능한 팀원이 없습니다.' : 'No eligible members to transfer to.'}</p>
                          ) : (
                            <>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <select value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                                  <option value="">{isKo ? '팀원 선택...' : 'Select member...'}</option>
                                  {transferableMembers.map(m => (
                                    <option key={m.user_id} value={m.user_id}>{m.email} ({m.role})</option>
                                  ))}
                                </select>
                                <button onClick={() => setTransferConfirm(true)} disabled={!transferTargetId} style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: transferTargetId ? '#f0883e' : '#21262d', color: transferTargetId ? '#fff' : '#6e7681', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                                  {isKo ? '이전' : 'Transfer'}
                                </button>
                              </div>
                              {transferMsg && <p style={{ margin: '8px 0 0', fontSize: 12, color: transferIsError ? '#f85149' : '#3fb950' }}>{transferMsg}</p>}
                            </>
                          )}
                        </div>

                        {/* Danger zone */}
                        <div style={{ background: '#161b22', border: '1px solid #6e2020', borderRadius: 10, padding: '20px 24px' }}>
                          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#f85149' }}>{isKo ? '위험 구역' : 'Danger Zone'}</h3>
                          <p style={{ margin: '0 0 16px', fontSize: 12, color: '#8b949e' }}>{isKo ? '팀을 삭제하면 모든 팀원이 제거되고 복구할 수 없습니다.' : 'Deleting a team removes all members and cannot be undone.'}</p>
                          {!deleteConfirm ? (
                            <button onClick={() => setDeleteConfirm(true)} style={{ padding: '8px 20px', borderRadius: 7, border: '1px solid #f85149', background: 'transparent', color: '#f85149', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              {isKo ? '팀 삭제' : 'Delete Team'}
                            </button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1c0a0a', borderRadius: 8, padding: '12px 16px' }}>
                              <span style={{ fontSize: 13, color: '#f85149', flex: 1 }}>{isKo ? `"${selectedTeam.name}" 팀을 정말 삭제하시겠습니까?` : `Really delete "${selectedTeam.name}"?`}</span>
                              <button onClick={handleDeleteTeam} disabled={deletingTeam} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#da3633', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                {deletingTeam ? '...' : (isKo ? '삭제 확인' : 'Confirm')}
                              </button>
                              <button onClick={() => setDeleteConfirm(false)} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 12, cursor: 'pointer' }}>
                                {isKo ? '취소' : 'Cancel'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: '#6e7681', fontSize: 14 }}>
                {isKo ? '팀을 선택하거나 새 팀을 만드세요.' : 'Select a team or create a new one.'}
              </div>
            )}
          </div>
          </>
        )}
      </div>

      {/* ── Leave team confirm modal ─────────────────────────────────────── */}
      {leaveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '28px', width: 360, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🚪</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#e6edf3' }}>
              {isKo ? '팀을 탈퇴하시겠습니까?' : 'Leave this team?'}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
              {isKo ? `"${selectedTeam?.name}" 팀에서 탈퇴합니다. 다시 초대받을 때까지 접근할 수 없습니다.` : `You will lose access to "${selectedTeam?.name}" until re-invited.`}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setLeaveConfirm(false)} style={{ padding: '8px 20px', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button onClick={handleLeaveTeam} disabled={leaving} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#da3633', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {leaving ? '...' : (isKo ? '탈퇴 확인' : 'Leave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transfer ownership confirm modal ────────────────────────────── */}
      {transferConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '28px', width: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#e6edf3' }}>
              {isKo ? '소유권을 이전하시겠습니까?' : 'Transfer ownership?'}
            </h3>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
              {isKo ? `다음 팀원에게 소유권이 이전됩니다:` : 'New owner:'}
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
              {transferableMembers.find(m => m.user_id === transferTargetId)?.email}
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 12, color: '#6e7681' }}>
              {isKo ? '이전 후 본인은 매니저로 유지됩니다.' : 'You will remain as manager after transfer.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setTransferConfirm(false)} style={{ padding: '8px 20px', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
                {isKo ? '취소' : 'Cancel'}
              </button>
              <button onClick={handleTransfer} disabled={transferring} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#f0883e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {transferring ? '...' : (isKo ? '이전 확인' : 'Transfer')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamDashboard({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0d1117' }} />}>
      <TeamDashboardInner params={params} />
    </Suspense>
  );
}
