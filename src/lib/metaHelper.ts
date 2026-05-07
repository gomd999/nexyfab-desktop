const BASE_URL = 'https://nexyfab.com';

export type Lang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

export const LOCALE_MAP: Record<Lang, string> = {
    kr: 'ko_KR',
    en: 'en_US',
    ja: 'ja_JP',
    cn: 'zh_CN',
    es: 'es_ES',
    ar: 'ar_AE',
};

export const HREFLANG_ALTERNATES = {
    'ko': `${BASE_URL}/kr`,
    'en': `${BASE_URL}/en`,
    'ja': `${BASE_URL}/ja`,
    'zh': `${BASE_URL}/cn`,
    'es': `${BASE_URL}/es`,
    'ar': `${BASE_URL}/ar`,
    'x-default': `${BASE_URL}/en`,
};

export type PageKey =
    | 'home'
    | 'how-it-works'
    | 'company-introduction'
    | 'project-inquiry'
    | 'partner-register'
    | 'shape-generator'
    | 'quick-quote'
    | 'nexyfab'
    | 'pricing'
    | 'auto-order'
    | 'component-order'
    | 'privacy-policy'
    | 'terms-of-use'
    | 'security-policy'
    | 'customer-policy'
    | 'refund-policy'
    | 'partner-policy'
    | 'simulator'
    | 'dashboard'
    | 'orders'
    | 'rfq'
    | 'files'
    | 'projects'
    | 'settings';

type PageMeta = { title: string; description: string };

