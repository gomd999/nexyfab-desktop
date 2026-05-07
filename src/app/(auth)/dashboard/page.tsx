'use client';

import React, { Suspense, useState, useEffect, useMemo } from 'react';
// Image import removed — using initials avatar
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import NotificationBell from '@/app/components/NotificationBell';
import NexyfabNotificationBell from '@/app/components/NexyfabNotificationBell';
import {
    RATE_TIERS,
    PLAN_MIN_FEE,
    MOCK_PROJECTS,
    MOCK_COMMISSIONS,
    type Project, type ProjectStatus, type CommissionRecord,
} from '@/lib/mockData';

/** Same-origin API: 쿠키 세션을 항상 전송 */
function credFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, { credentials: 'include', ...init });
}

/** `/api/inquiries` 등에서 오는 문의 행 (대시보드 목록용 최소 필드) */
interface InquiryListRow {
    id: string;
    projectName?: string;
    category?: string;
    shapeId?: string;
    status?: string;
    createdAt?: string;
    date?: string;
    updatedAt?: string;
    factoriesCount?: number;
    quotesCount?: number;
    estimatedAmount?: number;
    plan?: string;
}

function inquiryToProject(inq: InquiryListRow): Project {
    const statusMap: Record<string, ProjectStatus> = {
        pending: 'submitted',
        contacted: 'matching',
        rfp_sent: 'rfp_sent',
        quotes_received: 'quotes_received',
        confirmed: 'confirmed',
        contracted: 'contracted',
        closed: 'contracted',
    };
    const rawStatus = inq.status ?? '';
    const mapped = rawStatus in statusMap ? statusMap[rawStatus] : undefined;
    return {
        id: inq.id,
        name: inq.projectName ?? '(제목 없음)',
        category: inq.category || inq.shapeId || '제조 부품',
        status: mapped ?? 'submitted',
        submittedAt: inq.createdAt?.slice(0, 10) || inq.date?.slice(0, 10) || '',
        updatedAt: inq.updatedAt?.slice(0, 10) || inq.date?.slice(0, 10) || '',
        factories: inq.factoriesCount || 0,
        quotesReceived: inq.quotesCount || 0,
        estimatedAmount: inq.estimatedAmount || undefined,
        plan: inq.plan === 'premium' ? 'premium' : 'standard',
    };
}

const blue = '#0b5cff';

const AUDIT_ACTION_KO_MAP: Record<string, string> = {
    'project.invite_create': '이메일 초대 생성',
    'project.invite_revoke': '이메일 초대 폐기',
    'project.invite_accept': '초대 수락(멤버 가입)',
    'project.member_add': '멤버 추가',
    'project.member_remove': '멤버 제거',
    'project.update': '클라우드 저장/수정',
    'project.update_conflict': '저장 충돌(동시 편집)',
    'project.archive': '보관함 이동',
    'project.unarchive': '보관 해제',
    'project.delete': '프로젝트 삭제',
    'project.create': '프로젝트 생성',
    'project.version_restore': '버전 복원',
};

const AUDIT_ACTION_EN_MAP: Record<string, string> = {
    'project.invite_create': 'Email invite created',
    'project.invite_revoke': 'Email invite revoked',
    'project.invite_accept': 'Invite accepted (member joined)',
    'project.member_add': 'Member added',
    'project.member_remove': 'Member removed',
    'project.update': 'Cloud save / update',
    'project.update_conflict': 'Save conflict (concurrent edit)',
    'project.archive': 'Project archived',
    'project.unarchive': 'Project unarchived',
    'project.delete': 'Project deleted',
    'project.create': 'Project created',
    'project.version_restore': 'Version restored',
};

function projectAuditCopy(lang: string) {
    const ko = lang === 'kr' || lang === 'ko';
    if (ko) {
        return {
            sectionTitle: '프로젝트 활동 (감사 로그)',
            loading: '불러오는 중…',
            planNote: 'Pro 이상 플랜에서 이 프로젝트에 연결된 저장·초대·멤버 변경 기록을 조회할 수 있습니다. (계정 플랜 업그레이드 후 다시 열어 주세요.)',
            loadFail: '활동 기록을 불러오지 못했습니다.',
            empty: '아직 기록된 활동이 없습니다.',
            actorPrefix: '주체 ID',
            auditCsv: 'CSV',
            auditCsvTitle: '이 프로젝트 감사 로그를 CSV로 저장',
        };
    }
    return {
        sectionTitle: 'Project activity (audit log)',
        loading: 'Loading…',
        planNote: 'Upgrade to Pro or higher to view save, invite, and member changes for this project.',
        loadFail: 'Could not load activity.',
        empty: 'No recorded activity yet.',
        actorPrefix: 'Actor',
        auditCsv: 'CSV',
        auditCsvTitle: 'Download this project audit log as CSV',
    };
}

function formatProjectAuditAction(lang: string, action: string): string {
    const ko = lang === 'kr' || lang === 'ko';
    if (ko) return AUDIT_ACTION_KO_MAP[action] ?? action;
    return AUDIT_ACTION_EN_MAP[action] ?? action;
}

interface NexysysUser {
    sub: string; email: string; name: string; role: string;
    services: string[]; avatar: string; language: string; title?: string;
}

// ── Status helpers ───────────────────────────────────────────────────────────
const STATUS_STEPS: ProjectStatus[] = ['submitted', 'matching', 'rfp_sent', 'quotes_received', 'confirmed', 'contracted'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    submitted: '접수 완료', matching: '공장 매칭 중', rfp_sent: 'RFP 발송 완료',
    quotes_received: '견적 수신 완료', confirmed: '최종 확정', contracted: '계약 완료',
};
const STATUS_COLOR: Record<ProjectStatus, string> = {
    submitted: '#6b7280', matching: '#f59e0b', rfp_sent: '#3b82f6',
    quotes_received: '#8b5cf6', confirmed: '#10b981', contracted: '#059669',
};

function StatusBadge({ status }: { status: ProjectStatus }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: STATUS_COLOR[status] + '18', color: STATUS_COLOR[status], borderRadius: '20px', padding: '3px 12px', fontSize: '12px', fontWeight: 700 }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLOR[status], display: 'inline-block' }} />
            {STATUS_LABEL[status]}
        </span>
    );
}

