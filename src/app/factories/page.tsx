'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const KO_INDUSTRIES = [
  { key: '절삭·가공',  label: '절삭·가공',  icon: '⚙️' },
  { key: '금형',       label: '금형',        icon: '🔩' },
  { key: '배전·전장',  label: '배전·전장',   icon: '⚡' },
  { key: '자동차부품', label: '자동차부품',  icon: '🚗' },
  { key: '금속가공',   label: '금속가공',    icon: '🔧' },
  { key: '플라스틱',   label: '플라스틱',    icon: '🧪' },
  { key: '전자부품',   label: '전자부품',    icon: '💡' },
  { key: '반도체장비', label: '반도체장비',  icon: '🖥️' },
  { key: '도금·도장',  label: '도금·도장',   icon: '🎨' },
  { key: '선박',       label: '선박',        icon: '⚓' },
];

const KO_REGIONS = ['수도권', '경상', '전라', '충청', '강원', '제주'];
const CN_REGIONS = [
  { zh: '广东', ko: '광둥' }, { zh: '山东', ko: '산둥' },
  { zh: '江苏', ko: '장쑤' }, { zh: '浙江', ko: '저장' },
  { zh: '河北', ko: '허베이' }, { zh: '上海', ko: '상하이' },
  { zh: '北京', ko: '베이징' }, { zh: '四川', ko: '쓰촨' },
];

const LIMIT = 48;

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface KoFactory {
  id: string; company: string; tags: string[];
  industry: string; region: string; address: string; country: 'ko';
}
interface CnFactory {
  id: string; company: string; tags: string[];
  industry: string; regionKo: string; regionZh: string; address: string; country: 'cn';
}
type Factory = KoFactory | CnFactory;

// ── 공장명 블러 처리 ──────────────────────────────────────────────────────────

function MaskedName({ name, fontSize = 14, bold = true }: { name: string; fontSize?: number; bold?: boolean }) {
  const prefix = name.startsWith('(주)') ? 4 : name.startsWith('(유)') || name.startsWith('(재)') ? 4 : 0;
  const showCount = prefix > 0
    ? prefix  // (주)+1글자
    : Math.min(3, Math.max(1, Math.floor(name.length / 2)));
  const visible = name.slice(0, showCount);
  const hidden = name.slice(showCount);
  return (
    <span style={{ fontWeight: bold ? 700 : 400, fontSize, color: '#111827', letterSpacing: '-0.01em' }}>
      {visible}
      {hidden && (
        <span style={{ filter: 'blur(6px)', userSelect: 'none', WebkitUserSelect: 'none' }}>
          {hidden}
        </span>
      )}
    </span>
  );
}

// ── 카드 ──────────────────────────────────────────────────────────────────────

