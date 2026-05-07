'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from './dfmAnalysis';
import { isKorean } from '@/lib/i18n/normalize';

// ─── i18n dictionary ──────────────────────────────────────────────────────────

const dict = {
  ko: {
    // Text-to-CAD panel
    t2cTitle: '텍스트 → 형상 변환',
    t2cExample: '(예: 100×50×30mm 박스)',
    t2cPlaceholder: '자연어로 형상을 설명하세요. 예) 반지름 40mm 높이 100mm 원기둥',
    confHigh: '높은 확신',
    confMedium: '보통 확신',
    confLow: '낮은 확신',
    btnApplied: '적용됨 ✓',
    btnGenerate: '형상 생성',
    shapeUnrecognized: '형상 유형을 인식하지 못했습니다. 예: 박스, 원기둥, 구체, 파이프',
    // Advisor list
    noSuggestions: 'AI 제안 사항이 없습니다. 설계가 최적화되어 있습니다!',
    advisorTitle: 'AI 제조 어드바이저',
    suggestionsCount: '가지 제안',
    btnApply: '적용',
    btnAppliedShort: '적용됨',
    // Impact labels
    impactCost12: '-12% 비용',
    impactScore15: '+15pt 점수',
    impactWeight40: '-40% 무게',
    impactCost20: '-20% 비용',
    impactCost60: '-60% 비용',
    impactUnitCost25: '-25% 단가',
    impactUnitCost30: '-30% 단가',
    impactVolumeOpt: '대량 최적',
    impactMatCost35: '-35% 재료비',
    impactComplexity: '복잡도 ↑',
    impactStiffness: '+300% 강성',
    impactCost45: '-45% 비용',
    impactCycleTime50: '-50% 가공시간',
    impactCost30: '-30% 비용',
    impactMatCost50: '-50% 재료비',
    impactCost40: '-40% 비용',
    // Suggestion headlines
    hFilletReduce: '필렛 반경을 2mm로 줄이면 CNC 공정비 약 12% 절감 예상',
    hMaterialPla: '재질을 PLA로 변경하면 3D 프린팅 적합성 점수가 85점으로 개선됩니다',
    hTopologyOpt: '위상 최적화를 통해 최대 40% 경량화 가능합니다',
    hSplitAssembly: '긴 돌출부는 CNC 척킹 비용을 증가시킵니다. 분할 조립을 고려하세요',
    hDefaultFdm: '3D 프린팅(FDM)으로 전환하면 초기 제작비를 최대 60% 절감할 수 있습니다',
    hCncMilling: 'CNC 밀링이 현재 형상에 가장 적합합니다. 배치 생산으로 단가 절감 가능',
    hCncTurning: 'CNC 선삭으로 전환하면 회전 대칭 파트 단가를 낮출 수 있습니다',
    hInjection: '사출 성형 금형 투자 시 대량 생산 단가가 최저화됩니다',
    hSheetMetal: '판금 절곡 공정으로 재료 낭비 없이 제작 가능합니다',
    hCasting: '주조 공정으로 복잡한 내부 구조도 일체 제작 가능합니다',
    hRibStiffness: '얇은 판 형상 감지 — 리브 추가로 굽힘 강성 3-5배 향상 가능',
    hSlaSls: '형상 복잡도가 높습니다. SLA/SLS 3D 프린팅이 CNC 대비 비용 효율적입니다',
    hCncTurningSym: '회전 대칭 형상 감지 — CNC 선삭으로 전환하면 가공 시간 50% 단축',
    hSheetMetalShell: '쉘 형상 감지 — 판금 성형이 적합합니다',
    hDmlsTitanium: '티타늄 소재: DMLS 금속 3D 프린팅이 복잡 형상에서 CNC 대비 40% 저렴할 수 있습니다',
    hOversizeSplit: '큰 부품 감지 ({size}mm) — 분할 제작 후 접합을 검토하세요',
    // Shape labels
    shapeBox: '직육면체',
    shapeCylinder: '원기둥',
    shapeSphere: '구',
    shapeCone: '원뿔',
    shapeTorus: '토러스',
    shapePipe: '파이프',
  },
  en: {
    t2cTitle: 'Text to Shape',
    t2cExample: '(e.g. 100×50×30mm box)',
    t2cPlaceholder: 'Describe shape in plain text. e.g. cylinder radius 40mm height 100mm',
    confHigh: 'High confidence',
    confMedium: 'Medium confidence',
    confLow: 'Low confidence',
    btnApplied: 'Applied ✓',
    btnGenerate: 'Generate',
    shapeUnrecognized: 'Shape type not recognized. Try: box, cylinder, sphere, pipe',
    noSuggestions: 'No AI suggestions — your design looks well optimized!',
    advisorTitle: 'AI Manufacturing Advisor',
    suggestionsCount: 'suggestions',
    btnApply: 'Apply',
    btnAppliedShort: 'Applied',
    impactCost12: '-12% cost',
    impactScore15: '+15pt score',
    impactWeight40: '-40% weight',
    impactCost20: '-20% cost',
    impactCost60: '-60% cost',
    impactUnitCost25: '-25% unit cost',
    impactUnitCost30: '-30% unit cost',
    impactVolumeOpt: 'Volume optimal',
    impactMatCost35: '-35% material',
    impactComplexity: 'Complexity ↑',
    impactStiffness: '+300% stiffness',
    impactCost45: '-45% cost',
    impactCycleTime50: '-50% cycle time',
    impactCost30: '-30% cost',
    impactMatCost50: '-50% material',
    impactCost40: '-40% cost',
    hFilletReduce: 'Reducing fillet radius to 2mm could cut CNC machining cost ~12%',
    hMaterialPla: 'Switching to PLA improves 3D printing feasibility score to 85',
    hTopologyOpt: 'Topology optimization can reduce mass by up to 40%',
    hSplitAssembly: 'Long protrusion increases CNC chucking cost. Consider split assembly',
    hDefaultFdm: 'Switching to FDM 3D printing can cut initial production cost by up to 60%',
    hCncMilling: 'CNC milling best suits this geometry. Batch production lowers unit cost',
    hCncTurning: 'CNC turning reduces unit cost for rotationally symmetric parts',
    hInjection: 'Injection molding tooling investment minimizes high-volume unit cost',
    hSheetMetal: 'Sheet metal bending allows near-zero material waste fabrication',
    hCasting: 'Casting produces complex internal geometries in a single pour',
    hRibStiffness: 'Thin plate detected — adding ribs can improve bending stiffness 3-5×',
    hSlaSls: 'High geometric complexity — SLA/SLS 3D printing is more cost-efficient than CNC',
    hCncTurningSym: 'Rotationally symmetric geometry — switching to CNC turning reduces cycle time by 50%',
    hSheetMetalShell: 'Shell geometry detected — sheet metal forming is a great fit',
    hDmlsTitanium: 'Titanium: DMLS metal 3D printing can be 40% cheaper than CNC for complex shapes',
    hOversizeSplit: 'Large part detected ({size}mm) — consider splitting and joining',
    shapeBox: 'Box',
    shapeCylinder: 'Cylinder',
    shapeSphere: 'Sphere',
    shapeCone: 'Cone',
    shapeTorus: 'Torus',
    shapePipe: 'Pipe',
  },
  ja: {
    t2cTitle: 'テキスト → 形状変換',
    t2cExample: '(例: 100×50×30mm ボックス)',
    t2cPlaceholder: '自然言語で形状を記述してください。例) 半径40mm 高さ100mm の円柱',
    confHigh: '信頼度 高',
    confMedium: '信頼度 中',
    confLow: '信頼度 低',
    btnApplied: '適用済み ✓',
    btnGenerate: '形状を生成',
    shapeUnrecognized: '形状タイプを認識できません。例: box, cylinder, sphere, pipe',
    noSuggestions: 'AIの提案はありません。設計は最適化されています!',
    advisorTitle: 'AI 製造アドバイザー',
    suggestionsCount: '件の提案',
    btnApply: '適用',
    btnAppliedShort: '適用済み',
    impactCost12: '-12% コスト',
    impactScore15: '+15pt スコア',
    impactWeight40: '-40% 重量',
    impactCost20: '-20% コスト',
    impactCost60: '-60% コスト',
    impactUnitCost25: '-25% 単価',
    impactUnitCost30: '-30% 単価',
    impactVolumeOpt: '量産最適',
    impactMatCost35: '-35% 材料費',
    impactComplexity: '複雑度 ↑',
    impactStiffness: '+300% 剛性',
    impactCost45: '-45% コスト',
    impactCycleTime50: '-50% 加工時間',
    impactCost30: '-30% コスト',
    impactMatCost50: '-50% 材料費',
    impactCost40: '-40% コスト',
    hFilletReduce: 'Fillet半径を2mmに縮小すると CNC加工コストを約12%削減できます',
    hMaterialPla: '材質をPLAに変更すると 3Dプリント適性スコアが85点に改善します',
    hTopologyOpt: 'トポロジー最適化で最大40%の軽量化が可能です',
    hSplitAssembly: '長い突起部はCNCチャッキングコストを増加させます。分割組立を検討してください',
    hDefaultFdm: 'FDM 3Dプリントへの切替で初期製作費を最大60%削減できます',
    hCncMilling: 'CNCミリングがこの形状に最適です。バッチ生産で単価削減が可能',
    hCncTurning: 'CNC旋削への切替で回転対称部品の単価を下げられます',
    hInjection: 'インジェクション成形の金型投資で大量生産時の単価が最小化されます',
    hSheetMetal: '板金曲げ加工で材料ロスをほぼゼロで製作可能です',
    hCasting: '鋳造により複雑な内部構造も一体で製作可能です',
    hRibStiffness: '薄板形状を検出 — リブ追加で曲げ剛性を3〜5倍向上可能',
    hSlaSls: '形状複雑度が高いため、SLA/SLS 3DプリントがCNCより費用効率的です',
    hCncTurningSym: '回転対称形状を検出 — CNC旋削への切替で加工時間50%短縮',
    hSheetMetalShell: 'シェル形状を検出 — 板金成形が適しています',
    hDmlsTitanium: 'チタン材: 複雑形状ではDMLS金属3DプリントがCNCより40%安くなる場合があります',
    hOversizeSplit: '大型部品を検出 ({size}mm) — 分割製作後に接合を検討してください',
    shapeBox: 'ボックス',
    shapeCylinder: '円柱',
    shapeSphere: '球',
    shapeCone: '円錐',
    shapeTorus: 'トーラス',
    shapePipe: 'パイプ',
  },
  zh: {
    t2cTitle: '文本 → 形状转换',
    t2cExample: '(例如: 100×50×30mm 盒子)',
    t2cPlaceholder: '用自然语言描述形状。例如 半径40mm 高100mm 的圆柱',
    confHigh: '高置信度',
    confMedium: '中置信度',
    confLow: '低置信度',
    btnApplied: '已应用 ✓',
    btnGenerate: '生成形状',
    shapeUnrecognized: '无法识别的形状类型。尝试: box, cylinder, sphere, pipe',
    noSuggestions: '没有 AI 建议 — 您的设计已优化!',
    advisorTitle: 'AI 制造顾问',
    suggestionsCount: '条建议',
    btnApply: '应用',
    btnAppliedShort: '已应用',
    impactCost12: '-12% 成本',
    impactScore15: '+15pt 评分',
    impactWeight40: '-40% 重量',
    impactCost20: '-20% 成本',
    impactCost60: '-60% 成本',
    impactUnitCost25: '-25% 单价',
    impactUnitCost30: '-30% 单价',
    impactVolumeOpt: '量产最优',
    impactMatCost35: '-35% 材料费',
    impactComplexity: '复杂度 ↑',
    impactStiffness: '+300% 刚度',
    impactCost45: '-45% 成本',
    impactCycleTime50: '-50% 加工时间',
    impactCost30: '-30% 成本',
    impactMatCost50: '-50% 材料费',
    impactCost40: '-40% 成本',
    hFilletReduce: '将 Fillet 半径减至 2mm 预计可降低约 12% 的 CNC 加工成本',
    hMaterialPla: '材料改为 PLA 可将 3D 打印适配性评分提升至 85',
    hTopologyOpt: '拓扑优化可减重最高 40%',
    hSplitAssembly: '长凸出结构会增加 CNC 装夹成本,请考虑分体装配',
    hDefaultFdm: '改用 FDM 3D 打印可将初始制作成本降低最多 60%',
    hCncMilling: 'CNC 铣削最适合当前几何。批量生产可降低单价',
    hCncTurning: '改用 CNC 车削可降低旋转对称零件单价',
    hInjection: '注塑模具投入后大批量生产单价最低',
    hSheetMetal: '钣金折弯工艺可实现几乎零材料浪费',
    hCasting: '铸造工艺可一体成型复杂内部结构',
    hRibStiffness: '检测到薄板形状 — 添加加强筋可提升弯曲刚度 3-5 倍',
    hSlaSls: '几何复杂度高 — SLA/SLS 3D 打印比 CNC 更具成本效益',
    hCncTurningSym: '检测到旋转对称形状 — 改用 CNC 车削可缩短加工时间 50%',
    hSheetMetalShell: '检测到壳体形状 — 钣金成型非常适合',
    hDmlsTitanium: '钛材料: 复杂形状下 DMLS 金属 3D 打印可比 CNC 便宜 40%',
    hOversizeSplit: '检测到大型零件 ({size}mm) — 考虑分段制作后拼接',
    shapeBox: '长方体',
    shapeCylinder: '圆柱',
    shapeSphere: '球',
    shapeCone: '圆锥',
    shapeTorus: '圆环',
    shapePipe: '管道',
  },
  es: {
    t2cTitle: 'Texto → Forma',
    t2cExample: '(p. ej. caja 100×50×30mm)',
    t2cPlaceholder: 'Describe la forma en texto. Ej.: cilindro radio 40mm altura 100mm',
    confHigh: 'Confianza alta',
    confMedium: 'Confianza media',
    confLow: 'Confianza baja',
    btnApplied: 'Aplicado ✓',
    btnGenerate: 'Generar',
    shapeUnrecognized: 'Tipo de forma no reconocido. Prueba: box, cylinder, sphere, pipe',
    noSuggestions: 'Sin sugerencias de IA — ¡tu diseño luce bien optimizado!',
    advisorTitle: 'Asesor de Manufactura con IA',
    suggestionsCount: 'sugerencias',
    btnApply: 'Aplicar',
    btnAppliedShort: 'Aplicado',
    impactCost12: '-12% costo',
    impactScore15: '+15pt puntaje',
    impactWeight40: '-40% peso',
    impactCost20: '-20% costo',
    impactCost60: '-60% costo',
    impactUnitCost25: '-25% costo unitario',
    impactUnitCost30: '-30% costo unitario',
    impactVolumeOpt: 'Óptimo en volumen',
    impactMatCost35: '-35% material',
    impactComplexity: 'Complejidad ↑',
    impactStiffness: '+300% rigidez',
    impactCost45: '-45% costo',
    impactCycleTime50: '-50% tiempo de ciclo',
    impactCost30: '-30% costo',
    impactMatCost50: '-50% material',
    impactCost40: '-40% costo',
    hFilletReduce: 'Reducir el radio del Fillet a 2mm podría recortar ~12% del costo de mecanizado CNC',
    hMaterialPla: 'Cambiar a PLA sube el puntaje de viabilidad de impresión 3D a 85',
    hTopologyOpt: 'La optimización topológica puede reducir la masa hasta un 40%',
    hSplitAssembly: 'La protuberancia larga aumenta el costo de sujeción CNC. Considera ensamble dividido',
    hDefaultFdm: 'Cambiar a impresión 3D FDM puede recortar hasta 60% del costo inicial',
    hCncMilling: 'El fresado CNC se ajusta mejor a esta geometría. Producción en lote baja el costo unitario',
    hCncTurning: 'El torneado CNC reduce el costo unitario para piezas con simetría de revolución',
    hInjection: 'La inversión en molde de inyección minimiza el costo unitario en alto volumen',
    hSheetMetal: 'El doblado de chapa permite fabricación con casi cero desperdicio de material',
    hCasting: 'La fundición produce geometrías internas complejas en una sola colada',
    hRibStiffness: 'Placa delgada detectada — añadir costillas puede mejorar la rigidez a flexión 3-5×',
    hSlaSls: 'Alta complejidad geométrica — la impresión 3D SLA/SLS es más rentable que CNC',
    hCncTurningSym: 'Geometría con simetría de revolución — cambiar a torneado CNC reduce el tiempo de ciclo 50%',
    hSheetMetalShell: 'Geometría tipo cáscara detectada — conformado de chapa encaja bien',
    hDmlsTitanium: 'Titanio: la impresión 3D metálica DMLS puede ser 40% más barata que CNC en formas complejas',
    hOversizeSplit: 'Pieza grande detectada ({size}mm) — considera dividir y unir',
    shapeBox: 'Caja',
    shapeCylinder: 'Cilindro',
    shapeSphere: 'Esfera',
    shapeCone: 'Cono',
    shapeTorus: 'Toroide',
    shapePipe: 'Tubo',
  },
  ar: {
    t2cTitle: 'نص → شكل',
    t2cExample: '(مثال: صندوق 100×50×30مم)',
    t2cPlaceholder: 'صف الشكل بلغة طبيعية. مثال: أسطوانة نصف قطر 40مم ارتفاع 100مم',
    confHigh: 'ثقة عالية',
    confMedium: 'ثقة متوسطة',
    confLow: 'ثقة منخفضة',
    btnApplied: 'تم التطبيق ✓',
    btnGenerate: 'توليد الشكل',
    shapeUnrecognized: 'نوع الشكل غير معروف. جرّب: box, cylinder, sphere, pipe',
    noSuggestions: 'لا توجد اقتراحات من الذكاء الاصطناعي — تصميمك مُحسَّن!',
    advisorTitle: 'مستشار التصنيع بالذكاء الاصطناعي',
    suggestionsCount: 'اقتراحات',
    btnApply: 'تطبيق',
    btnAppliedShort: 'مُطبَّق',
    impactCost12: '-12% تكلفة',
    impactScore15: '+15 نقطة',
    impactWeight40: '-40% وزن',
    impactCost20: '-20% تكلفة',
    impactCost60: '-60% تكلفة',
    impactUnitCost25: '-25% تكلفة الوحدة',
    impactUnitCost30: '-30% تكلفة الوحدة',
    impactVolumeOpt: 'أمثل للكميات',
    impactMatCost35: '-35% مواد',
    impactComplexity: 'التعقيد ↑',
    impactStiffness: '+300% صلابة',
    impactCost45: '-45% تكلفة',
    impactCycleTime50: '-50% زمن الدورة',
    impactCost30: '-30% تكلفة',
    impactMatCost50: '-50% مواد',
    impactCost40: '-40% تكلفة',
    hFilletReduce: 'تقليل نصف قطر Fillet إلى 2مم قد يخفض تكلفة تصنيع CNC بنحو 12%',
    hMaterialPla: 'التحويل إلى PLA يرفع درجة ملاءمة الطباعة ثلاثية الأبعاد إلى 85',
    hTopologyOpt: 'تحسين الطوبولوجيا قد يقلل الكتلة حتى 40%',
    hSplitAssembly: 'النتوء الطويل يرفع تكلفة تثبيت CNC. فكّر في تجميع مقسّم',
    hDefaultFdm: 'التحويل إلى طباعة FDM ثلاثية الأبعاد يخفض تكلفة الإنتاج الأولية حتى 60%',
    hCncMilling: 'CNC milling الأنسب لهذا الشكل. الإنتاج بالدفعات يقلل تكلفة الوحدة',
    hCncTurning: 'CNC turning يقلل تكلفة الوحدة للأجزاء المتماثلة دورانياً',
    hInjection: 'استثمار قوالب الحقن يقلل تكلفة الوحدة في الإنتاج الضخم',
    hSheetMetal: 'ثني الصفائح المعدنية يتيح التصنيع بدون هدر مواد تقريباً',
    hCasting: 'السباكة تنتج هندسات داخلية معقدة في سبك واحد',
    hRibStiffness: 'تم اكتشاف صفيحة رقيقة — إضافة أضلاع تحسّن صلابة الانحناء 3-5×',
    hSlaSls: 'تعقيد هندسي عالٍ — طباعة SLA/SLS أكثر كفاءة من حيث التكلفة مقارنة بـ CNC',
    hCncTurningSym: 'شكل متماثل دورانياً — التحويل إلى CNC turning يقلل زمن الدورة 50%',
    hSheetMetalShell: 'تم اكتشاف شكل قشري — تشكيل الصفائح المعدنية مناسب جداً',
    hDmlsTitanium: 'التيتانيوم: طباعة DMLS المعدنية قد تكون أرخص 40% من CNC للأشكال المعقدة',
    hOversizeSplit: 'تم اكتشاف جزء كبير ({size}مم) — فكّر في التقسيم والدمج',
    shapeBox: 'صندوق',
    shapeCylinder: 'أسطوانة',
    shapeSphere: 'كرة',
    shapeCone: 'مخروط',
    shapeTorus: 'طوروس',
    shapePipe: 'أنبوب',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

type DictKey = keyof typeof dict['en'];

function pickDict(lang: string | undefined) {
  return dict[langMap[(lang ?? 'en').toLowerCase()] ?? 'en'];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIAdvisorProps {
  result: ShapeResult;
  dfmResults?: DFMResult[] | null;
  materialId?: string;
  lang?: string;
  onTextToCAD?: (shapeId: string, params: Record<string, number>) => void;
}

// ─── Text-to-CAD NL parser ────────────────────────────────────────────────────

type ParsedShape = { shapeId: string; params: Record<string, number>; confidence: 'high' | 'medium' | 'low' };

function parseNLToCAD(text: string): ParsedShape | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // Extract first number that follows a unit or dimension keyword
  const numOf = (patterns: RegExp[]): number | undefined => {
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return parseFloat(m[1]);
    }
    return undefined;
  };

  // Extract all bare numbers (for "100x50x30" style)
  const allNums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|cm|m)?/g)].map(m => parseFloat(m[1])).filter(n => n > 0 && n < 10000);

  // Detect shape
  let shapeId: string | null = null;
  if (/cylinder|원기둥|실린더|원통/.test(t)) shapeId = 'cylinder';
  else if (/sphere|ball|구체|구형|공/.test(t)) shapeId = 'sphere';
  else if (/cone|원뿔|코너|코니/.test(t)) shapeId = 'cone';
  else if (/torus|ring|donut|토러스|링|도넛/.test(t)) shapeId = 'torus';
  else if (/pipe|tube|파이프|튜브/.test(t)) shapeId = 'pipe';
  else if (/box|cube|cuboid|block|상자|박스|육면체|블록|직육면체/.test(t)) shapeId = 'box';
  else if (allNums.length >= 2) shapeId = 'box'; // fallback to box if dimensions found

  if (!shapeId) return null;

  const params: Record<string, number> = {};

  if (shapeId === 'box') {
    // Try "WxHxD" pattern first
    const xyzMatch = t.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
    if (xyzMatch) {
      params.width  = parseFloat(xyzMatch[1]);
      params.height = parseFloat(xyzMatch[2]);
      params.depth  = parseFloat(xyzMatch[3]);
    } else {
      params.width  = numOf([/width[^\d]*(\d+(?:\.\d+)?)/,/wide[^\d]*(\d+(?:\.\d+)?)/,/(?:가로|너비)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 100;
      params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/tall[^\d]*(\d+(?:\.\d+)?)/,/(?:높이|세로)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 50;
      params.depth  = numOf([/depth[^\d]*(\d+(?:\.\d+)?)/,/deep[^\d]*(\d+(?:\.\d+)?)/,/(?:깊이|두께)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[2] ?? allNums[0] ?? 50;
    }
  } else if (shapeId === 'cylinder') {
    const diam = numOf([/diameter[^\d]*(\d+(?:\.\d+)?)/,/지름[^\d]*(\d+(?:\.\d+)?)/,/직경[^\d]*(\d+(?:\.\d+)?)/]);
    const rad  = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/,/반경[^\d]*(\d+(?:\.\d+)?)/]);
    params.radius = diam ? diam / 2 : rad ?? allNums[0] ?? 30;
    params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/tall[^\d]*(\d+(?:\.\d+)?)/,/(?:높이|길이)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 80;
  } else if (shapeId === 'sphere') {
    const diam = numOf([/diameter[^\d]*(\d+(?:\.\d+)?)/,/지름[^\d]*(\d+(?:\.\d+)?)/]);
    const rad  = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]);
    params.radius = diam ? diam / 2 : rad ?? allNums[0] ?? 40;
  } else if (shapeId === 'cone') {
    params.radius = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 30;
    params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/높이[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 60;
  } else if (shapeId === 'torus') {
    params.radius      = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 50;
    params.tubeRadius  = numOf([/tube[^\d]*(\d+(?:\.\d+)?)/,/관[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? 15;
  } else if (shapeId === 'pipe') {
    params.outerRadius = numOf([/outer[^\d]*(\d+(?:\.\d+)?)/,/외경[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 30;
    params.innerRadius = numOf([/inner[^\d]*(\d+(?:\.\d+)?)/,/내경[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? 20;
    params.height      = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/길이[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[2] ?? allNums[0] ?? 100;
  }

  const confidence: ParsedShape['confidence'] =
    Object.keys(params).length >= 2 && allNums.length > 0 ? 'high'
    : Object.keys(params).length >= 1 ? 'medium'
    : 'low';

  return { shapeId, params, confidence };
}

export interface AdvisorSuggestion {
  id: string;
  category: 'cost' | 'weight' | 'process' | 'optimize';
  icon: string;
  /** i18n dict key for the headline text */
  headlineKey: DictKey;
  /** i18n dict key for the impact label */
  impactKey: DictKey;
  /** optional numeric value substituted into headline (e.g. bbox max dim) */
  headlineValue?: number;
  type: string;         // opaque key passed to parent onClick
}

// ─── Heuristic suggestion generator ──────────────────────────────────────────

export function generateAdvisorSuggestions(
  result: ShapeResult,
  dfmResults: DFMResult[] | null | undefined,
  material: string | undefined,
  _lang: string | undefined,
): AdvisorSuggestion[] {
  const suggestions: AdvisorSuggestion[] = [];

  // 1. Wall thickness issue → fillet reduction tip
  const hasThinWall = dfmResults?.some(r =>
    r.issues.some(i => i.type === 'thin_wall')
  );
  if (hasThinWall) {
    suggestions.push({
      id: 'fillet-reduce',
      category: 'cost',
      icon: '💰',
      headlineKey: 'hFilletReduce',
      impactKey: 'impactCost12',
      type: 'reduce-fillet',
    });
  }

  // 2. Score < 70 → suggest PLA / 3D printing
  const lowestScore = dfmResults?.reduce<number>((min, r) => Math.min(min, r.score), 100) ?? 100;
  if (lowestScore < 70) {
    suggestions.push({
      id: 'material-pla',
      category: 'process',
      icon: '🔧',
      headlineKey: 'hMaterialPla',
      impactKey: 'impactScore15',
      type: 'switch-material-pla',
    });
  }

  // 3. Volume > 500 cm³ → topology optimization
  if (result.volume_cm3 > 500) {
    suggestions.push({
      id: 'topology-opt',
      category: 'weight',
      icon: '⚖️',
      headlineKey: 'hTopologyOpt',
      impactKey: 'impactWeight40',
      type: 'topology-optimize',
    });
  }

  // 4. Bbox ratio > 5:1 → splitting suggestion
  const { w, h, d } = result.bbox;
  const dims = [w, h, d].sort((a, b) => b - a);
  const bboxRatio = dims[0] / Math.max(dims[2], 0.01);
  if (bboxRatio > 5) {
    suggestions.push({
      id: 'split-assembly',
      category: 'cost',
      icon: '💰',
      headlineKey: 'hSplitAssembly',
      impactKey: 'impactCost20',
      type: 'split-assembly',
    });
  }

  // 5. Always: cheapest alternative process suggestion
  const cheapestProcess = (() => {
    if (!dfmResults || dfmResults.length === 0) {
      return { headlineKey: 'hDefaultFdm' as DictKey, impactKey: 'impactCost60' as DictKey };
    }
    const best = dfmResults.reduce((a, b) => a.score > b.score ? a : b);
    const labels: Record<string, { headlineKey: DictKey; impactKey: DictKey }> = {
      cnc_milling: { headlineKey: 'hCncMilling', impactKey: 'impactUnitCost25' },
      cnc_turning: { headlineKey: 'hCncTurning', impactKey: 'impactUnitCost30' },
      injection_molding: { headlineKey: 'hInjection', impactKey: 'impactVolumeOpt' },
      sheet_metal: { headlineKey: 'hSheetMetal', impactKey: 'impactMatCost35' },
      casting: { headlineKey: 'hCasting', impactKey: 'impactComplexity' },
    };
    return labels[best.process] ?? { headlineKey: 'hDefaultFdm' as DictKey, impactKey: 'impactCost60' as DictKey };
  })();

  suggestions.push({
    id: 'cheapest-alt',
    category: 'optimize',
    icon: '⚡',
    headlineKey: cheapestProcess.headlineKey,
    impactKey: cheapestProcess.impactKey,
    type: 'cheapest-alternative',
  });

  // 6. Aspect ratio wall thickness — plate-like geometry
  if (w / d > 8 || h / d > 8) {
    suggestions.push({
      id: 'rib-stiffness',
      category: 'optimize',
      icon: '🏗️',
      headlineKey: 'hRibStiffness',
      impactKey: 'impactStiffness',
      type: 'add-ribs',
    });
  }

  // 7. Surface area to volume ratio > 15 → suggest SLA/SLS
  const sav = result.surface_area_cm2 / result.volume_cm3;
  if (sav > 15) {
    suggestions.push({
      id: 'sla-sls-complex',
      category: 'cost',
      icon: '💰',
      headlineKey: 'hSlaSls',
      impactKey: 'impactCost45',
      type: 'switch-sla-sls',
    });
  }

  // 8. Symmetry detection — near-square cross section and tall → CNC turning
  const squareness = Math.abs(w - d) / Math.max(w, d);
  if (squareness < 0.05 && h > w * 1.5) {
    suggestions.push({
      id: 'cnc-turning-sym',
      category: 'process',
      icon: '🔄',
      headlineKey: 'hCncTurningSym',
      impactKey: 'impactCycleTime50',
      type: 'switch-cnc-turning',
    });
  }

  // 9. Oversize warning — any bbox dimension > 300 mm
  const maxDim = Math.max(w, h, d);
  if (maxDim > 300) {
    suggestions.push({
      id: 'oversize-split',
      category: 'cost',
      icon: '📐',
      headlineKey: 'hOversizeSplit',
      impactKey: 'impactCost30',
      headlineValue: Math.round(maxDim),
      type: 'split-large-part',
    });
  }

  // 10. Shell detection — low volume, high surface area → sheet metal / thermoforming
  if (result.volume_cm3 < 5 && result.surface_area_cm2 > 50) {
    suggestions.push({
      id: 'sheet-metal-shell',
      category: 'process',
      icon: '🔩',
      headlineKey: 'hSheetMetalShell',
      impactKey: 'impactMatCost50',
      type: 'switch-sheet-metal',
    });
  }

  // 11. Material + process mismatch — titanium + complex CNC → DMLS
  if (material === 'titanium' && dfmResults?.some(r => r.process === 'cnc_milling' && r.score > 60)) {
    suggestions.push({
      id: 'dmls-titanium',
      category: 'cost',
      icon: '⚡',
      headlineKey: 'hDmlsTitanium',
      impactKey: 'impactCost40',
      type: 'switch-dmls',
    });
  }

  return suggestions.slice(0, 8);
}

// ─── Category colours ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<AdvisorSuggestion['category'], string> = {
  cost: '#f0883e',
  weight: '#3fb950',
  process: '#79c0ff',
  optimize: '#a371f7',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIAdvisor({
  result,
  dfmResults,
  materialId,
  lang,
  onApply,
  onTextToCAD,
}: AIAdvisorProps & { onApply?: (type: string) => void }) {
  // Prefer the locale segment in the URL so deep-linked pages translate even when `lang` prop is absent.
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? (lang ?? 'en');
  const resolvedLang = lang ?? seg;
  const t = pickDict(resolvedLang);
  // `isKorean` retained for any downstream parity checks elsewhere in the app.
  void isKorean;

  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [nlText, setNlText] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseNLToCAD>>(null);
  const [nlApplied, setNlApplied] = useState(false);

  const suggestions = generateAdvisorSuggestions(result, dfmResults, materialId, resolvedLang);

  function handleApply(suggestion: AdvisorSuggestion) {
    setApplied(prev => new Set(prev).add(suggestion.id));
    onApply?.(suggestion.type);
  }

  function handleNLChange(text: string) {
    setNlText(text);
    setNlApplied(false);
    setParsed(text.trim().length > 5 ? parseNLToCAD(text) : null);
  }

  function handleNLApply() {
    if (!parsed || !onTextToCAD) return;
    onTextToCAD(parsed.shapeId, parsed.params);
    setNlApplied(true);
  }

  const shapeLabelKeys: Record<string, DictKey> = {
    box: 'shapeBox',
    cylinder: 'shapeCylinder',
    sphere: 'shapeSphere',
    cone: 'shapeCone',
    torus: 'shapeTorus',
    pipe: 'shapePipe',
  };

  const renderHeadline = (s: AdvisorSuggestion): string => {
    const raw = t[s.headlineKey] ?? '';
    if (s.headlineValue != null) return raw.replace('{size}', String(s.headlineValue));
    return raw;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Text-to-CAD section ── */}
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 14 }}>✏️</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>
            {t.t2cTitle}
          </span>
          <span style={{ fontSize: 10, color: '#6e7681' }}>
            {t.t2cExample}
          </span>
        </div>
        <textarea
          value={nlText}
          onChange={e => handleNLChange(e.target.value)}
          placeholder={t.t2cPlaceholder}
          rows={2}
          style={{
            width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            color: '#c9d1d9', fontSize: 11, padding: '6px 8px', resize: 'none',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        {parsed && (
          <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                background: parsed.confidence === 'high' ? '#3fb95022' : parsed.confidence === 'medium' ? '#f0883e22' : '#6e767122',
                color: parsed.confidence === 'high' ? '#3fb950' : parsed.confidence === 'medium' ? '#f0883e' : '#6e7681',
              }}>
                {parsed.confidence === 'high' ? t.confHigh :
                 parsed.confidence === 'medium' ? t.confMedium :
                 t.confLow}
              </span>
              <span style={{ color: '#58a6ff', fontWeight: 700 }}>
                {shapeLabelKeys[parsed.shapeId] ? t[shapeLabelKeys[parsed.shapeId]] : parsed.shapeId}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
              {Object.entries(parsed.params).map(([k, v]) => (
                <span key={k} style={{ color: '#8b949e' }}>
                  <span style={{ color: '#79c0ff' }}>{k}</span>: {v}mm
                </span>
              ))}
            </div>
          </div>
        )}
        {parsed && (
          <button
            onClick={handleNLApply}
            disabled={nlApplied || !onTextToCAD}
            style={{
              alignSelf: 'flex-end', padding: '5px 14px', borderRadius: 6,
              border: `1px solid ${nlApplied ? '#30363d' : '#388bfd'}`,
              background: nlApplied ? '#21262d' : '#388bfd18',
              color: nlApplied ? '#6e7681' : '#58a6ff',
              fontSize: 11, fontWeight: 700, cursor: nlApplied ? 'default' : 'pointer',
            }}
          >
            {nlApplied ? t.btnApplied : t.btnGenerate}
          </button>
        )}
        {!parsed && nlText.trim().length > 5 && (
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            {t.shapeUnrecognized}
          </div>
        )}
      </div>

      {suggestions.length === 0 ? (
        <div style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
          padding: '16px 20px', color: '#8b949e', fontSize: 13, textAlign: 'center',
        }}>
          {t.noSuggestions}
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
              {t.advisorTitle}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px',
              borderRadius: 10, background: '#a371f718', color: '#a371f7',
            }}>
              {suggestions.length} {t.suggestionsCount}
            </span>
          </div>

          {suggestions.map(s => {
            const isApplied = applied.has(s.id);
            const color = CATEGORY_COLORS[s.category];
            return (
              <div
                key={s.id}
                style={{
                  background: '#161b22',
                  border: `1px solid ${isApplied ? color + '55' : '#30363d'}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: color + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18,
                }}>
                  {s.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 6px', fontSize: 12, color: '#e6edf3', lineHeight: 1.5,
                    wordBreak: 'keep-all',
                  }}>
                    {renderHeadline(s)}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px',
                      borderRadius: 6, background: color + '22', color,
                    }}>
                      {t[s.impactKey]}
                    </span>
                    <span style={{ fontSize: 10, color: '#6e7681', textTransform: 'uppercase' }}>
                      {s.category}
                    </span>
                  </div>
                </div>

                {/* Apply button */}
                <button
                  onClick={() => handleApply(s)}
                  disabled={isApplied}
                  style={{
                    flexShrink: 0,
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isApplied ? '#30363d' : color}`,
                    background: isApplied ? '#21262d' : color + '18',
                    color: isApplied ? '#6e7681' : color,
                    fontSize: 11, fontWeight: 700, cursor: isApplied ? 'default' : 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isApplied ? t.btnAppliedShort : t.btnApply}
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
