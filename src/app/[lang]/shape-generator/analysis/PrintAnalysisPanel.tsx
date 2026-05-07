'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PrintAnalysisResult, PrintAnalysisOptions, OrientationOptimizationResult, PrintProcess } from './printAnalysis';

const dict = {
  ko: {
    headerTitle: '3D 프린팅 분석',
    secSettings: '설정',
    lblOverhangAngle: '오버행 각도',
    lblLayerHeight: '레이어 높이',
    lblBuildDirection: '빌드 방향',
    lblCustom: '사용자 정의',
    lblProcess: '프로세스',
    lblInfill: '내부 채움',
    lblPrintSpeed: '프린트 속도',
    lblMinWall: '최소 벽 두께',
    btnAnalyze: '분석 실행',
    btnAutoOrient: '자동 방향 최적화',
    secOrientation: '방향 최적화',
    alreadyOptimal: '✓ 이미 최적',
    tryLabel: (label: string) => `↑ ${label} 권장`,
    supportDelta: (pct: number, curA: string, bestA: string) => `서포트 면적 ${pct}% ↓ (${curA} → ${bestA} mm²)`,
    btnReanalyze: '이 방향으로 분석',
    lblNow: '현재',
    secResults: '분석 결과',
    statLayers: '레이어 수',
    statTime: '예상 시간',
    statMaterial: '재료 사용량',
    statSupport: '서포트 볼륨',
    statHeight: '빌드 높이',
    statOverhangFaces: '오버행 면',
    secPrintability: '프린터빌리티',
    rateGood: '양호',
    rateAttention: '주의 필요',
    rateIssues: '문제 있음',
    secCost: '예상 비용',
    costTotal: '총 비용',
    costMaterial: '재료비',
    costMachine: '기계 시간',
    costEffectiveVol: '실제 부피',
    solidPrefix: (vol: string) => `솔리드 ${vol} cm³`,
    lblProcessInline: '프로세스: ',
    btnSendSlicer: '슬라이서로 보내기 (STL + 3MF)',
    secIssues: '이슈 목록',
    sevError: '오류',
    sevWarn: '경고',
    facesAffected: '면 영향',
    typeOverhang: '오버행',
    typeThinWall: '얇은 벽',
    typeBridging: '브리징',
    typeSmallFeature: '미세 형상',
    secLegend: '색상 범례',
    legSafe: '안전 (오버행 없음)',
    legModerate: '주의 (중간 오버행)',
    legHigh: '경고 (높은 오버행)',
    legDanger: '위험 (서포트 필요)',
    emptyHint: '설정을 조정하고 "분석 실행"을 클릭하세요',
  },
  en: {
    headerTitle: '3D Print Analysis',
    secSettings: 'Settings',
    lblOverhangAngle: 'Overhang Angle',
    lblLayerHeight: 'Layer Height',
    lblBuildDirection: 'Build Direction',
    lblCustom: 'Custom',
    lblProcess: 'Process',
    lblInfill: 'Infill',
    lblPrintSpeed: 'Print Speed',
    lblMinWall: 'Min Wall Thickness',
    btnAnalyze: 'Analyze',
    btnAutoOrient: 'Auto-Orient',
    secOrientation: 'Orientation Ranking',
    alreadyOptimal: '✓ Already optimal',
    tryLabel: (label: string) => `↑ Try ${label}`,
    supportDelta: (pct: number, curA: string, bestA: string) => `Support area ${pct}% ↓ (${curA} → ${bestA} mm²)`,
    btnReanalyze: 'Re-analyze with this',
    lblNow: 'NOW',
    secResults: 'Results',
    statLayers: 'Layers',
    statTime: 'Est. Time',
    statMaterial: 'Material',
    statSupport: 'Support Vol.',
    statHeight: 'Build Height',
    statOverhangFaces: 'Overhang Faces',
    secPrintability: 'Printability',
    rateGood: 'Good',
    rateAttention: 'Needs Attention',
    rateIssues: 'Issues Found',
    secCost: 'Cost Estimate',
    costTotal: 'Total',
    costMaterial: 'Material',
    costMachine: 'Machine',
    costEffectiveVol: 'Effective Vol.',
    solidPrefix: (vol: string) => `solid ${vol} cm³`,
    lblProcessInline: 'Process: ',
    btnSendSlicer: 'Send to Slicer (STL + 3MF)',
    secIssues: 'Issues',
    sevError: 'ERROR',
    sevWarn: 'WARN',
    facesAffected: 'faces affected',
    typeOverhang: 'Overhang',
    typeThinWall: 'Thin Wall',
    typeBridging: 'Bridging',
    typeSmallFeature: 'Small Feature',
    secLegend: 'Color Legend',
    legSafe: 'Safe (no overhang)',
    legModerate: 'Moderate overhang',
    legHigh: 'High overhang',
    legDanger: 'Support required',
    emptyHint: 'Adjust settings and click "Analyze"',
  },
  ja: {
    headerTitle: '3Dプリント解析',
    secSettings: '設定',
    lblOverhangAngle: 'オーバーハング角度',
    lblLayerHeight: 'レイヤー高さ',
    lblBuildDirection: 'ビルド方向',
    lblCustom: 'カスタム',
    lblProcess: 'プロセス',
    lblInfill: 'インフィル',
    lblPrintSpeed: '印刷速度',
    lblMinWall: '最小壁厚',
    btnAnalyze: '解析実行',
    btnAutoOrient: '方向自動最適化',
    secOrientation: '方向最適化',
    alreadyOptimal: '✓ 既に最適',
    tryLabel: (label: string) => `↑ ${label}を推奨`,
    supportDelta: (pct: number, curA: string, bestA: string) => `サポート面積 ${pct}% ↓ (${curA} → ${bestA} mm²)`,
    btnReanalyze: 'この方向で解析',
    lblNow: '現在',
    secResults: '解析結果',
    statLayers: 'レイヤー数',
    statTime: '予想時間',
    statMaterial: '材料使用量',
    statSupport: 'サポート体積',
    statHeight: 'ビルド高さ',
    statOverhangFaces: 'オーバーハング面',
    secPrintability: 'プリンタビリティ',
    rateGood: '良好',
    rateAttention: '注意が必要',
    rateIssues: '問題あり',
    secCost: 'コスト見積もり',
    costTotal: '合計',
    costMaterial: '材料費',
    costMachine: 'マシン時間',
    costEffectiveVol: '実効体積',
    solidPrefix: (vol: string) => `ソリッド ${vol} cm³`,
    lblProcessInline: 'プロセス: ',
    btnSendSlicer: 'スライサーへ送信 (STL + 3MF)',
    secIssues: '問題一覧',
    sevError: 'エラー',
    sevWarn: '警告',
    facesAffected: '面に影響',
    typeOverhang: 'Overhang',
    typeThinWall: '薄壁',
    typeBridging: 'ブリッジング',
    typeSmallFeature: '微小フィーチャ',
    secLegend: 'カラー凡例',
    legSafe: '安全 (overhang なし)',
    legModerate: '中程度の overhang',
    legHigh: '強い overhang',
    legDanger: 'サポート必須',
    emptyHint: '設定を調整して「解析実行」をクリックしてください',
  },
  zh: {
    headerTitle: '3D打印分析',
    secSettings: '设置',
    lblOverhangAngle: '悬垂角度',
    lblLayerHeight: '层高',
    lblBuildDirection: '构建方向',
    lblCustom: '自定义',
    lblProcess: '工艺',
    lblInfill: 'infill',
    lblPrintSpeed: '打印速度',
    lblMinWall: '最小壁厚',
    btnAnalyze: '运行分析',
    btnAutoOrient: '自动方向优化',
    secOrientation: '方向优化',
    alreadyOptimal: '✓ 已最优',
    tryLabel: (label: string) => `↑ 推荐 ${label}`,
    supportDelta: (pct: number, curA: string, bestA: string) => `支撑面积 ${pct}% ↓ (${curA} → ${bestA} mm²)`,
    btnReanalyze: '按此方向重新分析',
    lblNow: '当前',
    secResults: '分析结果',
    statLayers: '层数',
    statTime: '预计时间',
    statMaterial: '材料用量',
    statSupport: '支撑体积',
    statHeight: '构建高度',
    statOverhangFaces: '悬垂面',
    secPrintability: '可打印性',
    rateGood: '良好',
    rateAttention: '需注意',
    rateIssues: '存在问题',
    secCost: '成本估算',
    costTotal: '总计',
    costMaterial: '材料费',
    costMachine: '机器时间',
    costEffectiveVol: '有效体积',
    solidPrefix: (vol: string) => `实体 ${vol} cm³`,
    lblProcessInline: '工艺: ',
    btnSendSlicer: '发送到切片机 (STL + 3MF)',
    secIssues: '问题列表',
    sevError: '错误',
    sevWarn: '警告',
    facesAffected: '个面受影响',
    typeOverhang: 'Overhang',
    typeThinWall: '薄壁',
    typeBridging: 'Bridging',
    typeSmallFeature: '微小特征',
    secLegend: '颜色图例',
    legSafe: '安全 (无 overhang)',
    legModerate: '中等 overhang',
    legHigh: '高 overhang',
    legDanger: '需要 support',
    emptyHint: '调整设置后点击"运行分析"',
  },
  es: {
    headerTitle: 'Análisis de impresión 3D',
    secSettings: 'Ajustes',
    lblOverhangAngle: 'Ángulo de overhang',
    lblLayerHeight: 'Altura de capa',
    lblBuildDirection: 'Dirección de construcción',
    lblCustom: 'Personalizado',
    lblProcess: 'Proceso',
    lblInfill: 'infill',
    lblPrintSpeed: 'Velocidad de impresión',
    lblMinWall: 'Grosor mínimo de pared',
    btnAnalyze: 'Analizar',
    btnAutoOrient: 'Orientar automáticamente',
    secOrientation: 'Ranking de orientación',
    alreadyOptimal: '✓ Ya es óptima',
    tryLabel: (label: string) => `↑ Probar ${label}`,
    supportDelta: (pct: number, curA: string, bestA: string) => `Área de support ${pct}% ↓ (${curA} → ${bestA} mm²)`,
    btnReanalyze: 'Reanalizar con esta',
    lblNow: 'ACTUAL',
    secResults: 'Resultados',
    statLayers: 'Capas',
    statTime: 'Tiempo est.',
    statMaterial: 'Material',
    statSupport: 'Vol. support',
    statHeight: 'Altura',
    statOverhangFaces: 'Caras con overhang',
    secPrintability: 'Imprimibilidad',
    rateGood: 'Bien',
    rateAttention: 'Requiere atención',
    rateIssues: 'Problemas',
    secCost: 'Estimación de costo',
    costTotal: 'Total',
    costMaterial: 'Material',
    costMachine: 'Máquina',
    costEffectiveVol: 'Vol. efectivo',
    solidPrefix: (vol: string) => `sólido ${vol} cm³`,
    lblProcessInline: 'Proceso: ',
    btnSendSlicer: 'Enviar al slicer (STL + 3MF)',
    secIssues: 'Problemas',
    sevError: 'ERROR',
    sevWarn: 'AVISO',
    facesAffected: 'caras afectadas',
    typeOverhang: 'Overhang',
    typeThinWall: 'Pared delgada',
    typeBridging: 'Bridging',
    typeSmallFeature: 'Detalle pequeño',
    secLegend: 'Leyenda de colores',
    legSafe: 'Seguro (sin overhang)',
    legModerate: 'Overhang moderado',
    legHigh: 'Overhang alto',
    legDanger: 'Support requerido',
    emptyHint: 'Ajusta la configuración y pulsa "Analizar"',
  },
  ar: {
    headerTitle: 'تحليل الطباعة ثلاثية الأبعاد',
    secSettings: 'الإعدادات',
    lblOverhangAngle: 'زاوية overhang',
    lblLayerHeight: 'ارتفاع الطبقة',
    lblBuildDirection: 'اتجاه البناء',
    lblCustom: 'مخصص',
    lblProcess: 'العملية',
    lblInfill: 'infill',
    lblPrintSpeed: 'سرعة الطباعة',
    lblMinWall: 'أدنى سماكة جدار',
    btnAnalyze: 'تشغيل التحليل',
    btnAutoOrient: 'توجيه تلقائي',
    secOrientation: 'ترتيب الاتجاه',
    alreadyOptimal: '✓ مثالي بالفعل',
    tryLabel: (label: string) => `↑ جرّب ${label}`,
    supportDelta: (pct: number, curA: string, bestA: string) => `مساحة support انخفضت ${pct}% (${curA} → ${bestA} mm²)`,
    btnReanalyze: 'إعادة التحليل بهذا الاتجاه',
    lblNow: 'الحالي',
    secResults: 'النتائج',
    statLayers: 'عدد الطبقات',
    statTime: 'الوقت التقديري',
    statMaterial: 'استهلاك المادة',
    statSupport: 'حجم support',
    statHeight: 'ارتفاع البناء',
    statOverhangFaces: 'أوجه overhang',
    secPrintability: 'قابلية الطباعة',
    rateGood: 'جيد',
    rateAttention: 'يحتاج انتباه',
    rateIssues: 'يوجد مشاكل',
    secCost: 'تقدير التكلفة',
    costTotal: 'الإجمالي',
    costMaterial: 'تكلفة المادة',
    costMachine: 'وقت الآلة',
    costEffectiveVol: 'الحجم الفعلي',
    solidPrefix: (vol: string) => `صلب ${vol} cm³`,
    lblProcessInline: 'العملية: ',
    btnSendSlicer: 'إرسال إلى slicer (STL + 3MF)',
    secIssues: 'قائمة المشاكل',
    sevError: 'خطأ',
    sevWarn: 'تحذير',
    facesAffected: 'أوجه متأثرة',
    typeOverhang: 'Overhang',
    typeThinWall: 'جدار رفيع',
    typeBridging: 'Bridging',
    typeSmallFeature: 'تفصيل دقيق',
    secLegend: 'مفتاح الألوان',
    legSafe: 'آمن (بدون overhang)',
    legModerate: 'overhang متوسط',
    legHigh: 'overhang مرتفع',
    legDanger: 'يتطلب support',
    emptyHint: 'اضبط الإعدادات ثم انقر "تشغيل التحليل"',
  },
} as const;

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

