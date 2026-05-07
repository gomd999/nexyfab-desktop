'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { DFMResult, ManufacturingProcess, DFMIssue } from './dfmAnalysis';
import type { DFMExplanation, CostDelta } from './dfmExplainer';

/* ─── i18n dictionary ────────────────────────────────────────────────────── */

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    headerTitle: '제조 가능성 분석 (DFM)',
    featureBasedTitle: '피처 기반 공정 적합도 추천',
    featureBasedHint: '아래에서 공정 선택 후 분석 실행 시 정밀 검증',
    selectProcesses: '공정 선택',
    settings: '설정',
    minWallThickness: '최소 벽 두께',
    minDraftAngle: '최소 구배 각도',
    maxAspectRatio: '최대 종횡비',
    runAnalysis: '분석 실행',
    recommendedProcess: '공정 추천',
    score: '점수',
    processRanking: '공정 비교',
    scoreDiff: '점수 / 차이',
    feasible: '가능',
    notFeasible: '불가',
    errorsSuffix: '오류',
    warningsSuffix: '경고',
    infoSuffix: '정보',
    noIssues: '이슈 없음',
    fixBtn: '수정',
    aiAnalysisTitle: 'AI 분석',
    analyzing: '분석 중…',
    rootCause: '근본 원인',
    processImpact: '공정 영향',
    alternatives: '대안 전략',
    applyFix: '적용',
    facesAffected: '면 영향',
    jumpToFeature: '관련 피처로 이동',
    featureBtn: '피처',
    highlightBtn: '강조',
    colorLegend: '색상 범례',
    legendNoIssues: '이슈 없음',
    legendWarning: '경고',
    legendError: '오류 / 문제',
    legendSelected: '선택된 이슈',
    emptyPrompt: '공정을 선택하고 "분석 실행"을 클릭하세요',
    proRequired: 'Pro 플랜 필요',
  },
  en: {
    headerTitle: 'DFM Analysis',
    featureBasedTitle: 'Feature-Based Process Recommendation',
    featureBasedHint: 'Select processes below and run analysis for detailed validation',
    selectProcesses: 'Select Processes',
    settings: 'Settings',
    minWallThickness: 'Min Wall Thickness',
    minDraftAngle: 'Min Draft Angle',
    maxAspectRatio: 'Max Aspect Ratio',
    runAnalysis: 'Run DFM Analysis',
    recommendedProcess: 'Recommended Process',
    score: 'Score',
    processRanking: 'Process Ranking',
    scoreDiff: 'score / diff',
    feasible: 'FEASIBLE',
    notFeasible: 'NOT FEASIBLE',
    errorsSuffix: 'errors',
    warningsSuffix: 'warnings',
    infoSuffix: 'info',
    noIssues: 'No issues',
    fixBtn: 'Fix',
    aiAnalysisTitle: 'AI Analysis',
    analyzing: 'analyzing…',
    rootCause: 'Root cause',
    processImpact: 'Process impact',
    alternatives: 'Alternatives',
    applyFix: 'Apply',
    facesAffected: 'faces',
    jumpToFeature: 'Jump to related feature',
    featureBtn: 'Feature',
    highlightBtn: 'Highlight',
    colorLegend: 'Color Legend',
    legendNoIssues: 'No issues',
    legendWarning: 'Warning',
    legendError: 'Error / Problem',
    legendSelected: 'Selected issue',
    emptyPrompt: 'Select processes and click "Run DFM Analysis"',
    proRequired: 'Pro plan required',
  },
  ja: {
    headerTitle: 'DFM分析',
    featureBasedTitle: 'フィーチャーベースの工程推奨',
    featureBasedHint: '以下の工程を選択し、分析を実行して詳細検証',
    selectProcesses: '工程選択',
    settings: '設定',
    minWallThickness: '最小肉厚',
    minDraftAngle: '最小抜き勾配',
    maxAspectRatio: '最大アスペクト比',
    runAnalysis: 'DFM分析実行',
    recommendedProcess: '推奨工程',
    score: 'スコア',
    processRanking: '工程ランキング',
    scoreDiff: 'スコア / 差',
    feasible: '可能',
    notFeasible: '不可',
    errorsSuffix: 'エラー',
    warningsSuffix: '警告',
    infoSuffix: '情報',
    noIssues: '問題なし',
    fixBtn: '修正',
    aiAnalysisTitle: 'AI分析',
    analyzing: '分析中…',
    rootCause: '根本原因',
    processImpact: '工程への影響',
    alternatives: '代替案',
    applyFix: '適用',
    facesAffected: '面に影響',
    jumpToFeature: '関連フィーチャーへ移動',
    featureBtn: 'フィーチャー',
    highlightBtn: 'ハイライト',
    colorLegend: '色凡例',
    legendNoIssues: '問題なし',
    legendWarning: '警告',
    legendError: 'エラー / 問題',
    legendSelected: '選択した問題',
    emptyPrompt: '工程を選択して「DFM分析実行」をクリック',
    proRequired: 'Proプランが必要',
  },
  zh: {
    headerTitle: 'DFM可制造性分析',
    featureBasedTitle: '基于特征的工艺推荐',
    featureBasedHint: '选择下方工艺并运行分析进行详细验证',
    selectProcesses: '选择工艺',
    settings: '设置',
    minWallThickness: '最小壁厚',
    minDraftAngle: '最小拔模角度',
    maxAspectRatio: '最大长宽比',
    runAnalysis: '运行DFM分析',
    recommendedProcess: '推荐工艺',
    score: '评分',
    processRanking: '工艺比较',
    scoreDiff: '评分 / 差值',
    feasible: '可行',
    notFeasible: '不可行',
    errorsSuffix: '错误',
    warningsSuffix: '警告',
    infoSuffix: '信息',
    noIssues: '无问题',
    fixBtn: '修复',
    aiAnalysisTitle: 'AI分析',
    analyzing: '分析中…',
    rootCause: '根本原因',
    processImpact: '工艺影响',
    alternatives: '替代方案',
    applyFix: '应用',
    facesAffected: '面受影响',
    jumpToFeature: '跳转到相关特征',
    featureBtn: '特征',
    highlightBtn: '高亮',
    colorLegend: '颜色图例',
    legendNoIssues: '无问题',
    legendWarning: '警告',
    legendError: '错误 / 问题',
    legendSelected: '选中的问题',
    emptyPrompt: '选择工艺并点击"运行DFM分析"',
    proRequired: '需要Pro计划',
  },
  es: {
    headerTitle: 'Análisis DFM',
    featureBasedTitle: 'Recomendación de proceso basada en features',
    featureBasedHint: 'Selecciona procesos abajo y ejecuta el análisis para validación detallada',
    selectProcesses: 'Seleccionar procesos',
    settings: 'Configuración',
    minWallThickness: 'Grosor mínimo de pared',
    minDraftAngle: 'Ángulo mínimo de desmoldeo',
    maxAspectRatio: 'Relación de aspecto máxima',
    runAnalysis: 'Ejecutar análisis DFM',
    recommendedProcess: 'Proceso recomendado',
    score: 'Puntuación',
    processRanking: 'Ranking de procesos',
    scoreDiff: 'puntos / dif',
    feasible: 'FACTIBLE',
    notFeasible: 'NO FACTIBLE',
    errorsSuffix: 'errores',
    warningsSuffix: 'advertencias',
    infoSuffix: 'info',
    noIssues: 'Sin problemas',
    fixBtn: 'Corregir',
    aiAnalysisTitle: 'Análisis IA',
    analyzing: 'analizando…',
    rootCause: 'Causa raíz',
    processImpact: 'Impacto en el proceso',
    alternatives: 'Alternativas',
    applyFix: 'Aplicar',
    facesAffected: 'caras',
    jumpToFeature: 'Ir al feature relacionado',
    featureBtn: 'Feature',
    highlightBtn: 'Resaltar',
    colorLegend: 'Leyenda de colores',
    legendNoIssues: 'Sin problemas',
    legendWarning: 'Advertencia',
    legendError: 'Error / Problema',
    legendSelected: 'Problema seleccionado',
    emptyPrompt: 'Selecciona procesos y haz clic en "Ejecutar análisis DFM"',
    proRequired: 'Plan Pro requerido',
  },
  ar: {
    headerTitle: 'تحليل قابلية التصنيع (DFM)',
    featureBasedTitle: 'توصية العملية على أساس الميزة',
    featureBasedHint: 'اختر العمليات أدناه وشغّل التحليل للتحقق التفصيلي',
    selectProcesses: 'اختر العمليات',
    settings: 'الإعدادات',
    minWallThickness: 'أدنى سمك جدار',
    minDraftAngle: 'أدنى زاوية سحب',
    maxAspectRatio: 'أقصى نسبة عرض',
    runAnalysis: 'تشغيل تحليل DFM',
    recommendedProcess: 'العملية الموصى بها',
    score: 'النتيجة',
    processRanking: 'ترتيب العمليات',
    scoreDiff: 'نتيجة / فرق',
    feasible: 'ممكن',
    notFeasible: 'غير ممكن',
    errorsSuffix: 'أخطاء',
    warningsSuffix: 'تحذيرات',
    infoSuffix: 'معلومات',
    noIssues: 'لا توجد مشاكل',
    fixBtn: 'إصلاح',
    aiAnalysisTitle: 'تحليل الذكاء الاصطناعي',
    analyzing: 'يحلل…',
    rootCause: 'السبب الجذري',
    processImpact: 'تأثير العملية',
    alternatives: 'البدائل',
    applyFix: 'تطبيق',
    facesAffected: 'أوجه متأثرة',
    jumpToFeature: 'الانتقال إلى الميزة ذات الصلة',
    featureBtn: 'ميزة',
    highlightBtn: 'تمييز',
    colorLegend: 'مفتاح الألوان',
    legendNoIssues: 'لا توجد مشاكل',
    legendWarning: 'تحذير',
    legendError: 'خطأ / مشكلة',
    legendSelected: 'المشكلة المحددة',
    emptyPrompt: 'اختر العمليات وانقر على "تشغيل تحليل DFM"',
    proRequired: 'خطة Pro مطلوبة',
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
  purple: '#a371f7',
};

