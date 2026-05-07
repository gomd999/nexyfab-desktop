'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type LangKey = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const dict: Record<LangKey, {
    hero: string;
    heroSub: string;
    standard: string;
    premium: string;
    period: string;
    standardFeatures: string[];
    premiumFeatures: string[];
    standardNote: string;
    premiumNote: string;
    commissionTitle: string;
    commissionDesc: string;
    commissionRate: string;
    deductionLabel: string;
    deductionDesc: string;
    consultNote: string;
    exampleTitle: string;
    ctaStandard: string;
    ctaPremium: string;
    faqTitle: string;
    faqs: { q: string; a: string }[];
    badge: string;
    semiAutoLabel: string;
    semiAutoDesc: string;
    // 탭
    tab3d: string;
    tabProcurement: string;
}> = {
    kr: {
        tab3d: '3D 모델링 툴',
        tabProcurement: 'AI 제조 조달 플랫폼',
        hero: '합리적인 요금제',
        heroSub: '3D 모델링부터 AI 제조 조달까지, 필요한 서비스만 선택하세요.',
        standard: '기본 매칭',
        premium: '전담 매칭',
        period: '/ 2개월',
        standardFeatures: [
            'AI 제조 스펙 분석 및 최적화',
            '자동 RFP(제안요청서) 생성',
            '공장 리스트 추천 (국내·중국)',
            '자동 견적 요청 발송',
            '견적 취합 대시보드',
            '파트너 견적 최대 3개 제공',
            '3D 모델러 3개월 이용권 포함',
        ],
        premiumFeatures: [
            '기본 매칭 전 기능 포함',
            '파트너 견적 최대 5개 제공',
            '공장 매칭 리포트 PDF',
            '전담 오퍼레이터 배정',
            '오퍼레이터 직접 컨택 및 조율',
            '제조 조건 협상 지원',
            '우선 응대 (4시간 이내)',
            '3D 모델러 6개월 이용권 포함',
        ],
        standardNote: '당사를 통해 프로젝트 착수시 서비스료는 총수수료에서 공제',
        premiumNote: '당사를 통해 프로젝트 착수시 서비스료는 총수수료에서 공제',
        commissionTitle: '성사 수수료 안내',
        commissionDesc: '공장 매칭 후 계약이 성사될 경우 계약금 규모에 따라 구간별 요율이 적용됩니다. 월 이용료는 착수 시 수수료에서 자동 공제되며, 산정 수수료가 이용료를 초과하는 경우에만 차액이 추가 청구됩니다.',
        commissionRate: '4~7% (구간별 차등)',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: '별도 컨설팅 서비스 이용 시, 컨설팅 비용은 플랜 이용료와 별개로 청구됩니다.',
        exampleTitle: '수수료 계산 예시',
        ctaStandard: '신청하기',
        ctaPremium: '전담 매칭 신청',
        faqTitle: '자주 묻는 질문',
        badge: '추천',
        semiAutoLabel: 'Semi-Auto 운영 방식',
        semiAutoDesc: '현재 시스템은 AI 자동화 + 전담 오퍼레이터가 결합된 Semi-Auto 방식으로 운영됩니다. 창업자는 웹 대시보드에서 전 과정을 실시간으로 확인하고 관리할 수 있습니다.',
        faqs: [
            { q: '키워드 검색은 무료인가요?', a: '네, 키워드 검색과 AI 파트너 추천은 무료입니다. 실제 매칭을 원하실 때 매칭 신청금(50만 원, VAT 별도)이 발생합니다.' },
            { q: '매칭 신청금은 어떻게 되나요?', a: '50만 원(VAT 별도)이며, 전문 기술 검토 및 파트너 선별 비용입니다. 적합한 파트너를 찾지 못할 경우 전액 환불됩니다.' },
            { q: '수수료는 얼마인가요?', a: '계약 체결 시 계약금 규모에 따라 4~7%의 수수료가 적용되며, 매칭 신청금(50만 원)은 수수료에서 100% 공제됩니다.' },
            { q: '매칭에 얼마나 걸리나요?', a: '매칭 신청 후 영업일 기준 3~5일 이내에 적합 파트너 후보를 선별하여 안내드립니다.' },
        ],
    },
    en: {
        tab3d: '3D Modeling Tool',
        tabProcurement: 'AI Procurement Platform',
        hero: 'Simple, Transparent Pricing',
        heroSub: 'From 3D modeling to AI manufacturing procurement — choose what you need.',
        standard: 'Basic Matching',
        premium: 'Dedicated Matching',
        period: '/ 2 months',
        standardFeatures: [
            'AI Manufacturing Spec Analysis',
            'Auto RFP Generation',
            'Factory List Recommendation (Korea & China)',
            'Automated Quote Request Dispatch',
            'Quote Aggregation Dashboard',
            'Up to 3 partner quotes provided',
            '3D Modeler — 3 months included',
        ],
        premiumFeatures: [
            'All Basic Matching features included',
            'Up to 5 partner quotes provided',
            'Factory Matching Report PDF',
            'Dedicated Operator Assignment',
            'Direct Operator Contact & Coordination',
            'Manufacturing Negotiation Support',
            'Priority Response (within 4 hours)',
            '3D Modeler — 6 months included',
        ],
        standardNote: 'Service fee is deducted from total commission upon project start through us',
        premiumNote: 'Service fee is deducted from total commission upon project start through us',
        commissionTitle: 'Success Commission',
        commissionDesc: 'When a contract is concluded after factory matching, a tiered rate applies based on contract value. Your monthly plan fee is automatically deducted from the commission at project start — you are only charged the difference if the commission exceeds your plan fee.',
        commissionRate: '4–7% (tiered by contract value)',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: 'Separate consulting services are billed independently from the plan fee.',
        exampleTitle: 'Commission Calculation Example',
        ctaStandard: 'Apply Now',
        ctaPremium: 'Apply for Dedicated',
        faqTitle: 'Frequently Asked Questions',
        badge: 'Recommended',
        semiAutoLabel: 'Semi-Auto Operation Model',
        semiAutoDesc: 'Our system operates via a Semi-Auto model combining AI automation with dedicated operators. Founders can monitor and manage the entire process in real-time through the web dashboard.',
        faqs: [
            { q: 'Is keyword search free?', a: 'Yes, keyword search and AI partner recommendations are free. The matching application fee ($400, excl. VAT) applies when you request actual matching.' },
            { q: 'What is the matching application fee?', a: '$400 (excl. VAT) for professional tech review and partner selection. Fully refunded if no suitable partner is found.' },
            { q: 'How much is the commission?', a: 'A 4–7% commission applies upon contract signing based on contract value. The application fee is 100% credited toward the commission.' },
            { q: 'How long does matching take?', a: 'Suitable partner candidates are selected and presented within 3–5 business days after your matching application.' },
        ],
    },
    ja: {
        tab3d: '3Dモデリングツール',
        tabProcurement: 'AI製造調達プラットフォーム',
        hero: '料金プラン',
        heroSub: '3Dモデリングから製造調達まで、必要なサービスだけ選択できます。',
        standard: 'ベーシックマッチング',
        premium: '専任マッチング',
        period: '/ 2ヶ月',
        standardFeatures: [
            'AI製造スペック分析・最適化',
            'RFP（提案依頼書）自動生成',
            '工場リスト推薦（韓国・中国）',
            '自動見積もり依頼送信',
            '見積もり集計ダッシュボード',
            'パートナー見積もり最大3件提供',
            '3Dモデラー3ヶ月利用券付き',
        ],
        premiumFeatures: [
            'ベーシックマッチングの全機能を含む',
            'パートナー見積もり最大5件提供',
            '工場マッチングレポートPDF',
            '専任オペレーター配属',
            'オペレーターによる直接連絡・調整',
            '製造条件交渉サポート',
            '優先対応（4時間以内）',
            '3Dモデラー6ヶ月利用券付き',
        ],
        standardNote: '当社を通じてプロジェクト着手時、サービス料は総手数料から控除されます',
        premiumNote: '当社を通じてプロジェクト着手時、サービス料は総手数料から控除されます',
        commissionTitle: '成約手数料について',
        commissionDesc: '工場マッチング後に契約が成立した場合、契約金額の規模に応じた段階的な手数料率が適用されます。月額利用料は着手時に手数料から自動控除され、算定手数料が利用料を超えた場合のみ差額が追加請求されます。',
        commissionRate: '4〜7%（契約金額により段階適用）',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: '別途コンサルティングサービスをご利用の場合、コンサルティング費用はプラン料金とは別途請求されます。',
        exampleTitle: '手数料計算例',
        ctaStandard: '申込む',
        ctaPremium: '専任マッチング申込',
        faqTitle: 'よくある質問',
        badge: 'おすすめ',
        semiAutoLabel: 'セミオート運営方式',
        semiAutoDesc: '現在のシステムはAI自動化と専任オペレーターを組み合わせたセミオート方式で運営されています。創業者はウェブダッシュボードで全過程をリアルタイムで確認・管理できます。',
        faqs: [
            { q: 'キーワード検索は無料ですか？', a: 'はい、キーワード検索とAIパートナー推薦は無料です。実際のマッチングをご希望の際にマッチング申請金（¥60,000、税別）が発生します。' },
            { q: 'マッチング申請金とは何ですか？', a: '¥60,000（税別）で、専門技術検討およびパートナー選別の費用です。適切なパートナーが見つからない場合は全額返金されます。' },
            { q: '手数料はいくらですか？', a: '契約締結時に契約金額に応じて4～7%の手数料が適用されます。マッチング申請金は手数料から100%控除されます。' },
            { q: 'マッチングにどのくらいかかりますか？', a: 'マッチング申請後、営業日基準3～5日以内に適合パートナー候補を選別してご案内いたします。' },
        ],
    },
    cn: {
        tab3d: '3D建模工具',
        tabProcurement: 'AI制造采购平台',
        hero: '定价方案',
        heroSub: '从3D建模到AI制造采购，按需选择。',
        standard: '基础匹配',
        premium: '专属匹配',
        period: '/ 2个月',
        standardFeatures: [
            'AI制造规格分析与优化',
            '自动生成RFP（询价单）',
            '工厂推荐列表（韩国·中国）',
            '自动发送询价请求',
            '报价汇总仪表板',
            '最多提供3个合作伙伴报价',
            '含3D建模工具3个月使用权',
        ],
        premiumFeatures: [
            '包含基础匹配全部功能',
            '最多提供5个合作伙伴报价',
            '工厂匹配报告PDF',
            '专属运营人员配置',
            '运营人员直接联系与协调',
            '制造条件谈判支持',
            '优先响应（4小时内）',
            '含3D建模工具6个月使用权',
        ],
        standardNote: '通过我们启动项目时，服务费将从总佣金中扣除',
        premiumNote: '通过我们启动项目时，服务费将从总佣金中扣除',
        commissionTitle: '成交佣金说明',
        commissionDesc: '工厂匹配后合同成立时，按合同金额规模适用分级佣金率。月套餐费将在项目启动时自动从佣金中扣除，仅当佣金超过套餐费时才额外收取差额。',
        commissionRate: '4~7%（按合同金额分级）',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: '如使用单独咨询服务，咨询费用与套餐费用分开计费。',
        exampleTitle: '佣金计算示例',
        ctaStandard: '立即申请',
        ctaPremium: '申请专属匹配',
        faqTitle: '常见问题',
        badge: '推荐',
        semiAutoLabel: '半自动运营模式',
        semiAutoDesc: '目前系统采用AI自动化+专属运营人员相结合的半自动模式运营。创始人可通过网页仪表板实时查看和管理全过程。',
        faqs: [
            { q: '关键词搜索免费吗？', a: '是的，关键词搜索和AI合作伙伴推荐完全免费。实际匹配时需缴纳匹配申请费（$400，不含税）。' },
            { q: '匹配申请费是什么？', a: '$400（不含税），用于专业技术审查和合作伙伴筛选。如未找到合适的合作伙伴，将全额退还。' },
            { q: '佣金是多少？', a: '签约时按合同金额的4~7%收取佣金。匹配申请费可100%抵扣佣金。' },
            { q: '匹配需要多长时间？', a: '匹配申请后工作日3~5天内筛选出合适的合作伙伴候选名单并通知您。' },
        ],
    },
    es: {
        tab3d: 'Herramienta 3D',
        tabProcurement: 'Plataforma de Adquisición IA',
        hero: 'Precios Transparentes',
        heroSub: 'Desde modelado 3D hasta adquisición manufacturera con IA — elige lo que necesitas.',
        standard: 'Matching Básico',
        premium: 'Matching Dedicado',
        period: '/ 2 meses',
        standardFeatures: [
            'Análisis de especificaciones con IA',
            'Generación automática de RFP',
            'Recomendación de fábricas (Corea y China)',
            'Envío automático de solicitudes de cotización',
            'Panel de agregación de cotizaciones',
            'Hasta 3 cotizaciones de socios',
            'Modelador 3D — 3 meses incluidos',
        ],
        premiumFeatures: [
            'Todas las funciones de Matching Básico',
            'Hasta 5 cotizaciones de socios',
            'Informe PDF de coincidencia de fábricas',
            'Asignación de operador dedicado',
            'Contacto directo del operador',
            'Apoyo en negociación de fabricación',
            'Respuesta prioritaria (dentro de 4 horas)',
            'Modelador 3D — 6 meses incluidos',
        ],
        standardNote: 'Al iniciar el proyecto con nosotros, la tarifa de servicio se descuenta de la comisión total',
        premiumNote: 'Al iniciar el proyecto con nosotros, la tarifa de servicio se descuenta de la comisión total',
        commissionTitle: 'Comisión por Éxito',
        commissionDesc: 'Cuando se concluye un contrato tras el matching, se aplica una tasa escalonada según el valor. La tarifa mensual se descuenta automáticamente de la comisión al inicio del proyecto — solo se cobra la diferencia si la comisión supera la tarifa del plan.',
        commissionRate: '4–7% (escalonado por valor)',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: 'Los servicios de consultoría separados se facturan de forma independiente.',
        exampleTitle: 'Ejemplo de Cálculo de Comisión',
        ctaStandard: 'Solicitar Ahora',
        ctaPremium: 'Solicitar Matching Dedicado',
        faqTitle: 'Preguntas Frecuentes',
        badge: 'Recomendado',
        semiAutoLabel: 'Modelo Semi-Automático',
        semiAutoDesc: 'Nuestro sistema opera mediante un modelo Semi-Auto que combina automatización de IA con operadores dedicados.',
        faqs: [
            { q: '¿La búsqueda por palabras clave es gratuita?', a: 'Sí, la búsqueda y las recomendaciones de IA son gratuitas. La tarifa de solicitud de matching ($400, IVA excl.) se aplica al solicitar el matching real.' },
            { q: '¿Qué es la tarifa de solicitud de matching?', a: '$400 (IVA excl.) para revisión técnica profesional y selección de socios. Se reembolsa íntegramente si no se encuentra un socio adecuado.' },
            { q: '¿Cuánto es la comisión?', a: 'Al firmar el contrato se aplica una comisión del 4–7% según el valor. La tarifa de solicitud se acredita al 100% a la comisión.' },
            { q: '¿Cuánto tarda el matching?', a: 'Los candidatos adecuados se seleccionan y presentan en 3–5 días hábiles tras la solicitud.' },
        ],
    },
    ar: {
        tab3d: 'أداة النمذجة ثلاثية الأبعاد',
        tabProcurement: 'منصة المشتريات بالذكاء الاصطناعي',
        hero: 'خطط الأسعار',
        heroSub: 'من النمذجة ثلاثية الأبعاد إلى المشتريات التصنيعية بالذكاء الاصطناعي — اختر ما تحتاجه.',
        standard: 'المطابقة الأساسية',
        premium: 'المطابقة المخصصة',
        period: '/ شهران',
        standardFeatures: [
            'تحليل وتحسين مواصفات التصنيع بالذكاء الاصطناعي',
            'إنشاء RFP تلقائياً',
            'توصيات قائمة المصانع (كوريا والصين)',
            'إرسال طلبات عروض الأسعار تلقائياً',
            'لوحة تجميع عروض الأسعار',
            'ما يصل إلى 3 عروض أسعار من الشركاء',
            'أداة النمذجة ثلاثية الأبعاد — 3 أشهر مشمولة',
        ],
        premiumFeatures: [
            'جميع ميزات المطابقة الأساسية',
            'ما يصل إلى 5 عروض أسعار من الشركاء',
            'تقرير PDF لمطابقة المصانع',
            'تعيين مشغّل مخصص',
            'تواصل مباشر من المشغّل وتنسيق',
            'دعم تفاوض شروط التصنيع',
            'استجابة ذات أولوية (خلال 4 ساعات)',
            'أداة النمذجة ثلاثية الأبعاد — 6 أشهر مشمولة',
        ],
        standardNote: 'عند بدء المشروع عبرنا، تُخصم رسوم الخدمة من إجمالي العمولة',
        premiumNote: 'عند بدء المشروع عبرنا، تُخصم رسوم الخدمة من إجمالي العمولة',
        commissionTitle: 'عمولة النجاح',
        commissionDesc: 'عند إبرام العقد بعد مطابقة المصنع، تُطبَّق نسبة عمولة متدرجة وفقاً لقيمة العقد.',
        commissionRate: '٤–٧٪ (متدرجة حسب القيمة)',
        deductionLabel: '',
        deductionDesc: '',
        consultNote: 'تُفوتر خدمات الاستشارة المنفصلة باستقلالية.',
        exampleTitle: 'مثال حساب العمولة',
        ctaStandard: 'قدّم الآن',
        ctaPremium: 'اشترك في المطابقة المخصصة',
        faqTitle: 'الأسئلة الشائعة',
        badge: 'موصى به',
        semiAutoLabel: 'نموذج التشغيل شبه الآلي',
        semiAutoDesc: 'يعمل النظام بنموذج شبه آلي يجمع بين أتمتة الذكاء الاصطناعي والمشغّلين المخصصين.',
        faqs: [
            { q: 'هل البحث بالكلمات المفتاحية مجاني؟', a: 'نعم، البحث وتوصيات الذكاء الاصطناعي مجانية. رسوم طلب المطابقة ($400، باستثناء الضريبة) تُطبَّق عند طلب المطابقة الفعلية.' },
            { q: 'ما هي رسوم طلب المطابقة؟', a: '$400 (باستثناء الضريبة) للمراجعة التقنية المتخصصة واختيار الشركاء. تُسترد بالكامل إذا لم يُعثر على شريك مناسب.' },
            { q: 'كم تبلغ العمولة؟', a: 'تُطبَّق عمولة 4–7٪ عند توقيع العقد حسب قيمته. رسوم الطلب تُخصم 100٪ من العمولة.' },
            { q: 'كم تستغرق المطابقة؟', a: 'يتم اختيار المرشحين المناسبين وتقديمهم خلال 3–5 أيام عمل.' },
        ],
    },
};

