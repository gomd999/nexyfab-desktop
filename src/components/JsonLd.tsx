import type { Lang } from '@/lib/metaHelper';

const BASE_URL = 'https://nexyfab.com';

const SEARCH_PLACEHOLDERS: Record<Lang, string> = {
    kr: '배터리 자동화 설비',
    en: 'Battery Automation',
    ja: 'バッテリー自動化設備',
    cn: '电池自动化设备',
    es: 'Automatización de baterías',
    ar: 'أتمتة البطاريات',
};

export default function JsonLd({ lang }: { lang: Lang }) {
    const descriptions: Record<Lang, string> = {
        kr: 'AI 3D 모델링부터 AI 견적까지. 30만+ 공장 DB 기반으로 최적의 제조 파트너를 매칭하는 올인원 플랫폼입니다.',
        en: 'From AI 3D modeling to instant quoting. Match with the best manufacturers from our 300,000+ factory database.',
        ja: 'AI 3Dモデリングから見積もりまで。30万件以上の工場DBから最適な製造パートナーをマッチングするプラットフォームです。',
        cn: '从AI 3D建模到即时报价。基于30万+工厂数据库匹配最优制造合作伙伴的一站式平台。',
        es: 'Desde modelado 3D con IA hasta cotización instantánea. Encuentre el mejor socio entre más de 300,000 fábricas.',
        ar: 'من النمذجة ثلاثية الأبعاد بالذكاء الاصطناعي إلى التسعير الفوري. مطابقة مع أفضل المصنعين من قاعدة بيانات تضم أكثر من 300,000 مصنع.',
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
            availableLanguage: ['Korean', 'English', 'Japanese', 'Chinese'],
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
        name: lang === 'kr' ? '제조 파트너 매칭 서비스' : 'Manufacturing Partner Matching',
        serviceType: 'B2B Matching',
        provider: {
            '@type': 'Organization',
            name: 'Nexyfab',
        },
        areaServed: ['KR', 'CN', 'JP', 'US', 'GB'],
        availableLanguage: ['Korean', 'English', 'Japanese', 'Chinese'],
        description: descriptions[lang],
    };

    const breadcrumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            {
                '@type': 'ListItem',
                position: 1,
                name: lang === 'kr' ? '홈' : 'Home',
                item: `${BASE_URL}/${lang}`,
            },
            {
                '@type': 'ListItem',
                position: 2,
                name: lang === 'kr' ? '회사소개' : 'About',
                item: `${BASE_URL}/${lang}/company-introduction`,
            },
        ],
    };

    const nav = {
        '@context': 'https://schema.org',
        '@type': 'SiteNavigationElement',
        name: [
            lang === 'kr' ? '이용방법' : 'How It Works',
            lang === 'kr' ? '파트너 등록' : 'Partners',
            lang === 'kr' ? '회사소개' : 'About',
            lang === 'kr' ? '프로젝트 문의' : 'Inquiry',
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
