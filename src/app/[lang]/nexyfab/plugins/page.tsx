'use client';

// Plugin marketplace — public catalog of NexyFab plugins.
// v1 ships a curated list with install hooks that store the chosen plugin
// ids in localStorage; PluginHost in the modeler picks them up at boot.
//
// Future: replace MARKETPLACE_SEED with a fetch to /api/public/v1/plugins.

import { use, useEffect, useState } from 'react';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

interface PluginCard {
  id: string;
  title: string;
  author: string;
  version: string;
  description: Record<IsoLang, string>;
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
      ja: 'ISO 4762 SHCS、ISO 4017六角ボルト、ISO 7089ワッシャーなど200点以上の標準部品。',
      zh: '200多种 ISO 标准紧固件，包括内六角螺钉、六角螺栓、垫圈和螺母。',
      es: 'Más de 200 fijaciones ISO: tornillos Allen, pernos hexagonales, arandelas y tuercas.',
      ar: 'أكثر من 200 أداة تثبيت قياسية ISO تشمل البراغي السداسية والحلقات والصواميل.',
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
      ja: '平歯車、はすば歯車、かさ歯車を自動生成。AGMA/JIS規格に対応。',
      zh: '自动生成直齿轮、斜齿轮和锥齿轮，支持 AGMA/JIS 标准。',
      es: 'Genera automáticamente engranajes rectos, helicoidales y cónicos según AGMA/JIS.',
      ar: 'إنشاء تلقائي للتروس المستقيمة والحلزونية والمخروطية وفق AGMA وJIS.',
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
      ja: 'SIMPベースのトポロジー最適化。FEA結果から自動軽量化します。',
      zh: '基于 SIMP 的拓扑优化，读取 FEA 结果自动减重。',
      es: 'Optimización topológica SIMP que usa resultados FEA para aligerar automáticamente.',
      ar: 'تحسين طوبولوجي قائم على SIMP يستخدم نتائج FEA لتخفيف الوزن تلقائيًا.',
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
      ja: 'Fanuc 0i/30i/31i専用Gコードポスト。多軸・ヘリカル補間に対応。',
      zh: 'Fanuc 0i/30i/31i 专用 G 代码后处理，支持多轴和螺旋插补。',
      es: 'Posprocesador Fanuc 0i/30i/31i con interpolación multieje y helicoidal.',
      ar: 'معالج لاحق مخصص لـ Fanuc 0i/30i/31i يدعم المحاور المتعددة والاستيفاء الحلزوني.',
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
      ja: '高コントラストのダークテーマと等幅フォントのプリセット。',
      zh: '高对比度深色主题和等宽字体预设。',
      es: 'Tema oscuro de alto contraste con fuente monoespaciada.',
      ar: 'سمة داكنة عالية التباين مع خط أحادي المسافة.',
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
      ja: '大規模メッシュ向けクラウドFEA。非線形・動解析に対応。',
      zh: '面向大型网格的云端 FEA，支持非线性和动力分析。',
      es: 'FEA en la nube para mallas grandes, con análisis no lineal y dinámico.',
      ar: 'تحليل FEA سحابي للشبكات الكبيرة مع دعم التحليل غير الخطي والديناميكي.',
    },
    category: 'analysis',
    installs: 2_440,
    rating: 4.2,
    permissions: ['geometry:read'],
  },
];

const STORAGE_KEY = 'nexyfab.installed-plugins.v1';

const COPY: Record<IsoLang, {
  title: string; intro: string; search: string; installs: string; installed: string;
  install: string; empty: string; categories: Record<PluginCard['category'] | 'all', string>;
}> = {
  ko: { title: 'NexyFab 플러그인', intro: '커뮤니티 플러그인으로 NexyFab을 확장하세요. 모든 플러그인은 권한 모델로 격리됩니다.', search: '플러그인 검색…', installs: '설치', installed: '✓ 설치됨 · 제거', install: '설치', empty: '검색 결과가 없습니다.', categories: { all: '전체', export: '내보내기', analysis: '분석', generative: '생성형', cam: 'CAM', ui: 'UI' } },
  en: { title: 'NexyFab Plugins', intro: 'Extend NexyFab with community plugins. All run inside a permission-gated sandbox.', search: 'Search plugins…', installs: 'installs', installed: '✓ Installed · Uninstall', install: 'Install', empty: 'No matching plugins.', categories: { all: 'All', export: 'Export', analysis: 'Analysis', generative: 'Generative', cam: 'CAM', ui: 'UI' } },
  ja: { title: 'NexyFab プラグイン', intro: 'コミュニティプラグインでNexyFabを拡張できます。すべて権限管理されたサンドボックスで動作します。', search: 'プラグインを検索…', installs: 'インストール', installed: '✓ インストール済み・削除', install: 'インストール', empty: '一致するプラグインがありません。', categories: { all: 'すべて', export: 'エクスポート', analysis: '解析', generative: '生成', cam: 'CAM', ui: 'UI' } },
  zh: { title: 'NexyFab 插件', intro: '使用社区插件扩展 NexyFab。所有插件均在权限隔离沙箱中运行。', search: '搜索插件…', installs: '次安装', installed: '✓ 已安装·卸载', install: '安装', empty: '没有匹配的插件。', categories: { all: '全部', export: '导出', analysis: '分析', generative: '生成式', cam: 'CAM', ui: 'UI' } },
  es: { title: 'Plugins de NexyFab', intro: 'Amplía NexyFab con plugins de la comunidad. Todos se ejecutan en un entorno aislado por permisos.', search: 'Buscar plugins…', installs: 'instalaciones', installed: '✓ Instalado · Desinstalar', install: 'Instalar', empty: 'No hay plugins coincidentes.', categories: { all: 'Todos', export: 'Exportación', analysis: 'Análisis', generative: 'Generativo', cam: 'CAM', ui: 'UI' } },
  ar: { title: 'إضافات NexyFab', intro: 'وسّع NexyFab بإضافات المجتمع. تعمل جميعها داخل بيئة معزولة محكومة بالصلاحيات.', search: 'البحث عن إضافات…', installs: 'تثبيت', installed: '✓ مثبتة · إزالة', install: 'تثبيت', empty: 'لا توجد إضافات مطابقة.', categories: { all: 'الكل', export: 'تصدير', analysis: 'تحليل', generative: 'توليدي', cam: 'CAM', ui: 'UI' } },
};

export default function PluginsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const locale = toIsoLang(lang);
  const copy = COPY[locale];
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
          {copy.title}
        </h1>
        <p style={{ color: '#8a93a3', marginBottom: 24 }}>
          {copy.intro}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder={copy.search}
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
              {copy.categories[c]}
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
                    {p.author} · ★ {p.rating.toFixed(1)} · {p.installs.toLocaleString(locale)} {copy.installs}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#d8dee5', margin: 0, lineHeight: 1.6 }}>
                  {p.description[locale]}
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
                  {isInstalled ? copy.installed : copy.install}
                </button>
              </div>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#5b6373' }}>
            {copy.empty}
          </div>
        )}
      </div>
    </div>
  );
}
