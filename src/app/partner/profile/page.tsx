'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/useToast';
import {
  DEFAULT_PRICEBOOK, DEFAULT_CAPABILITY,
  type PriceBook, type ProcessCapability,
} from '@/lib/partner-pricebook';
import PriceBookEditor from './PriceBookEditor';
import CapabilityEditor from './CapabilityEditor';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Profile {
  partnerId: string;
  email: string;
  company: string;
  name: string;
  phone: string;
  homepage: string;
  bio: string;
  processes: string[];
  certifications: string[];
  tech_exp: string;
  match_field: string;
  amount: string;
  partner_type: string;
  status: string;
  avatarUrl?: string;
  priceBook?: PriceBook;
  processCapability?: ProcessCapability;
}

type TabKey = 'profile' | 'pricebook' | 'capability';

interface ReviewSummary {
  avgRating: number;
  avgDeadline: number;
  avgQuality: number;
  avgCommunication: number;
  count: number;
}

const ISO_OPTIONS = ['ISO9001', 'ISO14001', 'IATF16949', 'AS9100'];

const PRESET_PROCESSES = ['CNC가공', '판금', '도금', '사출성형', '3D프린팅', '레이저커팅', '용접', '열처리', '표면처리', '주조'];

function Sidebar({ partner, onLogout }: { partner: Partner | null; onLogout: () => void }) {
  const navItems = [
    { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
    { href: '/partner/projects', label: '프로젝트', icon: '📦' },
    { href: '/partner/quotes', label: '견적', icon: '📝' },
    { href: '/partner/settlements', label: '정산', icon: '💰' },
    { href: '/partner/portfolio', label: '포트폴리오', icon: '🏆' },
    { href: '/partner/profile', label: '프로필', icon: '🏭' },
  ];
  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen">
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/" prefetch={false} className="text-lg font-black text-gray-900">NexyFab</Link>
        <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
      </div>
      {partner && (
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-bold text-gray-800 truncate">{partner.company || '파트너'}</div>
          <div className="text-xs text-gray-400 truncate">{partner.email}</div>
        </div>
      )}
      <nav className="flex-1 px-3 py-3 space-y-1">
        {navItems.map(item => {
          const isActive = typeof window !== 'undefined' && window.location.pathname === item.href;
          return (
            <Link key={item.href} href={item.href} prefetch={false}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-gray-100">
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
          <span>🚪</span>로그아웃
        </button>
      </div>
    </aside>
  );
}

function StarDisplay({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`text-base leading-none ${i < Math.round(value) ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
      ))}
    </span>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-6 shrink-0">{value.toFixed(1)}</span>
    </div>
  );
}

// ─── Read-only profile view ──────────────────────────────────────────────────

function ProfileView({ profile, avatarUrl, onEdit }: { profile: Profile; avatarUrl: string | null; onEdit: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">회사 프로필</h2>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
          title="편집"
        >
          <PencilIcon />
          편집
        </button>
      </div>

      {/* Avatar + 기본 정보 */}
      <div className="px-6 py-5 flex items-start gap-5 border-b border-gray-100">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
          {avatarUrl
            ? <Image src={avatarUrl} alt="logo" fill className="object-cover" sizes="64px" unoptimized />
            : <span className="text-2xl text-gray-400">🏭</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900 truncate">{profile.company || '—'}</h3>
          {profile.name && <p className="text-sm text-gray-500 mt-0.5">담당자: {profile.name}</p>}
          {profile.email && <p className="text-xs text-gray-400 mt-0.5">{profile.email}</p>}
          {profile.phone && <p className="text-xs text-gray-400">{profile.phone}</p>}
          {profile.homepage && (
            <a href={profile.homepage} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline">{profile.homepage}</a>
          )}
        </div>
      </div>

      {/* 공정 태그 */}
      {profile.processes && profile.processes.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">주요 공정</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.processes.map(p => (
              <span key={p} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 인증 배지 */}
      {profile.certifications && profile.certifications.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">보유 인증</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.certifications.map(c => (
              <span key={c} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 소개글 */}
      {profile.bio && (
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">회사 소개</p>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{profile.bio}</p>
        </div>
      )}
    </div>
  );
}

// ─── Edit form ───────────────────────────────────────────────────────────────

interface FormState {
  company: string;
  name: string;
  phone: string;
  homepage: string;
  bio: string;
  processes: string[];
  certifications: string[];
  // legacy fields
  tech_exp: string;
  match_field: string;
  amount: string;
  partner_type: string;
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5L12.5 4.5L5 12H2V9L9.5 1.5Z" />
    </svg>
  );
}

function ProfileEditForm({
  form, email, avatarUrl,
  setForm, onSave, onCancel, saving, onAvatarClick, avatarInputRef,
}: {
  form: FormState;
  email: string;
  avatarUrl: string | null;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  onAvatarClick: () => void;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [processInput, setProcessInput] = useState('');

  function addProcess(tag: string) {
    const t = tag.trim();
    if (!t || form.processes.includes(t)) return;
    setForm(f => ({ ...f, processes: [...f.processes, t] }));
    setProcessInput('');
  }

  function removeProcess(tag: string) {
    setForm(f => ({ ...f, processes: f.processes.filter(p => p !== tag) }));
  }

  function toggleCert(cert: string) {
    setForm(f => ({
      ...f,
      certifications: f.certifications.includes(cert)
        ? f.certifications.filter(c => c !== cert)
        : [...f.certifications, cert],
    }));
  }

  return (
    <form onSubmit={onSave} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">프로필 편집</h2>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
        >
          취소
        </button>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Avatar upload */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onAvatarClick}
            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-100 flex items-center justify-center transition-colors hover:border-blue-400"
            title="로고/아바타 변경"
          >
            {avatarUrl
              ? <Image src={avatarUrl} alt="logo" fill className="object-cover" sizes="64px" unoptimized />
              : <span className="text-2xl text-gray-400">🏭</span>
            }
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-xs font-bold">변경</span>
            </div>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
          />
          <div>
            <p className="text-sm font-semibold text-gray-700">회사 로고</p>
            <p className="text-xs text-gray-400 mt-0.5">클릭하여 이미지 업로드 (JPG, PNG, 최대 2MB)</p>
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">회사명</label>
            <input
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              placeholder="회사명"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">담당자명</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="홍길동"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">이메일</label>
            <input
              value={email}
              readOnly
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">전화번호</label>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">홈페이지 URL</label>
            <input
              value={form.homepage}
              onChange={e => setForm(f => ({ ...f, homepage: e.target.value }))}
              placeholder="https://example.com"
              type="url"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">회사 소개</label>
            <textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              rows={4}
              placeholder="보유 기술, 설비, 경험 등을 간략히 기술해 주세요."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
            />
          </div>
        </div>

        {/* 주요 공정 (chips) */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">주요 공정</label>
          {/* 프리셋 버튼 */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_PROCESSES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => addProcess(p)}
                disabled={form.processes.includes(p)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors
                  ${form.processes.includes(p)
                    ? 'bg-blue-50 text-blue-700 border-blue-200 cursor-default'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
                  }`}
              >
                {form.processes.includes(p) ? `✓ ${p}` : `+ ${p}`}
              </button>
            ))}
          </div>
          {/* 선택된 태그 */}
          {form.processes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.processes.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white">
                  {p}
                  <button
                    type="button"
                    onClick={() => removeProcess(p)}
                    className="ml-0.5 opacity-70 hover:opacity-100 leading-none text-sm"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* 직접 입력 */}
          <div className="flex gap-2">
            <input
              value={processInput}
              onChange={e => setProcessInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProcess(processInput); } }}
              placeholder="직접 입력 후 Enter"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button
              type="button"
              onClick={() => addProcess(processInput)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition"
            >
              추가
            </button>
          </div>
        </div>

        {/* 보유 인증 */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">보유 인증</label>
          <div className="flex flex-wrap gap-3">
            {ISO_OPTIONS.map(cert => (
              <label key={cert} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.certifications.includes(cert)}
                  onChange={() => toggleCert(cert)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className={`text-sm font-semibold transition-colors
                  ${form.certifications.includes(cert) ? 'text-emerald-700' : 'text-gray-600 group-hover:text-gray-900'}`}>
                  {cert}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 저장 버튼 */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
          >
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PartnerProfilePage() {
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormState>({
    company: '', name: '', phone: '', homepage: '', bio: '',
    processes: [], certifications: [],
    tech_exp: '', match_field: '', amount: '', partner_type: '',
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('profile');
  const [priceBook, setPriceBook] = useState<PriceBook>(DEFAULT_PRICEBOOK);
  const [capability, setCapability] = useState<ProcessCapability>(DEFAULT_CAPABILITY);
  const toast = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/partner/login'); return; }

    if (session === 'demo') {
      const demoProfile: Profile = {
        partnerId: 'demo-partner-001',
        email: 'demo-partner@nexyfab.com',
        company: 'Demo 제조사',
        name: '김철수',
        phone: '02-0000-0000',
        homepage: 'https://example.com',
        bio: '정밀 CNC 가공 전문 업체입니다. 다양한 금속 소재 가공 경험 보유.',
        processes: ['CNC가공', '판금', '도금'],
        certifications: ['ISO9001'],
        tech_exp: 'CNC가공, 판금',
        match_field: '정밀가공',
        amount: '10000000',
        partner_type: '제조사',
        status: 'active',
      };
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setProfile(demoProfile);
      setForm({
        company: demoProfile.company,
        name: demoProfile.name,
        phone: demoProfile.phone,
        homepage: demoProfile.homepage,
        bio: demoProfile.bio,
        processes: demoProfile.processes,
        certifications: demoProfile.certifications,
        tech_exp: demoProfile.tech_exp,
        match_field: demoProfile.match_field,
        amount: demoProfile.amount,
        partner_type: demoProfile.partner_type,
      });
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(async d => {
        if (!d.valid) { router.replace('/partner/login'); return; }
        setPartner(d.partner);

        const profileRes = await fetch('/api/partner/profile', {
          headers: { Authorization: `Bearer ${session}` },
        });
        const profileData = await profileRes.json();
        if (profileData?.profile) {
          const p: Profile = profileData.profile;
          setProfile(p);
          setAvatarUrl(p.avatarUrl ?? null);
          if (p.priceBook) setPriceBook(p.priceBook);
          if (p.processCapability) setCapability(p.processCapability);
          setForm({
            company: p.company || '',
            name: p.name || '',
            phone: p.phone || '',
            homepage: p.homepage || '',
            bio: p.bio || '',
            processes: Array.isArray(p.processes) ? p.processes : [],
            certifications: Array.isArray(p.certifications) ? p.certifications : [],
            tech_exp: p.tech_exp || '',
            match_field: p.match_field || '',
            amount: p.amount || '',
            partner_type: p.partner_type || '',
          });

          if (d.partner?.email) {
            const reviewRes = await fetch(`/api/reviews?summary=1&partnerEmail=${encodeURIComponent(d.partner.email)}`).catch(() => null);
            if (reviewRes?.ok) setReviewSummary(await reviewRes.json());
          }
        }
      })
      .catch(() => router.replace('/partner/login'))
      .finally(() => setLoading(false));
  }, [router]);

  // Avatar file selection handler
  useEffect(() => {
    const el = avatarInputRef.current;
    if (!el) return;
    const handler = async () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast.error('이미지 크기는 2MB 이하여야 합니다.');
        return;
      }
      // Preview immediately
      const url = URL.createObjectURL(file);
      setAvatarUrl(url);

      // Upload
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/partner/profile/avatar', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getSession()}` },
          body: fd,
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.url) setAvatarUrl(data.url);
          toast.success('로고가 업데이트되었습니다.');
        } else {
          toast.error('로고 업로드에 실패했습니다.');
        }
      } catch {
        toast.error('로고 업로드 중 오류가 발생했습니다.');
      }
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      // Update displayed profile
      setProfile(prev => prev ? { ...prev, ...form } : null);
      setEditMode(false);
      toast.success('프로필이 저장되었습니다.');
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function savePriceBook() {
    if (getSession() === 'demo') {
      toast.success('데모 모드: 단가표 저장 시뮬레이션 완료');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({ priceBook }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as
          { error?: string; issues?: Array<{ path: string; message: string }> };
        const detail = data.issues?.length
          ? data.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(' · ')
          : '';
        toast.error(detail
          ? `단가표 검증 실패 — ${detail}`
          : (data.error || '단가표 저장에 실패했습니다.'));
        return;
      }
      toast.success('단가표가 저장되었습니다.');
    } catch {
      toast.error('단가표 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function saveCapability() {
    if (getSession() === 'demo') {
      toast.success('데모 모드: 공정 능력표 저장 시뮬레이션 완료');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/partner/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({ processCapability: capability }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as
          { error?: string; issues?: Array<{ path: string; message: string }> };
        const detail = data.issues?.length
          ? data.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(' · ')
          : '';
        toast.error(detail
          ? `공정 능력표 검증 실패 — ${detail}`
          : (data.error || '공정 능력표 저장에 실패했습니다.'));
        return;
      }
      toast.success('공정 능력표가 저장되었습니다.');
    } catch {
      toast.error('공정 능력표 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar partner={partner} onLogout={logout} />

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around py-2">
        {[
          { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
          { href: '/partner/projects', label: '프로젝트', icon: '📦' },
          { href: '/partner/quotes', label: '견적', icon: '📝' },
          { href: '/partner/settlements', label: '정산', icon: '💰' },
          { href: '/partner/profile', label: '프로필', icon: '🏭' },
        ].map(item => (
          <Link key={item.href} href={item.href} prefetch={false}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl ${item.href === '/partner/profile' ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </Link>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">프로필</h1>
            <p className="text-sm text-gray-500 mt-1">공장/파트너사 정보 관리</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl">
            {([
              { key: 'profile',    label: '회사 정보' },
              { key: 'pricebook',  label: '단가표' },
              { key: 'capability', label: '공정 능력' },
            ] as { key: TabKey; label: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg transition-colors
                  ${tab === t.key
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && <>
          {/* 평점 카드 */}
          {reviewSummary && reviewSummary.count > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-900">내 평점</h2>
                <span className="text-xs text-gray-400">리뷰 {reviewSummary.count}건</span>
              </div>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-center">
                  <div className="text-4xl font-black text-gray-900">{reviewSummary.avgRating.toFixed(1)}</div>
                  <StarDisplay value={reviewSummary.avgRating} />
                  <p className="text-xs text-gray-400 mt-1">평균 별점</p>
                </div>
                <div className="flex-1 space-y-2">
                  <RatingBar label="납기 준수" value={reviewSummary.avgDeadline} />
                  <RatingBar label="품질" value={reviewSummary.avgQuality} />
                  <RatingBar label="소통" value={reviewSummary.avgCommunication} />
                </div>
              </div>
            </div>
          )}

          {reviewSummary && reviewSummary.count === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 mb-4">
              <p className="text-sm text-gray-400">아직 받은 평가가 없습니다.</p>
            </div>
          )}

          {/* Profile card */}
          {editMode ? (
            <ProfileEditForm
              form={form}
              email={partner?.email ?? profile?.email ?? ''}
              avatarUrl={avatarUrl}
              setForm={setForm}
              onSave={handleSave}
              onCancel={() => setEditMode(false)}
              saving={saving}
              onAvatarClick={() => avatarInputRef.current?.click()}
              avatarInputRef={avatarInputRef}
            />
          ) : profile ? (
            <ProfileView
              profile={{ ...profile, ...form }}
              avatarUrl={avatarUrl}
              onEdit={() => setEditMode(true)}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-8 text-center">
              <p className="text-gray-400 text-sm mb-4">프로필 정보가 없습니다.</p>
              <button
                onClick={() => setEditMode(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition"
              >
                프로필 작성하기
              </button>
            </div>
          )}
          </>}

          {tab === 'pricebook' && (
            <PriceBookEditor
              value={priceBook}
              onChange={setPriceBook}
              onSave={savePriceBook}
              saving={saving}
            />
          )}

          {tab === 'capability' && (
            <CapabilityEditor
              value={capability}
              onChange={setCapability}
              onSave={saveCapability}
              saving={saving}
            />
          )}
        </div>
      </main>
    </div>
  );
}
