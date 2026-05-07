import type { NextRequest } from 'next/server';

/** Aligns with UI locale keys (ISO-style zh). */
export type BrepApiLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export function brepApiLangFromRequest(req: NextRequest): BrepApiLang {
  const h = req.headers.get('accept-language');
  if (!h) return 'en';
  const first = h.split(',')[0]?.trim().split('-')[0]?.toLowerCase() ?? '';
  const m: Record<string, BrepApiLang> = {
    ko: 'ko',
    kr: 'ko',
    en: 'en',
    ja: 'ja',
    zh: 'zh',
    cn: 'zh',
    es: 'es',
    ar: 'ar',
  };
  return m[first] ?? 'en';
}

const MSGS: Record<BrepApiLang, Record<string, string>> = {
  ko: {
    INPUT_REQUIRED: 'input 객체가 필요합니다.',
    FILENAME_STEP: '파일 이름은 .step 또는 .stp 여야 합니다.',
    QUEUE_FULL: '변환 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.',
    MONTHLY_LIMIT: '이번 달 STEP 서버 임포트 한도를 초과했습니다.',
    STORAGE_UNAVAILABLE: '이 배포에서는 저장소 다운로드를 사용할 수 없습니다.',
    OBJECT_DOWNLOAD_FAILED: '객체 키 다운로드에 실패했습니다.',
    EMPTY_PAYLOAD: 'STEP 데이터가 비어 있습니다.',
    TOO_LARGE: '파일 크기 한도를 초과했습니다.',
  },
  en: {
    INPUT_REQUIRED: 'input object is required.',
    FILENAME_STEP: 'Filename must end with .step or .stp.',
    QUEUE_FULL: 'Conversion queue is full. Try again shortly.',
    MONTHLY_LIMIT: 'Monthly STEP server import limit reached.',
    STORAGE_UNAVAILABLE: 'Storage download is not available on this deployment.',
    OBJECT_DOWNLOAD_FAILED: 'Failed to download object key.',
    EMPTY_PAYLOAD: 'STEP payload is empty.',
    TOO_LARGE: 'File exceeds size limit.',
  },
  ja: {
    INPUT_REQUIRED: 'input オブジェクトが必要です。',
    FILENAME_STEP: 'ファイル名は .step または .stp である必要があります。',
    QUEUE_FULL: '変換キューが満杯です。しばらくしてから再試行してください。',
    MONTHLY_LIMIT: '今月の STEP サーバーインポート上限に達しました。',
    STORAGE_UNAVAILABLE: 'この環境ではストレージのダウンロードが利用できません。',
    OBJECT_DOWNLOAD_FAILED: 'オブジェクトキーのダウンロードに失敗しました。',
    EMPTY_PAYLOAD: 'STEP データが空です。',
    TOO_LARGE: 'ファイルサイズが上限を超えています。',
  },
  zh: {
    INPUT_REQUIRED: '需要 input 对象。',
    FILENAME_STEP: '文件名必须以 .step 或 .stp 结尾。',
    QUEUE_FULL: '转换队列已满，请稍后重试。',
    MONTHLY_LIMIT: '本月 STEP 服务器导入次数已达上限。',
    STORAGE_UNAVAILABLE: '当前部署不支持从存储下载。',
    OBJECT_DOWNLOAD_FAILED: '下载对象键失败。',
    EMPTY_PAYLOAD: 'STEP 数据为空。',
    TOO_LARGE: '文件超过大小限制。',
  },
  es: {
    INPUT_REQUIRED: 'Se requiere el objeto input.',
    FILENAME_STEP: 'El nombre debe terminar en .step o .stp.',
    QUEUE_FULL: 'La cola de conversión está llena. Inténtelo más tarde.',
    MONTHLY_LIMIT: 'Se alcanzó el límite mensual de importación STEP en servidor.',
    STORAGE_UNAVAILABLE: 'La descarga del almacenamiento no está disponible.',
    OBJECT_DOWNLOAD_FAILED: 'Error al descargar la clave del objeto.',
    EMPTY_PAYLOAD: 'El payload STEP está vacío.',
    TOO_LARGE: 'El archivo supera el límite de tamaño.',
  },
  ar: {
    INPUT_REQUIRED: 'حقل input مطلوب.',
    FILENAME_STEP: 'يجب أن ينتهي اسم الملف بـ .step أو .stp.',
    QUEUE_FULL: 'طابور التحويل ممتلئ. حاول لاحقًا.',
    MONTHLY_LIMIT: 'تم بلوغ الحد الشهري لاستيراد STEP على الخادم.',
    STORAGE_UNAVAILABLE: 'تنزيل التخزين غير متاح في هذا النشر.',
    OBJECT_DOWNLOAD_FAILED: 'فشل تنزيل مفتاح الكائن.',
    EMPTY_PAYLOAD: 'حمولة STEP فارغة.',
    TOO_LARGE: 'الملف يتجاوز حد الحجم.',
  },
};

export function brepMsg(lang: BrepApiLang, code: keyof typeof MSGS.en): string {
  return MSGS[lang][code] ?? MSGS.en[code] ?? code;
}
