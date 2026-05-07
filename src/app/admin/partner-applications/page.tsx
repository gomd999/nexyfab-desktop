'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type AppStatus = 'pending' | 'approved' | 'rejected';

interface PartnerApplication {
  id: string;
  company_name: string;
  biz_number: string;
  ceo_name: string;
  founded_year: number | null;
  employee_count: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title: string | null;
  processes: string[];
  certifications: string[];
  monthly_capacity: string | null;
  industries: string[];
  bio: string | null;
  homepage: string | null;
  status: AppStatus;
  created_at: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AppStatus, string> = {
  pending: '검토대기',
  approved: '승인',
  rejected: '거절',
};

const STATUS_COLOR: Record<AppStatus, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  approved: 'bg-green-50 text-green-700 border-green-300',
  rejected: 'bg-red-50 text-red-700 border-red-300',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PartnerApplicationsPage() {
  const [apps, setApps] = useState<PartnerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AppStatus | 'all'>('pending');
  const [actioning, setActioning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, string>>({});

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/partner-applications');
      const data = await res.json();
      setApps(data.applications || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setActioning(id + ':' + action);
    setMsgs(prev => ({ ...prev, [id]: '' }));
    try {
      const res = await fetch(`/api/admin/partner-applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        setApps(prev => prev.map(a => a.id === id ? { ...a, status: data.status as AppStatus } : a));
        setMsgs(prev => ({ ...prev, [id]: action === 'approve' ? '승인 완료. 환영 이메일을 발송했습니다.' : '거절 완료. 결과 이메일을 발송했습니다.' }));
      } else {
        setMsgs(prev => ({ ...prev, [id]: data.error || '처리 중 오류가 발생했습니다.' }));
      }
    } catch {
      setMsgs(prev => ({ ...prev, [id]: '서버 오류가 발생했습니다.' }));
    } finally {
      setActioning(null);
    }
  }

  const filtered = filter === 'all' ? apps : apps.filter(a => a.status === filter);

  const counts = {
    all: apps.length,
    pending: apps.filter(a => a.status === 'pending').length,
    approved: apps.filter(a => a.status === 'approved').length,
    rejected: apps.filter(a => a.status === 'rejected').length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">파트너 신청 관리</h1>
          <p className="text-gray-500 text-sm mt-1">파트너 등록 신청을 검토하고 승인/거절합니다</p>
        </div>
        <button
          onClick={fetchApps}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          새로고침
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(['all', 'pending', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s === filter ? 'all' : s)}
            className={`p-3 rounded-xl border text-center transition-all ${
              filter === s ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'
            } ${s === 'all' ? 'bg-gray-50 text-gray-700 border-gray-200' : STATUS_COLOR[s as AppStatus]}`}
          >
            <div className="text-xl font-bold">{counts[s]}</div>
            <div className="text-xs mt-0.5">
              {s === 'all' ? '전체' : STATUS_LABEL[s as AppStatus]}
            </div>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {filter === 'pending' ? '검토 대기 중인 신청이 없습니다.' : '신청 목록이 없습니다.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(app => {
            const isExpanded = expanded === app.id;
            const isActioning = actioning?.startsWith(app.id + ':');

            return (
              <div key={app.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Main row */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Company + status */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-gray-900 text-base">{app.company_name}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLOR[app.status]}`}>
                          {STATUS_LABEL[app.status]}
                        </span>
                      </div>

                      {/* Contact info */}
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">{app.contact_name}</span>
                        {app.contact_title && <span className="text-gray-400 ml-1">({app.contact_title})</span>}
                        <a href={`mailto:${app.contact_email}`} className="ml-2 text-blue-600 hover:underline">{app.contact_email}</a>
                        <span className="ml-2 text-gray-400">{app.contact_phone}</span>
                      </div>

                      {/* Processes & date */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {app.processes.slice(0, 5).map(p => (
                          <span key={p} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                            {p}
                          </span>
                        ))}
                        {app.processes.length > 5 && (
                          <span className="text-[11px] text-gray-400">+{app.processes.length - 5}</span>
                        )}
                      </div>

                      <div className="text-xs text-gray-400 mt-1.5">신청일: {formatDate(app.created_at)}</div>
                    </div>

                    {/* Action buttons */}
                    {app.status === 'pending' && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleAction(app.id, 'approve')}
                          disabled={!!isActioning}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          {actioning === app.id + ':approve' ? '처리 중...' : '승인'}
                        </button>
                        <button
                          onClick={() => handleAction(app.id, 'reject')}
                          disabled={!!isActioning}
                          className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-300 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          {actioning === app.id + ':reject' ? '처리 중...' : '거절'}
                        </button>
                      </div>
                    )}
                  </div>

                  {msgs[app.id] && (
                    <p className={`mt-2 text-xs font-semibold ${app.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
                      {msgs[app.id]}
                    </p>
                  )}

                  {/* Toggle details */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : app.id)}
                    className="mt-3 text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {isExpanded ? '▲ 상세 접기' : '▼ 상세 보기'}
                  </button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-gray-400 mb-0.5">사업자등록번호</div>
                        <div className="font-medium text-gray-800">{app.biz_number}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-0.5">대표자</div>
                        <div className="font-medium text-gray-800">{app.ceo_name}</div>
                      </div>
                      {app.founded_year && (
                        <div>
                          <div className="text-xs text-gray-400 mb-0.5">설립연도</div>
                          <div className="font-medium text-gray-800">{app.founded_year}년</div>
                        </div>
                      )}
                      {app.employee_count && (
                        <div>
                          <div className="text-xs text-gray-400 mb-0.5">직원 수</div>
                          <div className="font-medium text-gray-800">{app.employee_count}명</div>
                        </div>
                      )}
                      {app.monthly_capacity && (
                        <div>
                          <div className="text-xs text-gray-400 mb-0.5">월 생산 능력</div>
                          <div className="font-medium text-gray-800">{app.monthly_capacity}</div>
                        </div>
                      )}
                      {app.homepage && (
                        <div>
                          <div className="text-xs text-gray-400 mb-0.5">홈페이지</div>
                          <a href={app.homepage} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline truncate block">{app.homepage}</a>
                        </div>
                      )}
                    </div>

                    {app.certifications.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">보유 인증</div>
                        <div className="flex flex-wrap gap-1.5">
                          {app.certifications.map(c => (
                            <span key={c} className="text-[11px] bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-medium">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {app.industries.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">주요 납품 산업</div>
                        <div className="flex flex-wrap gap-1.5">
                          {app.industries.map(ind => (
                            <span key={ind} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-medium">{ind}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {app.bio && (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">회사 소개</div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded-lg px-3 py-2 border border-gray-200">{app.bio}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
