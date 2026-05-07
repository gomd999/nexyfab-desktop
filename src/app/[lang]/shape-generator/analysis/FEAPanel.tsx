'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { FEAResult, FEABoundaryCondition, FEAMaterial } from './simpleFEA';
import type { FEADisplayMode } from './FEAOverlay';

/* ─── i18n dictionary ────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '응력 해석 (FEA)',
    materialProps: '재료 속성',
    youngsModulus: '탄성 계수',
    poissonRatio: '포아송 비',
    yieldStrength: '항복 강도',
    density: '밀도',
    boundaryConditions: '경계 조건',
    fixed: '고정',
    force: '하중',
    pressure: '압력',
    fixedUpper: '고정',
    forceUpper: '하중',
    pressureUpper: '압력',
    addBCHint: '경계 조건을 추가하세요',
    faces: '면',
    running: '해석 중...',
    runAnalysis: '해석 실행',
    methodLinear: '방법: 선형 FEM (Tet4)',
    methodBeam: '방법: 보 이론 (근사)',
    accuracy: '정확도: ±30-50%',
    elements: '요소',
    converged: '수렴',
    results: '해석 결과',
    maxStress: '최대 응력',
    minStress: '최소 응력',
    maxDisplacement: '최대 변위',
    safetyFactor: '안전율',
    safe: '안전',
    caution: '주의',
    danger: '위험',
    yieldLbl: '항복 강도',
    maxStressShort: '최대 응력',
    displayMode: '표시 모드',
    stress: '응력',
    displacement: '변위',
    deformed: '변형',
    deformationScale: '변형 배율',
    displacementMap: '변위 분포 (mm)',
    stressMap: '응력 분포 — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `항복강도 ${yieldVal} MPa / 최대응력 ${maxStress} MPa`,
    clickRunToStart: '"해석 실행"을 클릭하여 시작하세요',
    addBCThenAnalyze: '경계 조건(고정면, 하중)을 추가한 후 해석하세요',
    matAluminum: '알루미늄',
    matSteel: '스틸',
    matTitanium: '티타늄',
    matCopper: '구리',
    matAbs: 'ABS',
    matNylon: '나일론',
  },
  en: {
    title: 'Stress Analysis (FEA)',
    materialProps: 'Material Properties',
    youngsModulus: "Young's Modulus",
    poissonRatio: 'Poisson Ratio',
    yieldStrength: 'Yield Strength',
    density: 'Density',
    boundaryConditions: 'Boundary Conditions',
    fixed: 'Fixed',
    force: 'Force',
    pressure: 'Pressure',
    fixedUpper: 'FIXED',
    forceUpper: 'FORCE',
    pressureUpper: 'PRESSURE',
    addBCHint: 'Add boundary conditions above',
    faces: 'faces',
    running: 'Analyzing...',
    runAnalysis: 'Run Analysis',
    methodLinear: 'Method: Linear FEM (Tet4)',
    methodBeam: 'Method: Beam Theory (Approx)',
    accuracy: 'Accuracy: \u00B130\u201350%',
    elements: 'Elements',
    converged: 'Converged',
    results: 'Results',
    maxStress: 'Max Stress',
    minStress: 'Min Stress',
    maxDisplacement: 'Max Displacement',
    safetyFactor: 'Safety Factor',
    safe: 'Safe',
    caution: 'Caution',
    danger: 'Danger',
    yieldLbl: 'Yield',
    maxStressShort: 'Max Stress',
    displayMode: 'Display Mode',
    stress: 'Stress',
    displacement: 'Displacement',
    deformed: 'Deformed',
    deformationScale: 'Deformation Scale',
    displacementMap: 'Displacement Map (mm)',
    stressMap: 'Stress Map — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `Yield ${yieldVal} MPa / Max ${maxStress} MPa`,
    clickRunToStart: 'Click "Run Analysis" to begin',
    addBCThenAnalyze: 'Add boundary conditions (fixed, forces) then analyze',
    matAluminum: 'Aluminum',
    matSteel: 'Steel',
    matTitanium: 'Titanium',
    matCopper: 'Copper',
    matAbs: 'ABS',
    matNylon: 'Nylon',
  },
  ja: {
    title: '応力解析 (FEA)',
    materialProps: '材料特性',
    youngsModulus: 'ヤング率',
    poissonRatio: 'ポアソン比',
    yieldStrength: '降伏強度',
    density: '密度',
    boundaryConditions: '境界条件',
    fixed: '固定',
    force: '荷重',
    pressure: '圧力',
    fixedUpper: '固定',
    forceUpper: '荷重',
    pressureUpper: '圧力',
    addBCHint: '境界条件を追加してください',
    faces: '面',
    running: '解析中...',
    runAnalysis: '解析実行',
    methodLinear: '方法: 線形 FEM (Tet4)',
    methodBeam: '方法: 梁理論 (近似)',
    accuracy: '精度: ±30-50%',
    elements: '要素',
    converged: '収束',
    results: '解析結果',
    maxStress: '最大応力',
    minStress: '最小応力',
    maxDisplacement: '最大変位',
    safetyFactor: '安全率',
    safe: '安全',
    caution: '注意',
    danger: '危険',
    yieldLbl: '降伏強度',
    maxStressShort: '最大応力',
    displayMode: '表示モード',
    stress: '応力',
    displacement: '変位',
    deformed: '変形',
    deformationScale: '変形倍率',
    displacementMap: '変位分布 (mm)',
    stressMap: '応力分布 — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `降伏強度 ${yieldVal} MPa / 最大応力 ${maxStress} MPa`,
    clickRunToStart: '「解析実行」をクリックして開始してください',
    addBCThenAnalyze: '境界条件(固定面、荷重)を追加してから解析してください',
    matAluminum: 'アルミニウム',
    matSteel: 'スチール',
    matTitanium: 'チタン',
    matCopper: '銅',
    matAbs: 'ABS',
    matNylon: 'ナイロン',
  },
  zh: {
    title: '应力分析 (FEA)',
    materialProps: '材料属性',
    youngsModulus: '杨氏模量',
    poissonRatio: '泊松比',
    yieldStrength: '屈服强度',
    density: '密度',
    boundaryConditions: '边界条件',
    fixed: '固定',
    force: '载荷',
    pressure: '压力',
    fixedUpper: '固定',
    forceUpper: '载荷',
    pressureUpper: '压力',
    addBCHint: '请添加边界条件',
    faces: '面',
    running: '分析中...',
    runAnalysis: '运行分析',
    methodLinear: '方法: 线性 FEM (Tet4)',
    methodBeam: '方法: 梁理论 (近似)',
    accuracy: '精度: ±30-50%',
    elements: '单元',
    converged: '收敛',
    results: '分析结果',
    maxStress: '最大应力',
    minStress: '最小应力',
    maxDisplacement: '最大位移',
    safetyFactor: '安全系数',
    safe: '安全',
    caution: '注意',
    danger: '危险',
    yieldLbl: '屈服强度',
    maxStressShort: '最大应力',
    displayMode: '显示模式',
    stress: '应力',
    displacement: '位移',
    deformed: '变形',
    deformationScale: '变形比例',
    displacementMap: '位移分布 (mm)',
    stressMap: '应力分布 — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `屈服强度 ${yieldVal} MPa / 最大应力 ${maxStress} MPa`,
    clickRunToStart: '点击"运行分析"开始',
    addBCThenAnalyze: '添加边界条件(固定面、载荷)后进行分析',
    matAluminum: '铝',
    matSteel: '钢',
    matTitanium: '钛',
    matCopper: '铜',
    matAbs: 'ABS',
    matNylon: '尼龙',
  },
  es: {
    title: 'Análisis de Esfuerzos (FEA)',
    materialProps: 'Propiedades del Material',
    youngsModulus: 'Módulo de Young',
    poissonRatio: 'Coeficiente de Poisson',
    yieldStrength: 'Límite Elástico',
    density: 'Densidad',
    boundaryConditions: 'Condiciones de Contorno',
    fixed: 'Fijo',
    force: 'Fuerza',
    pressure: 'Presión',
    fixedUpper: 'FIJO',
    forceUpper: 'FUERZA',
    pressureUpper: 'PRESIÓN',
    addBCHint: 'Agregue condiciones de contorno',
    faces: 'caras',
    running: 'Analizando...',
    runAnalysis: 'Ejecutar Análisis',
    methodLinear: 'Método: FEM Lineal (Tet4)',
    methodBeam: 'Método: Teoría de Vigas (Aprox)',
    accuracy: 'Precisión: \u00B130\u201350%',
    elements: 'Elementos',
    converged: 'Convergido',
    results: 'Resultados',
    maxStress: 'Esfuerzo Máx',
    minStress: 'Esfuerzo Mín',
    maxDisplacement: 'Desplazamiento Máx',
    safetyFactor: 'Factor de Seguridad',
    safe: 'Seguro',
    caution: 'Precaución',
    danger: 'Peligro',
    yieldLbl: 'Límite',
    maxStressShort: 'Esfuerzo Máx',
    displayMode: 'Modo de Visualización',
    stress: 'Esfuerzo',
    displacement: 'Desplazamiento',
    deformed: 'Deformado',
    deformationScale: 'Escala de Deformación',
    displacementMap: 'Mapa de Desplazamiento (mm)',
    stressMap: 'Mapa de Esfuerzos — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `Límite ${yieldVal} MPa / Máx ${maxStress} MPa`,
    clickRunToStart: 'Haga clic en "Ejecutar Análisis" para comenzar',
    addBCThenAnalyze: 'Agregue condiciones de contorno (fijos, fuerzas) y luego analice',
    matAluminum: 'Aluminio',
    matSteel: 'Acero',
    matTitanium: 'Titanio',
    matCopper: 'Cobre',
    matAbs: 'ABS',
    matNylon: 'Nylon',
  },
  ar: {
    title: 'تحليل الإجهاد (FEA)',
    materialProps: 'خصائص المادة',
    youngsModulus: 'معامل يونغ',
    poissonRatio: 'نسبة بواسون',
    yieldStrength: 'مقاومة الخضوع',
    density: 'الكثافة',
    boundaryConditions: 'الشروط الحدودية',
    fixed: 'مثبت',
    force: 'قوة',
    pressure: 'ضغط',
    fixedUpper: 'مثبت',
    forceUpper: 'قوة',
    pressureUpper: 'ضغط',
    addBCHint: 'أضف الشروط الحدودية',
    faces: 'أوجه',
    running: 'جاري التحليل...',
    runAnalysis: 'تشغيل التحليل',
    methodLinear: 'الطريقة: FEM خطي (Tet4)',
    methodBeam: 'الطريقة: نظرية العارضة (تقريبي)',
    accuracy: 'الدقة: ±30-50%',
    elements: 'العناصر',
    converged: 'تقارب',
    results: 'النتائج',
    maxStress: 'الإجهاد الأقصى',
    minStress: 'الإجهاد الأدنى',
    maxDisplacement: 'الإزاحة القصوى',
    safetyFactor: 'عامل الأمان',
    safe: 'آمن',
    caution: 'تحذير',
    danger: 'خطر',
    yieldLbl: 'الخضوع',
    maxStressShort: 'الإجهاد الأقصى',
    displayMode: 'وضع العرض',
    stress: 'الإجهاد',
    displacement: 'الإزاحة',
    deformed: 'مشوه',
    deformationScale: 'مقياس التشوه',
    displacementMap: 'خريطة الإزاحة (mm)',
    stressMap: 'خريطة الإجهاد — Von Mises (MPa)',
    sfFormula: (yieldVal: number, maxStress: string) => `الخضوع ${yieldVal} MPa / الأقصى ${maxStress} MPa`,
    clickRunToStart: 'انقر على "تشغيل التحليل" للبدء',
    addBCThenAnalyze: 'أضف الشروط الحدودية (مثبتة، قوى) ثم حلل',
    matAluminum: 'ألومنيوم',
    matSteel: 'فولاذ',
    matTitanium: 'تيتانيوم',
    matCopper: 'نحاس',
    matAbs: 'ABS',
    matNylon: 'نايلون',
  },
} as const;

type Lang = keyof typeof dict;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  orange: '#f0883e',
};

/* ─── Material presets for FEA ───────────────────────────────────────────── */