function PlanBadge({ plan }: { plan: 'standard' | 'premium' }) {
    return (
        <span style={{ display: 'inline-block', background: plan === 'premium' ? blue + '18' : '#f3f4f6', color: plan === 'premium' ? blue : '#6b7280', borderRadius: '8px', padding: '2px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
            {plan === 'premium' ? '⭐ Premium' : 'Standard'}
        </span>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────
type Tab = 'overview' | 'designs' | 'contracts' | 'messages' | 'commission' | 'settings';

// ── NexyfabProject (cloud-saved designs) ─────────────────────────────────────
interface NexyfabProject {
    id: string;
    name: string;
    shapeId?: string;
    materialId?: string;
    updatedAt: number;
    createdAt: number;
    tags?: string[];
}

interface CustomerContract {
    id: string;
    projectName: string;
    factoryName?: string;
    status: string;
    contractDate?: string;
    /** 데모 목업 등 레거시 필드 */
    startDate?: string;
    endDate?: string;
    progressPercent?: number;
    contractAmount?: number;
    deadline?: string;
    completionRequested?: boolean;
}

function getUserLang(): string {
    if (typeof window === 'undefined') return 'kr';
    try {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            const u = JSON.parse(stored);
            if (u.language && ['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(u.language)) return u.language;
        }
    } catch {}
    const saved = localStorage.getItem('nf_lang');
    if (saved && ['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(saved)) return saved;
    return 'kr';
}

function DashboardPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<NexysysUser | null>(null);
    const [dashToast, setDashToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const userLang = getUserLang();
    const projectAuditLabels = useMemo(() => projectAuditCopy(userLang), [userLang]);
    const validTabs: Tab[] = ['overview', 'designs', 'contracts', 'messages', 'commission', 'settings'];
    const initialTab = (searchParams.get('tab') as Tab | null);
    const [tab, setTab] = useState<Tab>(initialTab && validTabs.includes(initialTab) ? initialTab : 'overview');

    const changeTab = (t: Tab) => {
        setTab(t);
        router.replace(`?tab=${t}`, { scroll: false });
        if (t === 'designs') fetchDesigns();
    };
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [contracts, setContracts] = useState<CustomerContract[]>([]);
    const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 9;
    // search/filter 바뀌면 1페이지로 리셋
    React.useEffect(() => { setPage(1); }, [search, statusFilter]);

    React.useEffect(() => {
        if (!dashToast) return;
        const id = window.setTimeout(() => setDashToast(null), 5000);
        return () => window.clearTimeout(id);
    }, [dashToast]);

    // ── Cloud-saved designs ──────────────────────────────────────────────────
    const [designs, setDesigns] = useState<NexyfabProject[]>([]);
    const [designsLoading, setDesignsLoading] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // ── 버전 히스토리 ────────────────────────────────────────────────────────
    interface ProjectVersion {
        id: string; version_num: number; shape_id: string | null;
        material_id: string | null; created_at: number;
    }
    const [versionProjectId, setVersionProjectId] = useState<string | null>(null);
    const [versions, setVersions] = useState<ProjectVersion[]>([]);
    const [versionsLoading, setVersionsLoading] = useState(false);
    const [restoringId, setRestoringId] = useState<string | null>(null);

    // ── 프로젝트 팀 멤버 (소유자만 관리) ─────────────────────────────────────
    interface DesignMemberRow { userId: string; email: string; role: string; createdAt: number }
    interface PendingInviteRow { token: string; emailHint: string; role: string; expiresAt: number; createdAt: number; expired: boolean }
    interface ProjectAuditRow { id: string; userId: string; action: string; resourceId?: string; metadata?: Record<string, unknown>; ip?: string; createdAt: number }
    const [membersProjectId, setMembersProjectId] = useState<string | null>(null);
    const [membersRows, setMembersRows] = useState<DesignMemberRow[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer');
    const [memberBusy, setMemberBusy] = useState(false);
    const [pendingInviteLink, setPendingInviteLink] = useState<string | null>(null);
    const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
    const [pendingInvitesList, setPendingInvitesList] = useState<PendingInviteRow[]>([]);
    const [projectAuditLogs, setProjectAuditLogs] = useState<ProjectAuditRow[]>([]);
    const [projectAuditLoading, setProjectAuditLoading] = useState(false);
    const [projectAuditNote, setProjectAuditNote] = useState<'audit_plan' | 'audit_denied' | 'error' | null>(null);

    const fetchPendingInvites = React.useCallback((projectId: string) => {
        void credFetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/invites`)
            .then(r => (r.ok ? r.json() : null) as Promise<{ invites?: PendingInviteRow[] } | null>)
            .then(d => setPendingInvitesList(d?.invites ?? []))
            .catch(() => setPendingInvitesList([]));
    }, []);

    const fetchMembers = React.useCallback((projectId: string) => {
        setMembersLoading(true);
        credFetch(`/api/nexyfab/projects/${projectId}/members`)
            .then(r => (r.ok ? r.json() : null) as Promise<{ members?: DesignMemberRow[] } | null>)
            .then(d => setMembersRows(d?.members ?? []))
            .catch(() => setMembersRows([]))
            .finally(() => setMembersLoading(false));
    }, []);

    const handleDownloadProjectAuditCsv = React.useCallback(async () => {
        if (!membersProjectId) return;
        try {
            const r = await credFetch(
                `/api/nexyfab/projects/${encodeURIComponent(membersProjectId)}/audit?format=csv&limit=200`,
            );
            if (!r.ok) {
                setDashToast({
                    type: 'error',
                    msg: userLang === 'kr' || userLang === 'ko' ? `CSV보내기 실패 (${r.status})` : `CSV export failed (${r.status})`,
                });
                return;
            }
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `project-audit-${membersProjectId.slice(0, 12)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setDashToast({
                type: 'success',
                msg: userLang === 'kr' || userLang === 'ko' ? 'CSV 파일을 저장했습니다.' : 'CSV file saved.',
            });
        } catch {
            setDashToast({
                type: 'error',
                msg: userLang === 'kr' || userLang === 'ko' ? 'CSV보내기 중 오류가 났습니다.' : 'CSV export error.',
            });
        }
    }, [membersProjectId, userLang]);

    const fetchProjectAudit = React.useCallback((projectId: string) => {
        setProjectAuditLoading(true);
        setProjectAuditNote(null);
        void credFetch(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/audit?limit=80`)
            .then(async r => {
                if (r.status === 403) {
                    const j = (await r.json().catch(() => ({}))) as { code?: string };
                    setProjectAuditLogs([]);
                    setProjectAuditNote(j.code === 'AUDIT_PLAN_REQUIRED' ? 'audit_plan' : 'audit_denied');
                    return;
                }
                if (!r.ok) {
                    setProjectAuditLogs([]);
                    setProjectAuditNote('error');
                    return;
                }
                const d = (await r.json()) as { logs?: ProjectAuditRow[] };
                setProjectAuditLogs(d.logs ?? []);
            })
            .catch(() => {
                setProjectAuditLogs([]);
                setProjectAuditNote('error');
            })
            .finally(() => setProjectAuditLoading(false));
    }, []);

    const openMembersModal = React.useCallback((projectId: string) => {
        setMembersProjectId(projectId);
        setInviteEmail('');
        setInviteRole('viewer');
        setPendingInviteLink(null);
        setPendingInviteToken(null);
        setProjectAuditLogs([]);
        setProjectAuditNote(null);
        fetchMembers(projectId);
        fetchPendingInvites(projectId);
        fetchProjectAudit(projectId);
    }, [fetchMembers, fetchPendingInvites, fetchProjectAudit]);

    const handleCreateInviteLink = React.useCallback(async () => {
        if (!membersProjectId || !inviteEmail.trim()) return;
        setMemberBusy(true);
        try {
            const res = await credFetch(`/api/nexyfab/projects/${membersProjectId}/invites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
            });
            const j = await res.json().catch(() => ({})) as { error?: string; token?: string };
            if (!res.ok) {
                setDashToast({ type: 'error', msg: j.error ?? `오류 (${res.status})` });
                return;
            }
            if (j.token && typeof window !== 'undefined') {
                const u = new URL('/dashboard', window.location.origin);
                u.searchParams.set('acceptInvite', j.token);
                u.searchParams.set('tab', 'designs');
                setPendingInviteLink(u.toString());
                setPendingInviteToken(j.token);
                setDashToast({ type: 'success', msg: '초대 링크가 생성되었습니다. 복사해 초대 대상에게 보내세요.' });
            }
            fetchPendingInvites(membersProjectId);
            fetchProjectAudit(membersProjectId);
        } finally {
            setMemberBusy(false);
        }
    }, [membersProjectId, inviteEmail, inviteRole, fetchPendingInvites, fetchProjectAudit]);

    const handleRevokeInvite = React.useCallback(async (token?: string | null) => {
        const tok = (token ?? pendingInviteToken)?.trim();
        if (!membersProjectId || !tok) return;
        setMemberBusy(true);
        try {
            const res = await credFetch(
                `/api/nexyfab/projects/${encodeURIComponent(membersProjectId)}/invites?token=${encodeURIComponent(tok)}`,
                { method: 'DELETE' },
            );
            const j = await res.json().catch(() => ({})) as { error?: string };
            if (res.ok) {
                if (tok === pendingInviteToken) {
                    setPendingInviteLink(null);
                    setPendingInviteToken(null);
                }
                fetchPendingInvites(membersProjectId);
                fetchProjectAudit(membersProjectId);
                setDashToast({ type: 'success', msg: '초대 링크를 폐기했습니다.' });
            } else {
                setDashToast({ type: 'error', msg: j.error ?? `오류 (${res.status})` });
            }
        } finally {
            setMemberBusy(false);
        }
    }, [membersProjectId, pendingInviteToken, fetchPendingInvites, fetchProjectAudit]);

    const handleAddMember = React.useCallback(async () => {
        if (!membersProjectId || !inviteEmail.trim()) return;
        setMemberBusy(true);
        try {
            const res = await credFetch(`/api/nexyfab/projects/${membersProjectId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
            });
            if (res.ok) {
                setInviteEmail('');
                setPendingInviteLink(null);
                setPendingInviteToken(null);
                fetchMembers(membersProjectId);
                fetchPendingInvites(membersProjectId);
                fetchProjectAudit(membersProjectId);
                setDashToast({ type: 'success', msg: '멤버가 추가되었습니다.' });
            } else {
                const j = await res.json().catch(() => ({})) as { error?: string; code?: string };
                if (j.code === 'USER_NOT_FOUND') {
                    setDashToast({
                        type: 'error',
                        msg: '가입된 이메일이 없습니다. 아래「초대 링크 만들기」로 가입 전 초대를 보낼 수 있습니다.',
                    });
                } else {
                    setDashToast({ type: 'error', msg: j.error ?? `오류 (${res.status})` });
                }
            }
        } finally {
            setMemberBusy(false);
        }
    }, [membersProjectId, inviteEmail, inviteRole, fetchMembers, fetchPendingInvites, fetchProjectAudit]);

    const handleRemoveMember = React.useCallback(async (userId: string) => {
        if (!membersProjectId || !confirm('이 멤버를 제거할까요?')) return;
        setMemberBusy(true);
        try {
            const res = await credFetch(
                `/api/nexyfab/projects/${membersProjectId}/members?userId=${encodeURIComponent(userId)}`,
                { method: 'DELETE' },
            );
            if (res.ok) {
                fetchMembers(membersProjectId);
                fetchProjectAudit(membersProjectId);
                setDashToast({ type: 'success', msg: '멤버를 제거했습니다.' });
            } else {
                const j = await res.json().catch(() => ({})) as { error?: string };
                setDashToast({ type: 'error', msg: j.error ?? `오류 (${res.status})` });
            }
        } finally {
            setMemberBusy(false);
        }
    }, [membersProjectId, fetchMembers, fetchProjectAudit]);

    const fetchVersions = React.useCallback((projectId: string) => {
        setVersionsLoading(true);
        credFetch(`/api/nexyfab/projects/${projectId}?versions`)
            .then(r => r.ok ? r.json() : { versions: [] })
            .then(data => setVersions(data.versions ?? []))
            .catch(() => {})
            .finally(() => setVersionsLoading(false));
    }, []);

    const handleOpenVersions = React.useCallback((projectId: string) => {
        setVersionProjectId(projectId);
        setVersions([]);
        fetchVersions(projectId);
    }, [fetchVersions]);

    // handleRestoreVersion은 fetchDesigns 이후에 선언

    const fetchDesigns = React.useCallback(() => {
        setDesignsLoading(true);
        credFetch('/api/nexyfab/projects')
            .then(r => r.ok ? r.json() : { projects: [] })
            .then(data => setDesigns(data.projects ?? []))
            .catch(() => {})
            .finally(() => setDesignsLoading(false));
    }, []);

    const handleRestoreVersion = React.useCallback(async (projectId: string, versionId: string) => {
        if (!confirm('이 버전으로 복원할까요? 현재 상태는 자동으로 스냅샷에 저장됩니다.')) return;
        setRestoringId(versionId);
        try {
            const res = await credFetch(`/api/nexyfab/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ restoreVersionId: versionId }),
            });
            if (res.ok) {
                setVersionProjectId(null);
                fetchDesigns();
            }
        } finally {
            setRestoringId(null);
        }
    }, [fetchDesigns]);

    const handleDeleteDesign = React.useCallback(async (id: string) => {
        if (!confirm('이 설계를 삭제할까요?')) return;
        setDeletingId(id);
        try {
            await credFetch(`/api/nexyfab/projects/${id}`, { method: 'DELETE' });
            setDesigns(prev => prev.filter(d => d.id !== id));
        } finally {
            setDeletingId(null);
        }
    }, []);

    const acceptInviteToken = searchParams.get('acceptInvite');
    React.useEffect(() => {
        if (!acceptInviteToken) return;
        const qs = new URLSearchParams(searchParams.toString());
        qs.delete('acceptInvite');
        const remainder = qs.toString();
        router.replace(remainder ? `/dashboard?${remainder}` : '/dashboard?tab=designs', { scroll: false });
        void (async () => {
            const res = await credFetch(`/api/nexyfab/project-invites/${encodeURIComponent(acceptInviteToken)}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const j = await res.json().catch(() => ({})) as { error?: string };
            if (res.ok) {
                setDashToast({ type: 'success', msg: '프로젝트 초대를 수락했습니다.「내 설계」에서 확인하세요.' });
            } else {
                setDashToast({ type: 'error', msg: j.error ?? '초대 수락에 실패했습니다.' });
            }
            fetchDesigns();
        })();
    }, [acceptInviteToken, router, searchParams, fetchDesigns]);

    useEffect(() => {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setUser(parsed);

                // Demo / test accounts → inject mock data immediately
                if (parsed.is_demo || parsed.email?.includes('demo-') ||
                    ['test@nexysys.com', 'orgadmin@nexysys.com', 'customer@nexyfab.com'].includes(parsed.email)) {
                    setProjects(MOCK_PROJECTS);
                    setContracts([
                        { id: 'c1', projectName: 'IoT 모듈 PCB 조립', factoryName: '선진정밀 (주)', contractAmount: 42_000_000, status: 'active', startDate: '2025-02-28', endDate: '2025-05-28' },
                        { id: 'c2', projectName: 'EV 배터리 케이스 외주 제조', factoryName: '대한정밀 (주)', contractAmount: 28_000_000, status: 'draft', startDate: '2025-04-01', endDate: '2025-07-01' },
                    ]);
                    setCommissions(MOCK_COMMISSIONS);
                    setProjectsLoading(false);
                    return;
                }

                const email = encodeURIComponent(parsed.email);
                // Fetch inquiries
                credFetch(`/api/inquiries?customerEmail=${email}`)
                    .then(res => res.ok ? res.json() : { inquiries: [] })
                    .then(data => { setProjects((data.inquiries || []).map(inquiryToProject)); })
                    .catch(() => {})
                    .finally(() => setProjectsLoading(false));
                // Fetch contracts
                credFetch(`/api/contracts?customerEmail=${email}`)
                    .then(res => res.ok ? res.json() : { contracts: [] })
                    .then(data => setContracts(data.contracts || []))
                    .catch(() => {});
                // Fetch commissions (real data derived from contracts)
                credFetch(`/api/nexyfab/commissions?customerEmail=${email}`)
                    .then(res => res.ok ? res.json() : { commissions: [] })
                    .then(data => setCommissions(data.commissions || []))
                    .catch(() => {});
            } catch { router.push('/login'); }
        } else {
            router.push('/login');
        }
    }, [router]);

    // Fetch designs when tab is active on mount
    React.useEffect(() => {
        if (tab === 'designs') fetchDesigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── useMemo must be called before any early return (Rules of Hooks) ────────
    const s = useMemo(() => ({
        page: { fontFamily: 'var(--font-sans)', background: 'var(--color-surface-muted)', minHeight: '100vh', display: 'flex', flexDirection: 'column' as const },
        topbar: { background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px', flexShrink: 0 },
        logo: { fontSize: '18px', fontWeight: 900, letterSpacing: '-0.03em', textDecoration: 'none' },
        body: { display: 'flex', flex: 1, overflow: 'hidden' },
        sidebar: { width: '220px', background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', padding: '28px 16px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
        sideBtn: (active: boolean) => ({ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: active ? 'var(--color-primary-alpha)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: active ? 800 : 500, fontSize: '14px', border: 'none', width: '100%', textAlign: 'left' as const, transition: 'var(--transition-fast)' }),
        main: { flex: 1, padding: '32px', overflowY: 'auto' as const },
        card: { background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', padding: '28px', boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' },
        statCard: (color: string) => ({ background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', padding: '24px', boxShadow: 'var(--shadow-card)', border: `1px solid ${color}20`, borderLeft: `4px solid ${color}` }),
        h2: { fontSize: '20px', fontWeight: 900, color: 'var(--color-text-primary)', margin: '0 0 20px', letterSpacing: '-0.02em' },
        table: { width: '100%', borderCollapse: 'collapse' as const },
        th: { padding: '10px 16px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '2px solid var(--color-border)', textAlign: 'left' as const, background: '#fafafa' },
        td: { padding: '14px 16px', fontSize: '13px', color: 'var(--color-text-secondary)', borderBottom: '1px solid #f9fafb', verticalAlign: 'middle' as const },
    }), []);

    // Early return after all hooks
    if (!user) return null;

    const activePlan: 'standard' | 'premium' = 'premium';
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status !== 'contracted').length;
    const pendingQuotes = projects.filter(p => p.status === 'quotes_received').length;
    const contracted = projects.filter(p => p.status === 'contracted').length;

    // ── Overview Tab ──────────────────────────────────────────────────────────
    const filtered = projects.filter(p =>
        (statusFilter === 'all' || p.status === statusFilter) &&
        (search === '' || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()))
    );
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const OverviewTab = () => (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>안녕하세요, {user!.name}님 👋</h1>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>현재 플랜: <PlanBadge plan={activePlan} /></p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <a href={`/${userLang}/project-inquiry`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '12px 22px', borderRadius: '12px', background: blue, color: '#fff', fontWeight: 800, fontSize: '14px', textDecoration: 'none' }}>
                        + 새 프로젝트 신청
                    </a>
                    <a href={`/${userLang}/pricing`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '12px 18px', borderRadius: '12px', background: '#f3f4f6', color: '#374151', fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>
                        플랜 관리
                    </a>
                </div>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '36px' }}>
                {[
                    { label: '전체 프로젝트', value: totalProjects, color: '#6366f1', icon: '📋' },
                    { label: '진행 중', value: activeProjects, color: '#f59e0b', icon: '⚙️' },
                    { label: '견적 수신 완료', value: pendingQuotes, color: '#8b5cf6', icon: '💬' },
                    { label: '계약 완료', value: contracted, color: '#10b981', icon: '✅' },
                ].map((stat, i) => (
                    <div key={i} style={s.statCard(stat.color)}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>{stat.icon}</div>
                        <div style={{ fontSize: '32px', fontWeight: 900, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '6px', fontWeight: 600 }}>{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Project List */}
            <div>
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <h2 style={{ ...s.h2, margin: 0 }}>프로젝트 목록</h2>
                        {!projectsLoading && projects.length > 0 && <span style={{ fontSize: '13px', color: '#9ca3af' }}>클릭하면 프로젝트 상세로 이동합니다</span>}
                    </div>
                    {!projectsLoading && projects.length > 0 && (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="프로젝트 검색..."
                                style={{ flex: 1, minWidth: '200px', padding: '9px 14px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}
                            />
                            <select
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value)}
                                style={{ padding: '9px 14px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '13px', background: '#fff', cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
                            >
                                <option value="all">전체 상태</option>
                                {STATUS_STEPS.map(s2 => <option key={s2} value={s2}>{STATUS_LABEL[s2]}</option>)}
                            </select>
                        </div>
                    )}
                </div>

                {/* ① Skeleton Loading */}
                {projectsLoading ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{ background: '#fff', borderRadius: '20px', padding: '28px', border: '1px solid #f0f0f0', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <div style={{ height: '14px', width: '55%', borderRadius: '8px', background: '#f3f4f6' }} />
                                    <div style={{ height: '14px', width: '18%', borderRadius: '8px', background: '#f3f4f6' }} />
                                </div>
                                <div style={{ height: '22px', width: '40%', borderRadius: '8px', background: '#f3f4f6', marginBottom: '16px' }} />
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                                    {[0,1,2,3,4,5].map(j => <div key={j} style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f3f4f6' }} />)}
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ height: '12px', width: '28%', borderRadius: '6px', background: '#f3f4f6' }} />
                                    <div style={{ height: '12px', width: '22%', borderRadius: '6px', background: '#f3f4f6' }} />
                                </div>
                            </div>
                        ))}
                    </div>

                ) : projects.length === 0 ? (
                    /* ② Empty State — Onboarding */
                    <div style={{ background: '#fff', borderRadius: '24px', border: '1px solid #f0f0f0', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', padding: '52px 40px', textAlign: 'center' }}>
                        <div style={{ fontSize: '52px', marginBottom: '16px' }}>🏭</div>
                        <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 8px' }}>첫 제조 프로젝트를 시작해보세요</h3>
                        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 40px', lineHeight: 1.7 }}>
                            3단계로 최적의 제조 공장을 매칭하고<br />복수 견적을 비교해 계약까지 원스톱으로 진행합니다
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0', marginBottom: '44px', flexWrap: 'wrap' }}>
                            {[
                                { step: '1', icon: '✏️', title: '프로젝트 신청', desc: '제품 사양·수량·예산을\n입력합니다' },
                                { step: '2', icon: '🤖', title: 'AI 공장 매칭', desc: 'NexyFab이 최적의\n파트너 공장을 찾습니다' },
                                { step: '3', icon: '📊', title: '견적 비교 후 계약', desc: '복수 견적을 비교하고\n최적 조건으로 계약합니다' },
                            ].map((step, i) => (
                                <React.Fragment key={i}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '160px', gap: '8px' }}>
                                        <div style={{ width: '60px', height: '60px', borderRadius: '20px', background: blue + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' }}>{step.icon}</div>
                                        <span style={{ fontSize: '11px', fontWeight: 800, color: blue, letterSpacing: '0.05em' }}>STEP {step.step}</span>
                                        <span style={{ fontSize: '14px', fontWeight: 800, color: '#111827' }}>{step.title}</span>
                                        <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'pre-line', lineHeight: 1.6 }}>{step.desc}</span>
                                    </div>
                                    {i < 2 && <div style={{ width: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: '22px', alignSelf: 'flex-start', marginTop: '20px' }}>→</div>}
                                </React.Fragment>
                            ))}
                        </div>
                        <a href={`/${userLang}/project-inquiry`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '14px 36px', borderRadius: '14px', background: blue, color: '#fff', fontWeight: 800, fontSize: '15px', textDecoration: 'none' }}>
                            + 첫 프로젝트 신청하기
                        </a>
                    </div>

                ) : (
                    /* ③ Project Cards */
                    <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                        {paginated.map(p => {
                            const stepIdx = STATUS_STEPS.indexOf(p.status);
                            const isQuotesReady = p.status === 'quotes_received';
                            return (
                                <a key={p.id} href={`/dashboard/projects/${p.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                                    <div style={{ ...s.card, cursor: 'pointer', transition: 'all 0.15s', borderColor: isQuotesReady ? '#8b5cf6' : '#f0f0f0', borderWidth: isQuotesReady ? '2px' : '1px', boxShadow: isQuotesReady ? '0 4px 20px rgba(139,92,246,0.14)' : '0 2px 12px rgba(0,0,0,0.05)', padding: isQuotesReady ? '0' : '28px', overflow: 'hidden' }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = isQuotesReady ? '0 8px 32px rgba(139,92,246,0.22)' : '0 4px 20px rgba(11,92,255,0.1)'; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = isQuotesReady ? '0 4px 20px rgba(139,92,246,0.14)' : '0 2px 12px rgba(0,0,0,0.05)'; }}>

                                        {/* ④ Quotes-ready banner */}
                                        {isQuotesReady && (
                                            <div style={{ padding: '9px 20px', background: 'linear-gradient(90deg, #f5f3ff, #ede9fe)', borderBottom: '1px solid #ddd6fe', display: 'flex', alignItems: 'center', gap: '7px' }}>
                                                <span style={{ fontSize: '14px' }}>🎉</span>
                                                <span style={{ fontSize: '12px', fontWeight: 800, color: '#6d28d9' }}>견적이 도착했습니다! 지금 비교해보세요</span>
                                            </div>
                                        )}

                                        <div style={{ padding: '20px 24px 24px' }}>
                                            {/* Card Header */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ fontSize: '15px', fontWeight: 800, color: '#111827', marginBottom: '4px' }}>{p.name}</div>
                                                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>{p.category}</div>
                                                </div>
                                                <PlanBadge plan={p.plan} />
                                            </div>

                                            {/* Status + Progress */}
                                            <div style={{ marginBottom: '14px' }}>
                                                <StatusBadge status={p.status} />
                                                <div style={{ display: 'flex', alignItems: 'center', marginTop: '10px', gap: '2px' }}>
                                                    {STATUS_STEPS.map((step, i) => (
                                                        <React.Fragment key={step}>
                                                            <div title={STATUS_LABEL[step]} style={{ width: '10px', height: '10px', borderRadius: '50%', background: i <= stepIdx ? STATUS_COLOR[p.status] : '#e5e7eb', flexShrink: 0 }} />
                                                            {i < STATUS_STEPS.length - 1 && <div style={{ flex: 1, height: '2px', background: i < stepIdx ? STATUS_COLOR[p.status] : '#e5e7eb' }} />}
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Meta */}
                                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                {p.factories > 0 && <span style={{ fontSize: '12px', color: '#6b7280' }}>🏭 공장 {p.factories}개</span>}
                                                {p.quotesReceived > 0 && <span style={{ fontSize: '12px', color: '#8b5cf6', fontWeight: 700 }}>💬 견적 {p.quotesReceived}개</span>}
                                                {p.estimatedAmount && <span style={{ fontSize: '12px', color: '#374151', fontWeight: 700 }}>₩{(p.estimatedAmount / 10000).toFixed(0)}만</span>}
                                                <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>{p.updatedAt}</span>
                                            </div>

                                            {isQuotesReady && (
                                                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span style={{ fontSize: '12px', color: '#8b5cf6', fontWeight: 700 }}>견적 {p.quotesReceived}개 비교 가능</span>
                                                    <span style={{ fontSize: '12px', color: blue, fontWeight: 700 }}>상세 보기 →</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </a>
                            );
                        })}

                        {/* New Project CTA Card */}
                        <a href={`/${userLang}/project-inquiry`} style={{ textDecoration: 'none' }}>
                            <div style={{ ...s.card, cursor: 'pointer', border: `2px dashed #e5e7eb`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '160px', gap: '10px', transition: '0.15s' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = blue; (e.currentTarget as HTMLElement).style.background = blue + '04'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                                <div style={{ fontSize: '28px' }}>+</div>
                                <div style={{ fontWeight: 800, color: '#374151', fontSize: '14px' }}>새 프로젝트 신청</div>
                                <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center' }}>AI 제조 매칭 서비스 시작하기</div>
                            </div>
                        </a>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '24px' }}>
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                style={{ padding: '7px 14px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: page === 1 ? '#f9fafb' : '#fff', color: page === 1 ? '#d1d5db' : '#374151', fontSize: '13px', fontWeight: 700, cursor: page === 1 ? 'default' : 'pointer' }}>
                                ← 이전
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p2 => (
                                <button key={p2} onClick={() => setPage(p2)}
                                    style={{ width: '36px', height: '36px', borderRadius: '10px', border: `1.5px solid ${p2 === page ? blue : '#e5e7eb'}`, background: p2 === page ? blue : '#fff', color: p2 === page ? '#fff' : '#374151', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                                    {p2}
                                </button>
                            ))}
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                style={{ padding: '7px 14px', borderRadius: '10px', border: '1.5px solid #e5e7eb', background: page === totalPages ? '#f9fafb' : '#fff', color: page === totalPages ? '#d1d5db' : '#374151', fontSize: '13px', fontWeight: 700, cursor: page === totalPages ? 'default' : 'pointer' }}>
                                다음 →
                            </button>
                            <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '4px' }}>{filtered.length}개 중 {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)}</span>
                        </div>
                    )}
                    </div>
                )}
            </div>
        </div>
    );

    // ── Commission Tab ────────────────────────────────────────────────────────
    const planMinFee = PLAN_MIN_FEE[activePlan];

    const CommissionTab = () => (
        <div>
            <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 8px' }}>수수료 내역</h1>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px' }}>
                당사를 통해 프로젝트 착수시 서비스료는 총수수료에서 공제됩니다.
            </p>

            <div style={{ background: activePlan === 'premium' ? blue + '0d' : '#f9fafb', border: `1.5px solid ${activePlan === 'premium' ? blue + '30' : '#e5e7eb'}`, borderRadius: '14px', padding: '14px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '20px' }}>{activePlan === 'premium' ? '⭐' : '📋'}</span>
                <div>
                    <span style={{ fontWeight: 800, color: activePlan === 'premium' ? blue : '#374151', fontSize: '14px' }}>
                        {activePlan === 'premium' ? 'Premium' : 'Standard'} 플랜
                    </span>
                    <span style={{ fontSize: '13px', color: '#6b7280', marginLeft: '8px' }}>
                        서비스료 <b style={{ color: '#111827' }}>₩{(planMinFee / 10000).toFixed(0)}만원 (1회)</b> — 착수시 총수수료에서 공제됩니다.
                    </span>
                </div>
            </div>

            {commissions.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0f0f0', padding: '60px 40px', textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#6b7280', margin: 0 }}>아직 수수료 내역이 없습니다</p>
                    <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '6px' }}>계약이 완료되면 이곳에 수수료 내역이 표시됩니다.</p>
                </div>
            ) : (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                {[
                    { label: '총 계약 건수', value: `${commissions.length}건`, icon: '📋', color: '#6366f1' },
                    { label: '총 산정 수수료', value: `₩${(commissions.reduce((a, c) => a + c.grossCommission, 0) / 10000).toFixed(1)}만`, icon: '📊', color: '#f59e0b' },
                    { label: '플랜 공제 합계', value: `₩${(commissions.reduce((a, c) => a + c.planDeduction, 0) / 10000).toFixed(0)}만`, icon: '🎟️', color: '#8b5cf6' },
                    { label: '실 청구 합계', value: `₩${(commissions.reduce((a, c) => a + c.finalCharge, 0) / 10000).toFixed(1)}만`, icon: '💳', color: blue },
                    { label: '납부 완료', value: `₩${(commissions.filter(c => c.status === 'paid').reduce((a, c) => a + c.finalCharge, 0) / 10000).toFixed(1)}만`, icon: '✅', color: '#10b981' },
                ].map((s2, i) => (
                    <div key={i} style={s.statCard(s2.color)}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>{s2.icon}</div>
                        <div style={{ fontSize: '20px', fontWeight: 900, color: s2.color }}>{s2.value}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontWeight: 600 }}>{s2.label}</div>
                    </div>
                ))}
            </div>

            <div style={{ ...s.card, overflowX: 'auto', padding: 0, marginBottom: '20px' }}>
                <table style={s.table}>
                    <thead>
                        <tr>{['프로젝트', '계약금', '수수료율', '산정 수수료', '플랜 공제', '추가 청구', '상태', '날짜'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {commissions.map((c, i) => {
                            const statusColor = c.status === 'paid' ? '#10b981' : c.status === 'invoiced' ? blue : '#f59e0b';
                            const statusLabel = c.status === 'paid' ? '납부 완료' : c.status === 'invoiced' ? '청구됨' : '대기 중';
                            const covered = c.grossCommission <= c.planDeduction;
                            return (
                                <tr key={i}>
                                    <td style={{ ...s.td, fontWeight: 700, color: '#111827' }}>{c.projectName}</td>
                                    <td style={{ ...s.td, fontWeight: 700 }}>₩{(c.contractAmount / 10000).toFixed(0)}만</td>
                                    <td style={{ ...s.td, textAlign: 'center' }}><span style={{ display: 'inline-block', background: '#f3f4f6', color: '#374151', borderRadius: '8px', padding: '3px 10px', fontWeight: 700, fontSize: '13px' }}>{c.commissionRate}%</span></td>
                                    <td style={{ ...s.td, fontWeight: 700 }}>₩{(c.grossCommission / 10000).toFixed(1)}만</td>
                                    <td style={{ ...s.td, textAlign: 'center' }}><span style={{ display: 'inline-block', background: '#f0fdf4', color: '#16a34a', borderRadius: '8px', padding: '3px 10px', fontWeight: 700, fontSize: '12px' }}>−₩{(c.planDeduction / 10000).toFixed(0)}만</span></td>
                                    <td style={{ ...s.td, fontWeight: 900, fontSize: '15px' }}>
                                        {covered ? <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 700 }}>이용료 내 포함</span> : <span style={{ color: blue }}>₩{(c.finalCharge / 10000).toFixed(1)}만</span>}
                                    </td>
                                    <td style={s.td}><span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: statusColor + '18', color: statusColor }}>{statusLabel}</span></td>
                                    <td style={{ ...s.td, color: '#9ca3af' }}>{c.date}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={s.card}>
                <h2 style={{ ...s.h2, fontSize: '15px' }}>📊 수수료 구간 및 플랜별 최소 수수료</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>계약금 구간별 수수료율</div>
                        <table style={s.table}>
                            <thead><tr><th style={s.th}>구간</th><th style={{ ...s.th, textAlign: 'center' }}>수수료율</th></tr></thead>
                            <tbody>
                                {RATE_TIERS.map((tier, i) => (
                                    <tr key={i}><td style={{ ...s.td, fontSize: '12px' }}>{tier.label}</td><td style={{ ...s.td, textAlign: 'center', fontWeight: 800, color: blue }}>{tier.rate}%</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>플랜별 최소 수수료 (선납 공제)</div>
                        {[
                            { plan: 'Standard', fee: 500_000, color: '#6b7280', bg: '#f9fafb' },
                            { plan: 'Premium', fee: 1_000_000, color: blue, bg: blue + '0a' },
                        ].map((p, i) => (
                            <div key={i} style={{ background: p.bg, border: `1px solid ${p.color}20`, borderRadius: '12px', padding: '14px 16px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, color: p.color, fontSize: '14px' }}>{p.plan}</span>
                                <span style={{ fontWeight: 900, color: p.color, fontSize: '16px' }}>₩{(p.fee / 10000).toFixed(0)}만원</span>
                            </div>
                        ))}
                        <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.6, margin: '8px 0 0' }}>
                            산정 수수료가 최소 수수료 이하일 경우 추가 청구 없음.
                        </p>
                    </div>
                </div>
            </div>
            </>)}
        </div>
    );

    // ── Contracts Tab ─────────────────────────────────────────────────────────
    const CONTRACT_STATUS_LABEL: Record<string, string> = {
        contracted: '계약 완료', in_progress: '제조 중', quality_check: '품질 검수',
        delivered: '납품 완료', completed: '완료', cancelled: '취소',
    };
    const CONTRACT_STATUS_COLOR: Record<string, string> = {
        contracted: '#1d4ed8', in_progress: '#a16207', quality_check: '#c2410c',
        delivered: '#7e22ce', completed: '#15803d', cancelled: '#b91c1c',
    };

    const ContractsTab = () => (
        <div>
            <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>계약 현황</h1>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px' }}>진행 중인 제조 계약의 상태와 진행률을 확인합니다.</p>

            {contracts.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0f0f0', padding: '60px 40px', textAlign: 'center' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#6b7280', margin: 0 }}>아직 계약이 없습니다</p>
                    <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '6px' }}>견적을 수락하면 이곳에 계약이 표시됩니다.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {contracts.map((c: CustomerContract) => {
                        const pct = c.progressPercent ?? 0;
                        const color = CONTRACT_STATUS_COLOR[c.status] || '#6b7280';
                        const label = CONTRACT_STATUS_LABEL[c.status] || c.status;
                        return (
                            <div key={c.id} style={{ background: '#fff', borderRadius: '18px', border: '1px solid #f0f0f0', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', padding: '22px 24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#111827', marginBottom: '4px' }}>{c.projectName}</div>
                                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>{c.factoryName || '파트너 미배정'} · {c.contractDate || ''}</div>
                                    </div>
                                    <span style={{ background: color + '18', color, borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 700 }}>{label}</span>
                                </div>

                                {/* Progress bar */}
                                <div style={{ marginBottom: '14px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280' }}>제조 진행률</span>
                                        <span style={{ fontSize: '13px', fontWeight: 900, color: pct === 100 ? '#10b981' : blue }}>{pct}%</span>
                                    </div>
                                    <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : blue, borderRadius: '99px', transition: '0.5s' }} />
                                    </div>
                                </div>

                                {/* Meta */}
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>₩{(c.contractAmount || 0).toLocaleString('ko-KR')}원</span>
                                    {c.deadline && <span style={{ fontSize: '12px', color: '#6b7280' }}>납기 {c.deadline}</span>}
                                    {c.completionRequested && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: '#fef3c7', color: '#92400e' }}>완료 확인 요청 중</span>}
                                    <a href={`/dashboard/projects/${c.id}`} style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: blue, textDecoration: 'none' }}>상세 보기 →</a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    // ── Messages Tab ──────────────────────────────────────────────────────────
    const MessagesOverviewTab = () => {
        interface ThreadPreviewMessage {
            createdAt: string;
            text?: string;
            sender?: string;
            senderType?: string;
        }
        const [msgData, setMsgData] = React.useState<{ project: Project; lastMsg: ThreadPreviewMessage; count: number }[]>([]);
        const [loading, setLoading] = React.useState(true);

        React.useEffect(() => {
            const relevant = projects.filter(p => p.status === 'contracted' || p.status === 'confirmed');
            if (relevant.length === 0) { setLoading(false); return; }
            Promise.all(
                relevant.map(p =>
                    credFetch(`/api/messages?contractId=${p.id}`)
                        .then(r => r.ok ? r.json() : { messages: [] })
                        .then(d => ({ project: p, msgs: d.messages || [] }))
                        .catch(() => ({ project: p, msgs: [] }))
                )
            ).then(results => {
                setMsgData(results
                    .filter(r => r.msgs.length > 0)
                    .map(r => ({ project: r.project, lastMsg: r.msgs[r.msgs.length - 1], count: r.msgs.length }))
                    .sort((a, b) => new Date(b.lastMsg.createdAt).getTime() - new Date(a.lastMsg.createdAt).getTime())
                );
                setLoading(false);
            });
        }, []);

        if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>불러오는 중...</div>;

        return (
            <div>
                <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>메시지</h1>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px' }}>프로젝트별 대화 내역을 모아 볼 수 있습니다.</p>
                {msgData.length === 0 ? (
                    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0f0f0', padding: '60px 40px', textAlign: 'center' }}>
                        <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
                        <p style={{ fontSize: '15px', fontWeight: 700, color: '#6b7280', margin: 0 }}>아직 메시지가 없습니다</p>
                        <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '6px' }}>계약된 프로젝트에서 담당자와 대화할 수 있습니다.</p>
                    </div>
                ) : (
                    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0f0f0', overflow: 'hidden' }}>
                        {msgData.map((d, i) => (
                            <a key={d.project.id} href={`/dashboard/projects/${d.project.id}?tab=messages`}
                                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px', borderBottom: i < msgData.length - 1 ? '1px solid #f9fafb' : 'none', textDecoration: 'none', transition: '0.1s' }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                                <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: blue + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🏭</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827', marginBottom: '3px' }}>{d.project.name}</div>
                                    <div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {d.lastMsg.senderType === 'customer' ? '나: ' : 'NexyFab: '}{d.lastMsg.text?.startsWith('📎 파일:') ? '파일을 보냈습니다' : d.lastMsg.text}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                                        {new Date(d.lastMsg.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                    </div>
                                    <span style={{ background: blue, color: '#fff', borderRadius: '20px', padding: '2px 8px', fontSize: '11px', fontWeight: 700 }}>{d.count}</span>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // ── Designs Tab ────────────────────────────────────────────────────────────
    const SHAPE_ICONS_MAP: Record<string, string> = {
        box: '📦', cylinder: '🔩', pipe: '🔧', lBracket: '📐', flange: '⚙️',
        plateBend: '🔨', gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
        sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻', sweep: '🔀', loft: '🔄',
    };
    const MATERIAL_LABELS: Record<string, string> = {
        aluminum: '알루미늄', steel: '스틸', stainless: '스테인리스',
        titanium: '티타늄', abs: 'ABS', nylon: '나일론', pla: 'PLA',
    };

    const DesignsTab = () => (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>내 설계 💾</h1>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>클라우드에 저장된 NexyFab 설계 파일</p>
                </div>
                <Link prefetch href={`/${userLang}/shape-generator`} style={{ padding: '10px 20px', borderRadius: '12px', background: blue, color: '#fff', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                    + 새 설계
                </Link>
            </div>

            {designsLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af', fontSize: '14px' }}>불러오는 중…</div>
            ) : designs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 20px', background: '#fff', borderRadius: '20px', border: '1px dashed #e5e7eb' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧊</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>저장된 설계가 없습니다</div>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '24px' }}>Shape Generator에서 설계를 저장하면 여기 표시됩니다.</div>
                    <Link prefetch href={`/${userLang}/shape-generator`} style={{ padding: '10px 24px', borderRadius: '12px', background: blue, color: '#fff', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                        설계 시작하기
                    </Link>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
                    {designs.map(d => (
                        <div key={d.id} style={{ background: '#fff', borderRadius: '16px', border: '1px solid #f0f0f0', overflow: 'hidden', transition: '0.15s', cursor: 'pointer' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = '#e0e7ff'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.borderColor = '#f0f0f0'; }}>
                            {/* Shape icon banner */}
                            <Link prefetch href={`/${userLang}/shape-generator?projectId=${d.id}`} style={{ textDecoration: 'none', display: 'block', background: 'linear-gradient(135deg, #f0f4ff 0%, #e8edff 100%)', padding: '28px 0', textAlign: 'center', fontSize: '48px' }}>
                                {SHAPE_ICONS_MAP[d.shapeId ?? ''] ?? '🧊'}
                            </Link>
                            <div style={{ padding: '14px 16px' }}>
                                <div style={{ fontSize: '14px', fontWeight: 800, color: '#111827', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {d.name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                    {d.materialId && (
                                        <span style={{ fontSize: '11px', background: '#f3f4f6', color: '#6b7280', borderRadius: '6px', padding: '2px 8px', fontWeight: 600 }}>
                                            {MATERIAL_LABELS[d.materialId] ?? d.materialId}
                                        </span>
                                    )}
                                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                                        {new Date(d.updatedAt).toLocaleDateString('ko-KR')}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <Link prefetch href={`/${userLang}/shape-generator?projectId=${d.id}`} style={{ flex: 1, padding: '7px 0', borderRadius: '8px', background: blue, color: '#fff', fontSize: '12px', fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>
                                        열기
                                    </Link>
                                    <button onClick={() => handleOpenVersions(d.id)}
                                        style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #e0e7ff', background: '#f5f7ff', color: '#6366f1', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                                        title="버전 히스토리">
                                        🕐
                                    </button>
                                    <button type="button" onClick={() => openMembersModal(d.id)}
                                        style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #dbeafe', background: '#eff6ff', color: '#0369a1', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                                        title="팀 멤버 (편집/보기)">
                                        팀
                                    </button>
                                    <button onClick={() => void handleDeleteDesign(d.id)} disabled={deletingId === d.id}
                                        style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fff', color: '#ef4444', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                                        {deletingId === d.id ? '…' : '삭제'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── 버전 히스토리 모달 ── */}
            {versionProjectId && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setVersionProjectId(null)}>
                    <div style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '480px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }}
                        onClick={e => e.stopPropagation()}>
                        {/* 모달 헤더 */}
                        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '20px' }}>🕐</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '15px', fontWeight: 900, color: '#111827' }}>버전 히스토리</div>
                                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    {designs.find(d => d.id === versionProjectId)?.name ?? versionProjectId}
                                </div>
                            </div>
                            <button onClick={() => setVersionProjectId(null)}
                                style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                        </div>
                        {/* 버전 목록 */}
                        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 0' }}>
                            {versionsLoading ? (
                                <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: '13px' }}>불러오는 중…</div>
                            ) : versions.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                                    <div style={{ fontSize: '32px', marginBottom: '10px' }}>📭</div>
                                    <div style={{ fontSize: '13px', color: '#9ca3af' }}>저장된 버전이 없습니다.<br/>설계를 수정하면 자동으로 스냅샷이 생성됩니다.</div>
                                </div>
                            ) : (
                                versions.map((v, i) => (
                                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', borderBottom: i < versions.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                                        {/* 타임라인 점 */}
                                        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: i === 0 ? blue : '#e5e7eb', border: i === 0 ? `2px solid ${blue}` : '2px solid #d1d5db' }} />
                                            {i < versions.length - 1 && <div style={{ width: '2px', flex: 1, background: '#f0f0f0', minHeight: '20px' }} />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                                                v{v.version_num}
                                                {i === 0 && <span style={{ marginLeft: '6px', fontSize: '10px', background: '#eff6ff', color: blue, borderRadius: '4px', padding: '1px 6px', fontWeight: 700 }}>최신</span>}
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                                                {new Date(v.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                {v.shape_id && <span style={{ marginLeft: '6px' }}>{SHAPE_ICONS_MAP[v.shape_id] ?? ''} {v.shape_id}</span>}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void handleRestoreVersion(versionProjectId, v.id)}
                                            disabled={restoringId === v.id || i === 0}
                                            style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${i === 0 ? '#e5e7eb' : '#e0e7ff'}`, background: i === 0 ? '#f9fafb' : '#f5f7ff', color: i === 0 ? '#9ca3af' : '#6366f1', fontSize: '12px', fontWeight: 700, cursor: i === 0 ? 'default' : 'pointer', flexShrink: 0 }}>
                                            {restoringId === v.id ? '…' : i === 0 ? '현재' : '복원'}
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f0f0', fontSize: '11px', color: '#9ca3af' }}>
                            최대 20개 버전 보관 · 자동 저장 시 스냅샷 생성
                        </div>
                    </div>
                </div>
            )}

            {/* ── 팀 멤버 모달 (소유자만 API 성공) ── */}
            {membersProjectId && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
                    onClick={() => !memberBusy && setMembersProjectId(null)}>
                    <div style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '20px' }}>👥</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '15px', fontWeight: 900, color: '#111827' }}>팀 멤버</div>
                                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    {designs.find(x => x.id === membersProjectId)?.name ?? membersProjectId}
                                </div>
                            </div>
                            <button type="button" onClick={() => !memberBusy && setMembersProjectId(null)}
                                style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ padding: '14px 22px', borderBottom: '1px solid #f9fafb' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', marginBottom: '8px' }}>초대 (가입된 이메일만 가능)</div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <input
                                    type="email"
                                    value={inviteEmail}
                                    onChange={e => setInviteEmail(e.target.value)}
                                    placeholder="email@example.com"
                                    disabled={memberBusy}
                                    style={{ flex: '1 1 180px', minWidth: 0, padding: '8px 12px', borderRadius: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                                />
                                <select
                                    value={inviteRole}
                                    onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
                                    disabled={memberBusy}
                                    style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #e5e7eb', fontSize: '12px', fontWeight: 700 }}>
                                    <option value="viewer">보기</option>
                                    <option value="editor">편집</option>
                                </select>
                                <button type="button" onClick={() => void handleAddMember()} disabled={memberBusy || !inviteEmail.trim()}
                                    style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: memberBusy || !inviteEmail.trim() ? '#e5e7eb' : blue, color: memberBusy || !inviteEmail.trim() ? '#9ca3af' : '#fff', fontSize: '12px', fontWeight: 800, cursor: memberBusy || !inviteEmail.trim() ? 'default' : 'pointer' }}>
                                    추가
                                </button>
                            </div>
                            <p style={{ fontSize: '10px', color: '#9ca3af', margin: '8px 0 0', lineHeight: 1.4 }}>
                                보기: 열람만. 편집: 클라우드 저장·버전 복원 가능. 소유자만 이 목록을 관리합니다.
                            </p>
                            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button type="button" onClick={() => void handleCreateInviteLink()} disabled={memberBusy || !inviteEmail.trim()}
                                    style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: '10px', border: '1px solid #bae6fd', background: '#f0f9ff', color: '#0369a1', fontSize: '12px', fontWeight: 700, cursor: memberBusy || !inviteEmail.trim() ? 'default' : 'pointer' }}>
                                    초대 링크 만들기 (가입 전 이메일)
                                </button>
                                {pendingInviteLink && (
                                    <div style={{ fontSize: '11px', color: '#374151' }}>
                                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>링크 복사</div>
                                        <input readOnly value={pendingInviteLink}
                                            onFocus={e => e.target.select()}
                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '11px' }} />
                                        <button type="button" onClick={() => void handleRevokeInvite()} disabled={memberBusy}
                                            style={{ marginTop: '8px', padding: '6px 12px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, cursor: memberBusy ? 'default' : 'pointer' }}>
                                            링크 폐기 (서버에서 토큰 삭제)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        {pendingInvitesList.length > 0 && (
                            <div style={{ padding: '10px 22px', borderBottom: '1px solid #f9fafb', background: '#fafafa' }}>
                                <div style={{ fontSize: '11px', fontWeight: 800, color: '#374151', marginBottom: '8px' }}>대기 중인 이메일 초대</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {pendingInvitesList.map(inv => (
                                        <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11px' }}>
                                            <span style={{ fontWeight: 700, color: '#111827' }}>{inv.emailHint}</span>
                                            <span style={{ color: '#6b7280' }}>{inv.role === 'editor' ? '편집' : '보기'}</span>
                                            {inv.expired ? (
                                                <span style={{ color: '#b45309', fontWeight: 700 }}>만료됨</span>
                                            ) : (
                                                <span style={{ color: '#9ca3af' }}>만료 {new Date(inv.expiresAt).toLocaleDateString('ko-KR')}</span>
                                            )}
                                            <button type="button" onClick={() => void handleRevokeInvite(inv.token)} disabled={memberBusy}
                                                style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: '10px', fontWeight: 700, cursor: memberBusy ? 'default' : 'pointer' }}>
                                                폐기
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div style={{ padding: '12px 22px', borderBottom: '1px solid #f0f0f0', background: '#fafbff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '8px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 800, color: '#374151' }}>{projectAuditLabels.sectionTitle}</div>
                                {projectAuditNote !== 'audit_plan' && !projectAuditLoading && (
                                    <button
                                        type="button"
                                        title={projectAuditLabels.auditCsvTitle}
                                        onClick={() => void handleDownloadProjectAuditCsv()}
                                        style={{
                                            padding: '4px 10px',
                                            borderRadius: 8,
                                            border: '1px solid #c7d2fe',
                                            background: '#eef2ff',
                                            color: '#3730a3',
                                            fontSize: '10px',
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {projectAuditLabels.auditCsv}
                                    </button>
                                )}
                            </div>
                            {projectAuditLoading ? (
                                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{projectAuditLabels.loading}</div>
                            ) : projectAuditNote === 'audit_plan' ? (
                                <div style={{ fontSize: '11px', color: '#92400e', lineHeight: 1.45 }}>
                                    {projectAuditLabels.planNote}
                                </div>
                            ) : projectAuditNote === 'audit_denied' || projectAuditNote === 'error' ? (
                                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{projectAuditLabels.loadFail}</div>
                            ) : projectAuditLogs.length === 0 ? (
                                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{projectAuditLabels.empty}</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                                    {projectAuditLogs.map(log => (
                                        <div key={log.id} style={{ fontSize: '10px', color: '#4b5563', lineHeight: 1.4, borderBottom: '1px solid #eef2ff', paddingBottom: '6px' }}>
                                            <span style={{ fontWeight: 800, color: '#111827' }}>{formatProjectAuditAction(userLang, log.action)}</span>
                                            <span style={{ color: '#9ca3af', marginLeft: '6px' }}>
                                                {new Date(log.createdAt).toLocaleString(userLang === 'kr' || userLang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                                            </span>
                                            <div style={{ color: '#9ca3af', marginTop: '2px' }}>{projectAuditLabels.actorPrefix} · {log.userId.slice(0, 10)}…</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0 12px' }}>
                            {membersLoading ? (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: '13px' }}>불러오는 중…</div>
                            ) : membersRows.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '24px 16px', fontSize: '13px', color: '#9ca3af' }}>아직 초대된 멤버가 없습니다.</div>
                            ) : (
                                membersRows.map(m => (
                                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 22px', borderBottom: '1px solid #f9fafb' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                                            <div style={{ fontSize: '11px', color: '#9ca3af' }}>{m.role === 'editor' ? '편집' : '보기'}</div>
                                        </div>
                                        <button type="button" onClick={() => void handleRemoveMember(m.userId)} disabled={memberBusy}
                                            style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fff', color: '#ef4444', fontSize: '11px', fontWeight: 700, cursor: memberBusy ? 'default' : 'pointer' }}>
                                            제거
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ── Settings Tab ──────────────────────────────────────────────────────────
    const SettingsTab = () => (
        <div>
            <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>계정 설정</h1>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px' }}>프로필과 플랜을 관리합니다.</p>

            {/* Profile card */}
            <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0f0f0', padding: '28px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                <span aria-hidden="true" style={{
                    width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #0b5cff, #6366f1)',
                    color: '#fff', fontSize: 24, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #e5e7eb',
                }}>{(user!.name ?? '?')[0].toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '18px', fontWeight: 900, color: '#111827', marginBottom: '4px' }}>{user!.name}</div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>{user!.email}</div>
                    <PlanBadge plan={activePlan} />
                </div>
                <Link href="/account" style={{ padding: '9px 20px', borderRadius: '12px', background: '#f3f4f6', color: '#374151', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                    프로필 수정
                </Link>
            </div>

            {/* Quick links */}
            {[
                { icon: '🔒', label: '비밀번호 변경', desc: '계정 보안을 강화하세요', href: '/account?tab=security' },
                { icon: '🔔', label: '알림 설정', desc: '이메일·앱 알림 수신 여부를 관리합니다', href: '/account?tab=notifications' },
                { icon: '💳', label: '플랜 관리', desc: `현재 ${activePlan === 'premium' ? 'Premium' : 'Standard'} 플랜 — 업그레이드 또는 취소`, href: `/${userLang}/pricing` },
                { icon: '📄', label: '이용 약관 / 개인정보 처리방침', desc: 'NexyFab 법적 문서 확인', href: `/${userLang}/terms-of-use` },
                { icon: '🚪', label: '로그아웃', desc: '현재 기기에서 로그아웃합니다', href: '/logout' },
            ].map((item, i) => (
                <Link key={i} href={item.href} style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#fff', borderRadius: '16px', border: '1px solid #f0f0f0', padding: '18px 22px', marginBottom: '10px', textDecoration: 'none', transition: '0.1s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
                    <span style={{ fontSize: '22px', flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{item.label}</div>
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{item.desc}</div>
                    </div>
                    <span style={{ color: '#d1d5db', fontSize: '16px' }}>›</span>
                </Link>
            ))}
        </div>
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={s.page}>
            {dashToast && (
                <div role="status"
                    style={{
                        position: 'fixed',
                        bottom: 24,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 10000,
                        maxWidth: 'min(520px, 92vw)',
                        padding: '12px 20px',
                        borderRadius: 14,
                        fontSize: 13,
                        fontWeight: 700,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        background: dashToast.type === 'success' ? '#ecfdf5' : '#fef2f2',
                        color: dashToast.type === 'success' ? '#065f46' : '#991b1b',
                        border: `1px solid ${dashToast.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
                    }}>
                    {dashToast.msg}
                </div>
            )}
            <div id="customer-topbar" role="banner" style={s.topbar}>
                <Link href="/kr" style={s.logo}>
                    <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: blue }}>Fab</span>
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <PlanBadge plan={activePlan} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span aria-hidden="true" style={{
                            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                            background: 'linear-gradient(135deg, #0b5cff, #6366f1)',
                            color: '#fff', fontSize: 13, fontWeight: 800,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '2px solid #e5e7eb',
                        }}>{(user.name ?? '?')[0].toUpperCase()}</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: '#374151' }}>{user.name}</span>
                    </div>
                    <NexyfabNotificationBell />
                    <NotificationBell recipient={`customer:${user.email}`} />
                    <Link href="/account" style={{ fontSize: '13px', color: '#6b7280', textDecoration: 'none', fontWeight: 600 }}>계정 설정</Link>
                </div>
            </div>

            <div style={s.body}>
                <nav id="customer-sidebar" aria-label="Dashboard navigation" style={s.sidebar}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 14px', marginBottom: '8px' }}>메뉴</div>
                    {([
                        { id: 'overview' as Tab, label: '프로젝트 홈', icon: '🏠' },
                        { id: 'designs' as Tab, label: '내 설계', icon: '💾', badge: designs.length || undefined },
                        { id: 'contracts' as Tab, label: '계약 현황', icon: '📋', badge: contracts.filter(c => !['completed','cancelled'].includes(c.status)).length || undefined },
                        { id: 'messages' as Tab, label: '메시지', icon: '💬' },
                        { id: 'commission' as Tab, label: '수수료 내역', icon: '📈' },
                        { id: 'settings' as Tab, label: '계정 설정', icon: '⚙️' },
                    ]).map(item => (
                        <button key={item.id} onClick={() => changeTab(item.id)}
                            aria-current={tab === item.id ? 'page' : undefined}
                            style={{ ...s.sideBtn(tab === item.id), justifyContent: 'flex-start' }}>
                            <span style={{ fontSize: '16px' }}>{item.icon}</span>
                            <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                            {'badge' in item && item.badge ? (
                                <span style={{ background: blue, color: '#fff', borderRadius: '20px', padding: '1px 7px', fontSize: '11px', fontWeight: 800, minWidth: '20px', textAlign: 'center' }}>
                                    {item.badge}
                                </span>
                            ) : null}
                        </button>
                    ))}
                    <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                        <a href={`/${userLang}/pricing`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '12px', background: blue + '10', color: blue, fontWeight: 700, fontSize: '13px', textDecoration: 'none' }}>
                            <span>⬆️</span> 플랜 업그레이드
                        </a>
                    </div>
                </nav>

                <div id="customer-main" style={s.main}>
                    {tab === 'overview'    && <OverviewTab />}
                    {tab === 'designs'     && <DesignsTab />}
                    {tab === 'contracts'   && <ContractsTab />}
                    {tab === 'messages'    && <MessagesOverviewTab />}
                    {tab === 'commission'  && <CommissionTab />}
                    {tab === 'settings'    && <SettingsTab />}
                </div>
            </div>

            {/* Mobile Bottom Nav */}
            <nav style={{ display: 'none' }} id="customer-mobile-nav" aria-label="Mobile navigation">
                {([
                    { id: 'overview' as Tab, label: '홈', icon: '🏠' },
                    { id: 'contracts' as Tab, label: '계약', icon: '📋' },
                    { id: 'messages' as Tab, label: '메시지', icon: '💬' },
                    { id: 'commission' as Tab, label: '수수료', icon: '📈' },
                    { id: 'settings' as Tab, label: '설정', icon: '⚙️' },
                    { id: 'designs' as Tab, label: '설계', icon: '💾' },
                ] as { id: Tab; label: string; icon: string }[]).map(item => (
                    <button key={item.id} onClick={() => changeTab(item.id)}
                        aria-current={tab === item.id ? 'page' : undefined}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '6px 12px', borderRadius: '12px', border: 'none', background: 'none', cursor: 'pointer', color: tab === item.id ? blue : '#9ca3af' }}>
                        <span style={{ fontSize: '22px', lineHeight: 1 }}>{item.icon}</span>
                        <span style={{ fontSize: '10px', fontWeight: 700 }}>{item.label}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
}

export default function DashboardPageWrapper() {
  return <Suspense fallback={null}><DashboardPage /></Suspense>;
}
