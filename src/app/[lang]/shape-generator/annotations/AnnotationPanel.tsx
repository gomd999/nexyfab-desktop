'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type {
  GDTAnnotation, DimensionAnnotation, GDTSymbol,
  FeatureControlFrame, ZoneModifier, MaterialCondition,
} from './GDTTypes';
import { GDT_SYMBOLS, GDT_SYMBOL_NAMES, GDT_CATEGORIES, formatFCF } from './GDTTypes';
import ToleranceStackPanel from './ToleranceStackPanel';

/* ─── i18n dict ────────────────────────────────────────────────────────────── */

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    title: 'GD&T 주석',
    placeGdt: '메쉬 표면을 클릭하여 GD&T를 배치하세요',
    placeDim: '메쉬 표면을 클릭하여 치수를 배치하세요',
    cancel: '취소',
    addGdt: '기하 공차 추가',
    tolerance: '공차 (mm)',
    datum: '데이텀',
    fcfAdvanced: 'FCF 고급 (Ⓜ/Ⓛ · 2/3차 데이텀)',
    zone: '존 형태',
    tolModifier: '공차 수정자',
    addGdtBtn: 'GD&T 추가',
    addDimension: '치수 공차 추가',
    value: '치수 값',
    dimLinear: '선형',
    dimAngular: '각도',
    dimRadial: '반경',
    dimDiameter: '지름',
    tolLimit: '한계',
    bilateralTol: '양방향 공차',
    upper: '상한',
    lower: '하한',
    addDimBtn: '치수 공차 추가',
    annotations: '주석 목록',
    delete: '삭제',
    toleranceStack: '공차 스택 분석',
    form: '형상',
    orientation: '자세',
    location: '위치',
    runout: '흔들림',
    profile: '윤곽',
  },
  en: {
    title: 'GD&T Annotations',
    placeGdt: 'Click on mesh surface to place GD&T',
    placeDim: 'Click on mesh surface to place dimension',
    cancel: 'Cancel',
    addGdt: 'Add GD&T',
    tolerance: 'Tolerance (mm)',
    datum: 'Datum',
    fcfAdvanced: 'FCF Advanced (MMC/LMC · 2°/3° datum)',
    zone: 'Zone',
    tolModifier: 'Tol modifier',
    addGdtBtn: 'Add GD&T',
    addDimension: 'Add Dimension',
    value: 'Value',
    dimLinear: 'Linear',
    dimAngular: 'Angular',
    dimRadial: 'Radial',
    dimDiameter: 'Dia.',
    tolLimit: 'Limit',
    bilateralTol: 'Bilateral Tol.',
    upper: 'Upper',
    lower: 'Lower',
    addDimBtn: 'Add Dimension',
    annotations: 'Annotations',
    delete: 'Delete',
    toleranceStack: 'Tolerance Stack',
    form: 'Form',
    orientation: 'Orientation',
    location: 'Location',
    runout: 'Runout',
    profile: 'Profile',
  },
  ja: {
    title: 'GD&T 注釈',
    placeGdt: 'メッシュ表面をクリックして GD&T を配置',
    placeDim: 'メッシュ表面をクリックして寸法を配置',
    cancel: 'キャンセル',
    addGdt: '幾何公差を追加',
    tolerance: '公差 (mm)',
    datum: 'データム',
    fcfAdvanced: 'FCF 詳細 (Ⓜ/Ⓛ · 2次/3次データム)',
    zone: 'ゾーン',
    tolModifier: '公差修飾子',
    addGdtBtn: 'GD&T 追加',
    addDimension: '寸法公差を追加',
    value: '寸法値',
    dimLinear: '直線',
    dimAngular: '角度',
    dimRadial: '半径',
    dimDiameter: '直径',
    tolLimit: '限界',
    bilateralTol: '両側公差',
    upper: '上限',
    lower: '下限',
    addDimBtn: '寸法公差を追加',
    annotations: '注釈一覧',
    delete: '削除',
    toleranceStack: '公差スタック解析',
    form: '形状',
    orientation: '姿勢',
    location: '位置',
    runout: '振れ',
    profile: '輪郭',
  },
  zh: {
    title: 'GD&T 注释',
    placeGdt: '点击网格表面放置 GD&T',
    placeDim: '点击网格表面放置尺寸',
    cancel: '取消',
    addGdt: '添加几何公差',
    tolerance: '公差 (mm)',
    datum: '基准',
    fcfAdvanced: 'FCF 高级 (Ⓜ/Ⓛ · 第2/3基准)',
    zone: '公差区',
    tolModifier: '公差修饰符',
    addGdtBtn: '添加 GD&T',
    addDimension: '添加尺寸公差',
    value: '尺寸值',
    dimLinear: '线性',
    dimAngular: '角度',
    dimRadial: '半径',
    dimDiameter: '直径',
    tolLimit: '极限',
    bilateralTol: '双向公差',
    upper: '上限',
    lower: '下限',
    addDimBtn: '添加尺寸公差',
    annotations: '注释列表',
    delete: '删除',
    toleranceStack: '公差堆叠分析',
    form: '形状',
    orientation: '方向',
    location: '位置',
    runout: '跳动',
    profile: '轮廓',
  },
  es: {
    title: 'Anotaciones GD&T',
    placeGdt: 'Haga clic en la superficie de la malla para colocar GD&T',
    placeDim: 'Haga clic en la superficie de la malla para colocar la cota',
    cancel: 'Cancelar',
    addGdt: 'Añadir tolerancia geométrica',
    tolerance: 'Tolerancia (mm)',
    datum: 'Referencia',
    fcfAdvanced: 'FCF Avanzado (Ⓜ/Ⓛ · ref. 2ª/3ª)',
    zone: 'Zona',
    tolModifier: 'Modificador',
    addGdtBtn: 'Añadir GD&T',
    addDimension: 'Añadir cota',
    value: 'Valor',
    dimLinear: 'Lineal',
    dimAngular: 'Angular',
    dimRadial: 'Radial',
    dimDiameter: 'Diám.',
    tolLimit: 'Límite',
    bilateralTol: 'Tol. bilateral',
    upper: 'Superior',
    lower: 'Inferior',
    addDimBtn: 'Añadir cota',
    annotations: 'Anotaciones',
    delete: 'Eliminar',
    toleranceStack: 'Análisis de tolerancias',
    form: 'Forma',
    orientation: 'Orientación',
    location: 'Ubicación',
    runout: 'Alabeo',
    profile: 'Perfil',
  },
  ar: {
    title: 'تعليقات GD&T',
    placeGdt: 'انقر على سطح الشبكة لوضع GD&T',
    placeDim: 'انقر على سطح الشبكة لوضع البُعد',
    cancel: 'إلغاء',
    addGdt: 'إضافة تفاوت هندسي',
    tolerance: 'التفاوت (mm)',
    datum: 'المرجع',
    fcfAdvanced: 'FCF متقدم (Ⓜ/Ⓛ · مرجع ٢/٣)',
    zone: 'المنطقة',
    tolModifier: 'معدل التفاوت',
    addGdtBtn: 'إضافة GD&T',
    addDimension: 'إضافة بُعد',
    value: 'القيمة',
    dimLinear: 'خطي',
    dimAngular: 'زاوي',
    dimRadial: 'نصف قطر',
    dimDiameter: 'قطر',
    tolLimit: 'حد',
    bilateralTol: 'تفاوت ثنائي',
    upper: 'أعلى',
    lower: 'أدنى',
    addDimBtn: 'إضافة بُعد',
    annotations: 'التعليقات',
    delete: 'حذف',
    toleranceStack: 'تحليل تراكم التفاوت',
    form: 'شكل',
    orientation: 'اتجاه',
    location: 'موقع',
    runout: 'انحراف',
    profile: 'محيط',
  },
} as const;

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// Localized GD&T symbol names: fallback to English for ja/zh/es/ar unless KO mapping exists
const GDT_SYMBOL_NAMES_LOCALIZED: Record<Lang, Record<string, string>> = {
  ko: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).ko])),
  en: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).en])),
  ja: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).en])),
  zh: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).en])),
  es: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).en])),
  ar: Object.fromEntries(Object.entries(GDT_SYMBOL_NAMES).map(([k, v]) => [k, (v as { ko: string; en: string }).en])),
};

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#1c2128',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  dim: '#8b949e',
  hover: '#30363d',
  danger: '#f85149',
  success: '#3fb950',
};