/* ─── Component ──────────────────────────────────────────────────────────── */

interface PrintAnalysisPanelProps {
  analysis: PrintAnalysisResult | null;
  onAnalyze: (options: PrintAnalysisOptions) => void;
  onClose: () => void;
  isKo: boolean;
  optimization?: OrientationOptimizationResult | null;
  onOptimizeOrientation?: (overhangAngle: number, currentDirection: [number, number, number]) => void;
  onApplyOptimalOrientation?: (direction: [number, number, number]) => void;
  onExportPrintReady?: (settings: {
    process: PrintProcess;
    layerHeight: number;
    infillPercent: number;
    printSpeed: number;
    buildDirection: [number, number, number];
  }) => void;
}

type BuildDirPreset = 'y-up' | 'z-up' | 'custom';

export default function PrintAnalysisPanel({
  analysis,
  onAnalyze,
  onClose,
  optimization,
  onOptimizeOrientation,
  onApplyOptimalOrientation,
  onExportPrintReady,
}: PrintAnalysisPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [overhangAngle, setOverhangAngle] = useState(45);
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [minWallThickness, setMinWallThickness] = useState(0.8);
  const [buildDirPreset, setBuildDirPreset] = useState<BuildDirPreset>('y-up');
  const [customDir, setCustomDir] = useState<[number, number, number]>([0, 1, 0]);
  const [process, setProcess] = useState<PrintProcess>('fdm');
  const [infillPercent, setInfillPercent] = useState(20);
  const [printSpeed, setPrintSpeed] = useState(60);

  const getBuildDirection = (): [number, number, number] => {
    switch (buildDirPreset) {
      case 'y-up': return [0, 1, 0];
      case 'z-up': return [0, 0, 1];
      case 'custom': return customDir;
    }
  };

  const handleAnalyze = () => {
    onAnalyze({
      buildDirection: getBuildDirection(),
      overhangAngle,
      layerHeight,
      minWallThickness,
      infillPercent,
      printSpeed,
      process,
    });
  };

  const PROCESS_OPTIONS: Array<{ key: PrintProcess; label: string }> = [
    { key: 'fdm', label: 'FDM' },
    { key: 'sla', label: 'SLA' },
    { key: 'sls', label: 'SLS' },
  ];

  const severityColor = (sev: 'warning' | 'error') => sev === 'error' ? C.red : C.yellow;
  const typeIcon = (type: string) => {
    switch (type) {
      case 'overhang': return '⚠';
      case 'thin_wall': return '📏';
      case 'bridging': return '🌉';
      case 'small_feature': return '🔍';
      default: return '•';
    }
  };
  const typeLabel = (type: string) => {
    switch (type) {
      case 'overhang': return t.typeOverhang;
      case 'thin_wall': return t.typeThinWall;
      case 'bridging': return t.typeBridging;
      case 'small_feature': return t.typeSmallFeature;
      default: return type;
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return (
    <div data-tour="print-panel" style={{
      width: isMobile ? '100vw' : 320,
      maxWidth: '100vw',
      background: 'rgba(13, 17, 23, 0.75)',
      backdropFilter: 'blur(16px)',
      border: `1px solid ${C.border}`,
      borderRadius: isMobile ? 0 : 16,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
      position: isMobile ? 'fixed' : 'absolute',
      top: isMobile ? 0 : 56,
      right: isMobile ? 0 : 16,
      bottom: isMobile ? 0 : 56,
      zIndex: isMobile ? 600 : 55,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          🖨 {t.headerTitle}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* ── Settings ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {t.secSettings}
          </div>

          {/* Overhang angle slider */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {t.lblOverhangAngle}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>
                {overhangAngle}°
              </span>
            </div>
            <input
              type="range"
              min={30} max={60} step={1}
              value={overhangAngle}
              onChange={e => setOverhangAngle(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#484f58' }}>
              <span>30°</span><span>45°</span><span>60°</span>
            </div>
          </div>

          {/* Layer height */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {t.lblLayerHeight}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {layerHeight} mm
              </span>
            </div>
            <input
              type="range"
              min={0.05} max={0.5} step={0.05}
              value={layerHeight}
              onChange={e => setLayerHeight(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Build direction */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>
              {t.lblBuildDirection}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                { key: 'y-up' as BuildDirPreset, label: 'Y-up' },
                { key: 'z-up' as BuildDirPreset, label: 'Z-up' },
                { key: 'custom' as BuildDirPreset, label: t.lblCustom },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setBuildDirPreset(opt.key)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 4,
                    border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: buildDirPreset === opt.key ? C.accent : C.card,
                    color: buildDirPreset === opt.key ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {buildDirPreset === 'custom' && (
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                  <div key={axis} style={{ flex: 1 }}>
                    <label style={{ fontSize: 9, color: '#484f58' }}>{axis}</label>
                    <input
                      type="number"
                      step={0.1}
                      value={customDir[idx]}
                      onChange={e => {
                        const v = [...customDir] as [number, number, number];
                        v[idx] = Number(e.target.value);
                        setCustomDir(v);
                      }}
                      style={{
                        width: '100%', padding: '3px 6px', borderRadius: 4,
                        border: `1px solid ${C.border}`, background: '#0d1117',
                        color: C.text, fontSize: 11, fontFamily: 'monospace',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Process selector */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>
              {t.lblProcess}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {PROCESS_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setProcess(opt.key)}
                  style={{
                    flex: 1, padding: '4px 6px', borderRadius: 4,
                    border: 'none', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    background: process === opt.key ? C.accent : C.card,
                    color: process === opt.key ? '#fff' : C.textDim,
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Infill (FDM only) */}
          {process === 'fdm' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  {t.lblInfill}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                  {infillPercent}%
                </span>
              </div>
              <input
                type="range"
                min={0} max={100} step={5}
                value={infillPercent}
                onChange={e => setInfillPercent(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.accent }}
              />
            </div>
          )}

          {/* Print speed */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {t.lblPrintSpeed}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {printSpeed} mm/s
              </span>
            </div>
            <input
              type="range"
              min={20} max={150} step={5}
              value={printSpeed}
              onChange={e => setPrintSpeed(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Min wall thickness */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {t.lblMinWall}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                {minWallThickness} mm
              </span>
            </div>
            <input
              type="range"
              min={0.4} max={2.0} step={0.1}
              value={minWallThickness}
              onChange={e => setMinWallThickness(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: 'none', background: C.accent, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            ▶ {t.btnAnalyze}
          </button>

          {/* Auto-orient button */}
          {onOptimizeOrientation && (
            <button
              data-tour="auto-orient-btn"
              onClick={() => onOptimizeOrientation(overhangAngle, getBuildDirection())}
              style={{
                width: '100%', marginTop: 6, padding: '7px 12px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card, color: C.text,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text; }}
            >
              🧭 {t.btnAutoOrient}
            </button>
          )}
        </div>

        {/* ── Orientation optimization result ── */}
        {optimization && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
              {t.secOrientation}
            </div>
            {(() => {
              const best = optimization.candidates[optimization.bestIndex];
              const cur  = optimization.candidates[optimization.currentIndex];
              const isAlready = optimization.bestIndex === optimization.currentIndex;
              const supportDelta = cur.supportArea - best.supportArea;
              const pct = cur.supportArea > 0
                ? Math.round((supportDelta / cur.supportArea) * 100)
                : 0;
              return (
                <div style={{
                  padding: 10, background: C.card, borderRadius: 6,
                  border: `1px solid ${isAlready ? C.green : C.accent}`,
                  marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isAlready ? C.green : C.accent }}>
                      {isAlready ? t.alreadyOptimal : t.tryLabel(best.label)}
                    </span>
                    <span style={{ fontSize: 10, color: C.textDim, fontFamily: 'monospace' }}>
                      {best.label}
                    </span>
                  </div>
                  {!isAlready && (
                    <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
                      {t.supportDelta(pct, cur.supportArea.toFixed(0), best.supportArea.toFixed(0))}
                    </div>
                  )}
                  {!isAlready && onApplyOptimalOrientation && (
                    <button
                      onClick={() => onApplyOptimalOrientation(best.buildDirection)}
                      style={{
                        width: '100%', padding: '5px 8px', borderRadius: 4,
                        border: 'none', background: C.accent, color: '#fff',
                        fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      {t.btnReanalyze}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* All 6 candidates ranked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[...optimization.candidates]
                .map((c, idx) => ({ c, idx }))
                .sort((a, b) => a.c.score - b.c.score)
                .map(({ c, idx }, rank) => {
                  const isBest = idx === optimization.bestIndex;
                  const isCur  = idx === optimization.currentIndex;
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px', borderRadius: 4,
                      background: isBest ? '#1f2937' : 'transparent',
                      border: `1px solid ${isBest ? C.accent : 'transparent'}`,
                    }}>
                      <span style={{ fontSize: 9, color: C.textDim, width: 14, fontFamily: 'monospace' }}>
                        #{rank + 1}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.text, width: 22, fontFamily: 'monospace' }}>
                        {c.label}
                      </span>
                      <span style={{ fontSize: 9, color: C.textDim, flex: 1, fontFamily: 'monospace' }}>
                        {c.supportArea.toFixed(0)} mm²
                      </span>
                      {isCur && (
                        <span style={{ fontSize: 8, color: C.yellow, fontWeight: 700 }}>
                          {t.lblNow}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {analysis && (
          <>
            {/* Summary stats */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {t.secResults}
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
              }}>
                {[
                  {
                    label: t.statLayers,
                    value: analysis.layerCount.toLocaleString(),
                    icon: '📊',
                  },
                  {
                    label: t.statTime,
                    value: analysis.printTime < 60
                      ? `${analysis.printTime.toFixed(0)} min`
                      : `${(analysis.printTime / 60).toFixed(1)} hr`,
                    icon: '⏱',
                  },
                  {
                    label: t.statMaterial,
                    value: `${analysis.materialUsage.toFixed(2)} cm³`,
                    icon: '🧱',
                  },
                  {
                    label: t.statSupport,
                    value: `${analysis.supportVolume.toFixed(2)} cm³`,
                    icon: '🏗',
                  },
                  {
                    label: t.statHeight,
                    value: `${analysis.buildHeight.toFixed(1)} mm`,
                    icon: '📐',
                  },
                  {
                    label: t.statOverhangFaces,
                    value: analysis.overhangFaces.length.toLocaleString(),
                    icon: '⚠',
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                      {stat.icon} {stat.label}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text, fontFamily: 'monospace' }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Printability score */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {t.secPrintability}
              </div>
              {(() => {
                const errors = analysis.issues.filter(i => i.severity === 'error').length;
                const warnings = analysis.issues.filter(i => i.severity === 'warning').length;
                const score = Math.max(0, 100 - errors * 30 - warnings * 10);
                const barColor = score >= 70 ? C.green : score >= 40 ? C.yellow : C.red;
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: barColor }}>{score}/100</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>
                        {score >= 70
                          ? t.rateGood
                          : score >= 40
                            ? t.rateAttention
                            : t.rateIssues
                        }
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#0d1117', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${score}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Cost breakdown */}
            {analysis.costBreakdown && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                  💰 {t.secCost}
                  <span style={{ marginLeft: 6, fontSize: 9, color: '#484f58', textTransform: 'none' }}>
                    ±{analysis.costBreakdown.confidencePct}%
                  </span>
                </div>
                <div style={{
                  padding: 12, background: C.card, borderRadius: 8,
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: C.textDim }}>
                      {t.costTotal}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: C.green, fontFamily: 'monospace' }}>
                      ${analysis.costBreakdown.totalCost.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ height: 1, background: C.border, marginBottom: 8 }} />
                  {[
                    {
                      label: t.costMaterial,
                      value: `$${analysis.costBreakdown.materialCost.toFixed(2)}`,
                      sub: `${analysis.costBreakdown.materialWeight.toFixed(1)} g`,
                    },
                    {
                      label: t.costMachine,
                      value: `$${analysis.costBreakdown.machineCost.toFixed(2)}`,
                      sub: analysis.printTime < 60
                        ? `${analysis.printTime.toFixed(0)} min`
                        : `${(analysis.printTime / 60).toFixed(1)} hr`,
                    },
                    {
                      label: t.costEffectiveVol,
                      value: `${analysis.costBreakdown.effectiveVolume.toFixed(2)} cm³`,
                      sub: t.solidPrefix(analysis.costBreakdown.meshVolume.toFixed(2)),
                    },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 0',
                    }}>
                      <span style={{ fontSize: 10, color: C.textDim }}>{row.label}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                          {row.value}
                        </span>
                        <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
                          {row.sub}
                        </span>
                      </span>
                    </div>
                  ))}
                  {analysis.process && (
                    <div style={{
                      marginTop: 8, paddingTop: 6,
                      borderTop: `1px solid ${C.border}`,
                      fontSize: 9, color: '#484f58',
                    }}>
                      {t.lblProcessInline}
                      <span style={{ color: C.textDim, fontWeight: 700 }}>
                        {analysis.process.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Send to slicer */}
                {onExportPrintReady && (
                  <button
                    data-tour="export-slicer-btn"
                    onClick={() => onExportPrintReady({
                      process,
                      layerHeight,
                      infillPercent,
                      printSpeed,
                      buildDirection: getBuildDirection(),
                    })}
                    style={{
                      width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 6,
                      border: 'none',
                      background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      transition: 'opacity 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  >
                    📥 {t.btnSendSlicer}
                  </button>
                )}
              </div>
            )}

            {/* Issues */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                {t.secIssues} ({analysis.issues.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {analysis.issues.map((issue, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', background: C.card, borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${severityColor(issue.severity)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13 }}>{typeIcon(issue.type)}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        color: severityColor(issue.severity),
                      }}>
                        {issue.severity === 'error' ? t.sevError : t.sevWarn}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: C.text }}>
                        {typeLabel(issue.type)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>
                      {issue.description}
                    </div>
                    {issue.faceIndices && (
                      <div style={{ fontSize: 9, color: '#484f58', marginTop: 3, fontFamily: 'monospace' }}>
                        {issue.faceIndices.length} {t.facesAffected}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div style={{ marginTop: 16, padding: '10px', background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {t.secLegend}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { color: '#26bf4e', label: t.legSafe },
                  { color: '#d4c026', label: t.legModerate },
                  { color: '#f0883e', label: t.legHigh },
                  { color: '#f85149', label: t.legDanger },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.textDim }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!analysis && (
          <div style={{
            textAlign: 'center', padding: '30px 10px', color: '#484f58',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🖨</div>
            <div style={{ fontSize: 11 }}>
              {t.emptyHint}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
