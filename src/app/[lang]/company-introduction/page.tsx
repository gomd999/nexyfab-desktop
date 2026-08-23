'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { richText } from '@/lib/richText';
import { loc } from '@/lib/i18n/loc';

const dict = {
    ko: {
        heroKicker: 'Nexysys · About.',
        heroTitle: '회사 소개',
        heroSub: '(Our Story & Vision)',
        heroDesc: '개발이 어려운 이유는 기술이나 비용 문제가 아니라,<br/>시작하는 방법조차 알 수 없는 파편화된 구조 때문입니다.',
        badge1: 'Data Matching', badge2: 'End-to-End', badge3: 'Risk Control',
        anchor: '더 알아보기 ↓',
        ceoLabel: '기업 소개',
        ceoQuote: '”제조업의 미래를 설계하는 산업 AI 연구 집단, 주식회사 넥시시스(Nexysys)입니다.”',
        ceoName: 'About Nexysys',
        sec1P2: '<b>Nexysys</b>는 치열한 <b>산업 현장(Industrial Field)</b>에서 직접 마주한 폐쇄적인 정보망과 비효율적 관행을 뼈저리게 느끼며 출발한 <b>AI 연구 집단(AI Research Group)</b>입니다.',
        sec1P3: '현장에서 목격한 파편화된 제조 생태계의 구조적 문제를 해결하기 위해, 우리는 한·중 제조사 B2B 매칭에 특화된 브랜드 <b>Nexyfab</b>을 운영하고 있습니다.',
        sec1P4: 'Nexysys의 AI 연구 역량과 현장 데이터를 기반으로, Nexyfab은 아이디어가 현실이 되는 가장 빠르고 신뢰할 수 있는 제조 매칭 경험을 제공합니다.',
        brandLabel: 'Brand',
        brandDesc: 'B2B 제조 매칭 특화 브랜드',
        calloutTitle: '🔍 우리가 현장에서 본 문제들',
        calloutItem1: '이 제품을 실제로 만들 수 있는 업체인지 판단하기 어려움',
        calloutItem2: '업체 개별 컨택으로 인한 시간·비용 낭비',
        calloutItem3: '개발 실패 원인을 사전에 파악하거나 예방할 수 없음',
        calloutBottom: 'Nexysys는 이 문제들이 단순한 정보 부족이 아니라 <b>\'판단 기준\'과 \'연결 구조\'의 부재</b>에서 비롯된다고 보았습니다.',
        methodTitle: 'Nexyfab의 방법론',
        core1Icon: '📊', core1Title: 'Data-Driven Matching',
        core1Desc: '한국과 중국의 28만 개 이상의 제조사 데이터와 실제 개발·양산 레퍼런스를 기반으로 프로젝트 적합도를 분석합니다.',
        core1Quote: '"할 수 있는 업체만 남기고, 아닌 경우는 사전에 걸러냅니다."',
        core2Icon: '🔗', core2Title: 'End-to-End 관점',
        core2Desc: '기획 단계부터 양산까지를 하나의 연속된 흐름으로 보고, 파편화된 중간 과정에서 발생하는 리스크를 통합하여 사전에 점검합니다.',
        core2Quote: '"미팅을 늘리는 플랫폼이 아니라, 의사결정을 빠르게 만드는 플랫폼"',
        core3Icon: '🛡️', core3Title: 'Risk Control',
        core3Desc: '프로젝트 시작 전 기술적·현실적 한계를 명확히 설명하고, 무리한 매칭은 지양하여 안전성을 보장합니다.',
        core3Quote: '"연결보다 판단을 먼저 합니다."',
        vmTitle: '우리가 만들고 싶은 미래',
        visionTitle: 'Vision', visionDesc: '개발의 장벽을 낮추고,\n아이디어가 더 빠르게 현실이 되는 환경을 만듭니다.',
        missionTitle: 'Mission', missionDesc: 'AI와 산업 데이터를 통해\n개발 성공 확률을 높이는 의사결정을 돕습니다.',
        valueTitle: 'Value', valueDesc: '연결보다 판단을 먼저 하고,\n경험과 성과가 검증된 선택만을 제공합니다.',
        promiseTitle: 'Promise', promiseDesc: '무리한 매칭은 하지 않으며,\n실패 가능성까지 투명하게 설명합니다.',
        closingLine1: '개발이 필요할 때,', closingLine2: '가장 먼저 떠오르는 플랫폼',
                ctaTitle: "비즈니스 아이디어를 현실로",
        ctaDesc: "지금 바로 Nexyfab의 프리미엄 매칭을 경험해보세요.",
        ctaBtn: "프로젝트 의뢰하기",
closingCeo: '대표이사 홍석영 (Hong Seog-yeong)',
    },
    en: {
        heroKicker: 'Nexysys · About.',
        heroTitle: 'Company Introduction',
        heroSub: '(Our Story & Vision)',
        heroDesc: 'The reason development is difficult is not technology or cost,<br/>but the fragmented structure where you don\'t even know how to start.',
        badge1: 'Data Matching', badge2: 'End-to-End', badge3: 'Risk Control',
        anchor: 'Learn more ↓',
        ceoLabel: 'About Us',
        ceoQuote: '”Intelligent via Nexysys, realized via Nexyfab.”',
        ceoName: 'Nexysys & Nexyfab',
        sec1P2: '<b>Nexysys</b> is an AI research group born from the frustration of a closed, fragmented industrial ecosystem — combining industrial data and AI to solve structural manufacturing problems.',
        sec1P3: 'To address these problems in the field, we operate <b>Nexyfab</b> — our dedicated brand specializing in B2B manufacturing matching for Korean and Chinese manufacturers.',
        sec1P4: 'Backed by Nexysys AI capabilities and field data, Nexyfab delivers the fastest and most reliable manufacturing matching experience from idea to reality.',
        brandLabel: 'Brand',
        brandDesc: 'B2B Manufacturing Matching Brand',
        calloutTitle: '🔍 Problems We Saw on Site',
        calloutItem1: 'Hard to judge whether a vendor can actually build the product',
        calloutItem2: 'Time and cost wasted on individual vendor contacts',
        calloutItem3: 'Unable to identify or prevent development failure causes in advance',
        calloutBottom: 'Nexyfab saw these problems stem from the <b>absence of "judgment criteria" and "connection structure"</b>, not just lack of information.',
        methodTitle: 'Our Methodology',
        core1Icon: '📊', core1Title: 'Data-Driven Matching',
        core1Desc: 'We analyze project suitability based on a Korea-China manufacturer database and real production references.',
        core1Quote: '"We keep only qualified vendors and filter out others in advance."',
        core2Icon: '🔗', core2Title: 'End-to-End Perspective',
        core2Desc: 'We view the process from planning to mass production as one continuous flow, managing risks that occur in fragmented intermediate stages.',
        core2Quote: '"Not a platform that multiplies meetings, but one that accelerates decisions."',
        core3Icon: '🛡️', core3Title: 'Risk Control',
        core3Desc: 'We clearly explain technical and realistic limits before starting and avoid risky matching to ensure safety.',
        core3Quote: '"We judge before we connect."',
        vmTitle: 'The Future We Want to Build',
        visionTitle: 'Vision', visionDesc: 'Lowering the barrier to development\nand making ideas become reality faster.',
        missionTitle: 'Mission', missionDesc: 'Helping decision-making to increase\ndevelopment success probability through AI and data.',
        valueTitle: 'Value', valueDesc: 'Judgment before connection,\nproviding only verified choices based on results.',
        promiseTitle: 'Promise', promiseDesc: 'No forced matching,\ntransparent explanation of failure possibilities.',
        closingLine1: 'When development is needed,', closingLine2: 'The first platform you think of.',
                ctaTitle: "Turn Your Business Ideas into Reality",
        ctaDesc: "Experience Nexyfab\'s premium matching today.",
        ctaBtn: "Request Expert Consulting",
closingCeo: 'CEO Hong Seog-yeong',
    },
    ja: {
        heroKicker: 'Nexysys · About.',
        heroTitle: '会社紹介',
        heroSub: '(Our Story & Vision)',
        heroDesc: '開発が難しい理由は技術や費用の問題ではなく、<br/>開始する方法さえ分からない断片化された構造のためです。',
        badge1: 'Data Matching', badge2: 'End-to-End', badge3: 'Risk Control',
        anchor: 'もっと見る ↓',
        ceoLabel: '企業紹介',
        ceoQuote: '「製造業の未来を設計する産業AI研究集団、株式会社Nexysysです。」',
        ceoName: 'About Nexysys',
        sec1P2: '<b>Nexysys</b>は、産業現場で目の当たりにした閉鎖的な情報網と非効率な慣行を解決するために立ち上がった<b>AI研究集団（AI Research Group）</b>です。',
        sec1P3: '現場の課題を解決するため、私たちは韓国・中国製造業者のB2Bマッチングに特化したブランド<b>Nexyfab</b>を運営しています。',
        sec1P4: 'NexysysのAI研究力と現場データを基盤に、NexyfabはアイデアをB2B製造へ繋ぐ、最も速く信頼できるマッチング体験を提供します。',
        brandLabel: 'ブランド',
        brandDesc: 'B2B製造マッチング特化ブランド',
        calloutTitle: '🔍 現場で見た課題',
        calloutItem1: '実際に作れる業者なのか判断が難しい',
        calloutItem2: '個別コンタクトによる時間・費用の浪費',
        calloutItem3: '開発失敗の原因を事前に把握したり予防したりできない',
        calloutBottom: 'Nexyfabは、これらの問題が単なる情報不足ではなく、<b>「判断基準」と「連結構造」の不在</b>から生じていると考えました。',
        methodTitle: '私たちの方法論',
        core1Icon: '📊', core1Title: 'Data-Driven Matching',
        core1Desc: '韓国と中国の28万以上の製造社データと実際の実績に基づいて適合度を分析します。',
        core1Quote: '「可能な業者だけを残し、そうでない場合は事前にフィルタリングします。」',
        core2Icon: '🔗', core2Title: 'End-to-End の視点',
        core2Desc: '企画から量産までを一連の流れとして捉え、断片的な過程で発生するリスクを統合的に事前点検しケアします。',
        core2Quote: '「ミーティングを増やすプラットフォームではなく、意思決定を加速するプラットフォーム」',
        core3Icon: '🛡️', core3Title: 'Risk Control',
        core3Desc: '開始前に技術的・現実的な限界を明確に説明し、無理なマッチングを避けることで安全性を保証します。',
        core3Quote: '「繋ぐよりもまず判断します。」',
        vmTitle: '私たちが作りたい未来',
        visionTitle: 'Vision', visionDesc: '開発の障壁を下げ、\nアイデアがより速く現実になる環境を作ります。',
        missionTitle: 'Mission', missionDesc: 'AIとデータを通じて、\n開発成功率を高める意思決定を支援します。',
        valueTitle: 'Value', valueDesc: '繋ぐよりもまず判断し、\n実績が検証された選択肢のみを提供します。',
        promiseTitle: 'Promise', promiseDesc: '無理なマッチングはせず、\n失敗可能性も透明に説明します。',
        closingLine1: '開発が必要なとき、', closingLine2: '最初に思い浮かぶプラットフォーム',
                ctaTitle: "ビジネスアイデアを現実に",
        ctaDesc: "今すぐNexyfabのプレミアムマッチングをご体験ください。",
        ctaBtn: "専門家コンサルティングを申し込む",
closingCeo: '代表取締役 洪碩鍈',
    },
    zh: {
        heroKicker: 'Nexysys · About.',
        heroTitle: '公司介绍',
        heroSub: '(Our Story & Vision)',
        heroDesc: '开发之所以困难，不在于技术或成本，<br/>而在于甚至不知道如何开始的碎片化结构。',
        badge1: '数据匹配', badge2: '端到端', badge3: '风险控制',
        anchor: '了解更多 ↓',
        ceoLabel: '公司介绍',
        ceoQuote: '”通过 Nexysys 实现智能化，通过 Nexyfab 变为现实。”',
        ceoName: 'Nexysys & Nexyfab',
        sec1P2: '<b>Nexysys</b> 是一个AI研究集团，立志于解决工业现场中封闭信息网络和低效惯例等结构性问题。',
        sec1P3: '为解决这些现场难题，我们运营着专注于韩中制造商B2B匹配的品牌 <b>Nexyfab</b>。',
        sec1P4: '依托Nexysys的AI研究实力与现场数据，Nexyfab为客户提供从创意到制造落地最快、最可靠的匹配体验。',
        brandLabel: '品牌',
        brandDesc: 'B2B 制造商匹配专属品牌',
        calloutTitle: '🔍 我们在现场发现的问题',
        calloutItem1: '难以判断供应商是否具备实际制造能力',
        calloutItem2: '因单独联系供应商而造成的时间和成本浪费',
        calloutItem3: '无法提前识别或预防开发失败的原因',
        calloutBottom: 'Nexyfab 认为，这些问题更是由于<b>"评估标准"和"连接结构"的缺失</b>。',
        methodTitle: '我们的方法论',
        core1Icon: '📊', core1Title: '数据驱动匹配',
        core1Desc: '我们基于韩国和中国 28 万家以上的制造商数据和实际生产案例分析项目匹配度。',
        core1Quote: '"仅保留合格供应商，提前过滤不匹配的供应商。"',
        core2Icon: '🔗', core2Title: '端到端视角',
        core2Desc: '我们将从规划到量产的过程视为一个连续的流程，整合并管理在碎片化的中间阶段发生的风险。',
        core2Quote: '"不是增加会议的平台，而是加速决策的平台。"',
        core3Icon: '🛡️', core3Title: '风险控制',
        core3Desc: '我们在项目开始前明确说明技术和现实限制，避免盲目匹配，从而确保项目的安全性。',
        core3Quote: '"先判断，再连接。"',
        vmTitle: '我们想创造的未来',
        visionTitle: '愿景', visionDesc: '降低开发门槛，\n创造让创意更快成为现实的环境。',
        missionTitle: '使命', missionDesc: '通过 AI 和工业数据提供决策支持，\n提高开发成功率。',
        valueTitle: '价值', valueDesc: '评估由于连接，\n仅提供经过经验和成果验证的选择。',
        promiseTitle: '承诺', promiseDesc: '不进行强制匹配，\n透明地说明失败可能性。',
        closingLine1: '需要开发时，', closingLine2: '第一个想到的平台',
                ctaTitle: "将商业理念变为现实",
        ctaDesc: "立即体验 Nexyfab 的高级匹配。",
        ctaBtn: "申请专家咨询",
closingCeo: '代表董事 洪碩鍈',
    },
    /** ⚠ 260802: es·ar 이 허용 목록에도 없어 영어로 떨어졌다 — 라이브 실측 es↔en 단어일치 74%. */
    es: {
        heroKicker: 'Nexysys · Acerca de.',
        heroTitle: 'Presentación de la empresa',
        heroSub: '(Nuestra historia y visión)',
        heroDesc: 'La razón por la que desarrollar es difícil no es la tecnología ni el coste,<br/>sino una estructura fragmentada en la que ni siquiera se sabe por dónde empezar.',
        badge1: 'Emparejamiento por datos', badge2: 'De extremo a extremo', badge3: 'Control de riesgos',
        anchor: 'Saber más ↓',
        ceoLabel: 'Quiénes somos',
        ceoQuote: '”Inteligencia con Nexysys, realización con Nexyfab.”',
        ceoName: 'Nexysys y Nexyfab',
        sec1P2: '<b>Nexysys</b> es un grupo de investigación en IA nacido de la frustración ante un ecosistema industrial cerrado y fragmentado: combina datos industriales e IA para resolver problemas estructurales de la fabricación.',
        sec1P3: 'Para abordar estos problemas sobre el terreno, operamos <b>Nexyfab</b>, nuestra marca especializada en el emparejamiento B2B de fabricación con fabricantes coreanos y chinos.',
        sec1P4: 'Respaldada por las capacidades de IA de Nexysys y por datos de campo, Nexyfab ofrece la experiencia de emparejamiento de fabricación más rápida y fiable, desde la idea hasta la realidad.',
        brandLabel: 'Marca',
        brandDesc: 'Marca de emparejamiento de fabricación B2B',
        calloutTitle: '🔍 Problemas que vimos sobre el terreno',
        calloutItem1: 'Es difícil saber si un proveedor puede fabricar realmente el producto',
        calloutItem2: 'Se pierden tiempo y dinero contactando con proveedores uno a uno',
        calloutItem3: 'No es posible identificar ni prevenir de antemano las causas del fracaso del desarrollo',
        calloutBottom: 'Nexyfab entendió que estos problemas nacen de la <b>ausencia de «criterios de juicio» y de «estructura de conexión»</b>, y no solo de la falta de información.',
        methodTitle: 'Nuestra metodología',
        core1Icon: '📊', core1Title: 'Emparejamiento basado en datos',
        core1Desc: 'Analizamos la idoneidad del proyecto a partir de una base de datos de fabricantes de Corea y China y de referencias reales de producción.',
        core1Quote: '«Mantenemos solo a los proveedores cualificados y filtramos el resto de antemano.»',
        core2Icon: '🔗', core2Title: 'Perspectiva de extremo a extremo',
        core2Desc: 'Vemos el proceso, desde la planificación hasta la producción en serie, como un flujo continuo, y gestionamos los riesgos que surgen en las etapas intermedias fragmentadas.',
        core2Quote: '«No una plataforma que multiplica reuniones, sino una que acelera decisiones.»',
        core3Icon: '🛡️', core3Title: 'Control de riesgos',
        core3Desc: 'Explicamos con claridad los límites técnicos y realistas antes de empezar y evitamos emparejamientos arriesgados para garantizar la seguridad.',
        core3Quote: '«Juzgamos antes de conectar.»',
        vmTitle: 'El futuro que queremos construir',
        visionTitle: 'Visión', visionDesc: 'Rebajar la barrera del desarrollo\ny lograr que las ideas se hagan realidad más rápido.',
        missionTitle: 'Misión', missionDesc: 'Apoyar la toma de decisiones para aumentar\nla probabilidad de éxito del desarrollo mediante IA y datos.',
        valueTitle: 'Valor', valueDesc: 'Juicio antes que conexión:\nsolo opciones verificadas y basadas en resultados.',
        promiseTitle: 'Compromiso', promiseDesc: 'Sin emparejamientos forzados,\ncon explicación transparente de las posibilidades de fracaso.',
        closingLine1: 'Cuando se necesita desarrollo,', closingLine2: 'la primera plataforma en la que se piensa.',
        ctaTitle: 'Convierta sus ideas de negocio en realidad',
        ctaDesc: 'Descubra hoy el emparejamiento premium de Nexyfab.',
        ctaBtn: 'Solicitar consultoría experta',
        closingCeo: 'CEO Hong Seog-yeong',
    },
    ar: {
        heroKicker: 'Nexysys · من نحن.',
        heroTitle: 'نبذة عن الشركة',
        heroSub: '(قصتنا ورؤيتنا)',
        heroDesc: 'سبب صعوبة التطوير ليس التقنية ولا التكلفة،<br/>بل بنية مجزّأة لا تعرف معها من أين تبدأ أصلاً.',
        badge1: 'مطابقة قائمة على البيانات', badge2: 'من البداية إلى النهاية', badge3: 'ضبط المخاطر',
        anchor: 'اعرف المزيد ↓',
        ceoLabel: 'من نحن',
        ceoQuote: '”الذكاء مع Nexysys، والتنفيذ مع Nexyfab.”',
        ceoName: 'Nexysys و Nexyfab',
        sec1P2: '<b>Nexysys</b> مجموعة أبحاث في الذكاء الاصطناعي نشأت من إحباط إزاء منظومة صناعية مغلقة ومجزّأة — تجمع بين البيانات الصناعية والذكاء الاصطناعي لحل المشكلات البنيوية في التصنيع.',
        sec1P3: 'ولمعالجة هذه المشكلات ميدانياً، نُشغّل <b>Nexyfab</b>، علامتنا المتخصصة في مطابقة التصنيع B2B مع المصنّعين الكوريين والصينيين.',
        sec1P4: 'وبفضل قدرات Nexysys في الذكاء الاصطناعي وبيانات الميدان، تقدّم Nexyfab أسرع تجربة مطابقة تصنيع وأكثرها موثوقية، من الفكرة إلى الواقع.',
        brandLabel: 'العلامة',
        brandDesc: 'علامة مطابقة التصنيع B2B',
        calloutTitle: '🔍 مشكلات رأيناها في الميدان',
        calloutItem1: 'يصعب الحكم على قدرة المورّد الفعلية على تصنيع المنتج',
        calloutItem2: 'يُهدر الوقت والمال في التواصل مع المورّدين واحداً تلو الآخر',
        calloutItem3: 'يتعذّر تحديد أسباب فشل التطوير أو منعها مسبقاً',
        calloutBottom: 'أدركت Nexyfab أن هذه المشكلات تنبع من <b>غياب «معايير الحكم» و«بنية الربط»</b>، لا من نقص المعلومات وحده.',
        methodTitle: 'منهجيتنا',
        core1Icon: '📊', core1Title: 'مطابقة قائمة على البيانات',
        core1Desc: 'نحلّل مدى ملاءمة المشروع استناداً إلى قاعدة بيانات للمصنّعين في كوريا والصين وإلى مراجع إنتاج فعلية.',
        core1Quote: '«نُبقي على المورّدين المؤهلين فقط ونستبعد غيرهم مسبقاً.»',
        core2Icon: '🔗', core2Title: 'نظرة من البداية إلى النهاية',
        core2Desc: 'ننظر إلى المسار من التخطيط حتى الإنتاج الكمي بوصفه تدفّقاً متصلاً، وندير المخاطر التي تنشأ في المراحل الوسيطة المجزّأة.',
        core2Quote: '«لسنا منصة تضاعف الاجتماعات، بل منصة تُسرّع القرارات.»',
        core3Icon: '🛡️', core3Title: 'ضبط المخاطر',
        core3Desc: 'نوضّح بجلاء الحدود التقنية والواقعية قبل البدء، ونتجنّب المطابقات المحفوفة بالمخاطر ضماناً للسلامة.',
        core3Quote: '«نحكم قبل أن نربط.»',
        vmTitle: 'المستقبل الذي نريد بناءه',
        visionTitle: 'الرؤية', visionDesc: 'خفض حاجز الدخول إلى التطوير\nوتسريع تحول الأفكار إلى واقع.',
        missionTitle: 'الرسالة', missionDesc: 'دعم اتخاذ القرار لزيادة\nاحتمال نجاح التطوير عبر الذكاء الاصطناعي والبيانات.',
        valueTitle: 'القيمة', valueDesc: 'الحكم قبل الربط،\nوتقديم خيارات متحقّق منها وقائمة على النتائج فحسب.',
        promiseTitle: 'التزامنا', promiseDesc: 'لا مطابقة قسرية،\nوشرح شفّاف لاحتمالات الفشل.',
        closingLine1: 'عند الحاجة إلى التطوير،', closingLine2: 'المنصة الأولى التي تخطر ببالك.',
        ctaTitle: 'حوّل أفكارك التجارية إلى واقع',
        ctaDesc: 'جرّب اليوم مطابقة Nexyfab المتميزة.',
        ctaBtn: 'اطلب استشارة متخصصة',
        closingCeo: 'الرئيس التنفيذي هونغ سوك يونغ',
    }
};

