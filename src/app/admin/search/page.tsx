'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  href: string;
}

interface SearchResults {
  users: SearchHit[];
  rfqs: SearchHit[];
  factories: SearchHit[];
  contracts: SearchHit[];
}

const TYPE_ICON: Record<string, string> = {
  user: '👤',
  rfq: '📋',
  factory: '🏭',
  contract: '📄',
};

const TYPE_LABEL: Record<string, string> = {
  user: '회원',
  rfq: 'RFQ',
  factory: '제조사',
  contract: '계약',
};

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { search(debouncedQuery); }, [debouncedQuery, search]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const allHits = results
    ? [...results.users, ...results.rfqs, ...results.factories, ...results.contracts]
    : [];

  const grouped = results ? [
    { key: 'users', label: '회원', hits: results.users },
    { key: 'rfqs', label: 'RFQ', hits: results.rfqs },
    { key: 'factories', label: '제조사', hits: results.factories },
    { key: 'contracts', label: '계약', hits: results.contracts },
  ].filter(g => g.hits.length > 0) : [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">통합 검색</h1>
        <p className="text-sm text-gray-500 mt-1">회원 · RFQ · 제조사 · 계약 전체 검색</p>
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
          placeholder="이메일, 부품명, 회사명, 계약 ID 등..."
          className="w-full pl-12 pr-4 py-3.5 text-base border-2 border-gray-200 rounded-2xl outline-none focus:border-blue-400 transition shadow-sm"
        />
        {loading && (
          <div className="absolute inset-y-0 right-4 flex items-center">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results */}
      {query.length >= 2 && !loading && allHits.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm font-semibold">"{query}"에 대한 결과가 없습니다</p>
        </div>
      )}

      {grouped.map(({ key, label, hits }) => (
        <div key={key} className="mb-6">
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</span>
            <span className="text-xs font-bold text-gray-400">({hits.length})</span>
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
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_COLORS[hit.meta] ?? 'bg-gray-100 text-gray-500'}`}>
                      {hit.meta}
                    </span>
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

      {!query && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">🔍</div>
          <p className="text-sm font-semibold">검색어를 입력하세요</p>
          <p className="text-xs mt-1">이메일, 부품명, RFQ ID, 계약 번호 등으로 검색</p>
        </div>
      )}
    </div>
  );
}
