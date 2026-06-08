/**
 * factoriesDict — UI i18n for the manufacturer-directory ("회사 찾기") page.
 *
 * The page component (`/factories`, re-exported by `/[lang]/factories`) was 100%
 * hard-coded Korean, so en/ja/cn/es/ar visitors saw Korean chrome. This dict
 * supplies the 6-language UI strings. Industry/region taxonomy stays KR-canonical
 * (the API filters on those Korean keys — a separate data-i18n concern).
 */

export type FactLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

export interface FactDict {
  badge: string;
  title: string;
  subtitle: (ko: string, cn: string) => string;
  searchPlaceholder: string;
  tabKo: string;
  tabCn: string;
  industryLabel: string;
  regionLabel: string;
  all: string;
  resultTotal: (n: string) => string;
  pageOf: (p: number, t: number) => string;
  /** "Search <X> factories" — country picks the Korean or Chinese count line. */
  emptyTitle: (country: 'ko' | 'cn', koN: string, cnN: string) => string;
  emptySub: string;
  loadError: string;
  noResults: string;
  noResultsSub: string;
  prev: string;
  next: string;
  // FactoryCard
  cardKo: string;
  cardCn: string;
  inquiry: string;
  lockNotice: string;
}

export const FACT_DICT: Record<FactLang, FactDict> = {
  ko: {
    badge: 'DIRECTORY · 한·중 공장 디렉터리',
    title: '제조사 디렉터리',
    subtitle: (ko, cn) => `국내 ${ko}개 · 중국 ${cn}개 공장 데이터베이스`,
    searchPlaceholder: '공장명, 제품, 업종으로 검색...',
    tabKo: '국내', tabCn: '중국',
    industryLabel: '업종', regionLabel: '지역', all: '전체',
    resultTotal: (n) => `총 ${n}개 공장`,
    pageOf: (p, t) => `${p}/${t} 페이지`,
    emptyTitle: (c, ko, cn) => `${c === 'ko' ? `국내 ${ko}개` : `중국 ${cn}개`} 공장을 검색해보세요`,
    emptySub: '공장명, 제품명, 업종으로 검색하거나 위 필터를 선택하세요',
    loadError: '공장 정보를 불러오지 못했습니다.',
    noResults: '조건에 맞는 공장이 없습니다',
    noResultsSub: '검색어나 필터를 바꿔보세요',
    prev: '← 이전', next: '다음 →',
    cardKo: '국내', cardCn: '중국',
    inquiry: '문의하기',
    lockNotice: '회원가입 후 전체 정보 열람 가능',
  },
  en: {
    badge: 'DIRECTORY · Korea-China factory directory',
    title: 'Manufacturer Directory',
    subtitle: (ko, cn) => `${ko} Korean · ${cn} Chinese factories in the database`,
    searchPlaceholder: 'Search by factory name, product, or industry...',
    tabKo: 'Korea', tabCn: 'China',
    industryLabel: 'Industry', regionLabel: 'Region', all: 'All',
    resultTotal: (n) => `${n} factories`,
    pageOf: (p, t) => `page ${p}/${t}`,
    emptyTitle: (c, ko, cn) => `Search ${c === 'ko' ? `${ko} Korean` : `${cn} Chinese`} factories`,
    emptySub: 'Search by factory name, product, or industry — or pick a filter above',
    loadError: 'Failed to load factory data.',
    noResults: 'No factories match your criteria',
    noResultsSub: 'Try a different search or filter',
    prev: '← Prev', next: 'Next →',
    cardKo: 'Korea', cardCn: 'China',
    inquiry: 'Contact',
    lockNotice: 'Sign up to view full details',
  },
  ja: {
    badge: 'DIRECTORY · 韓中工場ディレクトリ',
    title: 'メーカーディレクトリ',
    subtitle: (ko, cn) => `国内 ${ko}社 · 中国 ${cn}社の工場データベース`,
    searchPlaceholder: '工場名・製品・業種で検索...',
    tabKo: '韓国', tabCn: '中国',
    industryLabel: '業種', regionLabel: '地域', all: 'すべて',
    resultTotal: (n) => `全 ${n} 社`,
    pageOf: (p, t) => `${p}/${t} ページ`,
    emptyTitle: (c, ko, cn) => `${c === 'ko' ? `韓国 ${ko}社` : `中国 ${cn}社`}の工場を検索`,
    emptySub: '工場名・製品名・業種で検索するか、上のフィルターを選んでください',
    loadError: '工場情報を読み込めませんでした。',
    noResults: '条件に合う工場がありません',
    noResultsSub: '検索語やフィルターを変えてみてください',
    prev: '← 前へ', next: '次へ →',
    cardKo: '韓国', cardCn: '中国',
    inquiry: 'お問い合わせ',
    lockNotice: '会員登録で全情報を閲覧可能',
  },
  cn: {
    badge: 'DIRECTORY · 韩中工厂目录',
    title: '制造商目录',
    subtitle: (ko, cn) => `韩国 ${ko} 家 · 中国 ${cn} 家工厂数据库`,
    searchPlaceholder: '按工厂名称、产品或行业搜索...',
    tabKo: '韩国', tabCn: '中国',
    industryLabel: '行业', regionLabel: '地区', all: '全部',
    resultTotal: (n) => `共 ${n} 家工厂`,
    pageOf: (p, t) => `第 ${p}/${t} 页`,
    emptyTitle: (c, ko, cn) => `搜索${c === 'ko' ? `韩国 ${ko} 家` : `中国 ${cn} 家`}工厂`,
    emptySub: '按工厂名称、产品或行业搜索，或选择上方筛选条件',
    loadError: '无法加载工厂信息。',
    noResults: '没有符合条件的工厂',
    noResultsSub: '请尝试其他搜索词或筛选条件',
    prev: '← 上一页', next: '下一页 →',
    cardKo: '韩国', cardCn: '中国',
    inquiry: '咨询',
    lockNotice: '注册后可查看完整信息',
  },
  es: {
    badge: 'DIRECTORY · Directorio de fábricas Corea-China',
    title: 'Directorio de fabricantes',
    subtitle: (ko, cn) => `${ko} fábricas coreanas · ${cn} chinas en la base de datos`,
    searchPlaceholder: 'Buscar por nombre, producto o sector...',
    tabKo: 'Corea', tabCn: 'China',
    industryLabel: 'Sector', regionLabel: 'Región', all: 'Todos',
    resultTotal: (n) => `${n} fábricas`,
    pageOf: (p, t) => `página ${p}/${t}`,
    emptyTitle: (c, ko, cn) => `Busca ${c === 'ko' ? `${ko} fábricas coreanas` : `${cn} fábricas chinas`}`,
    emptySub: 'Busca por nombre, producto o sector, o elige un filtro arriba',
    loadError: 'No se pudo cargar la información de fábricas.',
    noResults: 'Ninguna fábrica coincide con los criterios',
    noResultsSub: 'Prueba con otra búsqueda o filtro',
    prev: '← Anterior', next: 'Siguiente →',
    cardKo: 'Corea', cardCn: 'China',
    inquiry: 'Contactar',
    lockNotice: 'Regístrate para ver todos los detalles',
  },
  ar: {
    badge: 'DIRECTORY · دليل المصانع الكوري-الصيني',
    title: 'دليل المصنّعين',
    subtitle: (ko, cn) => `قاعدة بيانات ${ko} مصنعًا كوريًا · ${cn} مصنعًا صينيًا`,
    searchPlaceholder: 'ابحث بالاسم أو المنتج أو الصناعة...',
    tabKo: 'كوريا', tabCn: 'الصين',
    industryLabel: 'الصناعة', regionLabel: 'المنطقة', all: 'الكل',
    resultTotal: (n) => `${n} مصنعًا`,
    pageOf: (p, t) => `صفحة ${p}/${t}`,
    emptyTitle: (c, ko, cn) => `ابحث في ${c === 'ko' ? `${ko} مصنعًا كوريًا` : `${cn} مصنعًا صينيًا`}`,
    emptySub: 'ابحث بالاسم أو المنتج أو الصناعة، أو اختر فلترًا من الأعلى',
    loadError: 'تعذّر تحميل بيانات المصانع.',
    noResults: 'لا توجد مصانع مطابقة للمعايير',
    noResultsSub: 'جرّب بحثًا أو فلترًا مختلفًا',
    prev: '→ السابق', next: 'التالي ←',
    cardKo: 'كوريا', cardCn: 'الصين',
    inquiry: 'استفسار',
    lockNotice: 'سجّل لعرض كامل المعلومات',
  },
};

const SEG_TO_LANG: Record<string, FactLang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar',
};

/** Resolve the UI language from the first path segment (the `[lang]` route).
 *  The bare `/factories` route (no lang prefix) defaults to Korean. */
export function pickFactLang(pathname: string | null | undefined): FactLang {
  const seg = (pathname ?? '').split('/').filter(Boolean)[0];
  return SEG_TO_LANG[seg ?? ''] ?? 'ko';
}
