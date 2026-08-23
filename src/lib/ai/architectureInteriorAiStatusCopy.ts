import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type ArchitectureInteriorAiStatus = 'proposal_ready' | 'proposal_rejected' | 'concept_compiled' | 'awaiting_authority'
  | 'invalid_request' | 'model_truncated' | 'model_output_invalid' | 'model_unavailable';

const COPY: Record<IsoLang, Record<ArchitectureInteriorAiStatus, string>> = {
  ko: { proposal_ready: 'AI 설계 제안 준비됨', proposal_rejected: 'AI 설계 제안 검토 필요', concept_compiled: '개념 설계로 변환됨', awaiting_authority: '권위 있는 입력을 기다리는 중', invalid_request: '설계 요청을 확인해 주세요', model_truncated: 'AI 응답이 잘려 다시 생성해야 합니다', model_output_invalid: 'AI 설계 형식이 올바르지 않습니다', model_unavailable: 'AI 설계 서비스를 사용할 수 없습니다' },
  en: { proposal_ready: 'AI design proposal ready', proposal_rejected: 'AI design proposal needs review', concept_compiled: 'Compiled as concept design', awaiting_authority: 'Awaiting authoritative inputs', invalid_request: 'Check the design request', model_truncated: 'The AI response was truncated; regenerate it', model_output_invalid: 'The AI design format is invalid', model_unavailable: 'The AI design service is unavailable' },
  ja: { proposal_ready: 'AI設計提案の準備完了', proposal_rejected: 'AI設計提案の確認が必要', concept_compiled: '概念設計として変換済み', awaiting_authority: '信頼できる入力を待機中', invalid_request: '設計リクエストを確認してください', model_truncated: 'AI応答が途中で切れたため再生成が必要です', model_output_invalid: 'AI設計の形式が正しくありません', model_unavailable: 'AI設計サービスを利用できません' },
  zh: { proposal_ready: 'AI 设计提案已准备', proposal_rejected: '需要检查 AI 设计提案', concept_compiled: '已转换为概念设计', awaiting_authority: '等待权威输入', invalid_request: '请检查设计请求', model_truncated: 'AI 响应已截断，请重新生成', model_output_invalid: 'AI 设计格式无效', model_unavailable: 'AI 设计服务暂不可用' },
  es: { proposal_ready: 'Propuesta de diseño de IA lista', proposal_rejected: 'La propuesta de diseño de IA requiere revisión', concept_compiled: 'Compilado como diseño conceptual', awaiting_authority: 'Esperando datos autorizados', invalid_request: 'Revisa la solicitud de diseño', model_truncated: 'La respuesta de IA se truncó; vuelve a generarla', model_output_invalid: 'El formato del diseño de IA no es válido', model_unavailable: 'El servicio de diseño de IA no está disponible' },
  ar: { proposal_ready: 'اقتراح تصميم الذكاء الاصطناعي جاهز', proposal_rejected: 'يحتاج اقتراح التصميم إلى مراجعة', concept_compiled: 'تم التحويل إلى تصميم مفاهيمي', awaiting_authority: 'بانتظار مدخلات موثوقة', invalid_request: 'تحقق من طلب التصميم', model_truncated: 'تم اقتطاع استجابة الذكاء الاصطناعي؛ أعد إنشاؤها', model_output_invalid: 'تنسيق تصميم الذكاء الاصطناعي غير صالح', model_unavailable: 'خدمة تصميم الذكاء الاصطناعي غير متاحة' },
};

export function architectureInteriorAiStatusCopy(status: ArchitectureInteriorAiStatus, lang: string | null | undefined): string {
  return COPY[toIsoLang(lang)][status];
}

export function architectureInteriorAiStatusDirection(lang: string | null | undefined): 'rtl' | 'ltr' {
  return toIsoLang(lang) === 'ar' ? 'rtl' : 'ltr';
}
