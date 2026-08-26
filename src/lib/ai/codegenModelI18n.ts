import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import type { CodegenModel } from './codegenModels';

type CodegenModelId = 'gpt-luna' | 'qwen-3.7-plus' | 'qwen-3.7-max' | 'deepseek-pro' | 'qwen-3.8-max' | 'gpt-terra';

const NOTES: Readonly<Record<CodegenModelId, Readonly<Record<IsoLang, string>>>> = {
  'gpt-luna': {
    ko: '무료 · 빠른 설계 · 이미지 자동 분석', en: 'Free · fast design · automatic image analysis', ja: '無料 · 高速設計 · 画像の自動解析',
    zh: '免费 · 快速设计 · 自动图像分析', es: 'Gratis · diseño rápido · análisis automático de imágenes', ar: 'مجاني · تصميم سريع · تحليل تلقائي للصور',
  },
  'qwen-3.7-plus': {
    ko: 'Pro · 빠른 반복 설계', en: 'Pro · fast iterative design', ja: 'Pro · 高速な反復設計', zh: 'Pro · 快速迭代设计',
    es: 'Pro · diseño iterativo rápido', ar: 'Pro · تصميم تكراري سريع',
  },
  'qwen-3.7-max': {
    ko: 'Pro · 복잡 형상 추론', en: 'Pro · complex geometry reasoning', ja: 'Pro · 複雑形状の推論', zh: 'Pro · 复杂几何推理',
    es: 'Pro · razonamiento de geometría compleja', ar: 'Pro · استدلال هندسي معقد',
  },
  'deepseek-pro': {
    ko: 'Pro · 정밀 설계 추론', en: 'Pro · precision design reasoning', ja: 'Pro · 精密設計の推論', zh: 'Pro · 精密设计推理',
    es: 'Pro · razonamiento de diseño de precisión', ar: 'Pro · استدلال للتصميم الدقيق',
  },
  'qwen-3.8-max': {
    ko: 'Enterprise · 고난도 멀티모달 설계 추론', en: 'Enterprise · advanced multimodal design reasoning', ja: 'Enterprise · 高度なマルチモーダル設計推論',
    zh: 'Enterprise · 高难度多模态设计推理', es: 'Enterprise · razonamiento avanzado de diseño multimodal', ar: 'Enterprise · استدلال متقدم للتصميم متعدد الوسائط',
  },
  'gpt-terra': {
    ko: 'Enterprise · 고난도 정밀 설계', en: 'Enterprise · advanced precision design', ja: 'Enterprise · 高度な精密設計', zh: 'Enterprise · 高难度精密设计',
    es: 'Enterprise · diseño de precisión avanzado', ar: 'Enterprise · تصميم دقيق متقدم',
  },
};

export function getCodegenModelNote(model: Pick<CodegenModel, 'id' | 'note'>, locale: string | undefined | null): string {
  return NOTES[model.id as CodegenModelId]?.[toIsoLang(locale)] ?? model.note;
}
