'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COTS_PARTS, COTSPart } from '@/app/[lang]/shape-generator/cots/cotsData';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

// Handoff key — the COTS selection is stashed here so the RFQ page can pick it
// up and prefill the request (previously the "Send RFQ" link dropped the
// selection entirely). (2026-06-09 follow-up #1)
const COTS_RFQ_STASH_KEY = 'nexyfab_cots_rfq';

const CATEGORIES = ['All', 'bolt', 'nut', 'bearing', 'collar', 'clip', 'washer'] as const;
type Category = (typeof CATEGORIES)[number];

type Localized = Record<IsoLang, string>;
const CATEGORY_LABELS: Record<Category, Localized> = {
  All:     { ko: '전체', en: 'All', ja: 'すべて', zh: '全部', es: 'Todos', ar: 'الكل' },
  bolt:    { ko: '볼트', en: 'Bolt', ja: 'ボルト', zh: '螺栓', es: 'Perno', ar: 'مسمار' },
  nut:     { ko: '너트', en: 'Nut', ja: 'ナット', zh: '螺母', es: 'Tuerca', ar: 'صامولة' },
  bearing: { ko: '베어링', en: 'Bearing', ja: 'ベアリング', zh: '轴承', es: 'Rodamiento', ar: 'محمل' },
  collar:  { ko: '칼라', en: 'Collar', ja: 'カラー', zh: '轴环', es: 'Collarín', ar: 'طوق' },
  clip:    { ko: '클립', en: 'Clip', ja: 'クリップ', zh: '卡环', es: 'Clip', ar: 'مشبك' },
  washer:  { ko: '와셔', en: 'Washer', ja: 'ワッシャー', zh: '垫圈', es: 'Arandela', ar: 'حلقة' },
};

const COPY: Record<IsoLang, {
  title: string; subtitle: string; search: string; partCount: (n: number) => string;
  headers: string[]; noResults: string; added: string; add: string; selected: string;
  subtotal: string; send: string;
}> = {
  ko: { title: 'COTS 부품 카탈로그', subtitle: '규격 부품을 검색하고 견적에 추가하세요', search: '부품명, 규격, 공급사 검색...', partCount: (n) => `${n}개 부품`, headers: ['ID', '이름', '규격', '파라미터', '무게(g)', '단가(₩)', '공급사'], noResults: '검색 결과가 없습니다', added: '✓ 추가됨', add: '+ 견적 추가', selected: '선택된 부품', subtotal: '소계', send: '견적 요청하기 →' },
  en: { title: 'COTS Parts Catalog', subtitle: 'Search standard parts and add them to your RFQ', search: 'Search parts, standards, suppliers...', partCount: (n) => `${n} parts`, headers: ['ID', 'Name', 'Standard', 'Parameters', 'Weight(g)', 'Price(₩)', 'Suppliers'], noResults: 'No results found', added: '✓ Added', add: '+ Add to RFQ', selected: 'Selected Parts', subtotal: 'Subtotal', send: 'Send RFQ →' },
  ja: { title: 'COTS 部品カタログ', subtitle: '標準部品を検索して見積依頼に追加できます', search: '部品名、規格、サプライヤーを検索...', partCount: (n) => `${n} 部品`, headers: ['ID', '名前', '規格', 'パラメータ', '重量(g)', '価格(₩)', 'サプライヤー'], noResults: '検索結果がありません', added: '✓ 追加済み', add: '+ 見積に追加', selected: '選択した部品', subtotal: '小計', send: '見積を依頼 →' },
  zh: { title: 'COTS 零件目录', subtitle: '搜索标准件并添加到询价单', search: '搜索零件、标准、供应商...', partCount: (n) => `${n} 个零件`, headers: ['ID', '名称', '标准', '参数', '重量(g)', '价格(₩)', '供应商'], noResults: '没有搜索结果', added: '✓ 已添加', add: '+ 添加到询价', selected: '已选零件', subtotal: '小计', send: '发送询价 →' },
  es: { title: 'Catálogo de piezas COTS', subtitle: 'Busca piezas estándar y añádelas a tu solicitud', search: 'Buscar piezas, normas y proveedores...', partCount: (n) => `${n} piezas`, headers: ['ID', 'Nombre', 'Norma', 'Parámetros', 'Peso(g)', 'Precio(₩)', 'Proveedores'], noResults: 'No se encontraron resultados', added: '✓ Añadida', add: '+ Añadir a solicitud', selected: 'Piezas seleccionadas', subtotal: 'Subtotal', send: 'Enviar solicitud →' },
  ar: { title: 'دليل قطع COTS', subtitle: 'ابحث عن القطع القياسية وأضفها إلى طلب التسعير', search: 'البحث في القطع والمعايير والموردين...', partCount: (n) => `${n} قطعة`, headers: ['المعرّف', 'الاسم', 'المعيار', 'المعلمات', 'الوزن(g)', 'السعر(₩)', 'الموردون'], noResults: 'لا توجد نتائج', added: '✓ تمت الإضافة', add: '+ إضافة إلى الطلب', selected: 'القطع المحددة', subtotal: 'المجموع الفرعي', send: 'إرسال طلب التسعير ←' },
};

