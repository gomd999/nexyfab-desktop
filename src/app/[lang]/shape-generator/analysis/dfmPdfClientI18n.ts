import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

const COPY: Readonly<Record<IsoLang, Readonly<{
  signIn: string;
  tooLarge: string;
  invalid: string;
  generic: string;
}>>> = {
  ko: { signIn: 'PDF를 내려받으려면 로그인해 주세요.', tooLarge: 'DFM 보고서가 너무 큽니다. 결과나 이슈 수를 줄인 뒤 다시 시도해 주세요.', invalid: '현재 DFM 결과로 PDF를 만들 수 없습니다. 분석을 다시 실행해 주세요.', generic: 'PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' },
  en: { signIn: 'Sign in to download the PDF.', tooLarge: 'The DFM report is too large. Reduce the number of results or issues and try again.', invalid: 'A PDF cannot be created from the current DFM results. Run the analysis again.', generic: 'The PDF could not be created. Please try again.' },
  ja: { signIn: 'PDFをダウンロードするにはログインしてください。', tooLarge: 'DFMレポートが大きすぎます。結果または問題の数を減らして再試行してください。', invalid: '現在のDFM結果からPDFを作成できません。解析を再実行してください。', generic: 'PDFを作成できませんでした。もう一度お試しください。' },
  zh: { signIn: '请登录后下载PDF。', tooLarge: 'DFM报告过大。请减少结果或问题数量后重试。', invalid: '无法根据当前DFM结果创建PDF。请重新运行分析。', generic: '无法创建PDF。请稍后重试。' },
  es: { signIn: 'Inicie sesión para descargar el PDF.', tooLarge: 'El informe DFM es demasiado grande. Reduzca los resultados o problemas e inténtelo de nuevo.', invalid: 'No se puede crear un PDF con los resultados DFM actuales. Ejecute de nuevo el análisis.', generic: 'No se pudo crear el PDF. Inténtelo de nuevo.' },
  ar: { signIn: 'سجّل الدخول لتنزيل ملف PDF.', tooLarge: 'تقرير DFM كبير جدًا. قلّل عدد النتائج أو المشكلات ثم حاول مرة أخرى.', invalid: 'لا يمكن إنشاء PDF من نتائج DFM الحالية. أعد تشغيل التحليل.', generic: 'تعذر إنشاء ملف PDF. حاول مرة أخرى.' },
};

export function formatDfmPdfExportError(locale: string | undefined | null, code: string | undefined): string {
  const copy = COPY[toIsoLang(locale)];
  const normalized = code?.trim().toUpperCase() ?? '';
  if (normalized === 'UNAUTHORIZED' || normalized === 'HTTP_401') return copy.signIn;
  if (normalized === 'PAYLOAD_TOO_LARGE' || normalized === 'HTTP_413') return copy.tooLarge;
  if (normalized === 'INVALID_JSON' || normalized === 'INVALID_DFM_PDF_REQUEST' || normalized === 'HTTP_400') return copy.invalid;
  return copy.generic;
}