/* ─── Process labels ─────────────────────────────────────────────────────── */

const PROCESS_META: Record<ManufacturingProcess, { icon: string; label: Record<Lang, string> }> = {
  cnc_milling: { icon: '🏭', label: { ko: 'CNC 밀링', en: 'CNC Milling', ja: 'CNCフライス', zh: 'CNC铣削', es: 'Fresado CNC', ar: 'طحن CNC' } },
  cnc_turning: { icon: '🔩', label: { ko: 'CNC 선반', en: 'CNC Turning', ja: 'CNC旋盤', zh: 'CNC车削', es: 'Torneado CNC', ar: 'خراطة CNC' } },
  injection_molding: { icon: '💉', label: { ko: '사출 성형', en: 'Injection Molding', ja: '射出成形', zh: '注塑成型', es: 'Moldeo por inyección', ar: 'قولبة بالحقن' } },
  sheet_metal: { icon: '📄', label: { ko: '판금 가공', en: 'Sheet Metal', ja: '板金加工', zh: '钣金加工', es: 'Chapa metálica', ar: 'الصاج المعدني' } },
  casting: { icon: '🫗', label: { ko: '주조', en: 'Casting', ja: '鋳造', zh: '铸造', es: 'Fundición', ar: 'السباكة' } },
  '3d_printing': { icon: '🖨️', label: { ko: '3D 프린팅', en: '3D Printing', ja: '3Dプリンティング', zh: '3D打印', es: 'Impresión 3D', ar: 'طباعة ثلاثية الأبعاد' } },
};