function FactoryCard({ factory, view, search, field, region: filterRegion }: {
  factory: Factory; view: 'grid' | 'list';
  search: string; field: string; region: string;
}) {
  const isKo = factory.country === 'ko';
  const region = isKo ? (factory as KoFactory).region : (factory as CnFactory).regionKo;

  const contactParams = new URLSearchParams({
    from: 'factory',
    factoryId: factory.id,
    industry: factory.industry || '',
    tags: factory.tags.join(','),
    region: region || '',
    country: factory.country,
  });
  if (search) contactParams.set('search', search);
  if (field) contactParams.set('field', field);
  if (filterRegion) contactParams.set('filterRegion', filterRegion);

  const contactUrl = `/kr/project-inquiry/?${contactParams.toString()}`;
  const accentColor = isKo ? '#2563eb' : '#ea580c';
  const accentBg = isKo ? '#eff6ff' : '#fff7ed';
  const badgeBg = isKo ? '#dbeafe' : '#fed7aa';
  const badgeColor = isKo ? '#1d4ed8' : '#c2410c';

  if (view === 'list') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: '#fff', borderRadius: 14,
        border: '1px solid #f1f3f5',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        padding: '14px 20px',
        transition: 'box-shadow 0.15s, transform 0.15s',
        borderLeft: `3px solid ${accentColor}`,
      }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
          e.currentTarget.style.transform = 'translateX(2px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
          e.currentTarget.style.transform = 'translateX(0)';
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0,
        }}>
          {isKo ? '🏭' : '🏗️'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <MaskedName name={factory.company} fontSize={14} />
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
              background: badgeBg, color: badgeColor, letterSpacing: '0.02em',
            }}>{isKo ? '🇰🇷 국내' : '🇨🇳 중국'}</span>
            {region && (
              <span style={{
                fontSize: 11, color: '#9ca3af',
                display: 'flex', alignItems: 'center', gap: 2,
              }}>
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                </svg>
                {region}
              </span>
            )}
          </div>
          {factory.industry && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{factory.industry}</div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 260 }}>
          {factory.tags.slice(0, 3).map(t => (
            <span key={t} style={{
              fontSize: 11, background: '#f8fafc', color: '#64748b',
              padding: '2px 9px', borderRadius: 20, border: '1px solid #e2e8f0',
            }}>{t}</span>
          ))}
        </div>

        <a href={contactUrl} style={{
          flexShrink: 0, padding: '8px 20px', borderRadius: 10,
          background: accentColor, color: '#fff', fontSize: 12,
          fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.85'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
        >문의하기</a>
      </div>
    );
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 18,
      border: '1px solid #f1f3f5',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      padding: '20px', display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'box-shadow 0.2s, transform 0.2s',
      position: 'relative', overflow: 'hidden',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.1)';
        e.currentTarget.style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 상단 컬러 바 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accentColor}, ${isKo ? '#60a5fa' : '#fb923c'})`,
        borderRadius: '18px 18px 0 0',
      }} />

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
        <div style={{
          width: 46, height: 46, borderRadius: 14, flexShrink: 0,
          background: accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          border: `1px solid ${isKo ? '#bfdbfe' : '#fed7aa'}`,
        }}>
          {isKo ? '🏭' : '🏗️'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <MaskedName name={factory.company} fontSize={15} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
              background: badgeBg, color: badgeColor,
            }}>{isKo ? '🇰🇷 국내' : '🇨🇳 중국'}</span>
            {region && (
              <span style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 2 }}>
                <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                </svg>
                {region}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 업종 */}
      {factory.industry && (
        <div style={{
          fontSize: 11, color: '#64748b',
          background: '#f8fafc', border: '1px solid #e2e8f0',
          padding: '5px 10px', borderRadius: 8,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {factory.industry}
        </div>
      )}

      {/* 제품 태그 */}
      {factory.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {factory.tags.map(t => (
            <span key={t} style={{
              fontSize: 11, background: '#f8fafc', color: '#475569',
              padding: '3px 10px', borderRadius: 20, border: '1px solid #e2e8f0',
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* 잠금 안내 */}
      <div style={{
        fontSize: 10, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <svg width="9" height="9" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>
        회원가입 후 전체 정보 열람 가능
      </div>

      <a href={contactUrl} style={{
        marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '10px 0', borderRadius: 12,
        background: accentColor,
        color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
        letterSpacing: '0.01em',
        transition: 'opacity 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.85'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
      >
        문의하기
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

export default function FactoriesPage() {
  const [factories, setFactories] = useState<Factory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [country, setCountry] = useState<'ko' | 'cn'>('ko');
  const [field, setField] = useState('');
  const [region, setRegion] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [hasSearched, setHasSearched] = useState(true);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchFactories = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    setHasSearched(true);
    try {
      const params = new URLSearchParams({ country, page: String(p), limit: String(LIMIT) });
      if (field) params.set('field', field);
      if (region) params.set('region', region);
      if (search) params.set('search', search);

      const res = await fetch(`/api/factories/?${params.toString()}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setFactories(data.factories || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setError('공장 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [country, field, region, search]);

  useEffect(() => {
    if (!hasSearched && !search && !field && !region) return;
    setPage(1);
    fetchFactories(1);
  }, [fetchFactories]); // eslint-disable-line

  const switchCountry = (c: 'ko' | 'cn') => {
    setCountry(c);
    setField('');
    setRegion('');
    setPage(1);
    setHasSearched(false);
    setFactories([]);
    setTotal(0);
  };

  const handlePage = (p: number) => {
    setPage(p);
    fetchFactories(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setHasSearched(true);
    }, 400);
  };

  const handleFilter = (type: 'field' | 'region', val: string) => {
    if (type === 'field') setField(prev => prev === val ? '' : val);
    else setRegion(prev => prev === val ? '' : val);
    setHasSearched(true);
  };

  const regionList = country === 'ko' ? KO_REGIONS : CN_REGIONS.map(r => r.ko);
  const koTotal = 277532;
  const cnTotal = 8860;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Pretendard', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── 히어로 헤더 ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%)',
        padding: '48px 24px 0',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* 배경 장식 */}
        <div style={{
          position: 'absolute', top: -60, right: -60, width: 300, height: 300,
          borderRadius: '50%', background: 'rgba(96,165,250,0.06)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 0, left: '30%', width: 200, height: 200,
          borderRadius: '50%', background: 'rgba(255,255,255,0.03)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative' }}>
          {/* 뱃지 */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)',
            borderRadius: 20, padding: '4px 12px', marginBottom: 16,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
            <span style={{ fontSize: 11, color: '#93c5fd', fontWeight: 600, letterSpacing: '0.05em' }}>
              VERIFIED · 검증된 제조사
            </span>
          </div>

          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#fff', margin: '0 0 8px', letterSpacing: '-0.03em' }}>
            제조사 디렉터리
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 28px' }}>
            국내 {koTotal.toLocaleString()}개 · 중국 {cnTotal.toLocaleString()}개 공장 데이터베이스
          </p>

          {/* 검색창 */}
          <div style={{ position: 'relative', maxWidth: 600, marginBottom: 32 }}>
            <svg style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
              width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text" value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="공장명, 제품, 업종으로 검색..."
              style={{
                width: '100%', paddingLeft: 48, paddingRight: 20, paddingTop: 15, paddingBottom: 15,
                fontSize: 15, border: '2px solid rgba(255,255,255,0.1)',
                borderRadius: 14, outline: 'none',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff', backdropFilter: 'blur(10px)',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = '#3b82f6';
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              }}
            />
          </div>

          {/* 국가 탭 */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            {[
              { key: 'ko' as const, flag: '🇰🇷', label: '국내', count: koTotal },
              { key: 'cn' as const, flag: '🇨🇳', label: '중국', count: cnTotal },
            ].map(tab => (
              <button key={tab.key} onClick={() => switchCountry(tab.key)} style={{
                padding: '13px 28px', fontSize: 14, fontWeight: 700,
                border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: country === tab.key ? '2px solid #60a5fa' : '2px solid transparent',
                color: country === tab.key ? '#60a5fa' : 'rgba(255,255,255,0.4)',
                marginBottom: -1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>{tab.flag} {tab.label}</span>
                <span style={{
                  fontSize: 11, padding: '1px 8px', borderRadius: 20, fontWeight: 700,
                  background: country === tab.key ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.08)',
                  color: country === tab.key ? '#93c5fd' : 'rgba(255,255,255,0.3)',
                }}>{tab.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 필터 바 ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f1f5f9', boxShadow: '0 1px 0 #f1f5f9' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* 업종 (한국만) */}
          {country === 'ko' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', minWidth: 28, textTransform: 'uppercase' }}>업종</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {KO_INDUSTRIES.map(ind => (
                  <button key={ind.key} onClick={() => handleFilter('field', ind.key)} style={{
                    padding: '5px 13px', fontSize: 12, fontWeight: 600,
                    borderRadius: 20, border: '1.5px solid',
                    borderColor: field === ind.key ? '#3b82f6' : '#e2e8f0',
                    background: field === ind.key ? '#3b82f6' : '#fff',
                    color: field === ind.key ? '#fff' : '#475569',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 11 }}>{ind.icon}</span>
                    {ind.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 지역 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', minWidth: 28, textTransform: 'uppercase' }}>지역</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['전체', ...regionList].map(r => {
                const isAll = r === '전체';
                const active = isAll ? (hasSearched && !region) : region === r;
                return (
                  <button key={r} onClick={() => isAll ? setRegion('') : handleFilter('region', r)} style={{
                    padding: '5px 13px', fontSize: 12, fontWeight: 600,
                    borderRadius: 20, border: '1.5px solid',
                    borderColor: active ? '#3b82f6' : '#e2e8f0',
                    background: active ? '#3b82f6' : '#fff',
                    color: active ? '#fff' : '#475569',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px' }}>

        {/* ── 결과 헤더 ── */}
        {hasSearched && !loading && !error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              총 <strong style={{ color: '#0f172a', fontSize: 15 }}>{total.toLocaleString()}</strong>개 공장
              {totalPages > 1 && <span style={{ color: '#94a3b8' }}> · {page}/{totalPages} 페이지</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
              {(['grid', 'list'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  width: 32, height: 32, borderRadius: 8, border: 'none',
                  background: view === v ? '#fff' : 'transparent',
                  color: view === v ? '#3b82f6' : '#94a3b8',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  {v === 'grid'
                    ? <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="0" width="6" height="6" rx="1.5"/><rect x="10" y="0" width="6" height="6" rx="1.5"/><rect x="0" y="10" width="6" height="6" rx="1.5"/><rect x="10" y="10" width="6" height="6" rx="1.5"/></svg>
                    : <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="1" width="16" height="2.5" rx="1.25"/><rect x="0" y="6.75" width="16" height="2.5" rx="1.25"/><rect x="0" y="12.5" width="16" height="2.5" rx="1.25"/></svg>
                  }
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 빈 초기 화면 ── */}
        {!hasSearched && !loading && (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
            <p style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8, letterSpacing: '-0.02em' }}>
              {country === 'ko' ? '국내 277,532개' : '중국 8,860개'} 공장을 검색해보세요
            </p>
            <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 28 }}>
              공장명, 제품명, 업종으로 검색하거나 위 필터를 선택하세요
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {(country === 'ko'
                ? ['CNC 가공', '사출금형', '배전반', '자동차부품', '도금']
                : ['볼 밸브', '태양광 브래킷', '펌프', '알루미늄', '기어']
              ).map(kw => (
                <button key={kw} onClick={() => {
                  setSearchInput(kw); setSearch(kw); setHasSearched(true);
                }} style={{
                  padding: '8px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: '#fff', border: '1.5px solid #e2e8f0',
                  color: '#475569', cursor: 'pointer', transition: 'all 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#3b82f6'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
                >
                  #{kw}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 로딩 스켈레톤 ── */}
        {loading && (
          <div style={view === 'grid' ? {
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
          } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{
                background: '#fff', borderRadius: view === 'grid' ? 18 : 14,
                border: '1px solid #f1f3f5',
                height: view === 'grid' ? 200 : 70,
                animation: 'pulse 1.5s ease-in-out infinite',
                opacity: 1 - i * 0.05,
              }}>
                <style>{`@keyframes pulse { 0%,100%{background:#fff} 50%{background:#f8fafc} }`}</style>
              </div>
            ))}
          </div>
        )}

        {/* ── 에러 ── */}
        {!loading && error && (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            color: '#ef4444', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div style={{ fontWeight: 600 }}>{error}</div>
          </div>
        )}

        {/* ── 결과 없음 ── */}
        {!loading && !error && hasSearched && factories.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>😔</div>
            <div style={{ fontWeight: 600, color: '#64748b' }}>조건에 맞는 공장이 없습니다</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>검색어나 필터를 바꿔보세요</div>
          </div>
        )}

        {/* ── 결과 ── */}
        {!loading && !error && factories.length > 0 && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={view === 'grid' ? {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            } : {
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {factories.map(f => <FactoryCard key={f.id} factory={f} view={view} search={search} field={field} region={region} />)}
            </div>

            {/* ── 페이지네이션 ── */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 36, paddingBottom: 24 }}>
                <button onClick={() => handlePage(page - 1)} disabled={page <= 1} style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600,
                  borderRadius: 10, border: '1.5px solid #e2e8f0',
                  background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  color: page <= 1 ? '#cbd5e1' : '#475569',
                  transition: 'all 0.15s',
                }}>← 이전</button>

                {(() => {
                  const pages: number[] = [];
                  let start = Math.max(1, page - 3);
                  const end = Math.min(totalPages, start + 6);
                  start = Math.max(1, end - 6);
                  for (let i = start; i <= end; i++) pages.push(i);
                  return pages.map(p => (
                    <button key={p} onClick={() => handlePage(p)} style={{
                      width: 38, height: 38, fontSize: 13, fontWeight: 600,
                      borderRadius: 10, border: '1.5px solid',
                      borderColor: p === page ? '#3b82f6' : '#e2e8f0',
                      background: p === page ? '#3b82f6' : '#fff',
                      color: p === page ? '#fff' : '#475569',
                      cursor: 'pointer', transition: 'all 0.15s',
                      boxShadow: p === page ? '0 2px 8px rgba(59,130,246,0.3)' : 'none',
                    }}>{p}</button>
                  ));
                })()}

                <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages} style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600,
                  borderRadius: 10, border: '1.5px solid #e2e8f0',
                  background: '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  color: page >= totalPages ? '#cbd5e1' : '#475569',
                  transition: 'all 0.15s',
                }}>다음 →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
