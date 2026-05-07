'use client';

/**
 * CertFilterPanel.tsx — AI Cert/Reg Filter (Phase 7-2).
 *
 * Lets the user pick an industry (medical / aerospace / automotive / food /
 * general) + region, asks the LLM for required + recommended certifications,
 * and (when a supplier list is passed) shows per-supplier cert scores so the
 * user can spot who's missing what.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { filterCerts, type CertFilterResult } from './certFilter';

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#a371f7',
  text: '#c9d1d9',
  dim: '#8b949e',
};

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, {
  title: string;
  subtitle: string;
  industryLabel: string;
  regionLabel: string;
  analyzing: string;
  reanalyze: string;
  required: string;
  recommended: string;
  supplierScores: string;
  filterByCerts: string;
  proRequired: string;
  industries: Record<string, string>;
}> = {
  ko: {
    title: '인증·규제 필터',
    subtitle: '산업별 필수 인증 자동 매핑',
    industryLabel: '산업',
    regionLabel: '지역',
    analyzing: '분석 중…',
    reanalyze: '재분석',
    required: '필수 인증',
    recommended: '권장 인증',
    supplierScores: '공급사 인증 점수',
    filterByCerts: '이 인증으로 공급사 필터',
    proRequired: 'Pro 플랜이 필요합니다',
    industries: { medical: '의료기기', aerospace: '항공우주', automotive: '자동차', food: '식품', general: '일반' },
  },
  en: {
    title: 'Cert & Regulation Filter',
    subtitle: 'Auto-map required certs by industry',
    industryLabel: 'Industry',
    regionLabel: 'Region',
    analyzing: 'Analyzing…',
    reanalyze: 'Re-analyze',
    required: 'Required',
    recommended: 'Recommended',
    supplierScores: 'Supplier cert scores',
    filterByCerts: 'Filter suppliers by these certs',
    proRequired: 'Pro plan required',
    industries: { medical: 'Medical', aerospace: 'Aerospace', automotive: 'Automotive', food: 'Food', general: 'General' },
  },
  ja: {
    title: '認証・規制フィルター',
    subtitle: '業界別の必須認証を自動マッピング',
    industryLabel: '業界',
    regionLabel: '地域',
    analyzing: '分析中…',
    reanalyze: '再分析',
    required: '必須認証',
    recommended: '推奨認証',
    supplierScores: 'サプライヤー認証スコア',
    filterByCerts: 'この認証でサプライヤーを絞り込む',
    proRequired: 'Proプランが必要です',
    industries: { medical: '医療機器', aerospace: '航空宇宙', automotive: '自動車', food: '食品', general: '一般' },
  },
  zh: {
    title: '认证与法规筛选',
    subtitle: '按行业自动映射必需认证',
    industryLabel: '行业',
    regionLabel: '地区',
    analyzing: '分析中…',
    reanalyze: '重新分析',
    required: '必需认证',
    recommended: '推荐认证',
    supplierScores: '供应商认证评分',
    filterByCerts: '按这些认证筛选供应商',
    proRequired: '需要Pro套餐',
    industries: { medical: '医疗器械', aerospace: '航空航天', automotive: '汽车', food: '食品', general: '通用' },
  },
  es: {
    title: 'Filtro de certificaciones y regulaciones',
    subtitle: 'Mapeo automático de certificaciones por industria',
    industryLabel: 'Industria',
    regionLabel: 'Región',
    analyzing: 'Analizando…',
    reanalyze: 'Reanalizar',
    required: 'Obligatorias',
    recommended: 'Recomendadas',
    supplierScores: 'Puntuación de certificaciones de proveedores',
    filterByCerts: 'Filtrar proveedores por estas certificaciones',
    proRequired: 'Se requiere plan Pro',
    industries: { medical: 'Médica', aerospace: 'Aeroespacial', automotive: 'Automotriz', food: 'Alimentos', general: 'General' },
  },
  ar: {
    title: 'فلتر الشهادات واللوائح',
    subtitle: 'تعيين تلقائي للشهادات المطلوبة حسب الصناعة',
    industryLabel: 'الصناعة',
    regionLabel: 'المنطقة',
    analyzing: 'جارٍ التحليل…',
    reanalyze: 'إعادة التحليل',
    required: 'مطلوبة',
    recommended: 'موصى بها',
    supplierScores: 'درجات شهادات الموردين',
    filterByCerts: 'تصفية الموردين بهذه الشهادات',
    proRequired: 'يتطلب خطة Pro',
    industries: { medical: 'طبي', aerospace: 'طيران وفضاء', automotive: 'سيارات', food: 'أغذية', general: 'عام' },
  },
};

const INDUSTRIES: Array<{ value: string; icon: string }> = [
  { value: 'medical',    icon: '🏥' },
  { value: 'aerospace',  icon: '✈️' },
  { value: 'automotive', icon: '🚗' },
  { value: 'food',       icon: '🍱' },
  { value: 'general',    icon: '🏭' },
];

interface CertFilterPanelProps {
  lang: string;
  initialIndustry?: string;
  material?: string;
  process?: string;
  /** Supplier list to score against (optional). */
  suppliers?: Array<{ id?: string; name?: string; nameKo?: string; certifications?: string[] }>;
  projectId?: string;
  onClose: () => void;
  onRequirePro?: () => void;
  /** Called with the *required* cert codes — caller can filter the supplier panel. */
  onApplyFilter?: (requiredCodes: string[]) => void;
}