const ALL_PROCESSES: ManufacturingProcess[] = ['cnc_milling', 'cnc_turning', 'injection_molding', 'sheet_metal', 'casting', '3d_printing'];

const SEVERITY_COLOR: Record<string, string> = { error: C.red, warning: C.yellow, info: C.accent };
const SEVERITY_LABEL_EN: Record<string, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };
const SEVERITY_LABEL_KO: Record<string, string> = { error: '오류', warning: '경고', info: '정보' };
const SEVERITY_LABEL_JA: Record<string, string> = { error: 'エラー', warning: '警告', info: '情報' };
const SEVERITY_LABEL_ZH: Record<string, string> = { error: '错误', warning: '警告', info: '信息' };
const SEVERITY_LABEL_ES: Record<string, string> = { error: 'ERROR', warning: 'AVISO', info: 'INFO' };
const SEVERITY_LABEL_AR: Record<string, string> = { error: 'خطأ', warning: 'تحذير', info: 'معلومات' };

const SEVERITY_LABEL: Record<Lang, Record<string, string>> = {
  ko: SEVERITY_LABEL_KO, en: SEVERITY_LABEL_EN, ja: SEVERITY_LABEL_JA,
  zh: SEVERITY_LABEL_ZH, es: SEVERITY_LABEL_ES, ar: SEVERITY_LABEL_AR,
};

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: C.green, moderate: C.yellow, difficult: C.orange, infeasible: C.red,
};
const DIFFICULTY_LABEL_EN: Record<string, string> = {
  easy: 'Easy', moderate: 'Moderate', difficult: 'Difficult', infeasible: 'Infeasible',
};
const DIFFICULTY_LABEL_KO: Record<string, string> = {
  easy: '용이', moderate: '보통', difficult: '어려움', infeasible: '불가',
};
const DIFFICULTY_LABEL_JA: Record<string, string> = {
  easy: '容易', moderate: '普通', difficult: '難しい', infeasible: '不可',
};
const DIFFICULTY_LABEL_ZH: Record<string, string> = {
  easy: '容易', moderate: '中等', difficult: '困难', infeasible: '不可行',
};
const DIFFICULTY_LABEL_ES: Record<string, string> = {
  easy: 'Fácil', moderate: 'Moderado', difficult: 'Difícil', infeasible: 'Inviable',
};
const DIFFICULTY_LABEL_AR: Record<string, string> = {
  easy: 'سهل', moderate: 'متوسط', difficult: 'صعب', infeasible: 'غير ممكن',
};

const DIFFICULTY_LABEL: Record<Lang, Record<string, string>> = {
  ko: DIFFICULTY_LABEL_KO, en: DIFFICULTY_LABEL_EN, ja: DIFFICULTY_LABEL_JA,
  zh: DIFFICULTY_LABEL_ZH, es: DIFFICULTY_LABEL_ES, ar: DIFFICULTY_LABEL_AR,
};

const TYPE_ICON: Record<string, string> = {
  undercut: '⬇', thin_wall: '📏', deep_pocket: '🕳', sharp_corner: '📐',
  draft_angle: '📏', uniform_wall: '▬', tool_access: '🔧', aspect_ratio: '↕',
  overhang: '⌒', bridge: '⌢', support_volume: '📦',
};

/* ─── Fix suggestion map ─────────────────────────────────────────────────── */

interface FixSuggestion {
  paramKey: string;
  label: Record<Lang, string>;
  value: number;
  unit: string;
  description: Record<Lang, string>;
}