export const PAGE_META: Record<PageKey, Record<Lang, PageMeta>> = {
    home: {
        kr: { title: 'Nexyfab | AI 3D 모델링 & 제조 파트너 매칭 플랫폼', description: '브라우저에서 3D 모델링부터 AI 견적까지. 30만+ 공장 DB 기반으로 최적의 제조 파트너를 매칭합니다.' },
        en: { title: 'Nexyfab | AI 3D Modeling & Manufacturing Partner Matching Platform', description: 'From 3D modeling to AI quoting — all in your browser. Match with the best manufacturers from our 300,000+ factory database.' },
        ja: { title: 'Nexyfab | AI 3Dモデリング & 製造パートナーマッチングプラットフォーム', description: 'ブラウザで3DモデリングからAI見積もりまで。30万件以上の工場DBから最適な製造パートナーをマッチング。' },
        cn: { title: 'Nexyfab | AI 3D建模与制造合作伙伴匹配平台', description: '从浏览器中的3D建模到AI报价。基于30万+工厂数据库匹配最优制造合作伙伴。' },
        es: { title: 'Nexyfab | Plataforma de Modelado 3D con IA y Matching de Manufactura', description: 'Desde modelado 3D hasta cotización con IA en su navegador. Encuentre el mejor socio entre más de 300,000 fábricas.' },
        ar: { title: 'Nexyfab | منصة النمذجة ثلاثية الأبعاد بالذكاء الاصطناعي ومطابقة التصنيع', description: 'من النمذجة ثلاثية الأبعاد إلى التسعير بالذكاء الاصطناعي في متصفحك. مطابقة مع أفضل المصنعين من قاعدة بيانات تضم أكثر من 300,000 مصنع.' },
    },
    'how-it-works': {
        kr: { title: 'How we Work | 매칭 프로세스', description: 'DB 기반 검색 → AI 맞춤 분석 → 검증된 파트너 연결. Nexyfab의 3단계 제조 매칭 프로세스를 확인하세요.' },
        en: { title: 'How we Work | Matching Process', description: 'DB-based Search → AI Custom Analysis → Verified Connection. Discover Nexyfab\'s 3-step manufacturing matching process.' },
        ja: { title: 'How we Work | マッチングプロセス', description: 'DBベース検索 → AI最適分析 → 検証済み接続。Nexyfabの3ステップ製造マッチングプロセス。' },
        cn: { title: 'How we Work | 匹配流程', description: '基于DB搜索 → AI定制分析 → 验证对接。了解Nexyfab的三步匹配流程。' },
        es: { title: 'Cómo Trabajamos | Proceso de Emparejamiento', description: 'Búsqueda basada en DB → Análisis personalizado con IA → Conexión verificada. Descubra el proceso de 3 pasos de Nexyfab.' },
        ar: { title: 'كيف نعمل | عملية المطابقة', description: 'بحث قائم على قاعدة البيانات ← تحليل مخصص بالذكاء الاصطناعي ← اتصال موثق. اكتشف عملية المطابقة من 3 خطوات.' },
    },
    'company-introduction': {
        kr: { title: '회사 소개 | Nexyfab', description: 'Nexyfab는 AI 3D 모델링과 제조 파트너 매칭을 결합한 올인원 제조 플랫폼입니다. 설계부터 생산까지 연결합니다.' },
        en: { title: 'Company Introduction | Nexyfab', description: 'Nexyfab is an all-in-one manufacturing platform combining AI 3D modeling with manufacturing partner matching. From design to production.' },
        ja: { title: '会社紹介 | Nexyfab', description: 'NexyfabはAI 3Dモデリングと製造パートナーマッチングを統合したオールインワン製造プラットフォームです。' },
        cn: { title: '公司介绍 | Nexyfab', description: 'Nexyfab是将AI 3D建模与制造合作伙伴匹配相结合的一站式制造平台。从设计到生产全程连接。' },
        es: { title: 'Introducción de la Empresa | Nexyfab', description: 'Nexyfab es una plataforma de manufactura todo-en-uno que combina modelado 3D con IA y emparejamiento de socios de manufactura.' },
        ar: { title: 'تعريف الشركة | Nexyfab', description: 'Nexyfab منصة تصنيع متكاملة تجمع بين النمذجة ثلاثية الأبعاد بالذكاء الاصطناعي ومطابقة شركاء التصنيع.' },
    },
    'project-inquiry': {
        kr: { title: '프로젝트 문의 | Nexyfab', description: '제조/개발 프로젝트를 문의하세요. 방대한 공장 DB와 AI가 최적의 한국·중국 파트너를 매칭해드립니다.' },
        en: { title: 'Project Inquiry | Nexyfab', description: 'Submit your manufacturing or development project. Our massive DB and AI will match you with the optimal Korea & China partners.' },
        ja: { title: 'プロジェクトお問い合わせ | Nexyfab', description: '製造・開発プロジェクトをお問い合わせください。膨大な工場DBとAIが最適な韓国・中国パートナーをマッチングします。' },
        cn: { title: '项目咨询 | Nexyfab', description: '提交您的制造或开发项目咨询，依托庞大工厂DB with AI技术为您匹配最优韩中合作伙伴。' },
        es: { title: 'Consulta de Proyecto | Nexyfab', description: 'Envíe su proyecto de manufactura o desarrollo. Nuestra DB masiva e IA le emparejarán con los socios óptimos.' },
        ar: { title: 'استفسار المشروع | Nexyfab', description: 'قدّم مشروعك التصنيعي أو التطويري. ستقوم قاعدة بياناتنا والذكاء الاصطناعي بمطابقتك مع الشركاء المثاليين.' },
    },
    'partner-register': {
        kr: { title: '파트너 등록 | Nexyfab', description: '제조사/개발사로 Nexyfab 파트너 데이터베이스(DB)에 등록하세요. 글로벌 프로젝트 매칭 기회를 얻으세요.' },
        en: { title: 'Partner Register | Nexyfab', description: 'Register as a manufacturer or developer in Nexyfab\'s partner DB. Get matched with global projects.' },
        ja: { title: 'パートナー登録 | Nexyfab', description: 'NexyfabのパートナーDBにメーカー・開発会社として登録。グローバルなプロジェクトマッチングの機会を。' },
        cn: { title: '合作伙伴注册 | Nexyfab', description: '以制造商或开发商身份注册Nexyfab合作伙伴数据库，获得全球项目匹配机会。' },
        es: { title: 'Registro de Socios | Nexyfab', description: 'Regístrese como fabricante o desarrollador en la DB de socios de Nexyfab. Obtenga emparejamiento con proyectos globales.' },
        ar: { title: 'تسجيل الشركاء | Nexyfab', description: 'سجّل كشركة تصنيع أو تطوير في قاعدة بيانات شركاء Nexyfab واحصل على فرص مطابقة مشاريع عالمية.' },
    },
    'shape-generator': {
        kr: { title: '3D Shape Generator | 파라메트릭 3D 모델 생성기', description: '16종 파라메트릭 3D 형상을 브라우저에서 바로 생성하고, DFM 분석과 AI 견적까지 한번에. STEP/IGES 파일 임포트도 지원합니다.' },
        en: { title: '3D Shape Generator | Parametric 3D Modeling Tool', description: 'Generate 16 parametric 3D shapes in your browser. Built-in DFM analysis, AI cost estimation, and STEP/IGES import support.' },
        ja: { title: '3D Shape Generator | パラメトリック3Dモデル生成ツール', description: 'ブラウザで16種のパラメトリック3D形状を生成。DFM分析、AI見積もり、STEP/IGESインポートに対応。' },
        cn: { title: '3D Shape Generator | 参数化3D模型生成器', description: '在浏览器中生成16种参数化3D形状。内置DFM分析、AI成本估算和STEP/IGES导入支持。' },
        es: { title: '3D Shape Generator | Generador de Modelos 3D Paramétricos', description: 'Genere 16 formas 3D paramétricas en su navegador. Análisis DFM integrado, estimación de costos con IA y soporte STEP/IGES.' },
        ar: { title: '3D Shape Generator | مولد نماذج ثلاثية الأبعاد', description: 'أنشئ 16 شكلًا ثلاثي الأبعاد في متصفحك. تحليل DFM مدمج وتقدير تكلفة بالذكاء الاصطناعي ودعم STEP/IGES.' },
    },
    'quick-quote': {
        kr: { title: 'AI 빠른 견적 | 도면 업로드 즉시 견적', description: '3D 도면을 업로드하면 AI가 즉시 제조 원가를 분석하고 견적을 제공합니다. CNC, 사출, 판금 등 다양한 공정 지원.' },
        en: { title: 'AI Quick Quote | Instant Manufacturing Cost Estimate', description: 'Upload your 3D file and get instant AI-powered manufacturing cost estimates. Supports CNC, injection molding, sheet metal, and more.' },
        ja: { title: 'AIクイック見積もり | 図面アップロードで即時見積もり', description: '3Dファイルをアップロードすると、AIが即座に製造原価を分析し見積もりを提供。CNC、射出成形、板金加工に対応。' },
        cn: { title: 'AI快速报价 | 上传图纸即时报价', description: '上传3D文件，AI即时分析制造成本并提供报价。支持CNC、注塑、钣金等多种工艺。' },
        es: { title: 'Cotización Rápida con IA | Estimación Instantánea de Costos', description: 'Suba su archivo 3D y obtenga una estimación instantánea de costos de fabricación con IA. CNC, moldeo por inyección, chapa metálica.' },
        ar: { title: 'عرض أسعار سريع بالذكاء الاصطناعي | تقدير تكلفة فوري', description: 'ارفع ملفك ثلاثي الأبعاد واحصل على تقدير فوري لتكاليف التصنيع بالذكاء الاصطناعي.' },
    },
    'nexyfab': {
        kr: { title: 'NexyFab CAD 워크벤치 | 올인원 제조 설계 플랫폼', description: '3D 모델링, FEA 구조해석, DFM 제조성 분석, AI 견적을 브라우저에서 한번에. 올인원 제조 설계 솔루션.' },
        en: { title: 'NexyFab CAD Workbench | All-in-One Manufacturing Design', description: '3D modeling, FEA structural analysis, DFM manufacturability checks, and AI cost estimation — all in your browser.' },
        ja: { title: 'NexyFab CADワークベンチ | オールインワン製造設計', description: '3Dモデリング、FEA構造解析、DFM製造性分析、AI見積もりをブラウザで一括実行。' },
        cn: { title: 'NexyFab CAD工作台 | 一站式制造设计平台', description: '3D建模、FEA结构分析、DFM可制造性检查和AI成本估算——全部在浏览器中完成。' },
        es: { title: 'NexyFab CAD Workbench | Diseño de Manufactura Todo en Uno', description: 'Modelado 3D, análisis estructural FEA, verificación DFM y estimación de costos con IA, todo en su navegador.' },
        ar: { title: 'NexyFab CAD | منصة تصميم التصنيع المتكاملة', description: 'نمذجة ثلاثية الأبعاد وتحليل هيكلي FEA وفحص قابلية التصنيع DFM وتقدير التكلفة بالذكاء الاصطناعي.' },
    },
    'pricing': {
        kr: { title: '요금제 | Nexyfab', description: 'Nexyfab의 무료 및 프리미엄 요금제를 확인하세요. 제조 매칭, 3D CAD, AI 견적 서비스 가격 안내.' },
        en: { title: 'Pricing | Nexyfab', description: 'Explore Nexyfab\'s free and premium plans. Manufacturing matching, 3D CAD, and AI quoting service pricing.' },
        ja: { title: '料金プラン | Nexyfab', description: 'Nexyfabの無料およびプレミアムプランをご確認ください。製造マッチング、3D CAD、AI見積もりサービスの価格案内。' },
        cn: { title: '价格方案 | Nexyfab', description: '查看Nexyfab免费和高级方案。制造匹配、3D CAD和AI报价服务定价。' },
        es: { title: 'Precios | Nexyfab', description: 'Explore los planes gratuitos y premium de Nexyfab. Precios de emparejamiento de manufactura, CAD 3D y cotización con IA.' },
        ar: { title: 'الأسعار | Nexyfab', description: 'استكشف خطط Nexyfab المجانية والمميزة. أسعار خدمات مطابقة التصنيع وCAD ثلاثي الأبعاد والتسعير بالذكاء الاصطناعي.' },
    },
    'auto-order': {
        kr: { title: '자동 발주 | Nexyfab', description: 'Nexyfab 자동 발주 시스템으로 효율적인 제조 파트너 발주를 진행하세요.' },
        en: { title: 'Auto Order | Nexyfab', description: 'Streamline your manufacturing orders with Nexyfab\'s automated ordering system.' },
        ja: { title: '自動発注 | Nexyfab', description: 'Nexyfabの自動発注시스템で効率的な製造パートナーへの発注を進めてください。' },
        cn: { title: '自动下单 | Nexyfab', description: '通过Nexyfab的自动下单系统，高效进行制造合作伙伴订单管理。' },
        es: { title: 'Pedido Automático | Nexyfab', description: 'Optimice sus pedidos de manufactura con el sistema automatizado de Nexyfab.' },
        ar: { title: 'الطلب التلقائي | Nexyfab', description: 'قم بتبسيط طلبات التصنيع الخاصة بك مع نظام الطلب الآلي من Nexyfab.' },
    },
    'component-order': {
        kr: { title: '부품 발주 | Nexyfab', description: 'Nexyfab 부품 발주 시스템으로 필요한 부품을 효율적으로 조달하세요.' },
        en: { title: 'Component Order | Nexyfab', description: 'Efficiently procure components with Nexyfab\'s component ordering system.' },
        ja: { title: '部品発注 | Nexyfab', description: 'Nexyfabの部品発注시스템で必要な部品を効率的に調達してください。' },
        cn: { title: '零件订购 | Nexyfab', description: '通过Nexyfab的零件订购系统，高效采购所需零件。' },
        es: { title: 'Pedido de Componentes | Nexyfab', description: 'Adquiera componentes eficientemente con el sistema de pedidos de Nexyfab.' },
        ar: { title: 'طلب المكونات | Nexyfab', description: 'احصل على المكونات بكفاءة من خلال نظام طلب المكونات من Nexyfab.' },
    },
    'privacy-policy': {
        kr: { title: '개인정보 처리방침 | Nexyfab', description: 'Nexyfab 개인정보 처리방침을 확인하세요.' },
        en: { title: 'Privacy Policy | Nexyfab', description: 'Read Nexyfab\'s privacy policy.' },
        ja: { title: 'プライバシーポリシー | Nexyfab', description: 'Nexyfabのプライバシーポリシーをご確認ください。' },
        cn: { title: '隐私政策 | Nexyfab', description: '查看Nexyfab隐私政策。' },
        es: { title: 'Política de Privacidad | Nexyfab', description: 'Lea la política de privacidad de Nexyfab.' },
        ar: { title: 'سياسة الخصوصية | Nexyfab', description: 'اقرأ سياسة الخصوصية الخاصة بـ Nexyfab.' },
    },
    'terms-of-use': {
        kr: { title: '이용약관 | Nexyfab', description: 'Nexyfab 서비스 이용약관을 확인하세요.' },
        en: { title: 'Terms of Use | Nexyfab', description: 'Read Nexyfab\'s terms of use.' },
        ja: { title: '利用規約 | Nexyfab', description: 'Nexyfabの利用規約をご確認ください。' },
        cn: { title: '使用条款 | Nexyfab', description: '查看Nexyfab使用条款。' },
        es: { title: 'Términos de Uso | Nexyfab', description: 'Lea los términos de uso de Nexyfab.' },
        ar: { title: 'شروط الاستخدام | Nexyfab', description: 'اقرأ شروط استخدام Nexyfab.' },
    },
    'security-policy': {
        kr: { title: '보안 정책 | Nexyfab', description: 'Nexyfab NDA 기반 보안 정책을 확인하세요.' },
        en: { title: 'Security Policy | Nexyfab', description: 'Read Nexyfab\'s NDA-based security policy.' },
        ja: { title: 'セキュリティポリシー | Nexyfab', description: 'NexyfabのNDAベースのセキュリティポリシーをご確認ください。' },
        cn: { title: '安全政策 | Nexyfab', description: '查看Nexyfab基于NDA的安全政策。' },
        es: { title: 'Política de Seguridad | Nexyfab', description: 'Lea la política de seguridad basada en NDA de Nexyfab.' },
        ar: { title: 'سياسة الأمان | Nexyfab', description: 'اقرأ سياسة الأمان المبنية على اتفاقية عدم الإفصاح من Nexyfab.' },
    },
    'customer-policy': {
        kr: { title: '고객 정책 | Nexyfab', description: 'Nexyfab 고객 정책을 확인하세요.' },
        en: { title: 'Customer Policy | Nexyfab', description: 'Read Nexyfab\'s customer policy.' },
        ja: { title: 'カスタマーポリシー | Nexyfab', description: 'Nexyfabのカスタマーポリシーをご確認ください。' },
        cn: { title: '客户政策 | Nexyfab', description: '查看Nexyfab客户政策。' },
        es: { title: 'Política del Cliente | Nexyfab', description: 'Lea la política de clientes de Nexyfab.' },
        ar: { title: 'سياسة العملاء | Nexyfab', description: 'اقرأ سياسة العملاء الخاصة بـ Nexyfab.' },
    },
    'refund-policy': {
        kr: { title: '환불 안내 | Nexyfab', description: 'NexyFab 구독·주문·수수료 환불 및 취소 절차를 안내합니다.' },
        en: { title: 'Refund Policy | Nexyfab', description: 'NexyFab subscription, order, and fee refund and cancellation procedures.' },
        ja: { title: '返金について | Nexyfab', description: 'NexyFabのサブスクリプション・注約・手数料の返金・キャンセル手順。' },
        cn: { title: '退款说明 | Nexyfab', description: 'NexyFab订阅、订单及费用的退款与取消流程说明。' },
        es: { title: 'Política de Reembolsos | Nexyfab', description: 'Procedimientos de reembolso y cancelación de NexyFab.' },
        ar: { title: 'سياسة الاسترداد | Nexyfab', description: 'إجراءات الاسترداد والإلغاء في NexyFab.' },
    },
    'partner-policy': {
        kr: { title: '파트너 정책 | Nexyfab', description: 'Nexyfab 파트너 정책을 확인하세요.' },
        en: { title: 'Partner Policy | Nexyfab', description: 'Read Nexyfab\'s partner policy.' },
        ja: { title: 'パートナーポリシー | Nexyfab', description: 'Nexyfabのパートナーポリシーをご確認ください。' },
        cn: { title: '合作伙伴政策 | Nexyfab', description: '查看Nexyfab合作伙伴政策。' },
        es: { title: 'Política de Socios | Nexyfab', description: 'Lea la política de socios de Nexyfab.' },
        ar: { title: 'سياسة الشركاء | Nexyfab', description: 'اقرأ سياسة الشركاء الخاصة بـ Nexyfab.' },
    },
    'simulator': {
        kr: { title: '제조 시뮬레이터 | 글로벌 제조 원가 및 생산 전략 시뮬레이터', description: '한국·중국 제조 원가, 관세, 물류비 및 생산 전략을 정밀 시뮬레이션하세요.' },
        en: { title: 'Manufacturing Simulator | Global Manufacturing Cost & Strategy Simulator', description: 'Simulate manufacturing costs, duties, logistics, and production strategies for Korea and China.' },
        ja: { title: '製造シミュレーター | グローバル製造原価および生産戦略シミュレーター', description: '韓国・中国の製造原価、関税、物流費、生産戦略を精密にシミュレーションします。' },
        cn: { title: '制造模拟器 | 全球制造成本与生产战略模拟器', description: '精确模拟韩中制造成本、关税、物流及生产战略。' },
        es: { title: 'Simulador de Manufactura | Simulador Global de Costos y Estrategia de Producción', description: 'Simule costos de manufactura, aranceles, logística y estrategias de producción para Corea y China.' },
        ar: { title: 'محاكي التصنيع | محاكي تكاليف التصنيع العالمية واستراتيجيات الإنتاج', description: 'محاكاة تكاليف التصنيع والرسوم الجمركية واللوجستيات واستراتيجيات الإنتاج لكوريا والصين.' },
    },
    'dashboard': {
        kr: { title: '대시보드 | Nexyfab', description: '제조 프로젝트, 주문, RFQ 현황을 한눈에 확인하세요.' },
        en: { title: 'Dashboard | Nexyfab', description: 'Overview of your manufacturing projects, orders, and RFQ status.' },
        ja: { title: 'ダッシュボード | Nexyfab', description: '製造プロジェクト、注文、RFQの状況を一目で確認。' },
        cn: { title: '仪表盘 | Nexyfab', description: '一览您的制造项目、订单及RFQ状态。' },
        es: { title: 'Panel de Control | Nexyfab', description: 'Resumen de sus proyectos de manufactura, pedidos y estado de RFQ.' },
        ar: { title: 'لوحة التحكم | Nexyfab', description: 'نظرة عامة على مشاريع التصنيع والطلبات وحالة RFQ.' },
    },
    'orders': {
        kr: { title: '주문 내역 | Nexyfab', description: '진행 중인 제조 주문과 배송 현황을 추적하세요.' },
        en: { title: 'Orders | Nexyfab', description: 'Track your active manufacturing orders and delivery status.' },
        ja: { title: '注文履歴 | Nexyfab', description: '進行中の製造注文と配送状況を追跡。' },
        cn: { title: '订单记录 | Nexyfab', description: '追踪您的制造订单及配送状态。' },
        es: { title: 'Pedidos | Nexyfab', description: 'Rastree sus pedidos de manufactura activos y el estado de entrega.' },
        ar: { title: 'الطلبات | Nexyfab', description: 'تتبع طلبات التصنيع النشطة وحالة التسليم.' },
    },
    'rfq': {
        kr: { title: 'RFQ 견적 요청 | Nexyfab', description: '제조 견적을 요청하고 파트너의 응답을 관리하세요.' },
        en: { title: 'RFQ | Nexyfab', description: 'Request manufacturing quotes and manage partner responses.' },
        ja: { title: 'RFQ 見積もり依頼 | Nexyfab', description: '製造見積もりを依頼し、パートナーの回答を管理。' },
        cn: { title: 'RFQ 询价 | Nexyfab', description: '发起制造询价并管理合作伙伴的回复。' },
        es: { title: 'RFQ | Nexyfab', description: 'Solicite cotizaciones de manufactura y gestione respuestas de socios.' },
        ar: { title: 'طلب عرض أسعار | Nexyfab', description: 'اطلب عروض أسعار التصنيع وأدر ردود الشركاء.' },
    },
    'files': {
        kr: { title: '파일 관리 | Nexyfab', description: '업로드한 3D 도면, 설계 파일 및 관련 문서를 관리하세요.' },
        en: { title: 'Files | Nexyfab', description: 'Manage your uploaded 3D drawings, design files, and related documents.' },
        ja: { title: 'ファイル管理 | Nexyfab', description: 'アップロードした3D図面、設計ファイル、関連書類を管理。' },
        cn: { title: '文件管理 | Nexyfab', description: '管理您上传的3D图纸、设计文件及相关文档。' },
        es: { title: 'Archivos | Nexyfab', description: 'Gestione sus dibujos 3D, archivos de diseño y documentos relacionados.' },
        ar: { title: 'الملفات | Nexyfab', description: 'إدارة الرسومات ثلاثية الأبعاد وملفات التصميم والوثائق المرتبطة.' },
    },
    'projects': {
        kr: { title: '프로젝트 | Nexyfab', description: '제조 프로젝트를 생성하고 파트너 협업을 진행하세요.' },
        en: { title: 'Projects | Nexyfab', description: 'Create manufacturing projects and collaborate with partners.' },
        ja: { title: 'プロジェクト | Nexyfab', description: '製造プロジェクトを作成しパートナーと連携。' },
        cn: { title: '项目 | Nexyfab', description: '创建制造项目并与合作伙伴协作。' },
        es: { title: 'Proyectos | Nexyfab', description: 'Cree proyectos de manufactura y colabore con socios.' },
        ar: { title: 'المشاريع | Nexyfab', description: 'أنشئ مشاريع التصنيع وتعاون مع الشركاء.' },
    },
    'settings': {
        kr: { title: '계정 설정 | Nexyfab', description: '프로필, 알림, 보안 설정을 관리하세요.' },
        en: { title: 'Account Settings | Nexyfab', description: 'Manage your profile, notifications, and security settings.' },
        ja: { title: 'アカウント設定 | Nexyfab', description: 'プロフィール、通知、セキュリティ設定を管理。' },
        cn: { title: '账户设置 | Nexyfab', description: '管理您的个人资料、通知和安全设置。' },
        es: { title: 'Configuración de Cuenta | Nexyfab', description: 'Administre su perfil, notificaciones y configuración de seguridad.' },
        ar: { title: 'إعدادات الحساب | Nexyfab', description: 'إدارة ملفك الشخصي وإشعاراتك وإعدادات الأمان.' },
    },
};

export function buildMetadata(lang: string, pageKey: PageKey) {
    const validLang = (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(lang) ? lang : 'en') as Lang;
    const m = PAGE_META[pageKey][validLang];
    const canonicalUrl = `${BASE_URL}/${validLang}/${pageKey === 'home' ? '' : pageKey}`;

    return {
        title: m.title,
        description: m.description,
        alternates: {
            canonical: canonicalUrl,
            languages: HREFLANG_ALTERNATES,
        },
        verification: {
            other: {
                'naver-site-verification': '75d70ae125ae8b085508cf900526811fa1c77cb3',
            },
        },
        openGraph: {
            type: 'website' as const,
            url: canonicalUrl,
            siteName: 'Nexyfab',
            title: m.title,
            description: m.description,
            locale: LOCALE_MAP[validLang],
            images: [{ url: `${BASE_URL}/api/og?page=${pageKey}&lang=${validLang}`, width: 1200, height: 630, alt: m.title }],
        },
        twitter: {
            card: 'summary_large_image' as const,
            title: m.title,
            description: m.description,
            images: [`${BASE_URL}/api/og?page=${pageKey}&lang=${validLang}`],
        },
    };
}