const panelStyle: React.CSSProperties = {
  width: 280,
  background: C.bg,
  borderLeft: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: `1px solid ${C.border}`,
  background: '#1b1f27',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 10px',
};

const sectionTitle: React.CSSProperties = {
  color: C.dim,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
  marginTop: 10,
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 5,
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  transition: 'all 0.15s',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: '#0d1117',
  color: C.text,
  fontSize: 11,
  fontFamily: 'monospace',
  outline: 'none',
};

const listItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderRadius: 4,
  background: C.card,
  marginBottom: 4,
  fontSize: 11,
  color: C.text,
  fontFamily: 'monospace',
};

/* ─── Types ───────────────────────────────────────────────────────────────── */

type PlacementMode = 'none' | 'gdt' | 'dimension';

type ToleranceType = 'bilateral' | 'unilateral' | 'limit';

interface AnnotationPanelProps {
  gdtAnnotations: GDTAnnotation[];
  dimensionAnnotations: DimensionAnnotation[];
  onAddGDT: (annotation: GDTAnnotation) => void;
  onUpdateGDT: (id: string, updates: Partial<GDTAnnotation>) => void;
  onRemoveGDT: (id: string) => void;
  onAddDimension: (annotation: DimensionAnnotation) => void;
  onUpdateDimension: (id: string, updates: Partial<DimensionAnnotation>) => void;
  onRemoveDimension: (id: string) => void;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  onClose: () => void;
  isKo: boolean;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function AnnotationPanel({
  gdtAnnotations,
  dimensionAnnotations,
  onAddGDT,
  onUpdateGDT,
  onRemoveGDT,
  onAddDimension,
  onUpdateDimension,
  onRemoveDimension,
  placementMode,
  onPlacementModeChange,
  onClose,
  isKo,
}: AnnotationPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const lang: Lang = langMap[seg] ?? 'en';

  const [selectedSymbol, setSelectedSymbol] = useState<GDTSymbol>('position');
  const [tolValue, setTolValue] = useState('0.05');
  const [datumLetter, setDatumLetter] = useState('A');
  const [showGDTDropdown, setShowGDTDropdown] = useState(false);
  const [dimType, setDimType] = useState<'linear' | 'angular' | 'radial' | 'diameter'>('linear');
  const [dimValue, setDimValue] = useState('50.00');
  const [tolType, setTolType] = useState<ToleranceType>('bilateral');
  const [tolUpper, setTolUpper] = useState('0.05');
  const [tolLower, setTolLower] = useState('-0.05');
  const [editingId, setEditingId] = useState<string | null>(null);
  // FCF advanced mode — zone modifier + material conditions + up to 3 datum refs
  const [fcfAdvanced, setFcfAdvanced] = useState(false);
  const [zoneMod, setZoneMod] = useState<ZoneModifier | ''>('');
  const [materialCond, setMaterialCond] = useState<MaterialCondition>('RFS');
  const [datumB, setDatumB] = useState('');
  const [datumC, setDatumC] = useState('');
  const [datumAMod, setDatumAMod] = useState<MaterialCondition>('RFS');
  const [datumBMod, setDatumBMod] = useState<MaterialCondition>('RFS');
  const [datumCMod, setDatumCMod] = useState<MaterialCondition>('RFS');

  // ── Add GD&T ──
  const handleAddGDT = useCallback(() => {
    const tol = parseFloat(tolValue);
    if (isNaN(tol) || tol <= 0) return;
    let fcf: FeatureControlFrame | undefined;
    if (fcfAdvanced) {
      fcf = {
        symbol: selectedSymbol,
        toleranceValue: tol,
        zoneModifier: zoneMod || undefined,
        materialCondition: materialCond === 'RFS' ? undefined : materialCond,
        primary: datumLetter ? { letter: datumLetter, modifier: datumAMod === 'RFS' ? undefined : datumAMod } : undefined,
        secondary: datumB ? { letter: datumB, modifier: datumBMod === 'RFS' ? undefined : datumBMod } : undefined,
        tertiary: datumC ? { letter: datumC, modifier: datumCMod === 'RFS' ? undefined : datumCMod } : undefined,
      };
    }
    const annotation: GDTAnnotation = {
      id: `gdt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol: selectedSymbol,
      tolerance: tol,
      datum: datumLetter || undefined,
      position: [0, 0, 0], // Will be updated on mesh click
      fcf,
      label: fcf ? formatFCF(fcf) : undefined,
    };
    onAddGDT(annotation);
    onPlacementModeChange('gdt');
  }, [selectedSymbol, tolValue, datumLetter, fcfAdvanced, zoneMod, materialCond, datumB, datumC, datumAMod, datumBMod, datumCMod, onAddGDT, onPlacementModeChange]);

  // ── Add Dimension ──
  const handleAddDimension = useCallback(() => {
    const val = parseFloat(dimValue);
    if (isNaN(val) || val <= 0) return;
    const upper = parseFloat(tolUpper);
    const lower = parseFloat(tolLower);
    const hasTol = !isNaN(upper) && !isNaN(lower) && (upper !== 0 || lower !== 0);
    const annotation: DimensionAnnotation = {
      id: `dim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: dimType,
      value: val,
      tolerance: hasTol ? { upper, lower } : undefined,
      position: [0, 0, 0], // Will be updated on mesh click
      direction: [1, 0, 0],
    };
    onAddDimension(annotation);
    onPlacementModeChange('dimension');
  }, [dimType, dimValue, tolType, tolUpper, tolLower, onAddDimension, onPlacementModeChange]);

  // ── Set bilateral tolerance shortcut ──
  const handleBilateralChange = useCallback((val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setTolUpper(Math.abs(n).toFixed(2));
      setTolLower((-Math.abs(n)).toFixed(2));
    }
  }, []);

