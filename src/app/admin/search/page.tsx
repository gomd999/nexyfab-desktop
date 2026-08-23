'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  href: string;
}

interface SearchResults {
  users:     SearchHit[];
  rfqs:      SearchHit[];
  factories: SearchHit[];
  contracts: SearchHit[];
  partners?: SearchHit[];
}

const TYPE_ICON: Record<string, string> = {
  user:     '👤',
  rfq:      '📋',
  factory:  '🏭',
  contract: '📄',
  partner:  '🤝',
};

const TYPE_LABEL: Record<string, { ko: string; en: string }> = {
  user:     { ko: '사용자', en: 'Users' },
  rfq:      { ko: 'RFQ', en: 'RFQs' },
  factory:  { ko: '제조사', en: 'Factories' },
  contract: { ko: '계약', en: 'Contracts' },
  partner:  { ko: '파트너', en: 'Partners' },
};

const GROUP_HREF: Record<string, string> = {
  users:     '/admin/users',
  rfqs:      '/admin/rfq',
  factories: '/admin/factories',
  contracts: '/admin/contracts',
  partners:  '/admin/partners',
};

const RECENT_KEY = 'admin_search_recent';
const MAX_RECENT = 8;

const SUGGESTIONS = [
  { ko: 'PCB', en: 'PCB' },
  { ko: '알루미늄', en: 'Aluminum' },
  { ko: 'EV 배터리', en: 'EV battery' },
  { ko: '의료기기', en: 'Medical device' },
  { ko: '프로토타입', en: 'Prototype' },
  { ko: '시제품', en: 'Pilot product' },
];

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

function addRecent(q: string) {
  const prev = getRecent().filter(r => r !== q);
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
}

function removeRecent(q: string) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter(r => r !== q)));
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  assigned: 'bg-blue-100 text-blue-700',
  quoted: 'bg-sky-100 text-sky-700',
  accepted: 'bg-teal-100 text-teal-700',
  completed: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-indigo-100 text-indigo-700',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminSearchPage() {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent]   = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 400);

  useEffect(() => { setRecent(getRecent()); }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results);
        addRecent(q);
        setRecent(getRecent());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void search(debouncedQuery); }, [debouncedQuery, search]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const grouped = results ? [
    { key: 'users',     label: L(TYPE_LABEL.user.ko, TYPE_LABEL.user.en),         icon: TYPE_ICON.user,     hits: results.users },
    { key: 'rfqs',      label: L(TYPE_LABEL.rfq.ko, TYPE_LABEL.rfq.en),           icon: TYPE_ICON.rfq,      hits: results.rfqs },
    { key: 'factories', label: L(TYPE_LABEL.factory.ko, TYPE_LABEL.factory.en),   icon: TYPE_ICON.factory,  hits: results.factories },
    { key: 'contracts', label: L(TYPE_LABEL.contract.ko, TYPE_LABEL.contract.en), icon: TYPE_ICON.contract, hits: results.contracts },
    { key: 'partners',  label: L(TYPE_LABEL.partner.ko, TYPE_LABEL.partner.en),   icon: TYPE_ICON.partner,  hits: results.partners ?? [] },
  ].filter(g => g.hits.length > 0) : [];

  const totalHits = grouped.reduce((s, g) => s + g.hits.length, 0);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{L('통합 검색', 'Global search')}</h1>
        <p className="text-sm text-gray-500 mt-1">{L('회원 · RFQ · 제조사 · 계약 전체 검색', 'Search users, RFQs, factories, and contracts')}</p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={L('이메일, 부품명, 회사명, 계약 ID 등...', 'Email, part name, company, contract ID, and more...')}
          className="w-full pl-12 pr-4 py-3.5 text-base border-2 border-gray-200 rounded-2xl outline-none focus:border-blue-400 transition shadow-sm"
        />
        {loading && (
          <div className="absolute inset-y-0 right-4 flex items-center">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* No-query state: recent searches + suggestions */}
      {!query && (
        <div>
          {recent.length > 0 ? (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{L('최근 검색', 'Recent searches')}</h2>
                <button
                  onClick={() => { localStorage.removeItem(RECENT_KEY); setRecent([]); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  {L('전체 삭제', 'Clear all')}
                </button>
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-50">
                {recent.map(r => (
                  <div key={r} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <span className="text-gray-300">🕐</span>
                    <button
                      className="flex-1 text-left text-sm text-gray-700 hover:text-blue-600 transition-colors"
                      onClick={() => setQuery(r)}
                    >
                      {r}
                    </button>
                    <button
                      onClick={() => { removeRecent(r); setRecent(getRecent()); }}
                      className="text-gray-300 hover:text-gray-500 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-400">
              <div className="text-5xl mb-3">🔍</div>
              <p className="text-sm font-semibold">{L('검색어를 입력하세요', 'Enter a search term')}</p>
              <p className="text-xs mt-1">{L('이메일, 부품명, RFQ ID, 계약 번호 등으로 검색', 'Search by email, part name, RFQ ID, contract number, and more')}</p>
            </div>
          )}

          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{L('추천 검색', 'Suggested searches')}</h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s.en}
                  onClick={() => setQuery(L(s.ko, s.en))}
                  className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-full text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors shadow-sm"
                >
                  {L(s.ko, s.en)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* No results state */}
      {query.length >= 2 && !loading && totalHits === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">😕</div>
          <p className="text-sm font-semibold text-gray-600">{L(`“${query}”에 대한 검색 결과가 없습니다`, `No results found for “${query}”`)}</p>
          <p className="text-xs mt-1 mb-6">{L('검색어를 다시 확인하거나 다른 키워드로 시도해 보세요.', 'Check the search term or try another keyword.')}</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {SUGGESTIONS.map(s => (
              <button
                key={s.en}
                onClick={() => setQuery(L(s.ko, s.en))}
                className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-full text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                {L(s.ko, s.en)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grouped results */}
      {grouped.map(({ key, label, icon, hits }) => (
        <div key={key} className="mb-6">
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-base">{icon}</span>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
            <span className="text-xs font-bold text-gray-400">({hits.length})</span>
            <a
              href={GROUP_HREF[key] ?? '#'}
              className="ml-auto text-xs text-blue-500 hover:underline"
            >
              {L('전체 보기 →', 'View all →')}
            </a>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-50">
            {hits.map(hit => (
              <a
                key={hit.id}
                href={`${hit.href}?highlight=${encodeURIComponent(hit.id)}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <span className="text-xl shrink-0">{TYPE_ICON[hit.type] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 truncate">{hit.title}</span>
                    {hit.meta && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_COLORS[hit.meta] ?? 'bg-gray-100 text-gray-500'}`}>
                        {hit.meta}
                      </span>
                    )}
                  </div>
                  {hit.subtitle && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{hit.subtitle}</p>
                  )}
                </div>
                <code className="text-[9px] font-mono text-gray-300 shrink-0 hidden sm:block">{hit.id.slice(0, 12)}</code>
                <span className="text-gray-300 shrink-0">→</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
