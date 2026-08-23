import type { Lang } from '@/lib/metaHelper';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

const BASE_URL = 'https://nexyfab.com';

const _SEARCH_PLACEHOLDERS: Record<Lang, string> = {
    kr: '배터리 자동화 설비',
    en: 'Battery Automation',
    ja: 'バッテリー自動化設備',
    cn: '电池自动化设备',
    es: 'Automatización de baterías',
    ar: 'أتمتة البطاريات',
};

export default function JsonLd({ lang }: { lang: Lang }) {
    const iso = toIsoLang(lang);
    const descriptions: Record<Lang, string> = {
        kr: 'AI 3D 모델링부터 AI 견적까지. 28만+ 공장 DB 기반으로 최적의 제조 파트너를 매칭하는 올인원 플랫폼입니다.',
        en: 'From AI 3D modeling to instant quoting. Match with manufacturers from our 286,000+ factory database.',
        ja: 'AI 3Dモデリングから見積もりまで。28万件以上の工場DBから最適な製造パートナーをマッチングするプラットフォームです。',
        cn: '从AI 3D建模到即时报价。基于28万+工厂数据库匹配最优制造合作伙伴的一站式平台。',
        es: 'Desde modelado 3D con IA hasta cotización instantánea. Encuentre el mejor socio entre más de 286,000 fábricas.',
        ar: 'من النمذجة ثلاثية الأبعاد بالذكاء الاصطناعي إلى التسعير الفوري. مطابقة مع أفضل المصنعين من قاعدة بيانات تضم أكثر من 286,000 مصنع.',
    };

    const organization = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Nexyfab',
        url: BASE_URL,
        logo: `${BASE_URL}/logo.png`,
        sameAs: [],
        description: descriptions[lang],
        contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'customer service',
            availableLanguage: ['Korean', 'English', 'Japanese', 'Chinese', 'Spanish', 'Arabic'],
        },
    };

    const website = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Nexyfab',
        url: BASE_URL,
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${BASE_URL}/${lang}?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
        },
    };

    const service = {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: ({ ko: '제조 파트너 매칭 서비스', en: 'Manufacturing Partner Matching', ja: '製造パートナーマッチングサービス', zh: '制造合作伙伴匹配服务', es: 'Servicio de emparejamiento de socios de fabricación', ar: 'خدمة مطابقة شركاء التصنيع' } satisfies Record<IsoLang, string>)[iso],
        serviceType: 'B2B Matching',
        provider: {
            '@type': 'Organization',
            name: 'Nexyfab',
        },
        areaServed: ['KR', 'CN', 'JP', 'US', 'GB'],
        availableLanguage: ['Korean', 'English', 'Japanese', 'Chinese', 'Spanish', 'Arabic'],
        description: descriptions[lang],
    };

    const breadcrumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            {
                '@type': 'ListItem',
                position: 1,
                name: ({ ko: '홈', en: 'Home', ja: 'ホーム', zh: '首页', es: 'Inicio', ar: 'الرئيسية' } satisfies Record<IsoLang, string>)[iso],
                item: `${BASE_URL}/${lang}`,
            },
            {
                '@type': 'ListItem',
                position: 2,
                name: ({ ko: '회사소개', en: 'About', ja: '会社概要', zh: '关于我们', es: 'Acerca de', ar: 'من نحن' } satisfies Record<IsoLang, string>)[iso],
                item: `${BASE_URL}/${lang}/company-introduction`,
            },
        ],
    };

    const nav = {
        '@context': 'https://schema.org',
        '@type': 'SiteNavigationElement',
        name: [
            ({ ko: '이용방법', en: 'How It Works', ja: '使い方', zh: '使用方法', es: 'Cómo funciona', ar: 'كيفية الاستخدام' } satisfies Record<IsoLang, string>)[iso],
            ({ ko: '파트너 등록', en: 'Partners', ja: 'パートナー登録', zh: '合作伙伴注册', es: 'Socios', ar: 'الشركاء' } satisfies Record<IsoLang, string>)[iso],
            ({ ko: '회사소개', en: 'About', ja: '会社概要', zh: '关于我们', es: 'Acerca de', ar: 'من نحن' } satisfies Record<IsoLang, string>)[iso],
            ({ ko: '프로젝트 문의', en: 'Inquiry', ja: 'プロジェクト相談', zh: '项目咨询', es: 'Consulta de proyecto', ar: 'استفسار عن مشروع' } satisfies Record<IsoLang, string>)[iso],
        ],
        url: [
            `${BASE_URL}/${lang}/how-it-works`,
            `${BASE_URL}/${lang}/partner-register`,
            `${BASE_URL}/${lang}/company-introduction`,
            `${BASE_URL}/${lang}/project-inquiry`,
        ],
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(service) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(nav) }}
            />
        </>
    );
}