const FIX_SUGGESTIONS: Partial<Record<DFMIssue['type'], FixSuggestion>> = {
  sharp_corner: {
    paramKey: 'filletRadius',
    label: {
      ko: '필렛 반경 추가',
      en: 'Add fillet radius',
      ja: 'フィレット半径を追加',
      zh: '添加圆角半径',
      es: 'Añadir radio de fillet',
      ar: 'إضافة نصف قطر Fillet',
    },
    value: 0.5,
    unit: 'mm',
    description: {
      ko: 'R0.5mm 필렛을 적용하면 응력 집중이 줄고 공구 수명이 늘어납니다.',
      en: 'R0.5mm fillet reduces stress concentration and extends tool life.',
      ja: 'R0.5mmのフィレットは応力集中を減らし、工具寿命を延ばします。',
      zh: 'R0.5mm圆角可减少应力集中并延长刀具寿命。',
      es: 'Un fillet R0.5mm reduce la concentración de esfuerzo y alarga la vida útil de la herramienta.',
      ar: 'يقلل Fillet بقطر R0.5mm من تركز الإجهاد ويطيل عمر الأداة.',
    },
  },
  thin_wall: {
    paramKey: 'wallThickness',
    label: {
      ko: '벽 두께 증가',
      en: 'Increase wall thickness',
      ja: '壁厚を増やす',
      zh: '增加壁厚',
      es: 'Aumentar grosor de pared',
      ar: 'زيادة سمك الجدار',
    },
    value: 1.2,
    unit: 'mm',
    description: {
      ko: '최소 1.2mm 벽 두께를 권장합니다. 변형 및 파손을 방지합니다.',
      en: 'Minimum 1.2mm wall thickness is recommended to prevent warping.',
      ja: '最小1.2mmの壁厚を推奨します。変形や破損を防ぎます。',
      zh: '建议最小壁厚1.2mm,以防止翘曲和破损。',
      es: 'Se recomienda un grosor mínimo de pared de 1.2mm para evitar deformación.',
      ar: 'يوصى بسمك جدار أدنى 1.2mm لمنع الالتواء.',
    },
  },
  draft_angle: {
    paramKey: 'draftAngle',
    label: {
      ko: '구배 각도 추가',
      en: 'Add draft angle',
      ja: '抜き勾配を追加',
      zh: '添加拔模角度',
      es: 'Añadir ángulo de desmoldeo',
      ar: 'إضافة زاوية سحب',
    },
    value: 1.5,
    unit: '°',
    description: {
      ko: '1.5° 구배각을 추가하면 금형에서 부품을 쉽게 빼낼 수 있습니다.',
      en: '1.5° draft angle ensures easy ejection from the mold.',
      ja: '1.5°の抜き勾配で金型から簡単に取り出せます。',
      zh: '1.5°拔模角度可确保从模具中轻松脱模。',
      es: 'Un ángulo de 1.5° asegura una expulsión fácil del molde.',
      ar: 'زاوية سحب 1.5° تضمن سهولة الإخراج من القالب.',
    },
  },
  deep_pocket: {
    paramKey: 'pocketDepthRatio',
    label: {
      ko: '포켓 깊이 줄이기',
      en: 'Reduce pocket depth',
      ja: 'ポケット深さを減らす',
      zh: '减小凹槽深度',
      es: 'Reducir profundidad del bolsillo',
      ar: 'تقليل عمق الجيب',
    },
    value: 3.0,
    unit: ':1 max ratio',
    description: {
      ko: '깊이:폭 비율을 3:1 이하로 줄이면 공구 접근성이 개선됩니다.',
      en: 'Keep depth:width ratio ≤3:1 to improve tool accessibility.',
      ja: '深さ:幅比を3:1以下にすると工具のアクセス性が向上します。',
      zh: '将深宽比保持在3:1以下可改善刀具可达性。',
      es: 'Mantén la relación profundidad:ancho ≤3:1 para mejorar el acceso de la herramienta.',
      ar: 'حافظ على نسبة العمق:العرض ≤3:1 لتحسين وصول الأداة.',
    },
  },
  undercut: {
    paramKey: 'undercutRelief',
    label: {
      ko: '언더컷 제거',
      en: 'Remove undercut',
      ja: 'undercutを除去',
      zh: '移除undercut',
      es: 'Eliminar undercut',
      ar: 'إزالة undercut',
    },
    value: 0,
    unit: '',
    description: {
      ko: '슬라이드 코어 추가 또는 형상 재설계로 언더컷을 제거하세요.',
      en: 'Redesign to eliminate undercut or add slide core to the mold.',
      ja: 'スライドコアの追加または形状の再設計でundercutを除去してください。',
      zh: '通过添加滑块型芯或重新设计形状来消除undercut。',
      es: 'Rediseña para eliminar el undercut o añade un slide core al molde.',
      ar: 'أعد التصميم لإزالة undercut أو أضف slide core للقالب.',
    },
  },
  uniform_wall: {
    paramKey: 'wallThickness',
    label: {
      ko: '벽 두께 기준 맞추기',
      en: 'Align wall thickness',
      ja: '壁厚基準を揃える',
      zh: '对齐壁厚基准',
      es: 'Alinear grosor de pared',
      ar: 'مواءمة سمك الجدار',
    },
    value: 2.5,
    unit: 'mm',
    description: {
      ko: '벽 두께 편차를 줄이려면 목표 두께를 2.5mm 이상으로 맞추는 것이 안전합니다.',
      en: 'Target ≥2.5mm wall thickness to reduce thickness variation risk.',
      ja: '壁厚のばらつきを減らすには2.5mm以上を目安にします。',
      zh: '建议壁厚≥2.5mm以降低壁厚不均风险。',
      es: 'Objetivo ≥2.5mm de pared para reducir variación.',
      ar: 'استهدف ≥2.5mm لتقليل تباين سمك الجدار.',
    },
  },
  tool_access: {
    paramKey: 'filletRadius',
    label: {
      ko: '내부 코너 완화',
      en: 'Relief internal corners',
      ja: '内コーナー逃げ',
      zh: '内角避空',
      es: 'Alivio en esquinas internas',
      ar: 'تخفيف الزوايا الداخلية',
    },
    value: 1.0,
    unit: 'mm',
    description: {
      ko: 'R1mm급 내부 필렛으로 공구 도달성과 가공 안정성을 높입니다.',
      en: '~R1mm internal fillet improves tool reach and stability.',
      ja: '約R1mmの内フィレットで工具の達成性を改善します。',
      zh: '约R1mm内圆角改善刀具可达性。',
      es: 'Fillet interno ~R1mm mejora el acceso de herramienta.',
      ar: 'نصف قطر داخلي ~R1mm يحسن وصول الأداة.',
    },
  },
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface DFMPanelProps {
  results: DFMResult[] | null;
  onAnalyze: (processes: ManufacturingProcess[], options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number }) => void;
  onClose: () => void;
  onHighlightIssue?: (issue: DFMIssue | null) => void;
  onApplyFix?: (issueType: DFMIssue['type'], suggestion: FixSuggestion) => void;
  /** Optional: jump to & highlight the most-related feature in the FeatureTree. */
  onJumpToFeature?: (issueType: DFMIssue['type']) => void;
  /** AI DFM Explainer — parent fetches (handles freemium gate); returns null if blocked. */
  onExplainIssue?: (issue: DFMIssue) => Promise<DFMExplanation | null>;
  /** Local cost-delta preview for a parameter hint (e.g. thickness +1mm). */
  onPreviewCostDelta?: (hint: { key: string; delta: number }) => CostDelta | null;
  isKo: boolean;
  /** Feature-type-based process recommendations (from useProcessRecommendation) */
  processRecommendations?: Array<{ process: ManufacturingProcess; confidence: number; reasons: string[]; emoji: string }>;
}