export default function CertFilterPanel({
  lang, initialIndustry, material, process, suppliers, projectId,
  onClose, onRequirePro, onApplyFilter,
}: CertFilterPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const isKo = lang === 'ko';
  const [industry, setIndustry] = useState<string>(initialIndustry ?? 'general');
  const [region, setRegion] = useState<'KR' | 'US' | 'EU' | 'global'>('global');
  const [result, setResult] = useState<CertFilterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await filterCerts({
        industry, region, material, process,
        suppliers: suppliers?.map(s => ({ id: s.id, certifications: s.certifications })),
        lang, projectId,
      });
      setResult(r);
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        onRequirePro?.();
        setError(tt.proRequired);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [industry, region, material, process, suppliers, lang, projectId, onRequirePro, tt]);

  useEffect(() => {
    if (!result && !loading && !error) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const supplierLookup = new Map<string, { name?: string; nameKo?: string }>();
  (suppliers ?? []).forEach(s => { if (s.id) supplierLookup.set(s.id, { name: s.name, nameKo: s.nameKo }); });

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 950,
      width: 460, maxHeight: 'calc(100vh - 80px)',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.purple}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🛡️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {tt.title}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {tt.subtitle}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4, textTransform: 'uppercase' }}>
            {tt.industryLabel}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {INDUSTRIES.map(opt => (
              <button key={opt.value} onClick={() => setIndustry(opt.value)} style={{
                flex: '1 0 28%', padding: '6px 0', borderRadius: 6,
                border: `1px solid ${industry === opt.value ? C.purple : C.border}`,
                background: industry === opt.value ? `${C.purple}22` : 'transparent',
                color: industry === opt.value ? C.purple : C.dim,
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}>
                {opt.icon} {tt.industries[opt.value]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4, textTransform: 'uppercase' }}>
            {tt.regionLabel}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['global', 'KR', 'US', 'EU'] as const).map(r => (
              <button key={r} onClick={() => setRegion(r)} style={{
                flex: 1, padding: '6px 0', borderRadius: 6,
                border: `1px solid ${region === r ? C.accent : C.border}`,
                background: region === r ? `${C.accent}22` : 'transparent',
                color: region === r ? C.accent : C.dim,
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}>{r}</button>
            ))}
          </div>
        </div>
        <button onClick={run} disabled={loading} style={{
          padding: '7px 0', borderRadius: 6, border: 'none',
          background: loading ? C.border : `linear-gradient(135deg, ${C.purple}, ${C.accent})`,
          color: '#fff', fontSize: 11, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
        }}>
          {loading ? tt.analyzing : `🛡 ${tt.reanalyze}`}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 11, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: 10, borderRadius: 6, background: `${C.accent}0d`,
              border: `1px solid ${C.accent}33`, fontSize: 11, color: C.text, lineHeight: 1.5,
            }}>
              {isKo ? result.summaryKo : result.summary}
            </div>

            {result.required.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.red, marginBottom: 6, textTransform: 'uppercase' }}>
                  ⚠ {tt.required}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.required.map(c => (
                    <div key={c.code} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: `${C.red}0d`, border: `1px solid ${C.red}33`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginBottom: 2 }}>
                        {isKo ? c.nameKo : c.name}{c.region ? ` · ${c.region}` : ''}
                      </div>
                      <div style={{ fontSize: 10, color: C.text, lineHeight: 1.4 }}>
                        {isKo ? c.reasonKo : c.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.recommended.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.yellow, marginBottom: 6, textTransform: 'uppercase' }}>
                  💡 {tt.recommended}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.recommended.map(c => (
                    <div key={c.code} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: `${C.yellow}0d`, border: `1px solid ${C.yellow}33`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.yellow, marginBottom: 2 }}>
                        {isKo ? c.nameKo : c.name}{c.region ? ` · ${c.region}` : ''}
                      </div>
                      <div style={{ fontSize: 10, color: C.text, lineHeight: 1.4 }}>
                        {isKo ? c.reasonKo : c.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.supplierScores && result.supplierScores.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.green, marginBottom: 6, textTransform: 'uppercase' }}>
                  ✓ {tt.supplierScores}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.supplierScores
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((s, i) => {
                      const lookup = s.id ? supplierLookup.get(s.id) : undefined;
                      const name = lookup ? (isKo ? lookup.nameKo ?? lookup.name : lookup.name ?? lookup.nameKo) : (s.id ?? `#${i + 1}`);
                      const color = s.score >= 80 ? C.green : s.score >= 50 ? C.yellow : C.red;
                      return (
                        <div key={s.id ?? i} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 8px', borderRadius: 4, background: C.card,
                        }}>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </div>
                          {s.missing.length > 0 && (
                            <div style={{ fontSize: 9, color: C.red }}>
                              -{s.missing.length}
                            </div>
                          )}
                          <div style={{ fontSize: 11, fontWeight: 800, color, minWidth: 36, textAlign: 'right' }}>
                            {s.score}%
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {result && onApplyFilter && result.required.length > 0 && (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => onApplyFilter(result.required.map(r => r.code))} style={{
            width: '100%', padding: '8px 0', borderRadius: 6, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.accent})`,
            color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
          }}>
            🔍 {tt.filterByCerts}
          </button>
        </div>
      )}
    </div>
  );
}