export default function CompanyIntroductionPage() {
    const pathname = usePathname();
    const langCode = pathname.split('/')[1] || 'en';
    const lang = ['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en';
    const t = dict[lang === 'cn' ? 'zh' : lang === 'kr' ? 'ko' : lang as keyof typeof dict];
    const ecoDescription = loc(lang, {
        ko: '제조업 난제를 해결하는 산업 AI 연구 집단',
        en: 'An industrial AI research group solving manufacturing challenges',
        ja: '製造業の課題を解決する産業AI研究グループ',
        zh: '解决制造业难题的产业 AI 研究团队',
        es: 'Grupo de investigación de IA industrial que resuelve retos de fabricación',
        ar: 'مجموعة أبحاث في الذكاء الاصطناعي الصناعي لحل تحديات التصنيع',
    });
    const accentDescription = loc(lang, {
        ko: '독자적 산업 데이터 기반\n지능형 매칭 엔진',
        en: 'Proprietary industrial data\nIntelligent matching engine',
        ja: '独自の産業データ基盤\nインテリジェントマッチングエンジン',
        zh: '自主产业数据基础\n智能匹配引擎',
        es: 'Datos industriales propios\nMotor de emparejamiento inteligente',
        ar: 'بيانات صناعية مملوكة\nمحرك مطابقة ذكي',
    });

    React.useEffect(() => {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        let observer: IntersectionObserver;
        const raf = requestAnimationFrame(() => {
          observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.classList.add('active');
              }
            });
          }, observerOptions);
          document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        });

        return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
    }, []);

    return (
        <div id="Nexyfab-company-intro">
            {/* ── Hero ── */}
            <section className="hat-hero hat-hero-about reveal">
                <div className="hat-hero-inner">
                    <p className="hat-kicker">{t.heroKicker}</p>
                    <h1 className="hat-hero-title">
                        {t.heroTitle} <span className="hat-hero-sub">{t.heroSub}</span>
                    </h1>
                    <p className="hat-hero-copy">{richText(t.heroDesc)}</p>
                    <div className="hat-hero-meta">
                        <span className="hat-pill">{t.badge1}</span>
                        <span className="hat-pill">{t.badge2}</span>
                        <span className="hat-pill">{t.badge3}</span>
                    </div>
                    <a href="#philosophy" className="hat-anchor">{t.anchor}</a>
                </div>
            </section>

            <section id="philosophy" className="hat-section">
                <div className="ci-wrap">

                    
                    {/* ── Eco System Flow ── */}
                    <div className="ci-eco-flow reveal">
                        <div className="ci-eco-node ci-eco-blue">
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4>Nexysys</h4>
                                <p><strong style={{color:'#0056ff'}}>AI Research Group</strong><br/>{ecoDescription}</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#9ca3af', fontSize: '12px' }}>
                            <svg width="2" height="24" viewBox="0 0 2 24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d1d5db" strokeWidth="2" strokeDasharray="4 3"/></svg>
                            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t.brandLabel}</span>
                            <svg width="2" height="24" viewBox="0 0 2 24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d1d5db" strokeWidth="2" strokeDasharray="4 3"/></svg>
                        </div>
                        <div className="ci-eco-node" style={{ border: '2px solid #0b5cff', background: '#eff6ff' }}>
                            <div className="ci-eco-glow"></div>
                            <div className="ci-eco-node-content">
                                <h4 style={{ color: '#0b5cff' }}>Nexyfab</h4>
                                <p><strong style={{color:'#0b5cff'}}>B2B Manufacturing Matching</strong><br/>{t.brandDesc}</p>
                            </div>
                        </div>
                    </div>
                    <div className="ci-ceo-content reveal" style={{marginTop: '40px'}}>
                        <div className="ci-ceo-text" style={{textAlign: 'center'}}>
                            <span className="ci-label">{t.ceoLabel}</span>
                            <blockquote className="ci-quote" style={{borderLeft:'none', padding:'0', fontStyle:'italic'}}>{t.ceoQuote}</blockquote>
                            <div className="ci-story" style={{maxWidth:'800px', margin:'0 auto', gap:'10px'}}>
                                <p>{richText(t.sec1P2)}</p>
                                <p>{richText(t.sec1P3)}</p>
                                <p>{richText(t.sec1P4)}</p>
                            </div>
                        </div>
                    </div>


                    {/* ── Callout Box ── */}
                    <div className="ci-callout reveal">
                        <h3 className="ci-callout-title">{t.calloutTitle}</h3>
                        <ul className="ci-callout-list">
                            <li>{t.calloutItem1}</li>
                            <li>{t.calloutItem2}</li>
                            <li>{t.calloutItem3}</li>
                        </ul>
                        <p className="ci-callout-bottom">{richText(t.calloutBottom)}</p>
                    </div>

                    {/* ── Method Cards ── */}
                    <div className="ci-method-head reveal">
                        <h2>{t.methodTitle}</h2>
                    </div>
                    <div className="ci-method-grid">
                        <div className="ci-method-card ci-method-blue reveal">
                            <span className="ci-method-icon">{t.core1Icon}</span>
                            <h3>{t.core1Title}</h3>
                            <p>{t.core1Desc}</p>
                            <blockquote className="ci-method-quote">{t.core1Quote}</blockquote>
                        </div>
                        <div className="ci-method-card ci-method-indigo reveal">
                            <span className="ci-method-icon">{t.core2Icon}</span>
                            <h3>{t.core2Title}</h3>
                            <p>{t.core2Desc}</p>
                            <blockquote className="ci-method-quote">{t.core2Quote}</blockquote>
                        </div>
                        <div className="ci-method-card ci-method-green reveal">
                            <span className="ci-method-icon">{t.core3Icon}</span>
                            <h3>{t.core3Title}</h3>
                            <p>{t.core3Desc}</p>
                            <blockquote className="ci-method-quote">{t.core3Quote}</blockquote>
                        </div>
                    </div>

                    
                    {/* ── Philosophy divider label ── */}
                    <div className="ci-vm-head reveal">
                        <span className="ci-vm-head-tag">{t.vmTitle}</span>
                    </div>

                    {/* ── Bento Grid ── */}
                    <div className="ci-bento-grid reveal">
                        <div className="ci-bento-card ci-bento-large">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.visionTitle}</span>
                            <p className="ci-bento-desc">{t.visionDesc}</p>
                        </div>
                        <div className="ci-bento-card">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.missionTitle}</span>
                            <p className="ci-bento-desc">{t.missionDesc}</p>
                        </div>
                        <div className="ci-bento-card">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.valueTitle}</span>
                            <p className="ci-bento-desc">{t.valueDesc}</p>
                        </div>
                        <div className="ci-bento-card ci-bento-wide">
                            <div className="ci-bento-glow"></div>
                            <span className="ci-bento-label">{t.promiseTitle}</span>
                            <p className="ci-bento-desc">{t.promiseDesc}</p>
                        </div>
                        <div className="ci-bento-card ci-bento-accent">
                            <div className="ci-bento-accent-content">
                                <h3>AI-Driven</h3>
                                <p>{accentDescription}</p>
                                <div className="bento-accent-circles">
                                    <div className="cac1"></div><div className="cac2"></div><div className="cac3"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── CTA ── */}
                    <div className="ci-cta-section reveal">
                        <h2>{t.ctaTitle}</h2>
                        <p>{t.ctaDesc}</p>
                        <a href={`/${lang}/project-inquiry`} className="ci-glow-btn">{t.ctaBtn}</a>
                    </div>




                </div>
            </section >
        </div >
    );
}
