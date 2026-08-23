'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate, formatDateTime } from '@/lib/formatDate';

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function _daysSince(ts: number) {
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

function timeAgo(ts: number | null, L?: (korean: string, english: string) => string): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return L?.('방금', 'Just now') ?? 'Just now';
  if (mins < 60) return `${mins}${L?.('분 전', ' minutes ago') ?? ' minutes ago'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${L?.('시간 전', ' hours ago') ?? ' hours ago'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}${L?.('일 전', ' days ago') ?? ' days ago'}`;
  return `${Math.floor(days / 30)}${L?.('개월 전', ' months ago') ?? ' months ago'}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
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

  // Create-account form (admin provisioning — public sign-up is invite-only)
  const [createOpen, setCreateOpen] = useState(false);
  const [cEmail, setCEmail]   = useState('');
  const [cName, setCName]     = useState('');
  const [cPw, setCPw]         = useState('');
  const [cPlan, setCPlan]     = useState('free');
  const [cBusy, setCBusy]     = useState(false);

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

  // The layout's AdminAuthGate already authenticated; auto-detect that session
  // so this page doesn't show a second password form.
  useEffect(() => {
    fetch('/api/admin/auth', { method: 'GET' })
      .then((r) => r.json())
      .then((d) => { if (d?.authed) setAuthed(true); })
      .catch(() => {});
  }, []);

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
      if (!res.ok) { setError(L('데이터를 불러오지 못했습니다.', 'Could not load user data.')); return; }
      const data = await res.json() as { users: User[]; total: number; stats: PlanStat[] };
      setUsers(data.users);
      setTotal(data.total);
      setStats(data.stats);
    } finally { setLoading(false); }
  }, [page, filterPlan, filterRole, filterVerified, filterCountry, filterSource, filterService, filterQ, filterSort, L]);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleCreateUser() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cEmail)) { showToast(L('유효한 이메일을 입력하세요.', 'Enter a valid email address.')); return; }
    if (cPw.length < 8) { showToast(L('비밀번호는 8자 이상이어야 합니다.', 'Password must be at least 8 characters.')); return; }
    setCBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cEmail.trim(), password: cPw, name: cName.trim(), plan: cPlan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(`${L('계정 생성 완료', 'Account created')}: ${cEmail}`);
        setCEmail(''); setCName(''); setCPw(''); setCPlan('free'); setCreateOpen(false);
        void load();
      } else {
        showToast(data.error || data.detail || `${L('생성 실패', 'Creation failed')} (${res.status})`);
      }
    } catch { showToast(L('생성 중 오류가 발생했습니다.', 'An error occurred while creating the account.')); }
    finally { setCBusy(false); }
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
      if (res.ok) { showToast(L('회원 정보 수정 완료', 'User details updated')); setEditUser(null); void load(); }
      else showToast(`${L('오류', 'Error')}: ${d.error}`);
    } finally { setEditSaving(false); }
  }

  async function handleLock(user: User) {
    const isLocked = user.locked_until && user.locked_until > Date.now();
    if (isLocked) {
      if (!confirm(`${user.email} — ${L('잠금을 해제하시겠습니까?', 'Unlock this account?')}`)) return;
    } else {
      if (!confirm(`${user.email} — ${L('계정을 잠금하시겠습니까? (24시간)', 'Lock this account? (24 hours)')}`)) return;
    }
    setLockingId(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, locked: !isLocked }),
      });
      if (res.ok) showToast(isLocked ? L('잠금 해제 완료', 'Account unlocked') : L('계정 잠금 완료', 'Account locked'));
      else showToast(L('오류 발생', 'An error occurred'));
      void load();
    } finally { setLockingId(null); }
  }

  async function handleDelete(user: User) {
    if (user.role === 'super_admin') { showToast(L('super_admin은 삭제할 수 없습니다', 'super_admin accounts cannot be deleted')); return; }
    if (!confirm(`${L('정말 회원을 삭제하시겠습니까?', 'Really delete this user?')} ${user.email}\n${L('이 작업은 되돌릴 수 없습니다.', 'This action cannot be undone.')}`)) return;
    if (!confirm(`${L('최종 확인: 모든 데이터가 삭제됩니다.', 'Final confirmation: all data will be deleted.')} ${user.email}`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) { showToast(L('회원 삭제 완료', 'User deleted')); void load(); }
      else showToast(`${L('오류', 'Error')}: ${d.error}`);
    } finally { setDeletingId(null); }
  }

  // CSV 내보내기
  function exportCSV() {
    const header = `ID,${L('이메일,이름,플랜,역할,서비스,회사,직책,국가,언어,시간대,전화번호,가입경로,가입IP,최근로그인IP,가입일,마지막로그인,로그인횟수,이메일인증,프로젝트수,잠금상태', 'Email,Name,Plan,Role,Service,Company,Job title,Country,Language,Timezone,Phone,Signup source,Signup IP,Last login IP,Signup date,Last login,Login count,Email verification,Projects,Lock status')},2FA\n`;
    const rows = users.map(u =>
      [u.id, u.email, u.name, u.plan, u.role,
        parseServices(u.services).join(';'),
        u.company ?? '', u.job_title ?? '', u.country ?? '', u.language ?? '',
        u.timezone ?? '', u.phone ?? '', u.signup_source ?? '',
        u.signup_ip ?? '', u.last_login_ip ?? '',
        formatDate(u.created_at),
        u.last_login_at ? formatDate(u.last_login_at) : '',
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
            <h1 className="text-xl font-black text-gray-900">{L('회원 관리', 'User management')}</h1>
            <p className="text-xs text-gray-400 mt-1">{L('관리자 인증 필요', 'Administrator authentication required')}</p>
          </div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void login()}
            placeholder={L('관리자 비밀번호', 'Admin password')}
            className={`w-full px-4 py-2.5 rounded-xl border text-sm mb-3 outline-none ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`} />
          <button onClick={() => void login()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
            {L('로그인', 'Log in')}
          </button>
          {pwError && <p className="text-red-500 text-xs text-center mt-2">{L('비밀번호가 틀렸습니다', 'Incorrect password')}</p>}
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

      {/* Create account — admin provisioning (public sign-up is invite-only) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">{L('계정 생성 (관리자 발급)', 'Create account (admin provisioned)')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{L('공개 회원가입은 비공개입니다. 여기서 만든 계정만 로그인할 수 있어요.', 'Public sign-up is private. Only accounts created here can log in.')}</p>
          </div>
          <button onClick={() => setCreateOpen(o => !o)} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500">
            {createOpen ? L('닫기', 'Close') : L('+ 새 계정', '+ New account')}
          </button>
        </div>
        {createOpen && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={cEmail} onChange={e => setCEmail(e.target.value)} type="email" placeholder={L('이메일', 'Email')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input value={cName} onChange={e => setCName(e.target.value)} type="text" placeholder={L('이름 (선택)', 'Name (optional)')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input value={cPw} onChange={e => setCPw(e.target.value)} type="text" placeholder={L('비밀번호 (8자 이상)', 'Password (8+ characters)')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={cPlan} onChange={e => setCPlan(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="team">Team</option>
            </select>
            <button onClick={() => void handleCreateUser()} disabled={cBusy} className="sm:col-span-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-60">
              {cBusy ? L('생성 중…', 'Creating…') : L('계정 생성 + 접근 권한 부여', 'Create account + grant access')}
            </button>
          </div>
        )}
      </div>

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
                <p className="text-xs text-gray-400">{L('플랜', 'Plan')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.plan}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('역할', 'Role')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.role}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('가입일', 'Signup date')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{formatDateTime(detailUser.created_at)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('마지막 로그인', 'Last login')}</p>
        <p className="font-bold text-gray-900 mt-0.5">{detailUser.last_login_at ? timeAgo(detailUser.last_login_at, L) : '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('로그인 횟수', 'Login count')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.login_count}{L('회', ' times')}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('가입 서비스', 'Signup service')}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {parseServices(detailUser.services).map(s => (
                    <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SERVICE_COLOR[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>
                  ))}
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('가입 경로', 'Signup source')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{SOURCE_LABEL[detailUser.signup_source ?? ''] ?? detailUser.signup_source ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('국가 / 언어', 'Country / language')}</p>
                <p className="font-bold text-gray-900 mt-0.5">
                  {detailUser.country ? `${countryFlag(detailUser.country)} ${detailUser.country}` : '-'}
                  {detailUser.language ? ` / ${detailUser.language}` : ''}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('시간대', 'Timezone')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.timezone ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('회사', 'Company')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.company ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('직책', 'Job title')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.job_title ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('전화번호', 'Phone')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.phone ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('프로젝트', 'Projects')}</p>
                <p className="font-bold text-gray-900 mt-0.5">{detailUser.project_count}{L('개', '')}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('이메일 인증', 'Email verification')}</p>
                <p className={`font-bold mt-0.5 ${detailUser.email_verified ? 'text-green-600' : 'text-red-500'}`}>
                  {detailUser.email_verified ? L('완료', 'Complete') : L('미인증', 'Unverified')}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">2FA (TOTP)</p>
                <p className={`font-bold mt-0.5 ${detailUser.totp_enabled ? 'text-green-600' : 'text-gray-400'}`}>
                  {detailUser.totp_enabled ? L('활성', 'Active') : L('비활성', 'Inactive')}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('가입 IP', 'Signup IP')}</p>
                <p className="font-bold text-gray-900 mt-0.5 text-xs font-mono">{detailUser.signup_ip ?? '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400">{L('최근 로그인 IP', 'Last login IP')}</p>
                <p className="font-bold text-gray-900 mt-0.5 text-xs font-mono">{detailUser.last_login_ip ?? '-'}</p>
              </div>
            </div>

            {detailUser.locked_until && detailUser.locked_until > Date.now() && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <p className="text-sm font-bold text-red-700">
                  {L('계정 잠김 —', 'Account locked —')} {formatDateTime(detailUser.locked_until)}{L('까지', ' until')}
                </p>
              </div>
            )}

            {detailUser.productRoles.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{L('제품별 역할', 'Product roles')}</p>
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
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{L('소속 조직', 'Organizations')}</p>
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
                {L('수정', 'Edit')}
              </button>
              <button onClick={() => setDetailUser(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                {L('닫기', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-black text-gray-900 mb-1">{L('회원 수정', 'Edit user')}</h2>
            <p className="text-sm text-gray-500 mb-4">{editUser.email}</p>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('이름', 'Name')}</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('플랜', 'Plan')}</label>
                  <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    {['free', 'pro', 'team', 'enterprise'].map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('글로벌 역할', 'Global role')}</label>
                  <select value={editRole} onChange={e => setEditRole(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    <option value="user">user</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('회사', 'Company')}</label>
                <input value={editCompany} onChange={e => setEditCompany(e.target.value)} placeholder={L('회사명', 'Company name')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('직책', 'Job title')}</label>
                  <input value={editJobTitle} onChange={e => setEditJobTitle(e.target.value)} placeholder={L('직책', 'Job title')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('전화번호', 'Phone')}</label>
                <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+82-10-1234-5678"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('국가', 'Country')}</label>
                  <input value={editCountry} onChange={e => setEditCountry(e.target.value)} placeholder="KR"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('언어', 'Language')}</label>
                  <select value={editLanguage} onChange={e => setEditLanguage(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400">
                    <option value="">{L('미설정', 'Not set')}</option>
                    <option value="ko">{L('한국어', 'Korean')}</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">{L('시간대', 'Timezone')}</label>
                <input value={editTimezone} onChange={e => setEditTimezone(e.target.value)} placeholder="Asia/Seoul"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => void handleEdit()} disabled={editSaving}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition">
                {editSaving ? L('저장 중...', 'Saving...') : L('저장', 'Save')}
              </button>
              <button onClick={() => setEditUser(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                {L('취소', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">{L('회원 관리', 'User management')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{L('전체', 'Total')} {total.toLocaleString()}{L('명', ' users')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            {L('CSV 내보내기', 'Export CSV')}
          </button>
          <button onClick={() => void load()}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            {L('새로고침', 'Refresh')}
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: L('전체 회원', 'All users'), value: totalUsers.toLocaleString(), icon: '👥' },
          { label: L('유료 회원', 'Paid users'), value: paidUsers.toLocaleString(), icon: '💎' },
          { label: L('무료 회원', 'Free users'), value: (totalUsers - paidUsers).toLocaleString(), icon: '🆓' },
          { label: L('전환율', 'Conversion rate'), value: totalUsers > 0 ? ((paidUsers / totalUsers) * 100).toFixed(1) + '%' : '0%', icon: '📈' },
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
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{L('플랜별 분포', 'Plan distribution')}</p>
          <div className="flex flex-wrap gap-2">
            {stats.sort((a, b) => b.count - a.count).map(r => (
              <div key={r.plan} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${PLAN_COLOR[r.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                {r.plan} · {r.count}{L('명', ' users')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select value={filterPlan} onChange={e => { setFilterPlan(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('전체 플랜', 'All plans')}</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="team">Team</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('전체 역할', 'All roles')}</option>
          <option value="user">user</option>
          <option value="super_admin">super_admin</option>
        </select>
        <select value={filterService} onChange={e => { setFilterService(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('전체 서비스', 'All services')}</option>
          <option value="nexyfab">NexyFab</option>
          <option value="nexyflow">NexyFlow</option>
          <option value="nexysys">Nexysys</option>
        </select>
        <select value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('가입 경로', 'Signup source')}</option>
          <option value="email">Email</option>
          <option value="google">Google</option>
          <option value="kakao">Kakao</option>
          <option value="naver">Naver</option>
        </select>
        <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('전체 국가', 'All countries')}</option>
          <option value="KR">{L('한국', 'South Korea')}</option>
          <option value="US">{L('미국', 'United States')}</option>
          <option value="JP">{L('일본', 'Japan')}</option>
          <option value="CN">{L('중국', 'China')}</option>
        </select>
        <select value={filterVerified} onChange={e => { setFilterVerified(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">{L('인증 상태', 'Verification status')}</option>
          <option value="1">{L('인증 완료', 'Verified')}</option>
          <option value="0">{L('미인증', 'Unverified')}</option>
        </select>
        <select value={filterSort} onChange={e => { setFilterSort(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="created_at_desc">{L('최근 가입순', 'Newest signup')}</option>
          <option value="created_at_asc">{L('오래된순', 'Oldest signup')}</option>
          <option value="last_login_desc">{L('최근 로그인순', 'Recent login')}</option>
          <option value="login_count_desc">{L('로그인 많은순', 'Most logins')}</option>
          <option value="name_asc">{L('이름순', 'Name')}</option>
          <option value="email_asc">{L('이메일순', 'Email')}</option>
        </select>
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
          placeholder={L('이메일 / 이름 검색', 'Search email / name')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 flex-1 min-w-[160px]" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">{L('회원이 없습니다.', 'No users found.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">{L('회원', 'User')}</th>
                  <th className="px-4 py-3 text-left">{L('플랜', 'Plan')}</th>
                  <th className="px-4 py-3 text-left">{L('국가', 'Country')}</th>
                  <th className="px-4 py-3 text-left">{L('서비스 / 가입', 'Service / signup')}</th>
                  <th className="px-4 py-3 text-left">{L('제품 역할', 'Product roles')}</th>
                  <th className="px-4 py-3 text-left">{L('상태', 'Status')}</th>
                  <th className="px-4 py-3 text-left">{L('활동', 'Activity')}</th>
                  <th className="px-4 py-3 text-left">{L('액션', 'Actions')}</th>
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
                            <span className="text-[10px] font-semibold text-green-600">{L('인증됨', 'Verified')}</span>
                          ) : (
                            <span className="text-[10px] font-semibold text-red-500">{L('미인증', 'Unverified')}</span>
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
                        <p className="text-gray-600">{formatDate(user.created_at)}</p>
                        <p className="text-gray-400" title={user.last_login_at ? formatDateTime(user.last_login_at) : ''}>
                          {user.last_login_at ? timeAgo(user.last_login_at, L) : '-'}
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
                            {L('수정', 'Edit')}
                          </button>
                          <button onClick={() => void handleLock(user)} disabled={lockingId === user.id}
                            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${
                              isLocked
                                ? 'border-green-200 text-green-600 hover:bg-green-50'
                                : 'border-amber-200 text-amber-600 hover:bg-amber-50'
                            } disabled:opacity-50`}>
                            {lockingId === user.id ? <Spinner /> : (isLocked ? L('해제', 'Unlock') : L('잠금', 'Lock'))}
                          </button>
                          {user.role !== 'super_admin' && (
                            <button onClick={() => void handleDelete(user)} disabled={deletingId === user.id}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition">
                              {deletingId === user.id ? <Spinner /> : L('삭제', 'Delete')}
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
          <p className="text-gray-400">{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} / {total}{L('명', ' users')}</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              {L('이전', 'Previous')}
            </button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              {L('다음', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
