'use client';

// Plugin marketplace — public catalog of NexyFab plugins.
// v1 ships a curated list with install hooks that store the chosen plugin
// ids in localStorage; PluginHost in the modeler picks them up at boot.
//
// Future: replace MARKETPLACE_SEED with a fetch to /api/public/v1/plugins.

import { use, useEffect, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface PluginCard {
  id: string;
  title: string;
  author: string;
  version: string;
  description: { ko: string; en: string };
  category: 'export' | 'analysis' | 'generative' | 'ui' | 'cam';
  installs: number;
  rating: number;
  permissions: string[];
}

const MARKETPLACE_SEED: PluginCard[] = [
  {
    id: 'com.nexyfab.iso-fasteners',
    title: 'ISO Fasteners Pro',
    author: 'NexyFab Team',
    version: '1.2.0',
    description: {
      ko: 'ISO 4762 SHCS, ISO 4017 헥스 볼트, ISO 7089 와셔 등 200+ 표준부품.',
      en: '200+ ISO standard fasteners — SHCS, hex bolts, washers, nuts.',
    },
    category: 'export',
    installs: 12_847,
    rating: 4.7,
    permissions: ['geometry:write', 'tool:register'],
  },
  {
    id: 'com.acme.gear-wizard',
    title: 'Gear Wizard',
    author: 'Acme Robotics',
    version: '0.9.3',
    description: {
      ko: '스퍼/헬리컬/베벨 기어 자동 생성. AGMA/JIS 표준 지원.',
      en: 'Auto-generate spur, helical, and bevel gears. AGMA and JIS standards.',
    },
    category: 'generative',
    installs: 4_201,
    rating: 4.5,
    permissions: ['geometry:write', 'tool:register'],
  },
  {
    id: 'com.makerlab.topology-pro',
    title: 'Topology Pro',
    author: 'MakerLab',
    version: '2.0.0',
    description: {
      ko: 'SIMP 기반 위상 최적화. FEA 결과를 입력으로 받아 자동 경량화.',
      en: 'SIMP-based topology optimisation. Reads FEA results for auto lightweighting.',
    },
    category: 'analysis',
    installs: 8_932,
    rating: 4.8,
    permissions: ['geometry:read', 'geometry:write'],
  },
  {
    id: 'com.cncfox.fanuc-pro',
    title: 'Fanuc Post-Processor Pro',
    author: 'CNC Fox',
    version: '3.1.0',
    description: {
      ko: 'Fanuc 0i/30i/31i 전용 G-code 포스트. 다축, 헬리컬 보간 지원.',
      en: 'Dedicated Fanuc 0i/30i/31i post. Multi-axis + helical interp.',
    },
    category: 'cam',
    installs: 6_113,
    rating: 4.6,
    permissions: ['export:invoke', 'tool:register'],
  },
  {
    id: 'com.nexyfab.dark-pro',
    title: 'Dark Pro Theme',
    author: 'NexyFab Team',
    version: '1.0.0',
    description: {
      ko: '고대비 다크 테마 + 모노스페이스 폰트 프리셋.',
      en: 'High-contrast dark theme with monospace font preset.',
    },
    category: 'ui',
    installs: 19_204,
    rating: 4.4,
    permissions: ['tool:register'],
  },
  {
    id: 'com.acme.fea-cloud',
    title: 'FEA Cloud Solver',
    author: 'Acme Simulation',
    version: '0.7.0',
    description: {
      ko: '대형 메시 클라우드 FEA. 비선형 동적 해석 지원.',
      en: 'Cloud FEA for large meshes. Nonlinear + dynamic supported.',
    },
    category: 'analysis',
    installs: 2_440,
    rating: 4.2,
    permissions: ['geometry:read'],
  },
];

const STORAGE_KEY = 'nexyfab.installed-plugins.v1';

export default function PluginsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<PluginCard['category'] | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setInstalled(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  const toggle = (id: string) => {
    setInstalled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      }
      return next;
    });
  };

  const visible = MARKETPLACE_SEED.filter(p => {
    if (filter !== 'all' && p.category !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.author.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0c0f14', color: '#d8dee5', padding: 32, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>
          {isKo ? 'NexyFab 플러그인' : 'NexyFab Plugins'}
        </h1>
        <p style={{ color: '#8a93a3', marginBottom: 24 }}>
          {isKo
            ? '커뮤니티 플러그인으로 NexyFab 을 확장하세요. 모든 플러그인은 권한 모델로 격리됩니다.'
            : 'Extend NexyFab with community plugins. All run inside a permission-gated sandbox.'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder={isKo ? '플러그인 검색…' : 'Search plugins…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200, height: 36, padding: '0 12px',
              borderRadius: 6, border: '1px solid #262d38',
              background: '#14181f', color: '#d8dee5', fontSize: 14,
            }}
          />
          {(['all', 'export', 'analysis', 'generative', 'cam', 'ui'] as const).map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filter === c ? '#4f8bff' : '#262d38'}`,
                background: filter === c ? 'rgba(79, 139, 255, 0.13)' : 'transparent',
                color: filter === c ? '#7aa9ff' : '#8a93a3',
              }}
            >
              {c === 'all' ? (isKo ? '전체' : 'All')
                : c === 'export' ? (isKo ? '내보내기' : 'Export')
                : c === 'analysis' ? (isKo ? '분석' : 'Analysis')
                : c === 'generative' ? (isKo ? '생성형' : 'Generative')
                : c === 'cam' ? 'CAM'
                : 'UI'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {visible.map(p => {
            const isInstalled = installed.has(p.id);
            return (
              <div key={p.id} style={{
                padding: 20, borderRadius: 10,
                border: `1px solid ${isInstalled ? '#4f8bff' : '#262d38'}`,
                background: '#14181f',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700, margin: 0 }}>{p.title}</h2>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: 'rgba(79, 139, 255, 0.13)', color: '#7aa9ff',
                    }}>v{p.version}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#8a93a3', marginTop: 2 }}>
                    {p.author} · ★ {p.rating.toFixed(1)} · {p.installs.toLocaleString()} {isKo ? '설치' : 'installs'}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#d8dee5', margin: 0, lineHeight: 1.6 }}>
                  {isKo ? p.description.ko : p.description.en}
                </p>
                <div style={{ fontSize: 10, color: '#5b6373', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {p.permissions.map(perm => (
                    <span key={perm} style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid #262d38' }}>
                      {perm}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => toggle(p.id)}
                  style={{
                    height: 36, padding: '0 16px', borderRadius: 6, border: 0,
                    background: isInstalled ? '#262d38' : '#4f8bff',
                    color: isInstalled ? '#d8dee5' : '#fff',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {isInstalled
                    ? (isKo ? '✓ 설치됨 · 제거' : '✓ Installed · Uninstall')
                    : (isKo ? '설치' : 'Install')}
                </button>
              </div>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#5b6373' }}>
            {isKo ? '검색 결과가 없습니다.' : 'No matching plugins.'}
          </div>
        )}
      </div>
    </div>
  );
}
