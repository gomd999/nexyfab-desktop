import type { NextRequest } from 'next/server';

export type OpenscadApiLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export function openscadApiLangFromRequest(req: NextRequest): OpenscadApiLang {
  const h = req.headers.get('accept-language');
  if (!h) return 'en';
  const first = h.split(',')[0]?.trim().split('-')[0]?.toLowerCase() ?? '';
  const m: Record<string, OpenscadApiLang> = {
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

const MSGS: Record<OpenscadApiLang, Record<string, string>> = {
  ko: {
    SCAD_REQUIRED: 'scad 문자열이 필요합니다.',
    MONTHLY_LIMIT: '이번 달 OpenSCAD 서버 렌더 한도를 초과했습니다.',
  },
  en: {
    SCAD_REQUIRED: 'scad (string) is required.',
    MONTHLY_LIMIT: 'Monthly OpenSCAD server render limit reached.',
  },
  ja: {
    SCAD_REQUIRED: 'scad 文字列が必要です。',
    MONTHLY_LIMIT: '今月の OpenSCAD サーバーレンダー上限に達しました。',
  },
  zh: {
    SCAD_REQUIRED: '需要 scad 字符串。',
    MONTHLY_LIMIT: '本月 OpenSCAD 服务器渲染次数已达上限。',
  },
  es: {
    SCAD_REQUIRED: 'Se requiere scad (cadena).',
    MONTHLY_LIMIT: 'Se alcanzó el límite mensual de render OpenSCAD en servidor.',
  },
  ar: {
    SCAD_REQUIRED: 'حقل scad (نص) مطلوب.',
    MONTHLY_LIMIT: 'تم بلوغ الحد الشهري لعرض OpenSCAD على الخادم.',
  },
};

export function openscadMsg(lang: OpenscadApiLang, code: keyof typeof MSGS.en): string {
  return MSGS[lang][code] ?? MSGS.en[code] ?? code;
}