const langMap: Record<string, LangKey> = { kr: 'kr', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };

// ── 3D 모델링 요금제 데이터 ────────────────────────────────────────────────────

function get3dPlans(lang: LangKey) {
    const isKr = lang === 'kr';
    const isJa = lang === 'ja';
    const isCn = lang === 'cn';

    const price = (kr: string, en: string, ja: string, cn: string) =>
        isKr ? kr : isJa ? ja : isCn ? cn : en;

    const check = (v: boolean) => v;

    return [
        {
            key: 'free',
            name: price('무료', 'Free', '無料', '免费'),
            price: price('₩0', '$0', '¥0', '$0'),
            period: price('/월', '/mo', '/月', '/月'),
            desc: price('혼자 가볍게 시작할 때', 'Try it for free', '無料で始める', '免费体验'),
            highlight: false,
            badge: '',
            cta: price('무료로 시작', 'Get Started Free', '無料で始める', '免费开始'),
            ctaStyle: 'gray' as const,
            features: [
                { label: price('프로젝트 3개', '3 projects', 'プロジェクト3件', '3个项目'), ok: check(true) },
                { label: price('STL 내보내기', 'STL export', 'STLエクスポート', 'STL导出'), ok: check(true) },
                { label: price('AI 채팅 (제한)', 'AI chat (limited)', 'AIチャット（制限）', 'AI对话（限制）'), ok: check(true) },
                { label: price('AI 치수·재료 추천 월 5회', 'AI Advisor — 5/month', 'AI寸法アドバイザー月5回', 'AI顾问每月5次'), ok: check(true) },
                { label: price('🤖 AI DFM 설명+단가 영향 월 5회', '🤖 AI DFM Explainer — 5/month', '🤖 AI DFM解説 月5回', '🤖 AI DFM 每月5次'), ok: check(true) },
                { label: price('🧭 AI 공정 라우터 월 5회', '🧭 AI Process Router — 5/month', '🧭 AI工程ルーター 月5回', '🧭 AI 工艺路由 每月5次'), ok: check(true) },
                { label: price('🎯 AI 공급사 Top 3 매칭 월 3회', '🎯 AI Supplier Top-3 — 3/month', '🎯 AIサプライヤーTop3 月3回', '🎯 AI 供应商 每月3次'), ok: check(true) },
                { label: price('💰 비용 절감 코파일럿 월 5회', '💰 Design-for-Cost Copilot — 5/month', '💰 コスト最適化コパイロット 月5回', '💰 成本副驾驶 每月5次'), ok: check(true) },
                { label: price('DFM 분석', 'DFM analysis', 'DFM分析', 'DFM分析'), ok: check(false) },
                { label: price('FEA 구조 해석', 'FEA analysis', 'FEA構造解析', 'FEA分析'), ok: check(false) },
                { label: price('클라우드 저장', 'Cloud save', 'クラウド保存', '云存储'), ok: check(false) },
                { label: price('STEP/OBJ/GLTF 내보내기', 'STEP/OBJ/GLTF export', 'STEP/OBJ/GLTFエクスポート', 'STEP/OBJ/GLTF导出'), ok: check(false) },
                { label: price('CAM G-코드 내보내기', 'CAM G-code export', 'CAM Gコードエクスポート', 'CAM G代码导出'), ok: check(false) },
                { label: price('공급사 매칭', 'Supplier matching', 'サプライヤーマッチング', '供应商匹配'), ok: check(false) },
                { label: price('RFQ 패키지 다운로드', 'RFQ bundle download', 'RFQパッケージDL', 'RFQ包下载'), ok: check(false) },
            ],
        },
        {
            key: 'pro',
            name: 'Pro',
            price: price('₩39,000', '$29', '¥4,200', '$29'),
            period: price('/월', '/mo', '/月', '/月'),
            desc: price('혼자 일하는 엔지니어·스타트업', 'Solo engineers & startups', 'ソロエンジニア・スタートアップ', '独立工程师·初创企业'),
            highlight: true,
            badge: price('가장 인기', 'Most Popular', '人気No.1', '最受欢迎'),
            cta: price('Pro 시작하기', 'Start Pro', 'Proを始める', '开始Pro'),
            ctaStyle: 'blue' as const,
            features: [
                { label: price('프로젝트 무제한', 'Unlimited projects', 'プロジェクト無制限', '无限项目'), ok: check(true) },
                { label: price('STEP/OBJ/DXF/GLTF/PLY 내보내기', 'STEP/OBJ/DXF/GLTF/PLY', 'STEP/OBJ/DXF/GLTF/PLY', 'STEP/OBJ/DXF/GLTF/PLY'), ok: check(true) },
                { label: price('AI 채팅 (무제한)', 'AI chat (unlimited)', 'AIチャット（無制限）', 'AI对话（无限）'), ok: check(true) },
                { label: price('AI 치수·재료 추천 무제한', 'AI Advisor — unlimited', 'AI寸法アドバイザー無制限', 'AI顾问无限次'), ok: check(true) },
                { label: price('🤖 AI DFM 설명+단가 영향 무제한', '🤖 AI DFM Explainer — unlimited', '🤖 AI DFM解説 無制限', '🤖 AI DFM 无限'), ok: check(true) },
                { label: price('🧭 AI 공정 라우터 무제한', '🧭 AI Process Router — unlimited', '🧭 AI工程ルーター 無制限', '🧭 AI 工艺路由 无限'), ok: check(true) },
                { label: price('🎯 AI 공급사 Top 3 매칭 무제한', '🎯 AI Supplier Top-3 — unlimited', '🎯 AIサプライヤーTop3 無制限', '🎯 AI 供应商 无限'), ok: check(true) },
                { label: price('💰 비용 절감 코파일럿 무제한', '💰 Design-for-Cost Copilot — unlimited', '💰 コスト最適化コパイロット 無制限', '💰 成本副驾驶 无限'), ok: check(true) },
                { label: price('DFM 분석', 'DFM analysis', 'DFM分析', 'DFM分析'), ok: check(true) },
                { label: price('FEA 구조 해석', 'FEA analysis', 'FEA構造解析', 'FEA分析'), ok: check(true) },
                { label: price('클라우드 저장', 'Cloud save', 'クラウド保存', '云存储'), ok: check(true) },
                { label: price('CAM G-코드 내보내기 (Fanuc/Mazak/Haas)', 'CAM G-code (Fanuc/Mazak/Haas)', 'CAM Gコード (Fanuc/Mazak/Haas)', 'CAM G代码 (Fanuc/Mazak/Haas)'), ok: check(true) },
                { label: price('공급사 매칭', 'Supplier matching', 'サプライヤーマッチング', '供应商匹配'), ok: check(true) },
                { label: price('RFQ 패키지 다운로드 (.zip)', 'RFQ bundle download (.zip)', 'RFQパッケージDL (.zip)', 'RFQ包下载 (.zip)'), ok: check(true) },
                { label: price('NexyFlow 견적 승인 연동', 'NexyFlow quote integration', 'NexyFlow見積統合', 'NexyFlow报价集成'), ok: check(true) },
                { label: price('IP 보호 공유 링크', 'IP-protected share link', 'IP保護共有リンク', 'IP保护分享链接'), ok: check(true) },
            ],
        },
        {
            key: 'team',
            name: price('팀', 'Team', 'チーム', '团队'),
            price: price('₩129,000', '$99', '¥14,500', '$99'),
            period: price('/월', '/mo', '/月', '/月'),
            desc: price('소규모 팀·제조 스타트업', 'Small teams & mfg startups', '小規模チーム', '小型团队'),
            highlight: false,
            badge: '',
            cta: price('팀 플랜 시작', 'Start Team', 'チームプランを始める', '开始团队计划'),
            ctaStyle: 'dark' as const,
            features: [
                { label: price('Pro 전 기능 포함', 'All Pro features', 'Proの全機能', 'Pro全部功能'), ok: check(true) },
                { label: price('실시간 협업', 'Real-time collaboration', 'リアルタイム協同作業', '实时协作'), ok: check(true) },
                { label: price('Rhino/Grasshopper 내보내기', 'Rhino/Grasshopper export', 'Rhino/Grasshopperエクスポート', 'Rhino/Grasshopper导出'), ok: check(true) },
                { label: price('브랜치 비교', 'Branch compare', 'ブランチ比較', '版本比较'), ok: check(true) },
                { label: price('플러그인 마켓', 'Plugin marketplace', 'プラグインマーケット', '插件市场'), ok: check(true) },
                { label: price('팀 관리 대시보드', 'Team admin dashboard', 'チーム管理ダッシュボード', '团队管理面板'), ok: check(true) },
                { label: price('우선 지원', 'Priority support', '優先サポート', '优先支持'), ok: check(true) },
                { label: price('최대 20명', 'Up to 20 seats', '最大20名', '最多20人'), ok: check(true) },
            ],
        },
        {
            key: 'enterprise',
            name: price('엔터프라이즈', 'Enterprise', 'エンタープライズ', '企业版'),
            price: price('문의', 'Custom', 'お問合せ', '联系我们'),
            period: '',
            desc: price('대기업·제조사 맞춤', 'Large orgs & manufacturers', '大企業・製造メーカー向け', '大型企业·制造商'),
            highlight: false,
            badge: '',
            cta: price('영업팀 문의', 'Contact Sales', '営業チームに問合せ', '联系销售'),
            ctaStyle: 'outline' as const,
            features: [
                { label: price('팀 플랜 전 기능', 'All Team features', 'チームプランの全機能', '团队计划全部功能'), ok: check(true) },
                { label: price('무제한 시트', 'Unlimited seats', 'シート無制限', '无限席位'), ok: check(true) },
                { label: price('SSO / SAML', 'SSO / SAML', 'SSO / SAML', 'SSO / SAML'), ok: check(true) },
                { label: price('전용 서버 배포', 'Dedicated deployment', '専用サーバー配備', '专用服务器部署'), ok: check(true) },
                { label: price('SLA 보장', 'SLA guarantee', 'SLA保証', 'SLA保证'), ok: check(true) },
                { label: price('전담 Customer Success', 'Dedicated CS manager', '専任CSマネージャー', '专属客户成功经理'), ok: check(true) },
                { label: price('커스텀 통합 개발', 'Custom integrations', 'カスタム統合開発', '定制集成开发'), ok: check(true) },
                { label: price('데이터 보존 정책 맞춤', 'Custom data retention', 'カスタムデータ保存', '自定义数据保留'), ok: check(true) },
            ],
        },
    ];
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

export default function PricingPage() {
    const params = useParams();
    const rawLang = (params?.lang as string) || 'en';
    const lang = langMap[rawLang] || 'en';
    const t = dict[lang];
    const isRtl = lang === 'ar';

    const [activeTab, setActiveTab] = useState<'3d' | 'procurement'>('3d');
    const [openFaq, setOpenFaq] = useState<number | null>(null);

    const blue = '#0b5cff';
    const plans = get3dPlans(lang);

    const card: React.CSSProperties = {
        background: '#fff',
        borderRadius: '24px',
        padding: '36px 32px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        border: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
    };
    const cardHighlight: React.CSSProperties = {
        ...card,
        border: `2px solid ${blue}`,
        boxShadow: `0 8px 40px rgba(11,92,255,0.14)`,
        position: 'relative',
    };

    return (
        <div dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'var(--font-sans)', background: '#f8fafc', minHeight: '100vh' }}>

            {/* ── 히어로 ── */}
            <div style={{ background: 'linear-gradient(135deg, #0b1a3e 0%, #0b5cff 100%)', padding: '72px 24px 0', textAlign: 'center' }}>
                <h1 style={{ fontSize: '36px', fontWeight: 900, color: '#fff', margin: '0 0 12px', letterSpacing: '-0.02em' }}>{t.hero}</h1>
                <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.7)', maxWidth: '500px', margin: '0 auto 40px', lineHeight: 1.7 }}>{t.heroSub}</p>

                {/* ── 탭 ── */}
                <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.1)', borderRadius: '16px', padding: '5px', gap: '4px', marginBottom: 0 }}>
                    {([
                        { key: '3d', label: t.tab3d, icon: '🧊' },
                        { key: 'procurement', label: t.tabProcurement, icon: '🏭' },
                    ] as const).map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                padding: '11px 28px',
                                borderRadius: '12px',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 700,
                                letterSpacing: '-0.01em',
                                transition: 'all 0.2s',
                                background: activeTab === tab.key ? '#fff' : 'transparent',
                                color: activeTab === tab.key ? '#0b1a3e' : 'rgba(255,255,255,0.7)',
                                boxShadow: activeTab === tab.key ? '0 2px 12px rgba(0,0,0,0.15)' : 'none',
                                display: 'flex', alignItems: 'center', gap: '7px',
                            }}
                        >
                            <span>{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* 탭 아래 여백 (흰 영역과 자연스럽게 연결) */}
                <div style={{ height: 40 }} />
            </div>

            <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px 80px' }}>

                {/* ══════════════════════════════ 3D 모델링 툴 탭 ══════════════════════════════ */}
                {activeTab === '3d' && (
                    <>
                        <div className="nf-plans-grid" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                            gap: '20px',
                            marginBottom: '48px',
                        }}>
                            {plans.map(plan => {
                                const isHighlight = plan.highlight;
                                return (
                                    <div key={plan.key} style={isHighlight ? { ...cardHighlight, marginTop: '-12px' } : card}>
                                        {isHighlight && plan.badge && (
                                            <div style={{
                                                position: 'absolute', top: '-14px', left: '50%',
                                                transform: 'translateX(-50%)',
                                                background: blue, color: '#fff',
                                                borderRadius: '20px', padding: '5px 18px',
                                                fontSize: '11px', fontWeight: 800,
                                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                                whiteSpace: 'nowrap',
                                            }}>{plan.badge}</div>
                                        )}

                                        <div style={{ marginBottom: '4px' }}>
                                            <span style={{
                                                fontSize: '13px', fontWeight: 800,
                                                color: isHighlight ? blue : '#374151',
                                                letterSpacing: '-0.01em',
                                            }}>{plan.name}</span>
                                        </div>

                                        <div style={{ marginBottom: '6px' }}>
                                            <span style={{
                                                fontSize: plan.price === '문의' || plan.price === 'Custom' || plan.price === 'お問合せ' || plan.price === '联系我们' ? '24px' : '36px',
                                                fontWeight: 900,
                                                color: isHighlight ? blue : '#111827',
                                                letterSpacing: '-0.03em',
                                            }}>{plan.price}</span>
                                            {plan.period && (
                                                <span style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 600, marginLeft: '3px' }}>{plan.period}</span>
                                            )}
                                        </div>

                                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 20px', paddingBottom: '20px', borderBottom: `1px solid ${isHighlight ? '#dbeafe' : '#f0f0f0'}` }}>
                                            {plan.desc}
                                        </p>

                                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {plan.features.map((f, i) => (
                                                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
                                                    <span style={{
                                                        width: '17px', height: '17px', borderRadius: '50%', flexShrink: 0, marginTop: '1px',
                                                        background: f.ok ? (isHighlight ? blue : '#e0e7ff') : '#f3f4f6',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    }}>
                                                        {f.ok
                                                            ? <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke={isHighlight ? '#fff' : '#0b5cff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                            : <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="#d1d5db" strokeWidth="1.8" strokeLinecap="round" /></svg>
                                                        }
                                                    </span>
                                                    <span style={{ fontSize: '13px', color: f.ok ? '#374151' : '#d1d5db', fontWeight: f.ok ? 500 : 400, lineHeight: 1.4 }}>{f.label}</span>
                                                </li>
                                            ))}
                                        </ul>

                                        <Link href="/login" prefetch={false} style={{
                                            display: 'block', textAlign: 'center',
                                            padding: '13px', borderRadius: '12px',
                                            fontWeight: 800, fontSize: '14px', textDecoration: 'none',
                                            transition: '0.15s',
                                            ...(plan.ctaStyle === 'blue' ? { background: blue, color: '#fff' }
                                                : plan.ctaStyle === 'dark' ? { background: '#111827', color: '#fff' }
                                                    : plan.ctaStyle === 'outline' ? { background: 'transparent', color: '#374151', border: '2px solid #e5e7eb' }
                                                        : { background: '#f3f4f6', color: '#111827' }),
                                        }}
                                            onMouseEnter={e => {
                                                const el = e.currentTarget as HTMLAnchorElement;
                                                if (plan.ctaStyle === 'blue') el.style.background = '#0945cc';
                                                else if (plan.ctaStyle === 'dark') el.style.background = '#374151';
                                                else if (plan.ctaStyle === 'outline') el.style.borderColor = '#374151';
                                                else el.style.background = '#e5e7eb';
                                            }}
                                            onMouseLeave={e => {
                                                const el = e.currentTarget as HTMLAnchorElement;
                                                if (plan.ctaStyle === 'blue') el.style.background = blue;
                                                else if (plan.ctaStyle === 'dark') el.style.background = '#111827';
                                                else if (plan.ctaStyle === 'outline') el.style.borderColor = '#e5e7eb';
                                                else el.style.background = '#f3f4f6';
                                            }}
                                        >
                                            {plan.cta}
                                        </Link>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 비교 표 안내 */}
                        <div style={{
                            background: '#fff', borderRadius: '20px', padding: '28px 32px',
                            border: '1px solid #f0f0f0', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                            display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                        }}>
                            <div style={{ fontSize: '28px' }}>💡</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 800, fontSize: '15px', color: '#111827', marginBottom: '4px' }}>
                                    {lang === 'kr' ? '모든 플랜에 무료 체험 포함' : lang === 'ja' ? '全プランに無料トライアル付き' : lang === 'cn' ? '所有计划包含免费试用' : 'All plans include a free trial'}
                                </div>
                                <div style={{ fontSize: '13px', color: '#6b7280' }}>
                                    {lang === 'kr' ? '신용카드 없이 14일 무료 체험 가능. 언제든지 취소할 수 있습니다.' : lang === 'ja' ? 'クレジットカード不要で14日間無料トライアル。いつでもキャンセル可能。' : lang === 'cn' ? '无需信用卡，14天免费试用。随时可取消。' : '14-day free trial without a credit card. Cancel anytime.'}
                                </div>
                            </div>
                            <Link prefetch href={`/${rawLang}/shape-generator/`} style={{
                                padding: '11px 22px', borderRadius: '12px', background: blue,
                                color: '#fff', fontWeight: 800, fontSize: '13px', textDecoration: 'none',
                                whiteSpace: 'nowrap', flexShrink: 0,
                            }}>
                                {lang === 'kr' ? '무료로 시작 →' : lang === 'ja' ? '無料で始める →' : lang === 'cn' ? '免费开始 →' : 'Try Free →'}
                            </Link>
                        </div>
                    </>
                )}

                {/* ══════════════════════════════ AI 조달 플랫폼 탭 ══════════════════════════════ */}
                {activeTab === 'procurement' && (
                    <>
                        {/* Semi-Auto 안내 */}
                        <div style={{ background: '#fff', borderRadius: '20px', padding: '20px 28px', border: '1px solid #f0f0f0', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', marginBottom: '36px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                            <div style={{ fontSize: '24px', flexShrink: 0 }}>🤖</div>
                            <div>
                                <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827', marginBottom: '4px' }}>{t.semiAutoLabel}</div>
                                <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6 }}>{t.semiAutoDesc}</div>
                            </div>
                        </div>

                        {/* Plan Cards */}
                        <div className="nf-pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '40px' }}>

                            {/* Standard */}
                            <div style={card}>
                                <div style={{ marginBottom: '8px' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.standard}</span>
                                </div>
                                <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                        <span style={{ fontSize: '38px', fontWeight: 900, color: '#111827', letterSpacing: '-0.03em' }}>{lang === 'kr' ? '₩500,000' : lang === 'ja' ? '¥60,000' : '$400'}</span>
                                    </div>
                                    <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>{lang === 'kr' ? '/ 1회' : lang === 'ja' ? '/ 1回' : lang === 'cn' ? '/ 一次' : lang === 'ar' ? '/ مرة واحدة' : '/ one-time'}</span>
                                    <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px', lineHeight: 1.5 }}>
                                        {lang === 'kr' ? 'AI 자동화 기반 제조 조달 서비스' : lang === 'en' ? 'AI-powered manufacturing procurement' : lang === 'ja' ? 'AI自動化ベースの製造調達サービス' : lang === 'cn' ? 'AI自动化制造采购服务' : lang === 'es' ? 'Servicio de adquisición basado en IA' : 'خدمة المشتريات المبنية على الذكاء الاصطناعي'}
                                    </p>
                                </div>
                                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', flex: 1 }}>
                                    {t.standardFeatures.map((f, i) => (
                                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                                            <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0b5cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                            </span>
                                            <span style={{ fontSize: '14px', color: '#374151', fontWeight: 500, lineHeight: 1.5 }}>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div style={{ background: '#f0f4ff', borderRadius: '10px', padding: '10px 14px', marginBottom: '20px', fontSize: '12px', color: '#1d4ed8', lineHeight: 1.5 }}>
                                    ℹ️ {t.standardNote}
                                </div>
                                <Link href="/login" prefetch={false} style={{ display: 'block', textAlign: 'center', padding: '14px', borderRadius: '12px', background: '#f3f4f6', color: '#111827', fontWeight: 800, fontSize: '14px', textDecoration: 'none', transition: '0.2s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#e5e7eb')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#f3f4f6')}
                                >{t.ctaStandard}</Link>
                            </div>

                            {/* Premium */}
                            <div style={cardHighlight}>
                                <div style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', background: blue, color: '#fff', borderRadius: '20px', padding: '5px 18px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                    {t.badge}
                                </div>
                                <div style={{ marginBottom: '8px' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: blue, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.premium}</span>
                                </div>
                                <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #dbeafe' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                        <span style={{ fontSize: '38px', fontWeight: 900, color: blue, letterSpacing: '-0.03em' }}>{lang === 'kr' ? '₩1,000,000' : lang === 'ja' ? '¥120,000' : '$800'}</span>
                                    </div>
                                    <span style={{ fontSize: '14px', color: '#93c5fd', fontWeight: 600 }}>{lang === 'kr' ? '/ 1회' : lang === 'ja' ? '/ 1回' : lang === 'cn' ? '/ 一次' : lang === 'ar' ? '/ مرة واحدة' : '/ one-time'}</span>
                                    <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px', lineHeight: 1.5 }}>
                                        {lang === 'kr' ? '전담 오퍼레이터 포함 전체 조달 서비스' : lang === 'en' ? 'Full procurement with dedicated operator' : lang === 'ja' ? '専任オペレーター付き全調達サービス' : lang === 'cn' ? '含专属运营人员的完整采购服务' : lang === 'es' ? 'Adquisición completa con operador dedicado' : 'خدمة مشتريات كاملة مع مشغّل مخصص'}
                                    </p>
                                </div>
                                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', flex: 1 }}>
                                    {t.premiumFeatures.map((f, i) => (
                                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                                            <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: blue, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                            </span>
                                            <span style={{ fontSize: '14px', color: '#111827', fontWeight: i === 0 ? 700 : 500, lineHeight: 1.5 }}>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div style={{ background: '#eff6ff', borderRadius: '10px', padding: '10px 14px', marginBottom: '20px', fontSize: '12px', color: '#1d4ed8', lineHeight: 1.5 }}>
                                    ℹ️ {t.premiumNote}
                                </div>
                                <Link href="/login" prefetch={false} style={{ display: 'block', textAlign: 'center', padding: '14px', borderRadius: '12px', background: blue, color: '#fff', fontWeight: 800, fontSize: '14px', textDecoration: 'none' }}>
                                    {t.ctaPremium}
                                </Link>
                            </div>
                        </div>

                        {/* Commission Section */}
                        <div style={{ background: '#fff', borderRadius: '24px', padding: '40px', border: '1px solid #f0f0f0', boxShadow: '0 2px 16px rgba(0,0,0,0.04)', marginBottom: '32px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)', color: '#15803d', fontSize: '11px', fontWeight: 800, padding: '4px 12px', borderRadius: '20px', letterSpacing: '0.04em', border: '1px solid #86efac' }}>
                                    ✓ {lang === 'kr' ? '업계 최저 수수료' : lang === 'ja' ? '業界最低水準' : lang === 'cn' ? '行业最低佣金' : lang === 'es' ? 'Comisión más baja del sector' : lang === 'ar' ? 'أدنى عمولة في القطاع' : 'Industry Lowest Rate'}
                                </span>
                                <h2 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: 0, letterSpacing: '-0.02em' }}>{t.commissionTitle}</h2>
                            </div>
                            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 28px', lineHeight: 1.6 }}>{t.commissionDesc}</p>

                            {/* Plan min-fee cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                                {[
                                    { plan: t.standard, fee: lang === 'kr' ? '₩500,000 / 1회' : lang === 'ja' ? '¥60,000 / 1回' : '$400 / one-time', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
                                    { plan: t.premium, fee: lang === 'kr' ? '₩1,000,000 / 1회' : lang === 'ja' ? '¥120,000 / 1回' : '$800 / one-time', color: blue, bg: blue + '08', border: blue + '30' },
                                ].map((p, i) => (
                                    <div key={i} style={{ background: p.bg, border: `1.5px solid ${p.border}`, borderRadius: '16px', padding: '18px 20px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 800, color: p.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{p.plan}</div>
                                        <div style={{ fontSize: '18px', fontWeight: 900, color: p.color, marginBottom: '4px' }}>{p.fee}</div>
                                        <div style={{ fontSize: '12px', color: '#6b7280' }}>= {lang === 'kr' ? '최소 수수료' : lang === 'ja' ? '最低手数料' : lang === 'cn' ? '最低佣金' : 'Min. commission'}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Rate table */}
                            <div style={{ overflowX: 'auto', marginBottom: '28px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc' }}>
                                            {[
                                                lang === 'kr' ? '최종 계약금' : lang === 'en' ? 'Contract Value' : lang === 'ja' ? '最終契約金額' : lang === 'cn' ? '合同金额' : lang === 'es' ? 'Valor del contrato' : 'قيمة العقد',
                                                lang === 'kr' ? '수수료율' : lang === 'en' ? 'Commission Rate' : lang === 'ja' ? '手数料率' : lang === 'cn' ? '佣金率' : lang === 'es' ? 'Tasa de comisión' : 'نسبة العمولة',
                                            ].map(h => (
                                                <th key={h} style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'start', borderBottom: '2px solid #f0f0f0' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { range: lang === 'kr' ? '2,000만원 이하' : '≤ ₩20M', rate: 7 },
                                            { range: lang === 'kr' ? '5,000만원 이하' : '≤ ₩50M', rate: 6 },
                                            { range: lang === 'kr' ? '1억원 이하' : '≤ ₩100M', rate: 5.5 },
                                            { range: lang === 'kr' ? '2억원 이하' : '≤ ₩200M', rate: 5 },
                                            { range: lang === 'kr' ? '5억원 이하' : '≤ ₩500M', rate: 4.5 },
                                            { range: lang === 'kr' ? '10억원 이하' : '≤ ₩1B', rate: 4 },
                                        ].map((row, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid #f9fafb', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                                <td style={{ padding: '14px 20px', fontSize: '14px', color: '#374151', fontWeight: 600 }}>{row.range}</td>
                                                <td style={{ padding: '14px 20px' }}>
                                                    <span style={{ display: 'inline-block', background: blue + '12', color: blue, borderRadius: '8px', padding: '4px 14px', fontWeight: 900, fontSize: '14px' }}>{row.rate}%</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ background: '#fefce8', borderRadius: '14px', padding: '16px 20px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '16px' }}>⚠️</span>
                                <p style={{ margin: 0, fontSize: '13px', color: '#78350f', lineHeight: 1.6 }}>{t.consultNote}</p>
                            </div>
                        </div>

                        {/* FAQ */}
                        <div style={{ background: '#fff', borderRadius: '24px', padding: '40px', border: '1px solid #f0f0f0', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
                            <h2 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 28px', letterSpacing: '-0.02em' }}>{t.faqTitle}</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {t.faqs.map((faq, i) => (
                                    <div key={i} style={{ border: `1px solid ${openFaq === i ? '#bfdbfe' : '#f0f0f0'}`, borderRadius: '16px', overflow: 'hidden', background: openFaq === i ? '#f0f7ff' : '#fafafa', transition: '0.2s' }}>
                                        <button
                                            onClick={() => setOpenFaq(openFaq === i ? null : i)}
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start' }}
                                        >
                                            <span style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{faq.q}</span>
                                            <span style={{ fontSize: '18px', color: blue, transform: openFaq === i ? 'rotate(45deg)' : 'rotate(0)', transition: '0.2s', flexShrink: 0, marginLeft: '12px' }}>+</span>
                                        </button>
                                        {openFaq === i && (
                                            <div style={{ padding: '0 24px 20px' }}>
                                                <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.7, margin: 0 }}>{faq.a}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