export default function CotsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const locale = toIsoLang(lang);
  const L = createCommercialLocalizer(lang);
  const copy = COPY[locale];
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [selected, setSelected] = useState<COTSPart[]>([]);

  const filtered = COTS_PARTS.filter(p => {
    const matchCat = category === 'All' || p.category === category;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.nameKo.includes(q) ||
      L(p.nameKo, p.name).toLowerCase().includes(q) ||
      p.standard.toLowerCase().includes(q) ||
      p.suppliers.some(s => s.toLowerCase().includes(q));
    return matchCat && matchSearch;
  });

  const addToQuote = (part: COTSPart) => {
    setSelected(prev =>
      prev.find(p => p.id === part.id) ? prev : [...prev, part]
    );
  };

  const removeFromQuote = (id: string) => {
    setSelected(prev => prev.filter(p => p.id !== id));
  };

  const formatParams = (keyValues: Record<string, number>) =>
    Object.entries(keyValues)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--nx-bg)',
      color: 'var(--nx-text)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--nx-panel-2)',
        padding: '20px 28px',
        position: 'sticky',
        top: 0,
        background: 'var(--nx-bg)',
        zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          🔩 {copy.title}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--nx-text-3)' }}>
          {copy.subtitle}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 81px)' }}>
        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {/* Search + filter bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={copy.search}
              style={{
                flex: 1,
                minWidth: 220,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--nx-panel)',
                border: '1px solid var(--nx-border)',
                color: 'var(--nx-text)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${category === cat ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
                    background: category === cat ? '#388bfd1a' : 'transparent',
                    color: category === cat ? 'var(--nx-accent)' : 'var(--nx-text-2)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {CATEGORY_LABELS[cat][locale]}
                </button>
              ))}
            </div>
          </div>

          {/* Count */}
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--nx-text-3)' }}>
            {copy.partCount(filtered.length)}
          </p>

          {/* Table */}
          <div style={{
            background: 'var(--nx-panel)',
            border: '1px solid var(--nx-border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--nx-border)', background: 'var(--nx-bg)' }}>
                  {[...copy.headers, ''].map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        color: 'var(--nx-text-2)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--nx-text-3)' }}>
                      {copy.noResults}
                    </td>
                  </tr>
                ) : (
                  filtered.map((part, idx) => {
                    const inQuote = selected.some(p => p.id === part.id);
                    return (
                      <tr
                        key={part.id}
                        style={{
                          borderBottom: idx < filtered.length - 1 ? '1px solid var(--nx-panel-2)' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                          {part.id}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text)', fontWeight: 600 }}>
                          {L(part.nameKo, part.name)}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>
                          {part.standard}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', fontFamily: 'monospace', fontSize: 11 }}>
                          {formatParams(part.params)}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)', textAlign: 'right' }}>
                          {part.unitWeightG}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-ok)', fontWeight: 600, textAlign: 'right' }}>
                          {part.unitPriceKRW.toLocaleString()}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--nx-text-2)' }}>
                          {part.suppliers.join(', ')}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <button
                            onClick={() => inQuote ? removeFromQuote(part.id) : addToQuote(part)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: `1px solid ${inQuote ? 'var(--nx-ok)' : 'var(--nx-accent)'}`,
                              background: inQuote ? '#3fb9501a' : '#388bfd1a',
                              color: inQuote ? 'var(--nx-ok)' : 'var(--nx-accent)',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              transition: 'all 0.12s',
                            }}
                          >
                            {inQuote
                              ? copy.added
                              : copy.add}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RFQ sidebar */}
        {selected.length > 0 && (
          <div style={{
            width: 260,
            minWidth: 260,
            borderLeft: '1px solid var(--nx-border)',
            background: 'var(--nx-panel)',
            overflowY: 'auto',
            padding: '20px 16px',
            flexShrink: 0,
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>
              💬 {copy.selected} ({selected.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {selected.map(part => (
                <div key={part.id} style={{
                  background: 'var(--nx-bg)',
                  border: '1px solid var(--nx-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  position: 'relative',
                }}>
                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', paddingRight: 20 }}>
                    {L(part.nameKo, part.name)}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--nx-ok)' }}>
                    ₩{part.unitPriceKRW.toLocaleString()}
                  </p>
                  <button
                    onClick={() => removeFromQuote(part.id)}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'none',
                      border: 'none',
                      color: 'var(--nx-text-3)',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{
              borderTop: '1px solid var(--nx-border)',
              paddingTop: 12,
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--nx-text-2)' }}>{copy.subtotal}</span>
                <span style={{ fontWeight: 700, color: 'var(--nx-text)' }}>
                  ₩{selected.reduce((s, p) => s + p.unitPriceKRW, 0).toLocaleString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  const payload = selected.map(p => ({
                    id: p.id, name: p.name, nameKo: p.nameKo,
                    standard: p.standard, qty: 1, unitPriceKRW: p.unitPriceKRW,
                  }));
                  sessionStorage.setItem(COTS_RFQ_STASH_KEY, JSON.stringify(payload));
                } catch { /* ignore */ }
                router.push(`/${lang}/nexyfab/rfq?from=cots`);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                padding: '10px 0',
                border: 'none',
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--nx-accent), #8b5cf6)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {copy.send}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
