'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductRole { product: string; role: string }
interface OrgInfo { org_id: string; org_name: string; role: string }

interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  role: string;
  email_verified: number;
  avatar_url: string | null;
  created_at: number;
  locked_until: number | null;
  totp_enabled: number;
  project_count: number;
  language: string | null;
  country: string | null;
  timezone: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  signup_source: string | null;
  last_login_at: number | null;
  login_count: number;
  signup_ip: string | null;
  last_login_ip: string | null;
  services: string | null;
  signup_service: string | null;
  nexyfab_plan: string | null;
  nexyflow_plan: string | null;
  oauth_provider: string | null;
  productRoles: ProductRole[];
  orgs: OrgInfo[];
}

interface PlanStat { plan: string; count: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const PLAN_COLOR: Record<string, string> = {
  free:       'bg-gray-100 text-gray-600',
  pro:        'bg-blue-100 text-blue-700',
  team:       'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const ROLE_COLOR: Record<string, string> = {
  user:        'bg-gray-100 text-gray-600',
  super_admin: 'bg-red-100 text-red-700',
};

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtFull(ts: number) {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function daysSince(ts: number) {
  return Math.floor((Date.now() - ts) / 86_400_000);
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const SOURCE_LABEL: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  kakao: 'Kakao',
  naver: 'Naver',
};

const SOURCE_COLOR: Record<string, string> = {
  email:  'bg-gray-100 text-gray-600',
  google: 'bg-blue-50 text-blue-600',
  kakao:  'bg-yellow-50 text-yellow-700',
  naver:  'bg-green-50 text-green-700',
};

const SERVICE_COLOR: Record<string, string> = {
  nexyfab:  'bg-indigo-100 text-indigo-700',
  nexyflow: 'bg-emerald-100 text-emerald-700',
  nexysys:  'bg-purple-100 text-purple-700',
};

function parseServices(raw: string | null): string[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function timeAgo(ts: number | null): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);

  const [users, setUsers]     = useState<User[]>([]);
  const [stats, setStats]     = useState<PlanStat[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');

  // Filters
  const [filterPlan, setFilterPlan]         = useState('');
  const [filterRole, setFilterRole]         = useState('');
  const [filterVerified, setFilterVerified] = useState('');
  const [filterCountry, setFilterCountry]   = useState('');
  const [filterSource, setFilterSource]     = useState('');
  const [filterService, setFilterService]   = useState('');
  const [filterQ, setFilterQ]               = useState('');
  const [filterSort, setFilterSort]         = useState('created_at_desc');

  // Detail modal
  const [detailUser, setDetailUser] = useState<User | null>(null);

  // Edit modal
  const [editUser, setEditUser]           = useState<User | null>(null);
  const [editPlan, setEditPlan]           = useState('');
  const [editRole, setEditRole]           = useState('');
  const [editName, setEditName]           = useState('');
  const [editCompany, setEditCompany]     = useState('');
  const [editJobTitle, setEditJobTitle]   = useState('');
  const [editPhone, setEditPhone]         = useState('');
  const [editCountry, setEditCountry]     = useState('');
  const [editLanguage, setEditLanguage]   = useState('');
  const [editTimezone, setEditTimezone]   = useState('');
  const [editSaving, setEditSaving]       = useState(false);

  // Action states
  const [lockingId, setLockingId]     = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  async function login() {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), sort: filterSort });
      if (filterPlan)     params.set('plan', filterPlan);
      if (filterRole)     params.set('role', filterRole);
      if (filterVerified) params.set('verified', filterVerified);
      if (filterCountry)  params.set('country', filterCountry);
      if (filterSource)   params.set('source', filterSource);
      if (filterService)  params.set('service', filterService);
      if (filterQ)        params.set('q', filterQ);
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
      const data = await res.json() as { users: User[]; total: number; stats: PlanStat[] };
      setUsers(data.users);
      setTotal(data.total);
      setStats(data.stats);
    } finally { setLoading(false); }
  }, [page, filterPlan, filterRole, filterVerified, filterCountry, filterSource, filterService, filterQ, filterSort]);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleEdit() {
    if (!editUser) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = { userId: editUser.id };
      if (editPlan && editPlan !== editUser.plan) body.plan = editPlan;
      if (editRole && editRole !== editUser.role) body.role = editRole;
      if (editName && editName !== editUser.name) body.name = editName;
      if (editCompany !== (editUser.company ?? '')) body.company = editCompany;
      if (editJobTitle !== (editUser.job_title ?? '')) body.job_title = editJobTitle;
      if (editPhone !== (editUser.phone ?? '')) body.phone = editPhone;
      if (editCountry !== (editUser.country ?? '')) body.country = editCountry;
      if (editLanguage !== (editUser.language ?? '')) body.language = editLanguage;
      if (editTimezone !== (editUser.timezone ?? '')) body.timezone = editTimezone;

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) { showToast('회원 정보 수정 완료'); setEditUser(null); void load(); }
      else showToast(`오류: ${d.error}`);
    } finally { setEditSaving(false); }
  }

  async function handleLock(user: User) {
    const isLocked = user.locked_until && user.locked_until > Date.now();
    if (isLocked) {
      if (!confirm(`${user.email}의 잠금을 해제하시겠습니까?`)) return;
    } else {
      if (!confirm(`${user.email} 계정을 잠금하시겠습니까? (24시간)`)) return;
    }
    setLockingId(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, locked: !isLocked }),
      });
      if (res.ok) showToast(isLocked ? '잠금 해제 완료' : '계정 잠금 완료');
      else showToast('오류 발생');
      void load();
    } finally { setLockingId(null); }
  }

  async function handleDelete(user: User) {
    if (user.role === 'super_admin') { showToast('super_admin은 삭제할 수 없습니다'); return; }
    if (!confirm(`정말 ${user.email} 회원을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    if (!confirm(`최종 확인: ${user.email}의 모든 데이터가 삭제됩니다.`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) { showToast('회원 삭제 완료'); void load(); }
      else showToast(`오류: ${d.error}`);
    } finally { setDeletingId(null); }
  }

  // CSV 내보내기
  function exportCSV() {
    const header = 'ID,이메일,이름,플랜,역할,서비스,회사,직책,국가,언어,시간대,전화번호,가입경로,가입IP,최근로그인IP,가입일,마지막로그인,로그인횟수,이메일인증,프로젝트수,잠금상태,2FA\n';
    const rows = users.map(u =>
      [u.id, u.email, u.name, u.plan, u.role,
        parseServices(u.services).join(';'),
        u.company ?? '', u.job_title ?? '', u.country ?? '', u.language ?? '',
        u.timezone ?? '', u.phone ?? '', u.signup_source ?? '',
        u.signup_ip ?? '', u.last_login_ip ?? '',
        fmt(u.created_at),
        u.last_login_at ? fmt(u.last_login_at) : '',
        u.login_count,
        u.email_verified ? 'Y' : 'N', u.project_count,
        u.locked_until && u.locked_until > Date.now() ? 'LOCKED' : '',
        u.totp_enabled ? 'Y' : 'N',
      ].map(v => `"${v}"`).join(',')
    ).join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalUsers = stats.reduce((s, r) => s + r.count, 0);
  const paidUsers  = stats.filter(r => r.plan !== 'free').reduce((s, r) => s + r.count, 0);

  // ── Login gate ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">👥</div>
            <h1 className="text-xl font-black text-gray-900">회원 관리</h1>
            <p className="text-xs text-gray-400 mt-1">관리자 인증 필요</p>
          </div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void login()}
            placeholder="관리자 비밀번호"
            className={`w-full px-4 py-2.5 rounded-xl border text-sm mb-3 outline-none ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`} />
          <button onClick={() => void login()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
            로그인
          </button>
          {pwError && <p className="text-red-500 text-xs text-center mt-2">비밀번호가 틀렸습니다</p>}
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {/* Detail modal */}
      {detailUser && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setDetailUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-4 mb-5">
              {detailUser.avatar_url ? (
                <img src={detailUser.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-gray-100" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-xl">
                  {initials(detailUser.name)}
                </div>
              )}
              <div>
                <h2 className="text-lg font-black text-gray-900">{detailUser.name}</h2>
                <p className="text-sm text-gray-500">{detailUser.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">플랜</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.plan}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">역할</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.role}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">가입일</p>
                <p className="font-bold text-gray-900 mt-0.5">{fmtFull(detailUser.created_at)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">마지막 로그인</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.last_login_at ? timeAgo(detailUser.last_login_at) : '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">로그인 횟수</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.login_count}회</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">가입 서비스</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {parseServices(detailUser.services).map(s => (
                    <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SERVICE_COLOR[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>
                  ))}
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">가입 경로</p>
                <p className="font-bold text-gray-900 mt-0.5">{SOURCE_LABEL[detailUser.signup_source ?? ''] ?? detailUser.signup_source ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">국가 / 언어</p>
                <p className="font-bold text-gray-900 mt-0.5">
                  {detailUser.country ? `${countryFlag(detailUser.country)} ${detailUser.country}` : '-'}
                  {detailUser.language ? ` / ${detailUser.language}` : ''}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">시간대</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.timezone ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">회사</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.company ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">직책</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.job_title ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">전화번호</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.phone ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">프로젝트</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.project_count}개</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">이메일 인증</p>
                <p className={`font-bold mt-0.5 ${detailUser.email_verified ? 'text-green-600' : 'text-red-500'}`}>
                  {detailUser.email_verified ? '완료' : '미인증'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">2FA (TOTP)</p>
                <p className={`font-bold mt-0.5 ${detailUser.totp_enabled ? 'text-green-600' : 'text-gray-400'}`}>
                  {detailUser.totp_enabled ? '활성' : '비활성'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">가입 IP</p>
                <p className="font-bold text-gray-900 mt-0.5 text-xs font-mono">{detailUser.signup_ip ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">최근 로그인 IP</p>
                <p className="font-bold text-gray-900 mt-0.5 text-xs font-mono">{detailUser.last_login_ip ?? '-'}</p>
              </div>
            </div>

            {detailUser.locked_until && detailUser.locked_until > Date.now() && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <p className="text-sm font-bold text-red-700">
                  계정 잠김 — {fmtFull(detailUser.locked_until)}까지
                </p>
              </div>
            )}

            {detailUser.productRoles.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">제품별 역할</p>
                <div className="flex flex-wrap gap-2">
                  {detailUser.productRoles.map((pr, i) => (
                    <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-semibold">
                      {pr.product}:{pr.role}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detailUser.orgs.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">소속 조직</p>
                <div className="flex flex-wrap gap-2">
                  {detailUser.orgs.map((o, i) => (
                    <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full font-semibold">
                      {o.org_name} ({o.role})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button onClick={() => {
                setEditUser(detailUser);
                setEditPlan(detailUser.plan);
                setEditRole(detailUser.role);
                setEditName(detailUser.name);
                setEditCompany(detailUser.company ?? '');
                setEditJobTitle(detailUser.job_title ?? '');
                setEditPhone(detailUser.phone ?? '');
                setEditCountry(detailUser.country ?? '');
                setEditLanguage(detailUser.language ?? '');
                setEditTimezone(detailUser.timezone ?? '');
                setDetailUser(null);
              }} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
                수정
              </button>
              <button onClick={() => setDetailUser(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-black text-gray-900 mb-1">회원 수정</h2>
            <p className="text-sm text-gray-500 mb-4">{editUser.email}</p>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">이름</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">플랜</label>
                  <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    {['free', 'pro', 'team', 'enterprise'].map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">글로벌 역할</label>
                  <select value={editRole} onChange={e => setEditRole(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    <option value="user">user</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">회사</label>
                <input value={editCompany} onChange={e => setEditCompany(e.target.value)} placeholder="회사명"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">직책</label>
                <input value={editJobTitle} onChange={e => setEditJobTitle(e.target.value)} placeholder="직책"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">전화번호</label>
                <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+82-10-1234-5678"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">국가</label>
                  <input value={editCountry} onChange={e => setEditCountry(e.target.value)} placeholder="KR"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">언어</label>
                  <select value={editLanguage} onChange={e => setEditLanguage(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    <option value="">미설정</option>
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">시간대</label>
                <input value={editTimezone} onChange={e => setEditTimezone(e.target.value)} placeholder="Asia/Seoul"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => void handleEdit()} disabled={editSaving}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition">
                {editSaving ? '저장 중...' : '저장'}
              </button>
              <button onClick={() => setEditUser(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">회원 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 {total.toLocaleString()}명</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            CSV 내보내기
          </button>
          <button onClick={() => void load()}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            새로고침
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '전체 회원', value: totalUsers.toLocaleString(), icon: '👥' },
          { label: '유료 회원', value: paidUsers.toLocaleString(), icon: '💎' },
          { label: '무료 회원', value: (totalUsers - paidUsers).toLocaleString(), icon: '🆓' },
          { label: '전환율', value: totalUsers > 0 ? ((paidUsers / totalUsers) * 100).toFixed(1) + '%' : '0%', icon: '📈' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400">{k.icon} {k.label}</p>
            <p className="text-2xl font-black text-gray-900 mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      {stats.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">플랜별 분포</p>
          <div className="flex flex-wrap gap-2">
            {stats.sort((a, b) => b.count - a.count).map(r => (
              <div key={r.plan} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${PLAN_COLOR[r.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                {r.plan} · {r.count}명
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select value={filterPlan} onChange={e => { setFilterPlan(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 플랜</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="team">Team</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 역할</option>
          <option value="user">user</option>
          <option value="super_admin">super_admin</option>
        </select>
        <select value={filterService} onChange={e => { setFilterService(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 서비스</option>
          <option value="nexyfab">NexyFab</option>
          <option value="nexyflow">NexyFlow</option>
          <option value="nexysys">Nexysys</option>
        </select>
        <select value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">가입 경로</option>
          <option value="email">Email</option>
          <option value="google">Google</option>
          <option value="kakao">Kakao</option>
          <option value="naver">Naver</option>
        </select>
        <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 국가</option>
          <option value="KR">한국</option>
          <option value="US">미국</option>
          <option value="JP">일본</option>
          <option value="CN">중국</option>
        </select>
        <select value={filterVerified} onChange={e => { setFilterVerified(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">인증 상태</option>
          <option value="1">인증 완료</option>
          <option value="0">미인증</option>
        </select>
        <select value={filterSort} onChange={e => { setFilterSort(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="created_at_desc">최근 가입순</option>
          <option value="created_at_asc">오래된순</option>
          <option value="last_login_desc">최근 로그인순</option>
          <option value="login_count_desc">로그인 많은순</option>
          <option value="name_asc">이름순</option>
          <option value="email_asc">이메일순</option>
        </select>
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
          placeholder="이메일 / 이름 검색"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 flex-1 min-w-[160px]" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">회원이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">회원</th>
                  <th className="px-4 py-3 text-left">플랜</th>
                  <th className="px-4 py-3 text-left">국가</th>
                  <th className="px-4 py-3 text-left">서비스 / 가입</th>
                  <th className="px-4 py-3 text-left">제품 역할</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-left">활동</th>
                  <th className="px-4 py-3 text-left">액션</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isLocked = !!(user.locked_until && user.locked_until > Date.now());
                  return (
                    <tr key={user.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${isLocked ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setDetailUser(user)}>
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {initials(user.name)}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900 truncate max-w-[150px] hover:text-blue-600">{user.name}</p>
                            <p className="text-xs text-gray-400 truncate max-w-[150px]">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block w-fit ${PLAN_COLOR[user.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                            {user.plan}
                          </span>
                          {user.role !== 'user' && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block w-fit ${ROLE_COLOR[user.role] ?? ''}`}>
                              {user.role}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {user.country ? (
                          <span>{countryFlag(user.country)} {user.country}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                        {user.company && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[80px]">{user.company}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {parseServices(user.services).map(s => (
                            <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SERVICE_COLOR[s] ?? 'bg-gray-100 text-gray-600'}`}>
                              {s}
                            </span>
                          ))}
                        </div>
                        {user.signup_source && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${SOURCE_COLOR[user.signup_source] ?? 'bg-gray-100 text-gray-600'}`}>
                            {SOURCE_LABEL[user.signup_source] ?? user.signup_source}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {user.productRoles.length > 0 ? user.productRoles.map((pr, i) => (
                            <span key={i} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                              {pr.product}:{pr.role}
                            </span>
                          )) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {user.email_verified ? (
                            <span className="text-[10px] font-semibold text-green-600">인증됨</span>
                          ) : (
                            <span className="text-[10px] font-semibold text-red-500">미인증</span>
                          )}
                          {user.totp_enabled ? (
                            <span className="text-[10px] font-semibold text-blue-600">2FA</span>
                          ) : null}
                          {isLocked && (
                            <span className="text-[10px] font-bold text-red-600">LOCKED</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{fmt(user.created_at)}</p>
                        <p className="text-gray-400" title={user.last_login_at ? fmtFull(user.last_login_at) : ''}>
                          {user.last_login_at ? timeAgo(user.last_login_at) : '-'}
                          {user.login_count > 0 && <span className="ml-1 text-gray-300">({user.login_count})</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => {
                            setEditUser(user);
                            setEditPlan(user.plan);
                            setEditRole(user.role);
                            setEditName(user.name);
                            setEditCompany(user.company ?? '');
                            setEditJobTitle(user.job_title ?? '');
                            setEditPhone(user.phone ?? '');
                            setEditCountry(user.country ?? '');
                            setEditLanguage(user.language ?? '');
                            setEditTimezone(user.timezone ?? '');
                          }}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">
                            수정
                          </button>
                          <button onClick={() => void handleLock(user)} disabled={lockingId === user.id}
                            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${
                              isLocked
                                ? 'border-green-200 text-green-600 hover:bg-green-50'
                                : 'border-amber-200 text-amber-600 hover:bg-amber-50'
                            } disabled:opacity-50`}>
                            {lockingId === user.id ? <Spinner /> : (isLocked ? '해제' : '잠금')}
                          </button>
                          {user.role !== 'super_admin' && (
                            <button onClick={() => void handleDelete(user)} disabled={deletingId === user.id}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition">
                              {deletingId === user.id ? <Spinner /> : '삭제'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-400">{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} / {total}명</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              이전
            </button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