const FEA_MATERIAL_PRESETS: { id: string; labelKey: 'matAluminum' | 'matSteel' | 'matTitanium' | 'matCopper' | 'matAbs' | 'matNylon'; props: FEAMaterial }[] = [
  { id: 'aluminum', labelKey: 'matAluminum', props: { youngsModulus: 69, poissonRatio: 0.33, yieldStrength: 276, density: 2.7 } },
  { id: 'steel', labelKey: 'matSteel', props: { youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85 } },
  { id: 'titanium', labelKey: 'matTitanium', props: { youngsModulus: 116, poissonRatio: 0.34, yieldStrength: 880, density: 4.43 } },
  { id: 'copper', labelKey: 'matCopper', props: { youngsModulus: 117, poissonRatio: 0.34, yieldStrength: 210, density: 8.96 } },
  { id: 'abs', labelKey: 'matAbs', props: { youngsModulus: 2.3, poissonRatio: 0.35, yieldStrength: 40, density: 1.05 } },
  { id: 'nylon', labelKey: 'matNylon', props: { youngsModulus: 2.7, poissonRatio: 0.39, yieldStrength: 70, density: 1.14 } },
];

/* ─── Component ──────────────────────────────────────────────────────────── */

interface FEAPanelProps {
  result: FEAResult | null;
  conditions: FEABoundaryCondition[];
  onConditionsChange: (conds: FEABoundaryCondition[]) => void;
  onRunAnalysis: (material: FEAMaterial) => void;
  onClose: () => void;
  displayMode: FEADisplayMode;
  onDisplayModeChange: (mode: FEADisplayMode) => void;
  deformationScale: number;
  onDeformationScaleChange: (scale: number) => void;
  materialId?: string;
  isKo: boolean;
  totalFaces: number;
}

