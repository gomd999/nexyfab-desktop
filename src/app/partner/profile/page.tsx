'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
  tech_exp: string;
  match_field: string;
  amount: string;
  partner_type: string;
  status: string;
}

interface ReviewSummary {
  avgRating: number;
  avgDeadline: number;
  avgQuality: number;
  avgCommunication: number;
  count: number;
}

interface AvailabilityEntry {
  week_start: string;
  available_hours: number;
  notes: string | null;
}

function Sidebar({ partner, onLogout }: { partner: Partner | null; onLogout: () => void }) {
  const navItems = [
    { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
    { href: '/partner/projects', label: '프로젝트', icon: '📦' },
    { href: '/partner/quotes', label: '견적', icon: '📝' },
    { href: '/partner/portfolio', label: '포트폴리오', icon: '🏆' },
    { href: '/partner/profile', label: '프로필', icon: '🏭' },
  ];

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-gray-100">
        <a href="/" className="text-lg font-black text-gray-900">NexyFab</a>
        <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
      </div>
      {partner && (
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-bold text-gray-800 truncate">{partner.company || '파트너'}</div>
          <div className="text-xs text-gray-400 truncate">{partner.email}</div>
        </div>
      )}
      <nav className="flex-1 px-3 py-3 space-y-1">
        {navItems.map(item => (
          <a key={item.href} href={item.href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <span>{item.icon}</span>{item.label}
          </a>
        ))}
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
        <span key={i} className={`text-base leading-none ${i < Math.round(value) ? 'text-yellow-400' : 'text-gray-200'}`}>
          ★
        </span>
      ))}
    </span>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all"
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </div>
      <span className="text-xs font-bold text-gray-700 w-6 shrink-0">{value.toFixed(1)}</span>
    </div>
  );
}