export default function DFMPanel({ results, onAnalyze, onClose, onHighlightIssue, onApplyFix, onJumpToFeature, onExplainIssue, onPreviewCostDelta, isKo: _isKo, processRecommendations }: DFMPanelProps) {
  // `isKo` prop is accepted for backwards compat but lang is resolved from URL
  void _isKo;
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const lang: Lang = langMap[seg] ?? 'en';
  const t = dict[lang];
  const [activeFixId, setActiveFixId] = useState<string | null>(null);
  // AI explainer state — keyed by issue.id
  const [explanations, setExplanations] = useState<Record<string, DFMExplanation>>({});
  const [explainLoading, setExplainLoading] = useState<Record<string, boolean>>({});
  const [explainError, setExplainError] = useState<Record<string, string>>({});
  const [expandedExplainId, setExpandedExplainId] = useState<string | null>(null);

  const requestExplain = async (issue: DFMIssue) => {
    const id = issue.id;
    if (explainLoading[id]) return;
    setExpandedExplainId(id);
    if (explanations[id]) return; // already fetched
    if (!onExplainIssue) return;
    setExplainLoading(prev => ({ ...prev, [id]: true }));
    setExplainError(prev => ({ ...prev, [id]: '' }));
    try {
      const exp = await onExplainIssue(issue);
      if (exp) setExplanations(prev => ({ ...prev, [id]: exp }));
      else setExplainError(prev => ({ ...prev, [id]: t.proRequired }));
    } catch (err) {
      setExplainError(prev => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setExplainLoading(prev => ({ ...prev, [id]: false }));
    }
  };
  const [selectedProcesses, setSelectedProcesses] = useState<Set<ManufacturingProcess>>(
    new Set(['cnc_milling', 'injection_molding']),
  );
  const [minWall, setMinWall] = useState(1.0);
  const [minDraft, setMinDraft] = useState(1.0);
  const [maxAR, setMaxAR] = useState(4.0);
  const [expandedProcess, setExpandedProcess] = useState<ManufacturingProcess | null>(null);
  const [expandedSeverity, setExpandedSeverity] = useState<Record<string, boolean>>({});

  const toggleProcess = (p: ManufacturingProcess) => {
    setSelectedProcesses(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const handleAnalyze = () => {
    if (selectedProcesses.size === 0) return;
    onAnalyze([...selectedProcesses], { minWallThickness: minWall, minDraftAngle: minDraft, maxAspectRatio: maxAR });
  };

  // Find best recommended process
  const bestProcess = results
    ? results.reduce((best, r) => (!best || r.score > best.score) ? r : best, null as DFMResult | null)
    : null;

  // Mobile-aware width: full-width drawer on small viewports
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return (
    <div style={{
      width: isMobile ? '100vw' : 320,
      maxWidth: '100vw',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
      ...(isMobile ? { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 600 } : {}),
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          {t.headerTitle}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>

        {/* ── Feature-based Process Recommendation (pre-analysis) ── */}
        {processRecommendations && processRecommendations.length > 0 && !results && (
          <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: 'rgba(56,139,253,0.06)', border: '1px solid rgba(56,139,253,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 10, color: '#388bfd', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.featureBasedTitle}
            </div>
            {processRecommendations.slice(0, 3).map((rec) => (
              <div key={rec.process} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{rec.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9' }}>
                      {PROCESS_META[rec.process].label[lang]}
                    </span>
                    <span style={{ fontSize: 10, color: rec.confidence >= 80 ? '#3fb950' : rec.confidence >= 50 ? '#f0883e' : '#8b949e' }}>
                      {rec.confidence}%
                    </span>
                  </div>
                  {rec.reasons.length > 0 && (
                    <div style={{ fontSize: 9, color: '#8b949e', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.reasons[0]}
                    </div>
                  )}
                </div>
                {/* Confidence bar */}
                <div style={{ width: 48, height: 4, borderRadius: 2, background: '#21262d', flexShrink: 0 }}>
                  <div style={{ width: `${rec.confidence}%`, height: '100%', borderRadius: 2, background: rec.confidence >= 80 ? '#3fb950' : rec.confidence >= 50 ? '#f0883e' : '#8b949e', transition: 'width 0.3s' }} />
                </div>
              </div>
            ))}
            <div style={{ fontSize: 9, color: '#6e7681', marginTop: 6 }}>
              {t.featureBasedHint}
            </div>
          </div>
        )}

        {/* ── Process Selection ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {t.selectProcesses}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ALL_PROCESSES.map(p => {
              const meta = PROCESS_META[p];
              const checked = selectedProcesses.has(p);
              return (
                <label key={p} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: checked ? 'rgba(56,139,253,0.1)' : 'transparent',
                  border: `1px solid ${checked ? C.accent : C.border}`,
                  transition: 'all 0.12s',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProcess(p)}
                    style={{ accentColor: C.accent }}
                  />
                  <span style={{ fontSize: 15 }}>{meta.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{meta.label[lang]}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Settings ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {t.settings}
          </div>

          {/* Min wall thickness */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{t.minWallThickness}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{minWall} mm</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.1} value={minWall}
              onChange={e => setMinWall(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Min draft angle */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{t.minDraftAngle}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{minDraft}°</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.5} value={minDraft}
              onChange={e => setMinDraft(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Max aspect ratio */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>{t.maxAspectRatio}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>{maxAR}:1</span>
            </div>
            <input type="range" min={2} max={10} step={0.5} value={maxAR}
              onChange={e => setMaxAR(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }} />
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            disabled={selectedProcesses.size === 0}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: 'none', background: selectedProcesses.size > 0 ? C.accent : '#484f58',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: selectedProcesses.size > 0 ? 'pointer' : 'default',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => { if (selectedProcesses.size > 0) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            {t.runAnalysis}
          </button>
        </div>

        {/* ── Results ── */}
        {results && results.length > 0 && (
          <>
            {/* Best process recommendation */}
            {bestProcess && (
              <div style={{
                marginBottom: 16, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(63,185,80,0.08)', border: `1px solid ${C.green}`,
              }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: C.green, marginBottom: 6 }}>
                  {t.recommendedProcess}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{PROCESS_META[bestProcess.process].icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>
                      {PROCESS_META[bestProcess.process].label[lang]}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim }}>
                      {t.score}: {bestProcess.score}/100 &middot;{' '}
                      {DIFFICULTY_LABEL[lang][bestProcess.estimatedDifficulty]}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Process ranking table ── */}
            {results.length > 1 && (() => {
              const sorted = [...results].sort((a, b) => b.score - a.score);
              const topScore = sorted[0].score || 1;
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
                    {t.processRanking}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sorted.map((r, rank) => {
                      const meta = PROCESS_META[r.process];
                      const scoreColor = r.score >= 70 ? C.green : r.score >= 40 ? C.yellow : C.red;
                      const diff = rank === 0 ? null : r.score - topScore;
                      const barWidth = Math.max(6, Math.round((r.score / 100) * 100));
                      return (
                        <div key={r.process} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 8px', borderRadius: 6, background: rank === 0 ? `${C.green}0d` : C.card,
                          border: `1px solid ${rank === 0 ? C.green + '44' : C.border}`,
                        }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: C.textDim, width: 14 }}>
                            #{rank + 1}
                          </span>
                          <span style={{ fontSize: 12 }}>{meta.icon}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: C.text, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {meta.label[lang]}
                          </span>
                          <div style={{ width: 60, height: 5, background: '#0d1117', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                            <div style={{ width: `${barWidth}%`, height: '100%', background: scoreColor, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: scoreColor, width: 28, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                            {r.score}
                          </span>
                          {diff !== null && (
                            <span style={{ fontSize: 9, color: C.textDim, width: 26, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                              {diff}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 9, color: '#484f58', marginTop: 2 }}>
                    {t.scoreDiff}
                  </div>
                </div>
              );
            })()}

            {/* Per-process results */}
            {results.map(r => {
              const meta = PROCESS_META[r.process];
              const scoreColor = r.score >= 70 ? C.green : r.score >= 40 ? C.yellow : C.red;
              const isExpanded = expandedProcess === r.process;
              const errors = r.issues.filter(i => i.severity === 'error');
              const warnings = r.issues.filter(i => i.severity === 'warning');
              const infos = r.issues.filter(i => i.severity === 'info');

              return (
                <div key={r.process} style={{
                  marginBottom: 12, borderRadius: 8,
                  border: `1px solid ${C.border}`, overflow: 'hidden',
                }}>
                  {/* Process header */}
                  <button
                    onClick={() => setExpandedProcess(isExpanded ? null : r.process)}
                    style={{
                      width: '100%', padding: '10px 12px', border: 'none',
                      background: C.card, color: C.text, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>
                        {meta.label[lang]}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, fontFamily: 'monospace' }}>
                          {r.score}/100
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          background: r.feasible ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                          color: r.feasible ? C.green : C.red,
                        }}>
                          {r.feasible ? t.feasible : t.notFeasible}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                          background: `${DIFFICULTY_COLOR[r.estimatedDifficulty]}20`,
                          color: DIFFICULTY_COLOR[r.estimatedDifficulty],
                        }}>
                          {DIFFICULTY_LABEL[lang][r.estimatedDifficulty]}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: C.textDim }}>{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {/* Score gauge */}
                  <div style={{ padding: '0 12px', background: C.card }}>
                    <div style={{ height: 4, background: '#0d1117', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${r.score}%`, height: '100%',
                        background: scoreColor, borderRadius: 2,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>

                  {/* Issue summary */}
                  <div style={{
                    display: 'flex', gap: 8, padding: '6px 12px',
                    background: C.card, fontSize: 10,
                  }}>
                    {errors.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{errors.length} {t.errorsSuffix}</span>}
                    {warnings.length > 0 && <span style={{ color: C.yellow, fontWeight: 700 }}>{warnings.length} {t.warningsSuffix}</span>}
                    {infos.length > 0 && <span style={{ color: C.accent, fontWeight: 700 }}>{infos.length} {t.infoSuffix}</span>}
                    {r.issues.length === 0 && <span style={{ color: C.green, fontWeight: 700 }}>{t.noIssues}</span>}
                  </div>

                  {/* Expanded issue list */}
                  {isExpanded && (
                    <div style={{ padding: '8px 12px', background: C.bg }}>
                      {(['error', 'warning', 'info'] as const).map(sev => {
                        const sevIssues = r.issues.filter(i => i.severity === sev);
                        if (sevIssues.length === 0) return null;
                        const sevKey = `${r.process}_${sev}`;
                        const isSevExpanded = expandedSeverity[sevKey] !== false; // default expanded
                        return (
                          <div key={sev} style={{ marginBottom: 8 }}>
                            <button
                              onClick={() => setExpandedSeverity(prev => ({ ...prev, [sevKey]: !isSevExpanded }))}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'none', border: 'none', color: SEVERITY_COLOR[sev],
                                fontWeight: 700, fontSize: 10, cursor: 'pointer',
                                padding: '2px 0', textTransform: 'uppercase',
                              }}
                            >
                              {isSevExpanded ? '▼' : '▶'} {SEVERITY_LABEL[lang][sev]} ({sevIssues.length})
                            </button>
                            {isSevExpanded && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                {sevIssues.map(issue => {
                                  const fix = FIX_SUGGESTIONS[issue.type];
                                  const fixKey = `${issue.id}_fix`;
                                  const showFix = activeFixId === fixKey;
                                  return (
                                  <div key={issue.id} style={{
                                    padding: '8px 10px', background: C.card, borderRadius: 6,
                                    border: `1px solid ${C.border}`,
                                    borderLeft: `3px solid ${SEVERITY_COLOR[issue.severity]}`,
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                      <span style={{ fontSize: 13 }}>{TYPE_ICON[issue.type] ?? '•'}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: C.text, flex: 1 }}>
                                        {issue.type.replace(/_/g, ' ')}
                                      </span>
                                      {fix && (
                                        <button
                                          onClick={() => setActiveFixId(showFix ? null : fixKey)}
                                          style={{
                                            padding: '2px 7px', borderRadius: 4,
                                            border: `1px solid ${showFix ? C.green : C.border}`,
                                            background: showFix ? `${C.green}22` : 'transparent',
                                            color: showFix ? C.green : C.textDim,
                                            fontSize: 9, fontWeight: 700, cursor: 'pointer',
                                            transition: 'all 0.12s',
                                          }}
                                        >
                                          🔧 {t.fixBtn}
                                        </button>
                                      )}
                                      {onExplainIssue && (
                                        <button
                                          onClick={() => {
                                            if (expandedExplainId === issue.id) setExpandedExplainId(null);
                                            else requestExplain(issue);
                                          }}
                                          style={{
                                            padding: '2px 7px', borderRadius: 4,
                                            border: `1px solid ${expandedExplainId === issue.id ? C.purple : C.border}`,
                                            background: expandedExplainId === issue.id ? `${C.purple}22` : 'transparent',
                                            color: expandedExplainId === issue.id ? C.purple : C.textDim,
                                            fontSize: 9, fontWeight: 700, cursor: 'pointer',
                                            transition: 'all 0.12s',
                                          }}
                                        >
                                          💡 AI
                                        </button>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginBottom: 4 }}>
                                      {issue.description}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.green, lineHeight: 1.4, fontStyle: 'italic' }}>
                                      {issue.suggestion}
                                    </div>

                                    {/* AI explanation panel */}
                                    {expandedExplainId === issue.id && (
                                      <div style={{
                                        marginTop: 8, padding: '8px 10px', borderRadius: 6,
                                        background: `${C.purple}0d`, border: `1px solid ${C.purple}44`,
                                      }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                          💡 {t.aiAnalysisTitle}
                                          {explainLoading[issue.id] && <span style={{ color: C.textDim, fontWeight: 500 }}>— {t.analyzing}</span>}
                                        </div>
                                        {explainError[issue.id] && (
                                          <div style={{ fontSize: 10, color: C.red, lineHeight: 1.4 }}>
                                            {explainError[issue.id]}
                                          </div>
                                        )}
                                        {explanations[issue.id] && (() => {
                                          const exp = explanations[issue.id];
                                          return (
                                            <>
                                              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                                                <b style={{ color: C.purple }}>{t.rootCause}:</b>{' '}
                                                {lang === 'ko' ? exp.rootCauseKo : exp.rootCause}
                                              </div>
                                              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                                                <b style={{ color: C.purple }}>{t.processImpact}:</b>{' '}
                                                {lang === 'ko' ? exp.processImpactKo : exp.processImpact}
                                              </div>
                                              {exp.alternatives.length > 0 && (
                                                <div style={{ marginTop: 6 }}>
                                                  <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, textTransform: 'uppercase', marginBottom: 4 }}>
                                                    {t.alternatives}
                                                  </div>
                                                  {exp.alternatives.map((alt, i) => {
                                                    const costDelta = alt.paramHint && onPreviewCostDelta ? onPreviewCostDelta(alt.paramHint) : null;
                                                    return (
                                                      <div key={i} style={{
                                                        marginBottom: 4, padding: '6px 8px', borderRadius: 4,
                                                        background: C.card, border: `1px solid ${C.border}`,
                                                      }}>
                                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                                                          {lang === 'ko' ? alt.labelKo : alt.label}
                                                        </div>
                                                        <div style={{ fontSize: 9, color: C.textDim, lineHeight: 1.4 }}>
                                                          {lang === 'ko' ? alt.rationaleKo : alt.rationale}
                                                        </div>
                                                        {costDelta && (
                                                          <div style={{
                                                            marginTop: 4, fontSize: 9, color: costDelta.delta > 0 ? C.orange : C.green,
                                                            fontFamily: 'monospace', fontWeight: 700,
                                                          }}>
                                                            💰 {costDelta.delta > 0 ? '+' : ''}{costDelta.percentChange.toFixed(1)}% ({costDelta.currency})
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                              <div style={{ marginTop: 6, fontSize: 9, color: C.textDim, lineHeight: 1.4, fontStyle: 'italic' }}>
                                                💰 {lang === 'ko' ? exp.costNoteKo : exp.costNote}
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </div>
                                    )}

                                    {/* Fix suggestion panel */}
                                    {showFix && fix && (
                                      <div style={{
                                        marginTop: 8, padding: '8px 10px', borderRadius: 6,
                                        background: `${C.green}0d`, border: `1px solid ${C.green}44`,
                                      }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.green, marginBottom: 4 }}>
                                          {fix.label[lang]}
                                          {fix.value > 0 && (
                                            <span style={{ color: C.text, fontFamily: 'monospace', marginLeft: 6 }}>
                                              → {fix.value}{fix.unit}
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4, marginBottom: 6 }}>
                                          {fix.description[lang]}
                                        </div>
                                        <button
                                          onClick={() => {
                                            onApplyFix?.(issue.type, fix);
                                            setActiveFixId(null);
                                          }}
                                          style={{
                                            width: '100%', padding: '4px 0', borderRadius: 4,
                                            border: 'none', background: C.green,
                                            color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                                          }}
                                        >
                                          {t.applyFix}
                                        </button>
                                      </div>
                                    )}

                                    {issue.faceIndices && issue.faceIndices.length > 0 && (
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
                                        <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
                                          {issue.faceIndices.length} {t.facesAffected}
                                        </span>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          {onJumpToFeature && (
                                            <button
                                              onClick={() => onJumpToFeature(issue.type)}
                                              title={t.jumpToFeature}
                                              style={{
                                                padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`,
                                                background: 'transparent', color: '#a371f7', fontSize: 9,
                                                fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s',
                                              }}
                                              onMouseEnter={e => { e.currentTarget.style.background = '#a371f7'; e.currentTarget.style.color = '#fff'; }}
                                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a371f7'; }}
                                            >
                                              🌳 {t.featureBtn}
                                            </button>
                                          )}
                                          <button
                                            onClick={() => onHighlightIssue?.(issue)}
                                            style={{
                                              padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`,
                                              background: 'transparent', color: C.accent, fontSize: 9,
                                              fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = '#fff'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.accent; }}
                                          >
                                            {t.highlightBtn}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Color legend */}
            <div style={{ marginTop: 8, padding: '10px', background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: C.textDim, marginBottom: 6 }}>
                {t.colorLegend}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { color: C.green, label: t.legendNoIssues },
                  { color: C.yellow, label: t.legendWarning },
                  { color: C.red, label: t.legendError },
                  { color: C.accent, label: t.legendSelected },
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

        {!results && (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#484f58' }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🏭</div>
            <div style={{ fontSize: 11 }}>
              {t.emptyPrompt}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