export default function FEAPanel({
  result,
  conditions,
  onConditionsChange,
  onRunAnalysis,
  onClose,
  displayMode,
  onDisplayModeChange,
  deformationScale,
  onDeformationScaleChange,
  materialId,
  isKo,
  totalFaces,
}: FEAPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  // Find matching preset or default to steel
  const defaultPreset = FEA_MATERIAL_PRESETS.find(p => p.id === materialId) || FEA_MATERIAL_PRESETS[1];
  const [selectedPreset, setSelectedPreset] = useState(defaultPreset.id);
  const [matProps, setMatProps] = useState<FEAMaterial>({ ...defaultPreset.props });
  const [isRunning, setIsRunning] = useState(false);

  const handlePresetChange = useCallback((presetId: string) => {
    const preset = FEA_MATERIAL_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);
      setMatProps({ ...preset.props });
    }
  }, []);

  const handleAddCondition = useCallback((type: 'fixed' | 'force' | 'pressure') => {
    // Default: apply to first 10% of faces as a starting point
    const faceCount = Math.max(1, Math.floor(totalFaces * 0.1));
    const startIdx = type === 'fixed' ? 0 : Math.floor(totalFaces * 0.9);
    const indices: number[] = [];
    for (let i = startIdx; i < Math.min(startIdx + faceCount, totalFaces); i++) {
      indices.push(i);
    }
    const newCond: FEABoundaryCondition = {
      type,
      faceIndices: indices,
      value: type === 'force' ? [0, -1000, 0] : type === 'pressure' ? [0, -100, 0] : undefined,
    };
    onConditionsChange([...conditions, newCond]);
  }, [conditions, onConditionsChange, totalFaces]);

  const handleRemoveCondition = useCallback((idx: number) => {
    const next = conditions.filter((_, i) => i !== idx);
    onConditionsChange(next);
  }, [conditions, onConditionsChange]);

  const handleUpdateConditionValue = useCallback((idx: number, axis: 0 | 1 | 2, val: number) => {
    const next = conditions.map((c, i) => {
      if (i !== idx) return c;
      const newVal: [number, number, number] = [...(c.value || [0, 0, 0])] as [number, number, number];
      newVal[axis] = val;
      return { ...c, value: newVal };
    });
    onConditionsChange(next);
  }, [conditions, onConditionsChange]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    // Small delay for UI feedback
    await new Promise(r => setTimeout(r, 50));
    onRunAnalysis(matProps);
    setIsRunning(false);
  }, [matProps, onRunAnalysis]);

  const safetyColor = (sf: number) => sf >= 2 ? C.green : sf >= 1 ? C.yellow : C.red;
  const safetyLabel = (sf: number) => {
    if (sf >= 2) return t.safe;
    if (sf >= 1) return t.caution;
    return t.danger;
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return (
    <div style={{
      width: isMobile ? '100vw' : 310,
      maxWidth: '100vw',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
      ...(isMobile ? { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 600 } : {}),
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`, background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          {t.title}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>&#10005;</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* ── Material properties ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {t.materialProps}
          </div>

          {/* Preset selector */}
          <div style={{ marginBottom: 10 }}>
            <select
              value={selectedPreset}
              onChange={e => handlePresetChange(e.target.value)}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 4,
                border: `1px solid ${C.border}`, background: '#0d1117',
                color: C.text, fontSize: 11, cursor: 'pointer',
              }}
            >
              {FEA_MATERIAL_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {t[p.labelKey]}
                </option>
              ))}
            </select>
          </div>

          {/* Material property inputs */}
          {([
            { key: 'youngsModulus' as const, label: t.youngsModulus, unit: 'GPa' },
            { key: 'poissonRatio' as const, label: t.poissonRatio, unit: '' },
            { key: 'yieldStrength' as const, label: t.yieldStrength, unit: 'MPa' },
            { key: 'density' as const, label: t.density, unit: 'g/cm\u00B3' },
          ]).map(prop => (
            <div key={prop.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: C.textDim, width: 80, flexShrink: 0 }}>{prop.label}</span>
              <input
                type="number"
                step={prop.key === 'poissonRatio' ? 0.01 : 1}
                value={matProps[prop.key]}
                onChange={e => setMatProps(prev => ({ ...prev, [prop.key]: Number(e.target.value) }))}
                style={{
                  flex: 1, padding: '3px 6px', borderRadius: 4,
                  border: `1px solid ${C.border}`, background: '#0d1117',
                  color: C.text, fontSize: 11, fontFamily: 'monospace',
                }}
              />
              {prop.unit && (
                <span style={{ fontSize: 9, color: '#484f58', width: 32, flexShrink: 0 }}>{prop.unit}</span>
              )}
            </div>
          ))}
        </div>

        {/* ── Boundary conditions ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {t.boundaryConditions}
          </div>

          {/* Add condition buttons */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {([
              { type: 'fixed' as const, icon: '📌', label: t.fixed },
              { type: 'force' as const, icon: '➡', label: t.force },
              { type: 'pressure' as const, icon: '⬇', label: t.pressure },
            ]).map(btn => (
              <button
                key={btn.type}
                onClick={() => handleAddCondition(btn.type)}
                style={{
                  flex: 1, padding: '5px 4px', borderRadius: 4,
                  border: `1px solid ${C.border}`, background: C.card,
                  color: C.text, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.12s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
              >
                <span style={{ fontSize: 12 }}>{btn.icon}</span> +{btn.label}
              </button>
            ))}
          </div>

          {/* Condition list */}
          {conditions.length === 0 && (
            <div style={{ fontSize: 10, color: '#484f58', textAlign: 'center', padding: 8 }}>
              {t.addBCHint}
            </div>
          )}
          {conditions.map((cond, idx) => (
            <div key={idx} style={{
              padding: '8px 10px', background: C.card, borderRadius: 6,
              border: `1px solid ${C.border}`, marginBottom: 6,
              borderLeft: `3px solid ${cond.type === 'fixed' ? C.green : cond.type === 'force' ? C.orange : C.accent}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  color: cond.type === 'fixed' ? C.green : cond.type === 'force' ? C.orange : C.accent }}>
                  {cond.type === 'fixed' ? t.fixedUpper :
                   cond.type === 'force' ? t.forceUpper :
                   t.pressureUpper}
                </span>
                <button onClick={() => handleRemoveCondition(idx)} style={{
                  border: 'none', background: 'none', color: C.textDim, cursor: 'pointer', fontSize: 12, padding: 0,
                }}>&#10005;</button>
              </div>
              <div style={{ fontSize: 9, color: '#484f58', marginBottom: 4 }}>
                {cond.faceIndices.length} {t.faces}
              </div>
              {cond.type !== 'fixed' && cond.value && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['X', 'Y', 'Z']).map((axis, ai) => (
                    <div key={axis} style={{ flex: 1 }}>
                      <label style={{ fontSize: 8, color: '#484f58' }}>{axis}</label>
                      <input
                        type="number"
                        value={cond.value![ai]}
                        onChange={e => handleUpdateConditionValue(idx, ai as 0 | 1 | 2, Number(e.target.value))}
                        style={{
                          width: '100%', padding: '2px 4px', borderRadius: 3,
                          border: `1px solid ${C.border}`, background: '#0d1117',
                          color: C.text, fontSize: 10, fontFamily: 'monospace',
                        }}
                      />
                    </div>
                  ))}
                  <div style={{ fontSize: 8, color: '#484f58', alignSelf: 'flex-end', paddingBottom: 3 }}>
                    {cond.type === 'force' ? 'N' : 'Pa'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Run button ── */}
        <button
          onClick={handleRun}
          disabled={conditions.length === 0 || isRunning}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            border: 'none', background: conditions.length === 0 ? '#21262d' : C.accent,
            color: conditions.length === 0 ? '#484f58' : '#fff',
            fontSize: 12, fontWeight: 700, cursor: conditions.length === 0 ? 'default' : 'pointer',
            transition: 'opacity 0.12s', marginBottom: 16,
            opacity: isRunning ? 0.6 : 1,
          }}
          onMouseEnter={e => { if (conditions.length > 0) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = isRunning ? '0.6' : '1'; }}
        >
          {isRunning ? t.running : t.runAnalysis}
        </button>

        {/* ── Results ── */}
        {result && (
          <>
            {/* Solver quality indicator */}
            <div style={{
              marginBottom: 12, padding: '7px 10px', borderRadius: 6,
              background: C.card, border: `1px solid ${C.border}`,
              fontSize: 10, color: C.textDim, fontFamily: 'monospace',
              lineHeight: 1.6,
            }}>
              {result.method === 'linear-fem-tet' ? (
                <>
                  <span style={{ color: C.green, fontWeight: 700 }}>
                    {t.methodLinear}
                  </span>
                  {' | '}
                  {t.elements}: {result.elementCount.toLocaleString()}
                  {' | '}
                  DOF: {result.dofCount.toLocaleString()}
                  {' | '}
                  {t.converged}: {result.converged ? (
                    <span style={{ color: C.green }}>&#10003;</span>
                  ) : (
                    <span style={{ color: C.yellow }}>&#9888;</span>
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: C.yellow, fontWeight: 700 }}>
                    {t.methodBeam}
                  </span>
                  {' | '}
                  <span style={{ color: C.yellow }}>
                    {t.accuracy}
                  </span>
                </>
              )}
            </div>

            {/* Summary stats */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {t.results}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  {
                    label: t.maxStress,
                    value: `${result.maxStress.toFixed(2)} MPa`,
                    icon: '🔴',
                  },
                  {
                    label: t.minStress,
                    value: `${result.minStress.toFixed(2)} MPa`,
                    icon: '🔵',
                  },
                  {
                    label: t.maxDisplacement,
                    value: `${result.maxDisplacement.toFixed(4)} mm`,
                    icon: '📏',
                  },
                  {
                    label: t.safetyFactor,
                    value: result.safetyFactor.toFixed(2),
                    icon: '🛡',
                    color: safetyColor(result.safetyFactor),
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                      {stat.icon} {stat.label}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
                      color: stat.color || C.text,
                    }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety factor badge */}
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: C.card, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13,
                background: safetyColor(result.safetyFactor) + '22',
                color: safetyColor(result.safetyFactor),
                border: `2px solid ${safetyColor(result.safetyFactor)}`,
              }}>
                {result.safetyFactor.toFixed(1)}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: safetyColor(result.safetyFactor) }}>
                  {safetyLabel(result.safetyFactor)}
                </div>
                <div style={{ fontSize: 10, color: C.textDim }}>
                  {t.safetyFactor} = {t.yieldLbl} / {t.maxStressShort}
                </div>
              </div>
            </div>

            {/* Display mode toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {t.displayMode}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { key: 'stress' as FEADisplayMode, label: t.stress },
                  { key: 'displacement' as FEADisplayMode, label: t.displacement },
                  { key: 'deformed' as FEADisplayMode, label: t.deformed },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => onDisplayModeChange(opt.key)}
                    style={{
                      flex: 1, padding: '5px 6px', borderRadius: 4,
                      border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: displayMode === opt.key ? C.accent : C.card,
                      color: displayMode === opt.key ? '#fff' : C.textDim,
                      transition: 'all 0.12s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Deformation scale slider */}
            {displayMode === 'deformed' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>
                    {t.deformationScale}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>
                    {deformationScale.toFixed(0)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={1} max={500} step={1}
                  value={deformationScale}
                  onChange={e => onDeformationScaleChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: C.accent }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
                  <span>1x</span><span>250x</span><span>500x</span>
                </div>
              </div>
            )}

            {/* Color legend */}
            <div style={{
              padding: '10px', background: '#0d1117', borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {displayMode === 'displacement'
                  ? t.displacementMap
                  : t.stressMap}
              </div>
              {/* Gradient bar */}
              <div style={{
                height: 14, borderRadius: 4, marginBottom: 6, position: 'relative',
                background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)',
              }}>
                {/* tick marks */}
                {[0, 25, 50, 75, 100].map(pct => (
                  <div key={pct} style={{
                    position: 'absolute', left: `${pct}%`, top: 0, width: 1, height: '100%',
                    background: 'rgba(0,0,0,0.25)',
                  }} />
                ))}
              </div>
              {/* Min / quartile / max labels */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
                {displayMode === 'stress' ? (
                  <>
                    <span>{result.minStress.toFixed(1)}</span>
                    <span>{((result.minStress + result.maxStress) / 2).toFixed(1)}</span>
                    <span style={{ color: '#f85149', fontWeight: 700 }}>{result.maxStress.toFixed(1)}</span>
                  </>
                ) : (
                  <>
                    <span>0</span>
                    <span>{(result.maxDisplacement / 2).toFixed(4)}</span>
                    <span style={{ color: '#f85149', fontWeight: 700 }}>{result.maxDisplacement.toFixed(4)}</span>
                  </>
                )}
              </div>
              {/* Safety factor reminder */}
              <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 5, background: `${safetyColor(result.safetyFactor)}18`, border: `1px solid ${safetyColor(result.safetyFactor)}44`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: safetyColor(result.safetyFactor) }}>
                  SF {result.safetyFactor.toFixed(2)}
                </span>
                <span style={{ fontSize: 9, color: C.textDim }}>
                  {t.sfFormula(matProps.yieldStrength, result.maxStress.toFixed(2))}
                </span>
              </div>
            </div>
          </>
        )}

        {!result && conditions.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🔬</div>
            <div style={{ fontSize: 11 }}>
              {t.clickRunToStart}
            </div>
          </div>
        )}

        {!result && conditions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📌</div>
            <div style={{ fontSize: 11 }}>
              {t.addBCThenAnalyze}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