  const DATUM_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const categoryLabelKey: Record<string, keyof typeof dict['en']> = {
    form: 'form',
    orientation: 'orientation',
    location: 'location',
    runout: 'runout',
    profile: 'profile',
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>
          {t.title}
        </span>
        <button
          onClick={onClose}
          style={{ ...btnBase, background: 'transparent', color: C.dim, fontSize: 16, padding: '0 4px', lineHeight: 1 }}
        >
          &times;
        </button>
      </div>

      <div style={scrollStyle}>
        {/* Placement mode indicator */}
        {placementMode !== 'none' && (
          <div style={{
            padding: '6px 10px', borderRadius: 5, marginBottom: 8,
            background: 'rgba(56,139,253,0.15)', border: '1px solid rgba(56,139,253,0.3)',
            color: C.accent, fontSize: 11, fontWeight: 600, textAlign: 'center',
          }}>
            {placementMode === 'gdt' ? t.placeGdt : t.placeDim}
            <button
              onClick={() => onPlacementModeChange('none')}
              style={{ ...btnBase, background: 'rgba(248,81,73,0.2)', color: C.danger, marginLeft: 8, padding: '2px 8px' }}
            >
              {t.cancel}
            </button>
          </div>
        )}

        {/* ── Add GD&T Section ── */}
        <div style={sectionTitle}>{t.addGdt}</div>

        {/* Symbol selector */}
        <div style={{ position: 'relative', marginBottom: 6 }}>
          <button
            onClick={() => setShowGDTDropdown(v => !v)}
            style={{
              ...btnBase, width: '100%', textAlign: 'left',
              background: C.card, color: C.text, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>{GDT_SYMBOLS[selectedSymbol]}</span>
            <span>{GDT_SYMBOL_NAMES_LOCALIZED[lang][selectedSymbol]}</span>
            <span style={{ marginLeft: 'auto', color: C.dim }}>&#x25BE;</span>
          </button>
          {showGDTDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#21262d', border: `1px solid ${C.border}`, borderRadius: 5,
              maxHeight: 280, overflowY: 'auto', padding: 4,
            }}>
              {Object.entries(GDT_CATEGORIES).map(([cat, symbols]) => (
                <div key={cat}>
                  <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, padding: '4px 8px', textTransform: 'uppercase' }}>
                    {t[categoryLabelKey[cat]]}
                  </div>
                  {symbols.map(sym => (
                    <button
                      key={sym}
                      onClick={() => { setSelectedSymbol(sym); setShowGDTDropdown(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '4px 8px', border: 'none', borderRadius: 3, cursor: 'pointer',
                        background: sym === selectedSymbol ? 'rgba(56,139,253,0.2)' : 'transparent',
                        color: C.text, fontSize: 11, textAlign: 'left',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.hover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = sym === selectedSymbol ? 'rgba(56,139,253,0.2)' : 'transparent'; }}
                    >
                      <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{GDT_SYMBOLS[sym]}</span>
                      <span>{GDT_SYMBOL_NAMES_LOCALIZED[lang][sym]}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tolerance input */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t.tolerance}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tolValue}
              onChange={e => setTolValue(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ width: 70 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t.datum}</label>
            <select
              value={datumLetter}
              onChange={e => setDatumLetter(e.target.value)}
              style={{ ...inputStyle, padding: '5px 4px' }}
            >
              <option value="">-</option>
              {DATUM_LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* FCF advanced — zone modifier + MMC/LMC + secondary/tertiary datums */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ color: C.dim, fontSize: 10, display: 'flex', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={fcfAdvanced} onChange={(e) => setFcfAdvanced(e.target.checked)} />
            {t.fcfAdvanced}
          </label>
        </div>

        {fcfAdvanced && (
          <div style={{ padding: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, marginBottom: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div>
                <label style={{ color: C.dim, fontSize: 10 }}>{t.zone}</label>
                <select value={zoneMod} onChange={(e) => setZoneMod(e.target.value as ZoneModifier | '')} style={{ ...inputStyle, padding: '4px' }}>
                  <option value="">—</option>
                  <option value="diameter">Ø</option>
                  <option value="spherical">SØ</option>
                  <option value="projected">Ⓟ proj.</option>
                  <option value="free">Ⓕ free</option>
                </select>
              </div>
              <div>
                <label style={{ color: C.dim, fontSize: 10 }}>{t.tolModifier}</label>
                <select value={materialCond} onChange={(e) => setMaterialCond(e.target.value as MaterialCondition)} style={{ ...inputStyle, padding: '4px' }}>
                  <option value="RFS">RFS</option>
                  <option value="MMC">Ⓜ MMC</option>
                  <option value="LMC">Ⓛ LMC</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {([['A', datumLetter, (v: string) => setDatumLetter(v), datumAMod, setDatumAMod],
                 ['B', datumB, setDatumB, datumBMod, setDatumBMod],
                 ['C', datumC, setDatumC, datumCMod, setDatumCMod]] as const).map(([name, val, setVal, mod, setMod]) => (
                <div key={name}>
                  <label style={{ color: C.dim, fontSize: 10 }}>{t.datum} {name}</label>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <select value={val} onChange={(e) => setVal(e.target.value)} style={{ ...inputStyle, padding: '4px', flex: 1 }}>
                      <option value="">-</option>
                      {DATUM_LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <select value={mod} onChange={(e) => setMod(e.target.value as MaterialCondition)} style={{ ...inputStyle, padding: '4px', width: 56 }}>
                      <option value="RFS">—</option>
                      <option value="MMC">Ⓜ</option>
                      <option value="LMC">Ⓛ</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            {/* Live FCF preview */}
            <div style={{ marginTop: 8, padding: '4px 6px', background: '#0d1117', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, color: C.accent }}>
              {formatFCF({
                symbol: selectedSymbol,
                toleranceValue: parseFloat(tolValue) || 0,
                zoneModifier: zoneMod || undefined,
                materialCondition: materialCond === 'RFS' ? undefined : materialCond,
                primary: datumLetter ? { letter: datumLetter, modifier: datumAMod === 'RFS' ? undefined : datumAMod } : undefined,
                secondary: datumB ? { letter: datumB, modifier: datumBMod === 'RFS' ? undefined : datumBMod } : undefined,
                tertiary: datumC ? { letter: datumC, modifier: datumCMod === 'RFS' ? undefined : datumCMod } : undefined,
              })}
            </div>
          </div>
        )}

        <button
          onClick={handleAddGDT}
          style={{
            ...btnBase, width: '100%', marginBottom: 10,
            background: C.accent, color: '#fff',
          }}
        >
          {t.addGdtBtn}
        </button>

        {/* ── Add Dimension Section ── */}
        <div style={sectionTitle}>{t.addDimension}</div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['linear', 'angular', 'radial', 'diameter'] as const).map(dt => (
            <button
              key={dt}
              onClick={() => setDimType(dt)}
              style={{
                ...btnBase, flex: 1, fontSize: 10, padding: '4px 2px',
                background: dimType === dt ? C.accent : C.card,
                color: dimType === dt ? '#fff' : C.dim,
                border: `1px solid ${dimType === dt ? C.accent : C.border}`,
              }}
            >
              {dt === 'linear' ? t.dimLinear :
               dt === 'angular' ? t.dimAngular :
               dt === 'radial' ? t.dimRadial :
               t.dimDiameter}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>
            {t.value} {dimType === 'angular' ? '(\u00B0)' : '(mm)'}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={dimValue}
            onChange={e => setDimValue(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Tolerance type */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['bilateral', 'unilateral', 'limit'] as const).map(tt => (
            <button
              key={tt}
              onClick={() => {
                setTolType(tt);
                if (tt === 'bilateral') {
                  const v = Math.abs(parseFloat(tolUpper) || 0.05);
                  setTolUpper(v.toFixed(2));
                  setTolLower((-v).toFixed(2));
                }
              }}
              style={{
                ...btnBase, flex: 1, fontSize: 10, padding: '3px 2px',
                background: tolType === tt ? 'rgba(56,139,253,0.15)' : 'transparent',
                color: tolType === tt ? C.accent : C.dim,
                border: `1px solid ${tolType === tt ? C.accent : C.border}`,
              }}
            >
              {tt === 'bilateral' ? '\u00B1' : tt === 'unilateral' ? '+/-' : t.tolLimit}
            </button>
          ))}
        </div>

        {tolType === 'bilateral' ? (
          <div style={{ marginBottom: 6 }}>
            <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t.bilateralTol} (\u00B1)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={Math.abs(parseFloat(tolUpper) || 0).toFixed(2)}
              onChange={e => handleBilateralChange(e.target.value)}
              style={inputStyle}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t.upper}</label>
              <input
                type="number"
                step="0.01"
                value={tolUpper}
                onChange={e => setTolUpper(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: C.dim, fontSize: 10, fontWeight: 600 }}>{t.lower}</label>
              <input
                type="number"
                step="0.01"
                value={tolLower}
                onChange={e => setTolLower(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleAddDimension}
          style={{
            ...btnBase, width: '100%', marginBottom: 10,
            background: '#fbbf24', color: '#0d1117',
          }}
        >
          {t.addDimBtn}
        </button>

        {/* ── Annotation List ── */}
        {(gdtAnnotations.length > 0 || dimensionAnnotations.length > 0) && (
          <>
            <div style={sectionTitle}>{t.annotations}</div>

            {gdtAnnotations.map(a => (
              <div key={a.id} style={listItemStyle}>
                <span style={{ fontSize: 14 }}>{GDT_SYMBOLS[a.symbol]}</span>
                <span style={{ flex: 1, fontFamily: a.fcf ? 'monospace' : undefined, fontSize: a.fcf ? 10 : 11 }}>
                  {a.fcf ? formatFCF(a.fcf) : `${a.tolerance.toFixed(2)}${a.datum ? ` [${a.datum}]` : ''}`}
                </span>
                <button
                  onClick={() => onRemoveGDT(a.id)}
                  style={{ ...btnBase, background: 'transparent', color: C.danger, padding: '0 4px', fontSize: 13 }}
                  title={t.delete}
                >
                  &times;
                </button>
              </div>
            ))}

            {dimensionAnnotations.map(a => {
              const prefix = a.type === 'diameter' ? '\u2300' : a.type === 'radial' ? 'R' : '';
              const suffix = a.type === 'angular' ? '\u00B0' : '';
              let tolStr = '';
              if (a.tolerance) {
                if (a.tolerance.upper === -a.tolerance.lower) {
                  tolStr = ` \u00B1${a.tolerance.upper.toFixed(2)}`;
                } else {
                  tolStr = ` +${a.tolerance.upper.toFixed(2)}/${a.tolerance.lower.toFixed(2)}`;
                }
              }
              return (
                <div key={a.id} style={listItemStyle}>
                  <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: 12, width: 18, textAlign: 'center' }}>
                    {a.type === 'linear' ? '↔' : a.type === 'angular' ? '∠' : a.type === 'radial' ? 'R' : '⌀'}
                  </span>
                  <span style={{ flex: 1 }}>{prefix}{a.value.toFixed(2)}{suffix}{tolStr}</span>
                  <button
                    onClick={() => onRemoveDimension(a.id)}
                    style={{ ...btnBase, background: 'transparent', color: C.danger, padding: '0 4px', fontSize: 13 }}
                    title={t.delete}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </>
        )}

        {/* ── Tolerance Stack Analyzer ── */}
        <div style={{ ...sectionTitle, marginTop: 16 }}>{t.toleranceStack}</div>
        <ToleranceStackPanel
          lang={isKo ? 'ko' : 'en'}
          initialEntries={dimensionAnnotations.slice(0, 4).map((d) => ({
            id: d.id,
            label: d.label || `dim_${d.id.slice(0, 5)}`,
            nominal: d.value,
            upper: d.tolerance?.upper != null ? Math.abs(d.tolerance.upper) : 0.1,
            lower: d.tolerance?.lower != null ? Math.abs(d.tolerance.lower) : 0.1,
            direction: 'add',
            ref: d.id,
          }))}
        />
      </div>
    </div>
  );
}