export default function PartnerProfilePage() {
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [form, setForm] = useState({
    company: '', phone: '', tech_exp: '', match_field: '', amount: '', partner_type: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availSaving, setAvailSaving] = useState<string | null>(null);
  const [editingAvail, setEditingAvail] = useState<string | null>(null);
  const [editHours, setEditHours] = useState(40);

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
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setForm({ company: 'Demo 제조사', phone: '02-0000-0000', tech_exp: '3D프린팅, CNC가공, 금속판금', match_field: '정밀가공', amount: '10000000', partner_type: '제조사' });
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
          setProfile(profileData.profile);
          setForm({
            company: profileData.profile.company || '',
            phone: profileData.profile.phone || '',
            tech_exp: profileData.profile.tech_exp || '',
            match_field: profileData.profile.match_field || '',
            amount: profileData.profile.amount || '',
            partner_type: profileData.profile.partner_type || '',
          });

          // 평점 조회 + 가용성 조회 병렬
          if (d.partner?.email) {
            const email = d.partner.email;
            const [reviewRes, availRes] = await Promise.allSettled([
              fetch(`/api/reviews?summary=1&partnerEmail=${encodeURIComponent(email)}`),
              fetch(`/api/partner/availability?email=${encodeURIComponent(email)}&weeks=6`, {
                headers: { Authorization: `Bearer ${session}` },
              }),
            ]);
            if (reviewRes.status === 'fulfilled' && reviewRes.value.ok) {
              setReviewSummary(await reviewRes.value.json());
            }
            if (availRes.status === 'fulfilled' && availRes.value.ok) {
              const av = await availRes.value.json();
              setAvailability(av.availability ?? []);
            }
          }
        }
      })
      .catch(() => router.replace('/partner/login'))
      .finally(() => setLoading(false));
  }, [router]);

  function getNextMondays(count = 6): string[] {
    const mondays: string[] = [];
    const d = new Date();
    const day = d.getDay();
    const daysToMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    d.setDate(d.getDate() + daysToMon);
    for (let i = 0; i < count; i++) {
      mondays.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 7);
    }
    return mondays;
  }

  async function saveAvailability(weekStart: string, hours: number) {
    setAvailSaving(weekStart);
    try {
      const res = await fetch('/api/partner/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ weekStart, availableHours: hours }),
      });
      if (res.ok) {
        setAvailability(prev => {
          const existing = prev.find(a => a.week_start === weekStart);
          if (existing) return prev.map(a => a.week_start === weekStart ? { ...a, available_hours: hours } : a);
          return [...prev, { week_start: weekStart, available_hours: hours, notes: null }];
        });
        setEditingAvail(null);
      }
    } finally {
      setAvailSaving(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
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
      setMessage({ type: 'success', text: '프로필이 저장되었습니다.' });
    } catch {
      setMessage({ type: 'error', text: '저장에 실패했습니다.' });
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

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">프로필</h1>
            <p className="text-sm text-gray-500 mt-1">공장/파트너사 정보 관리</p>
          </div>

          {/* ─── 평점 카드 ─────────────────────────────────────────── */}
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

          {/* ─── 주간 가용성 위젯 ─────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">주간 가용성</h2>
              <span className="text-xs text-gray-400">향후 6주</span>
            </div>
            <div className="space-y-2">
              {getNextMondays(6).map(monday => {
                const entry = availability.find(a => a.week_start === monday);
                const hours = entry?.available_hours ?? 40;
                const isEditing = editingAvail === monday;
                const isSaving = availSaving === monday;
                const pct = Math.min(100, (hours / 80) * 100);
                const color = hours === 0 ? 'bg-red-400' : hours < 20 ? 'bg-amber-400' : 'bg-emerald-400';
                const label = new Date(monday + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                return (
                  <div key={monday} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-16 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={0} max={80}
                          value={editHours}
                          onChange={e => setEditHours(Number(e.target.value))}
                          className="w-14 px-2 py-1 text-xs border border-gray-300 rounded-lg outline-none focus:border-blue-400"
                          autoFocus
                        />
                        <span className="text-xs text-gray-400">h</span>
                        <button
                          onClick={() => saveAvailability(monday, editHours)}
                          disabled={isSaving}
                          className="text-xs font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          {isSaving ? '저장중' : '저장'}
                        </button>
                        <button onClick={() => setEditingAvail(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingAvail(monday); setEditHours(hours); }}
                        className="text-xs font-semibold text-gray-700 w-16 text-right shrink-0 hover:text-blue-600 transition-colors"
                      >
                        {hours}h/주
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">시간을 클릭해 편집하세요. 0h = 불가, 40h = 전일제, 80h = 초과근무</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* 기본 정보 (읽기 전용) */}
            {profile && (
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400">이메일</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{profile.email}</p>
                  </div>
                  {profile.name && (
                    <div>
                      <p className="text-xs text-gray-400">담당자</p>
                      <p className="text-sm font-semibold text-gray-800 mt-0.5">{profile.name}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 편집 폼 */}
            <form onSubmit={handleSave} className="px-6 py-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">전화번호</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">업종/파트너 유형</label>
                  <input
                    value={form.partner_type}
                    onChange={e => setForm(f => ({ ...f, partner_type: e.target.value }))}
                    placeholder="예: 금속 가공, 사출 성형"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">예산 규모</label>
                  <input
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="예: 1억~5억"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">매칭 분야</label>
                  <input
                    value={form.match_field}
                    onChange={e => setForm(f => ({ ...f, match_field: e.target.value }))}
                    placeholder="예: 자동차 부품, 전자제품 케이스"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">기술/경험 소개</label>
                  <textarea
                    value={form.tech_exp}
                    onChange={e => setForm(f => ({ ...f, tech_exp: e.target.value }))}
                    rows={4}
                    placeholder="보유 기술, 설비, 경험 등을 간략히 기술해 주세요."
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
                  />
                </div>
              </div>

              {message && (
                <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${
                  message.type === 'success'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '변경사항 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
