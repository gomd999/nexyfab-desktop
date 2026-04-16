'use client';

import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { analytics } from '@/lib/analytics';

// ModelViewer는 client-side only (three.js)
const ModelViewer = dynamic(() => import('@/app/components/ModelViewer'), { ssr: false });

// ─── 다국어 사전 ─────────────────────────────────────────────────────────────

const dict = {
    ko: {
        pageTitle: '빠른 제조 견적',
        pageDesc: 'STEP 또는 이미지 파일을 업로드하면 AI가 즉시 원가를 예측합니다',
        uploadTab_step: 'STEP/STP 파일',
        uploadTab_image: '이미지 파일',
        dropzoneText: '파일을 드래그하거나 클릭하여 업로드',
        dropzoneHint_step: '지원: .step .stp .stl .obj .blend · 다중 파일 가능',
        dropzoneHint_image: '지원: .jpg .png .webp · 다중 파일 가능',
        exampleBtn: '예시 파일로 체험하기',
        exampleLabel: '예시',
        dimTitle: '치수 입력 (필수)',
        dimW: '가로(W)',
        dimH: '세로(H)',
        dimD: '높이(D)',
        dimUnit: 'mm',
        analyzeBtn: '분석 시작',
        analyzing: 'AI 분석 중...',
        step_parsing: '파일 파싱 완료',
        step_geometry: '지오메트리 추출 중...',
        step_deepseek: 'AI 분석 요청 중...',
        analysisTitle: '부품 분석 결과',
        volume: '볼륨',
        surfaceArea: '표면적',
        size: '크기',
        aiProcess: 'AI 추정 공정',
        complexity: '복잡도',
        materialTitle: '재질 선택',
        processTitle: '공정 선택',
        finishLabel: '표면 처리',
        toleranceLabel: '공차 등급',
        quantityLabel: '수량',
        pcs: '개',
        calcBtn: '견적 계산',
        resultTitle: '예상 견적',
        unitPrice: '단가',
        totalPrice: '총액',
        costBreakdown: '원가 구성',
        materialCost: '재료비',
        machiningCost: '가공비',
        setupCost: '셋업/금형',
        aiReport: 'AI 분석 결과',
        difficulty: '난이도',
        dfmScore: 'DFM 점수',
        leadTime: '리드타임',
        days: '일',
        alternatives: '비용 절감 대안',
        saving: '절감',
        qualityRisks: '품질 리스크',
        inquiryBtn: '견적서로 문의하기',
        saveBtn: '저장',
        aiRecommended: 'AI추천',
        fileSizeError: '파일 크기가 초과되었습니다.',
        fileTypeError: '지원하지 않는 파일 형식입니다.',
        dimRequired: '이미지 파일은 치수(W, H, D)를 입력해주세요.',
        uploadError: '파일 업로드 중 오류가 발생했습니다.',
        storageQuota: '저장 공간이 부족합니다. 플랜을 업그레이드하거나 기존 파일을 삭제해주세요.',
        estimateError: '견적 계산 중 오류가 발생했습니다.',
        viewModel: '3D 모델 보기',
        closeModel: '닫기',
        gateTitle: '전체 분석 결과 확인',
        gateDesc: '무료 가입 후 원가 구성, AI 리포트, 비용 절감 대안, 제조사 매칭까지 모두 확인하세요.',
        gateSignup: '무료 회원가입',
        gateLogin: '이미 계정이 있어요',
        gateItem1: '📊 원가 구성 상세 (재료비 / 가공비 / 셋업비)',
        gateItem2: '🤖 AI 분석 리포트 (난이도 / DFM / 리드타임)',
        gateItem3: '⚡ 비용 절감 대안 제안',
        gateItem4: '📋 견적서로 제조사 매칭 문의',
        retentionNotice: '업로드된 파일은 견적 요청 미연결 시 30일, RFQ만 있고 계약 미체결 시 90일 후 자동 삭제됩니다. 중요한 파일은 로컬에 백업해 주세요.',
    },
    en: {
        pageTitle: 'Quick Manufacturing Quote',
        pageDesc: 'Upload a STEP or image file and AI instantly predicts manufacturing costs',
        uploadTab_step: 'STEP/STP File',
        uploadTab_image: 'Image File',
        dropzoneText: 'Drag & drop or click to upload',
        dropzoneHint_step: 'Supported: .step .stp .stl .obj .blend · Multiple files allowed',
        exampleBtn: 'Try with Example File',
        exampleLabel: 'Example',
        dropzoneHint_image: 'Supported: .jpg .png .webp · Multiple files allowed',
        dimTitle: 'Enter Dimensions (required)',
        dimW: 'Width (W)',
        dimH: 'Height (H)',
        dimD: 'Depth (D)',
        dimUnit: 'mm',
        analyzeBtn: 'Start Analysis',
        analyzing: 'AI Analyzing...',
        step_parsing: 'File parsed',
        step_geometry: 'Extracting geometry...',
        step_deepseek: 'Requesting AI analysis...',
        analysisTitle: 'Part Analysis Result',
        volume: 'Volume',
        surfaceArea: 'Surface Area',
        size: 'Size',
        aiProcess: 'AI Est. Process',
        complexity: 'Complexity',
        materialTitle: 'Select Material',
        processTitle: 'Select Process',
        finishLabel: 'Surface Finish',
        toleranceLabel: 'Tolerance Grade',
        quantityLabel: 'Quantity',
        pcs: 'pcs',
        calcBtn: 'Calculate Quote',
        resultTitle: 'Estimated Quote',
        unitPrice: 'Unit Price',
        totalPrice: 'Total',
        costBreakdown: 'Cost Breakdown',
        materialCost: 'Material',
        machiningCost: 'Machining',
        setupCost: 'Setup/Tooling',
        aiReport: 'AI Analysis',
        difficulty: 'Difficulty',
        dfmScore: 'DFM Score',
        leadTime: 'Lead Time',
        days: ' days',
        alternatives: 'Cost Saving Alternatives',
        saving: 'saving',
        qualityRisks: 'Quality Risks',
        inquiryBtn: 'Request Quote',
        saveBtn: 'Save',
        aiRecommended: 'AI Recommended',
        fileSizeError: 'File size exceeded.',
        fileTypeError: 'Unsupported file type.',
        dimRequired: 'Please enter dimensions (W, H, D) for image files.',
        uploadError: 'File upload error.',
        storageQuota: 'Storage quota exceeded. Please upgrade your plan or delete existing files.',
        estimateError: 'Quote calculation error.',
        viewModel: 'View 3D Model',
        closeModel: 'Close',
        gateTitle: 'See Full Analysis Results',
        gateDesc: 'Sign up free to access cost breakdown, AI report, cost-saving alternatives, and manufacturer matching.',
        gateSignup: 'Sign Up Free',
        gateLogin: 'Already have an account',
        gateItem1: '📊 Cost Breakdown (Material / Machining / Setup)',
        gateItem2: '🤖 AI Report (Difficulty / DFM / Lead Time)',
        gateItem3: '⚡ Cost-Saving Alternatives',
        gateItem4: '📋 Manufacturer Matching Inquiry',
        retentionNotice: 'Uploaded files are auto-deleted after 30 days if not linked to a quote, or 90 days if no contract is signed. Please back up important files locally.',
    },
    ja: {
        pageTitle: 'クイック製造見積もり',
        pageDesc: 'STEPまたは画像ファイルをアップロードするとAIが即座に原価を予測します',
        uploadTab_step: 'STEP/STPファイル',
        uploadTab_image: '画像ファイル',
        dropzoneText: 'ドラッグまたはクリックしてアップロード',
        dropzoneHint_step: '対応: .step .stp .stl',
        exampleBtn: 'サンプルファイルで試す',
        exampleLabel: 'サンプル',
        dropzoneHint_image: '対応: .jpg .png .webp',
        dimTitle: '寸法入力（必須）',
        dimW: '幅(W)',
        dimH: '高さ(H)',
        dimD: '奥行(D)',
        dimUnit: 'mm',
        analyzeBtn: '分析開始',
        analyzing: 'AI分析中...',
        step_parsing: 'ファイル解析完了',
        step_geometry: 'ジオメトリ抽出中...',
        step_deepseek: 'AI分析リクエスト中...',
        analysisTitle: '部品分析結果',
        volume: '体積',
        surfaceArea: '表面積',
        size: 'サイズ',
        aiProcess: 'AI推定工程',
        complexity: '複雑度',
        materialTitle: '素材選択',
        processTitle: '工程選択',
        finishLabel: '表面処理',
        toleranceLabel: '公差グレード',
        quantityLabel: '数量',
        pcs: '個',
        calcBtn: '見積もり計算',
        resultTitle: '予想見積もり',
        unitPrice: '単価',
        totalPrice: '合計',
        costBreakdown: 'コスト内訳',
        materialCost: '材料費',
        machiningCost: '加工費',
        setupCost: 'セットアップ',
        aiReport: 'AI分析結果',
        difficulty: '難易度',
        dfmScore: 'DFMスコア',
        leadTime: 'リードタイム',
        days: '日',
        alternatives: 'コスト削減代替案',
        saving: '削減',
        qualityRisks: '品質リスク',
        inquiryBtn: '見積書で問い合わせ',
        saveBtn: '保存',
        aiRecommended: 'AI推薦',
        fileSizeError: 'ファイルサイズが超過しました。',
        fileTypeError: 'サポートされていないファイル形式です。',
        dimRequired: '画像ファイルには寸法(W, H, D)を入力してください。',
        uploadError: 'ファイルアップロードエラー。',
        storageQuota: 'ストレージ容量が不足しています。プランをアップグレードするか、既存ファイルを削除してください。',
        estimateError: '見積もり計算エラー。',
        viewModel: '3Dモデルを表示',
        closeModel: '閉じる',
        gateTitle: '詳細分析結果を確認',
        gateDesc: '無料登録後、コスト内訳・AIレポート・コスト削減案・工場マッチングをご覧いただけます。',
        gateSignup: '無料会員登録',
        gateLogin: 'すでにアカウントをお持ちの方',
        gateItem1: '📊 コスト内訳（材料費 / 加工費 / 段取り費）',
        gateItem2: '🤖 AIレポート（難易度 / DFM / リードタイム）',
        gateItem3: '⚡ コスト削減代替案',
        gateItem4: '📋 工場マッチング問い合わせ',
        retentionNotice: 'アップロードされたファイルは、見積依頼未連結の場合30日、契約未締結の場合90日後に自動削除されます。重要なファイルはローカルにバックアップしてください。',
    },
    cn: {
        pageTitle: '快速制造报价',
        pageDesc: '上传STEP或图片文件，AI立即预测制造成本',
        uploadTab_step: 'STEP/STP文件',
        uploadTab_image: '图片文件',
        dropzoneText: '拖拽或点击上传文件',
        dropzoneHint_step: '支持: .step .stp .stl',
        exampleBtn: '用示例文件体验',
        exampleLabel: '示例',
        dropzoneHint_image: '支持: .jpg .png .webp',
        dimTitle: '输入尺寸（必填）',
        dimW: '宽(W)',
        dimH: '高(H)',
        dimD: '深(D)',
        dimUnit: 'mm',
        analyzeBtn: '开始分析',
        analyzing: 'AI分析中...',
        step_parsing: '文件解析完成',
        step_geometry: '提取几何数据中...',
        step_deepseek: 'AI分析请求中...',
        analysisTitle: '零件分析结果',
        volume: '体积',
        surfaceArea: '表面积',
        size: '尺寸',
        aiProcess: 'AI推荐工艺',
        complexity: '复杂度',
        materialTitle: '选择材料',
        processTitle: '选择工艺',
        finishLabel: '表面处理',
        toleranceLabel: '公差等级',
        quantityLabel: '数量',
        pcs: '件',
        calcBtn: '计算报价',
        resultTitle: '预估报价',
        unitPrice: '单价',
        totalPrice: '总价',
        costBreakdown: '成本构成',
        materialCost: '材料费',
        machiningCost: '加工费',
        setupCost: '模具/装夹',
        aiReport: 'AI分析结果',
        difficulty: '难度',
        dfmScore: 'DFM评分',
        leadTime: '交货期',
        days: '天',
        alternatives: '降本方案',
        saving: '节省',
        qualityRisks: '质量风险',
        inquiryBtn: '提交询价',
        saveBtn: '保存',
        aiRecommended: 'AI推荐',
        fileSizeError: '文件大小超出限制。',
        fileTypeError: '不支持的文件类型。',
        dimRequired: '图片文件请输入尺寸(W, H, D)。',
        uploadError: '文件上传错误。',
        storageQuota: '存储空间不足，请升级套餐或删除已有文件。',
        estimateError: '报价计算错误。',
        viewModel: '查看3D模型',
        closeModel: '关闭',
        gateTitle: '查看完整分析结果',
        gateDesc: '免费注册后，查看成本构成、AI报告、降本方案及制造商匹配服务。',
        gateSignup: '免费注册',
        gateLogin: '已有账号',
        gateItem1: '📊 成本构成（材料费 / 加工费 / 模具费）',
        gateItem2: '🤖 AI报告（难度 / DFM / 交货期）',
        gateItem3: '⚡ 降本替代方案',
        gateItem4: '📋 制造商匹配询价',
        retentionNotice: '上传的文件如未关联报价请求，将在30天后自动删除；仅有询价但未签订合同的文件将在90天后删除。请在本地备份重要文件。',
    },
    es: {
        pageTitle: 'Cotización Rápida de Fabricación',
        pageDesc: 'Sube un archivo STEP o imagen y la IA predice los costos de fabricación',
        uploadTab_step: 'Archivo STEP/STP',
        uploadTab_image: 'Archivo de Imagen',
        dropzoneText: 'Arrastra o haz clic para subir',
        dropzoneHint_step: 'Soportado: .step .stp .stl',
        exampleBtn: 'Probar con archivo de ejemplo',
        exampleLabel: 'Ejemplo',
        dropzoneHint_image: 'Soportado: .jpg .png .webp',
        dimTitle: 'Ingresar Dimensiones (requerido)',
        dimW: 'Ancho(W)',
        dimH: 'Alto(H)',
        dimD: 'Prof(D)',
        dimUnit: 'mm',
        analyzeBtn: 'Iniciar Análisis',
        analyzing: 'Analizando con IA...',
        step_parsing: 'Archivo analizado',
        step_geometry: 'Extrayendo geometría...',
        step_deepseek: 'Solicitando análisis de IA...',
        analysisTitle: 'Resultado del Análisis',
        volume: 'Volumen',
        surfaceArea: 'Área Superficial',
        size: 'Tamaño',
        aiProcess: 'Proceso Est. IA',
        complexity: 'Complejidad',
        materialTitle: 'Seleccionar Material',
        processTitle: 'Seleccionar Proceso',
        finishLabel: 'Acabado Superficial',
        toleranceLabel: 'Grado de Tolerancia',
        quantityLabel: 'Cantidad',
        pcs: 'uds',
        calcBtn: 'Calcular Cotización',
        resultTitle: 'Cotización Estimada',
        unitPrice: 'Precio Unitario',
        totalPrice: 'Total',
        costBreakdown: 'Desglose de Costos',
        materialCost: 'Material',
        machiningCost: 'Mecanizado',
        setupCost: 'Utillaje',
        aiReport: 'Análisis IA',
        difficulty: 'Dificultad',
        dfmScore: 'Puntuación DFM',
        leadTime: 'Tiempo de Entrega',
        days: ' días',
        alternatives: 'Alternativas de Ahorro',
        saving: 'ahorro',
        qualityRisks: 'Riesgos de Calidad',
        inquiryBtn: 'Solicitar Cotización',
        saveBtn: 'Guardar',
        aiRecommended: 'Recomendado IA',
        fileSizeError: 'Tamaño de archivo excedido.',
        fileTypeError: 'Tipo de archivo no soportado.',
        dimRequired: 'Por favor ingrese dimensiones (W, H, D).',
        uploadError: 'Error al subir archivo.',
        storageQuota: 'Almacenamiento insuficiente. Actualice su plan o elimine archivos existentes.',
        estimateError: 'Error al calcular cotización.',
        viewModel: 'Ver Modelo 3D',
        closeModel: 'Cerrar',
        gateTitle: 'Ver Resultados Completos',
        gateDesc: 'Regístrate gratis para acceder al desglose de costos, informe de IA, alternativas de ahorro y matching de fabricantes.',
        gateSignup: 'Registro Gratuito',
        gateLogin: 'Ya tengo una cuenta',
        gateItem1: '📊 Desglose de Costos (Material / Mecanizado / Utillaje)',
        gateItem2: '🤖 Informe IA (Dificultad / DFM / Tiempo de Entrega)',
        gateItem3: '⚡ Alternativas de Ahorro',
        gateItem4: '📋 Consulta de Matching de Fabricantes',
        retentionNotice: 'Los archivos subidos se eliminan automáticamente después de 30 días si no están vinculados a una cotización, o 90 días si no se firma un contrato. Respalde los archivos importantes localmente.',
    },
    ar: {
        pageTitle: 'عرض سعر سريع',
        pageDesc: 'قم بتحميل ملف STEP أو صورة وسيتنبأ الذكاء الاصطناعي بتكاليف التصنيع',
        uploadTab_step: 'ملف STEP/STP',
        uploadTab_image: 'ملف صورة',
        dropzoneText: 'اسحب أو انقر للرفع',
        dropzoneHint_step: 'مدعوم: .step .stp .stl',
        exampleBtn: 'جرّب بملف نموذجي',
        exampleLabel: 'نموذج',
        dropzoneHint_image: 'مدعوم: .jpg .png .webp',
        dimTitle: 'أدخل الأبعاد (مطلوب)',
        dimW: 'العرض',
        dimH: 'الارتفاع',
        dimD: 'العمق',
        dimUnit: 'mm',
        analyzeBtn: 'بدء التحليل',
        analyzing: 'الذكاء الاصطناعي يحلل...',
        step_parsing: 'تم تحليل الملف',
        step_geometry: 'استخراج الهندسة...',
        step_deepseek: 'جارٍ طلب تحليل الذكاء الاصطناعي...',
        analysisTitle: 'نتيجة تحليل القطعة',
        volume: 'الحجم',
        surfaceArea: 'المساحة السطحية',
        size: 'الحجم',
        aiProcess: 'العملية المقدرة',
        complexity: 'التعقيد',
        materialTitle: 'اختر المادة',
        processTitle: 'اختر العملية',
        finishLabel: 'معالجة السطح',
        toleranceLabel: 'درجة التفاوت',
        quantityLabel: 'الكمية',
        pcs: 'قطعة',
        calcBtn: 'احسب العرض',
        resultTitle: 'عرض السعر المقدر',
        unitPrice: 'سعر الوحدة',
        totalPrice: 'الإجمالي',
        costBreakdown: 'تفصيل التكاليف',
        materialCost: 'تكلفة المواد',
        machiningCost: 'تكلفة التشغيل',
        setupCost: 'الإعداد',
        aiReport: 'تقرير الذكاء الاصطناعي',
        difficulty: 'الصعوبة',
        dfmScore: 'نقاط DFM',
        leadTime: 'وقت التسليم',
        days: ' يوم',
        alternatives: 'بدائل توفير التكاليف',
        saving: 'توفير',
        qualityRisks: 'مخاطر الجودة',
        inquiryBtn: 'طلب عرض سعر',
        saveBtn: 'حفظ',
        aiRecommended: 'موصى به بالذكاء',
        fileSizeError: 'حجم الملف تجاوز الحد.',
        fileTypeError: 'نوع ملف غير مدعوم.',
        dimRequired: 'الرجاء إدخال الأبعاد (W, H, D).',
        uploadError: 'خطأ في رفع الملف.',
        storageQuota: 'مساحة التخزين غير كافية. يرجى ترقية خطتك أو حذف الملفات الموجودة.',
        estimateError: 'خطأ في حساب العرض.',
        viewModel: 'عرض النموذج ثلاثي الأبعاد',
        closeModel: 'إغلاق',
        gateTitle: 'عرض النتائج الكاملة',
        gateDesc: 'سجّل مجاناً للوصول إلى تفصيل التكاليف وتقرير الذكاء الاصطناعي وبدائل التوفير ومطابقة المصنّعين.',
        gateSignup: 'تسجيل مجاني',
        gateLogin: 'لدي حساب بالفعل',
        gateItem1: '📊 تفصيل التكاليف (مواد / تشغيل / إعداد)',
        gateItem2: '🤖 تقرير الذكاء الاصطناعي (صعوبة / DFM / وقت التسليم)',
        gateItem3: '⚡ بدائل توفير التكاليف',
        gateItem4: '📋 استفسار مطابقة المصنّعين',
        retentionNotice: 'يتم حذف الملفات المرفوعة تلقائياً بعد 30 يوماً إذا لم تكن مرتبطة بطلب عرض سعر، أو بعد 90 يوماً إذا لم يتم توقيع عقد. يرجى نسخ الملفات المهمة احتياطياً.',
    },
};

// ─── 재질/공정 목록 ───────────────────────────────────────────────────────────

const MATERIALS = [
    { id: 'steel_s45c',    label: '일반강철 (S45C)' },
    { id: 'aluminum_6061', label: '알루미늄합금 (6061)' },
    { id: 'stainless_304', label: '스테인레스 (SUS304)' },
    { id: 'brass',         label: '황동 (C3604)' },
    { id: 'abs_plastic',   label: 'ABS 플라스틱' },
    { id: 'pom',           label: 'POM (엔지니어링 플라스틱)' },
    { id: 'pc',            label: 'PC (폴리카보네이트)' },
    { id: 'titanium',      label: '티타늄 (Ti-6Al-4V)' },
];

const PROCESSES = [
    { id: 'cnc',               label: 'CNC 가공' },
    { id: 'injection_molding', label: '사출 성형' },
    { id: 'die_casting',       label: '다이캐스팅' },
    { id: 'sheet_metal',       label: '판금 가공' },
    { id: '3d_printing_fdm',   label: '3D프린팅 (FDM)' },
    { id: '3d_printing_sla',   label: '3D프린팅 (SLA)' },
    { id: '3d_printing_sls',   label: '3D프린팅 (SLS)' },
    { id: 'forging',           label: '단조' },
];

const FINISHES = [
    { id: 'none',        label: { ko: '무처리', en: 'None', ja: 'なし', cn: '无处理', es: 'Ninguno', ar: 'لا شيء' } },
    { id: 'anodize',     label: { ko: '아노다이징', en: 'Anodizing', ja: 'アルマイト', cn: '阳极氧化', es: 'Anodizado', ar: 'أنودة' } },
    { id: 'paint',       label: { ko: '도장', en: 'Painting', ja: '塗装', cn: '喷漆', es: 'Pintura', ar: 'طلاء' } },
    { id: 'chrome',      label: { ko: '크롬도금', en: 'Chrome Plating', ja: 'クロムメッキ', cn: '镀铬', es: 'Cromado', ar: 'كروم' } },
    { id: 'nickel',      label: { ko: '니켈도금', en: 'Nickel Plating', ja: 'ニッケルメッキ', cn: '镀镍', es: 'Niquelado', ar: 'نيكل' } },
    { id: 'powder_coat', label: { ko: '파우더코팅', en: 'Powder Coat', ja: 'パウダーコート', cn: '粉末涂装', es: 'Pintura en polvo', ar: 'طلاء مسحوق' } },
];

const TOLERANCES = [
    { id: 'it7',  label: { ko: '정밀(IT7)', en: 'Precision (IT7)', ja: '精密(IT7)', cn: '精密(IT7)', es: 'Precisión (IT7)', ar: 'دقيق (IT7)' } },
    { id: 'it8',  label: { ko: '고정밀(IT8)', en: 'Fine (IT8)', ja: '高精密(IT8)', cn: '高精度(IT8)', es: 'Fino (IT8)', ar: 'دقيق جداً (IT8)' } },
    { id: 'it9',  label: { ko: '일반(IT9)', en: 'Standard (IT9)', ja: '一般(IT9)', cn: '标准(IT9)', es: 'Estándar (IT9)', ar: 'قياسي (IT9)' } },
    { id: 'it11', label: { ko: '거칠기(IT11)', en: 'Rough (IT11)', ja: '粗(IT11)', cn: '粗糙(IT11)', es: 'Rugoso (IT11)', ar: 'خشن (IT11)' } },
];

// ─── 숫자 포맷 ──────────────────────────────────────────────────────────────

const fmtKRW = (n: number) => n.toLocaleString('ko-KR') + '원';

// ─── 상수 ──────────────────────────────────────────────────────────────────

const NEXYSYS_URL = process.env.NEXT_PUBLIC_NEXYSYS_URL || 'https://nexysys.com';

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

function QuickQuotePageInner() {
    const pathname = usePathname();
    const router = useRouter();
    const parts = pathname?.split('/').filter(Boolean) || [];
    const langCode = parts[0] || 'en';
    const lang = ['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en';
    const langMapCode: Record<string, keyof typeof dict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
    const t = dict[langMapCode[lang] || 'en'];

    // ── State ──
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [fileMode, setFileMode] = useState<'step' | 'image'>('step');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [fileUrl, setFileUrl] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState('');

    // 치수 입력 (이미지 모드)
    const [dimW, setDimW] = useState('');
    const [dimH, setDimH] = useState('');
    const [dimD, setDimD] = useState('');

    // 치수 요구 상태 (서버 추출 실패 시)
    const [dimRequired, setDimRequired] = useState(false);
    const [dimFieldError, setDimFieldError] = useState({ w: false, h: false, d: false });
    const dimSectionRef = useRef<HTMLDivElement>(null);

    // 분석 진행 상태
    const [analyzeProgress, setAnalyzeProgress] = useState<string[]>([]);
    const [analyzing, setAnalyzing] = useState(false);

    // 분석 결과
    const [geometry, setGeometry] = useState<{ volume_cm3: number; surface_area_cm2: number; bbox: { w: number; h: number; d: number } } | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<Record<string, unknown> | null>(null);

    // 선택 옵션
    const [material, setMaterial] = useState('aluminum_6061');
    const [process, setProcess] = useState('cnc');
    const [finishType, setFinishType] = useState('none');
    const [tolerance, setTolerance] = useState('it9');
    const [quantity, setQuantity] = useState(1);

    // 견적 결과
    const [estimates, setEstimates] = useState<{
        unit_cost: number;
        total_cost: number;
        breakdown: { material: { amount: number; pct: number }; machining: { amount: number; pct: number }; setup: { amount: number; pct: number } };
        weight_kg: number;
    } | null>(null);
    const [aiReport, setAiReport] = useState<Record<string, unknown> | null>(null);
    const [alternatives, setAlternatives] = useState<Array<{ material: string; process: string; saving_pct: number; reason: string }>>([]);

    // 실시간 재료 가격
    const [livePrices, setLivePrices] = useState<Record<string, number> | null>(null);
    const [liveUsdKrw, setLiveUsdKrw] = useState<number | null>(null);
    const [priceSource, setPriceSource] = useState<'live' | 'default' | null>(null);
    const [priceUpdatedAt, setPriceUpdatedAt] = useState<string | null>(null);

    // 로그인 상태
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    useEffect(() => {
        const user = localStorage.getItem('currentUser');
        setIsLoggedIn(!!user);
    }, []);

    // ── Shape Generator 연동: searchParams에서 geometry 프리필 ──
    const searchParams = useSearchParams();

    // Cart items for batch mode
    interface CartItemLocal { id: string; shapeId: string; shapeName: string; thumbnail: string | null; volume_cm3: number; surface_area_cm2: number; bbox: { w: number; h: number; d: number }; featureCount: number; }
    const [cartItems, setCartItems] = useState<CartItemLocal[]>([]);
    const [isCartMode, setIsCartMode] = useState(false);

    useEffect(() => {
        const from = searchParams.get('from');
        if (from === 'shape-generator') {
            const vol = parseFloat(searchParams.get('volume_cm3') || '');
            const sa = parseFloat(searchParams.get('surface_area_cm2') || '');
            const bw = parseFloat(searchParams.get('bbox_w') || '');
            const bh = parseFloat(searchParams.get('bbox_h') || '');
            const bd = parseFloat(searchParams.get('bbox_d') || '');
            if (!isNaN(vol) && !isNaN(sa) && !isNaN(bw) && !isNaN(bh) && !isNaN(bd)) {
                setGeometry({ volume_cm3: vol, surface_area_cm2: sa, bbox: { w: bw, h: bh, d: bd } });
                setDimW(bw.toFixed(0));
                setDimH(bh.toFixed(0));
                setDimD(bd.toFixed(0));
                setStep(3);
            }
        } else if (from === 'shape-cart') {
            // Load cart from localStorage
            try {
                const raw = localStorage.getItem('nexyfab_shape_cart');
                const items: CartItemLocal[] = raw ? JSON.parse(raw) : [];
                if (items.length > 0) {
                    setCartItems(items);
                    setIsCartMode(true);
                    // Use combined geometry of all items
                    const totalVol = items.reduce((s, i) => s + i.volume_cm3, 0);
                    const totalSA = items.reduce((s, i) => s + i.surface_area_cm2, 0);
                    const maxW = Math.max(...items.map(i => i.bbox.w));
                    const maxH = Math.max(...items.map(i => i.bbox.h));
                    const maxD = Math.max(...items.map(i => i.bbox.d));
                    setGeometry({ volume_cm3: totalVol, surface_area_cm2: totalSA, bbox: { w: maxW, h: maxH, d: maxD } });
                    setDimW(maxW.toFixed(0));
                    setDimH(maxH.toFixed(0));
                    setDimD(maxD.toFixed(0));
                    setStep(3);
                }
            } catch { /* ignore */ }
        }
    }, [searchParams]);

    // ── 기능 1: 다재료 비교 테이블 ──
    const [showCompareTable, setShowCompareTable] = useState(false);

    // ── 기능 3: LME 차트 데이터 ──
    const [chartData, setChartData] = useState<{
        aluminum: Array<{ date: string; value: number }>;
        copper: Array<{ date: string; value: number }>;
        lastUpdated: string;
    } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadExample = async () => {
        try {
            const res = await fetch('/examples/acu_part-1_main_body.stp');
            const blob = await res.blob();
            const file = new File([blob], 'acu_part-1_main_body.stp', { type: 'application/octet-stream' });
            setFileMode('step');
            setSelectedFiles([file]);
            // 예시 파일의 실측 치수 (STP 파일 기준)
            setDimW('247');
            setDimH('243');
            setDimD('127');
            setError('');
        } catch {
            setError('예시 파일을 불러오는 데 실패했습니다.');
        }
    };

    // 실시간 재료 가격 로드
    useEffect(() => {
        fetch('/api/material-prices')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.prices) {
                    setLivePrices(data.prices);
                    setLiveUsdKrw(data.usd_krw);
                    const anyLive = Object.values(data.sources as Record<string, string>).some((s: string) => s.includes('실시간'));
                    setPriceSource(anyLive ? 'live' : 'default');
                    setPriceUpdatedAt(data.lastUpdated);
                }
            })
            .catch(() => {});
    }, []);

    // Step 4 진입 시 LME 차트 데이터 로드
    useEffect(() => {
        if (step === 4 && !chartData) {
            fetch('/api/material-prices/chart')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.aluminum?.length > 0) {
                        setChartData(data);
                    }
                })
                .catch(() => {});
        }
    }, [step]);

    // AI 추천 재질/공정 반영
    useEffect(() => {
        if (aiAnalysis) {
            const recProcess = aiAnalysis.process as string;
            const recMaterials = aiAnalysis.materials as string[];
            if (recProcess && PROCESSES.find(p => p.id === recProcess)) {
                setProcess(recProcess);
            }
            if (recMaterials?.length > 0 && MATERIALS.find(m => m.id === recMaterials[0])) {
                setMaterial(recMaterials[0]);
            }
        }
    }, [aiAnalysis]);

    // ── 파일 검증 ──
    const validateFile = (file: File): boolean => {
        if (fileMode === 'step') {
            const allowed = ['.step', '.stp', '.stl', '.obj', '.blend'];
            const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
            if (!allowed.includes(ext)) { setError(t.fileTypeError); return false; }
            if (file.size > 50 * 1024 * 1024) { setError(t.fileSizeError); return false; }
        } else {
            const allowed = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowed.includes(file.type)) { setError(t.fileTypeError); return false; }
            if (file.size > 10 * 1024 * 1024) { setError(t.fileSizeError); return false; }
        }
        return true;
    };

    const handleFileSelect = (files: FileList | File[]) => {
        setError('');
        setDimRequired(false);
        setDimFieldError({ w: false, h: false, d: false });
        const valid: File[] = [];
        for (const file of Array.from(files)) {
            if (validateFile(file)) valid.push(file);
        }
        if (valid.length > 0) setSelectedFiles(prev => {
            const names = new Set(prev.map(f => f.name));
            return [...prev, ...valid.filter(f => !names.has(f.name))];
        });
    };

    const removeFile = (name: string) => {
        setSelectedFiles(prev => prev.filter(f => f.name !== name));
        setDimRequired(false);
        setDimFieldError({ w: false, h: false, d: false });
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
    }, [fileMode]);

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = () => setIsDragging(false);

    // blend 파일 포함 여부 (치수 입력 필요)
    const hasBlendOrImage = selectedFiles.some(f => {
        const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
        return ['.blend', '.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });
    const needsDimensions = fileMode === 'image' || (fileMode === 'step' && hasBlendOrImage);

    // ── 분석 시작 ──
    const handleAnalyze = async () => {
        if (selectedFiles.length === 0) return;

        // 치수가 필요한 상태에서 미입력 시 강조
        const showDimForm = needsDimensions || dimRequired;
        if (showDimForm && (!dimW || !dimH || !dimD)) {
            const fieldErr = { w: !dimW, h: !dimH, d: !dimD };
            setDimFieldError(fieldErr);
            setTimeout(() => {
                dimSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
            return;
        }

        setDimFieldError({ w: false, h: false, d: false });
        setError('');
        setStep(2);
        setAnalyzing(true);
        setAnalyzeProgress([]);

        try {
            const addProgress = (msg: string) => setAnalyzeProgress(prev => [...prev, msg]);
            addProgress(t.step_parsing);

            const formData = new FormData();
            for (const file of selectedFiles) {
                formData.append('file', file);
            }
            if (dimW && dimH && dimD) {
                formData.append('dimensions', JSON.stringify({ w: Number(dimW), h: Number(dimH), d: Number(dimD) }));
            }

            addProgress(t.step_geometry);

            const res = await fetch('/api/quick-quote/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (res.status === 413) throw new Error(data.error || t.storageQuota);
            if (!res.ok) throw new Error(data.error || t.uploadError);

            addProgress(t.step_deepseek);

            setGeometry(data.geometry);
            setAiAnalysis(data.aiAnalysis);
            setFileUrl(data.fileUrl);
            analytics.quoteRequest({ source: 'quick-quote' });

            setStep(3);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t.uploadError;
            setError(msg);
            setStep(1);
            // 지오메트리 추출 실패 → 치수 직접 입력 요구
            const isGeoFail = msg.toLowerCase().includes('geometry') || msg.toLowerCase().includes('extract') || msg.includes('치수') || msg.includes('dimensions');
            if (isGeoFail) {
                setDimRequired(true);
                setTimeout(() => {
                    dimSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        } finally {
            setAnalyzing(false);
        }
    };

    // ── 견적 계산 ──
    const handleEstimate = async () => {
        if (!geometry) return;
        setError('');

        try {
            const res = await fetch('/api/quick-quote/estimate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geometry, material, process, quantity, finishType, tolerance, aiAnalysis }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || t.estimateError);

            setEstimates(data.estimates);
            setAiReport(data.aiReport);
            setAlternatives(data.alternatives || []);
            setStep(4);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t.estimateError);
        }
    };

    // ── 수량 변경 시 즉시 재계산 ──
    const handleQuantityChange = async (newQty: number) => {
        setQuantity(newQty);
        if (step === 4 && geometry) {
            try {
                const res = await fetch('/api/quick-quote/estimate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ geometry, material, process, quantity: newQty, finishType, tolerance, aiAnalysis }),
                });
                const data = await res.json();
                if (res.ok) {
                    setEstimates(data.estimates);
                }
            } catch { /* 실패해도 기존 값 유지 */ }
        }
    };

    // ─── 공통 단가 계산 유틸 (기능 1, 4 공용) ────────────────────────────────
    // estimate API와 동일한 로직으로 클라이언트에서 즉시 계산
    const MATERIAL_DATA: Record<string, { density: number; machinability: number; price: number }> = {
        steel_s45c:    { density: 7.85, machinability: 0.8,  price: 1800 },
        aluminum_6061: { density: 2.70, machinability: 0.5,  price: 4500 },
        stainless_304: { density: 7.93, machinability: 1.2,  price: 6000 },
        brass:         { density: 8.50, machinability: 0.4,  price: 9000 },
        abs_plastic:   { density: 1.05, machinability: 0.3,  price: 3500 },
        pom:           { density: 1.42, machinability: 0.35, price: 5000 },
        pc:            { density: 1.20, machinability: 0.4,  price: 4800 },
        titanium:      { density: 4.43, machinability: 2.5,  price: 85000 },
    };

    const PROCESS_DATA: Record<string, { base_rate: number; setup: number; complexity_factor: boolean }> = {
        cnc:               { base_rate: 85000,  setup: 150000,   complexity_factor: true },
        injection_molding: { base_rate: 25000,  setup: 5000000,  complexity_factor: false },
        die_casting:       { base_rate: 35000,  setup: 3000000,  complexity_factor: false },
        sheet_metal:       { base_rate: 45000,  setup: 200000,   complexity_factor: true },
        '3d_printing_fdm': { base_rate: 15000,  setup: 30000,    complexity_factor: false },
        '3d_printing_sla': { base_rate: 45000,  setup: 50000,    complexity_factor: false },
        '3d_printing_sls': { base_rate: 80000,  setup: 100000,   complexity_factor: false },
        forging:           { base_rate: 55000,  setup: 800000,   complexity_factor: true },
    };

    const TOL_MULT: Record<string, number> = { it7: 1.25, it8: 1.12, it9: 1.0, it11: 0.9 };
    const FIN_MULT: Record<string, number> = { none: 1.0, anodize: 1.15, paint: 1.12, chrome: 1.25, nickel: 1.20, powder_coat: 1.10 };

    function calcQtyDiscount(qty: number): number {
        if (qty >= 500) return 0.68;
        if (qty >= 100) return 0.75;
        if (qty >= 50)  return 0.82;
        if (qty >= 10)  return 0.90;
        return 1.0;
    }

    function calcUnitCost(
        matId: string,
        procId: string,
        qty: number,
        tol: string,
        fin: string,
        vol_cm3: number,
        area_cm2: number,
        complexityVal: number,
        priceOverride?: number
    ): number {
        const mat = MATERIAL_DATA[matId];
        const proc = PROCESS_DATA[procId];
        if (!mat || !proc) return 0;

        const pricePerKg = priceOverride ?? mat.price;
        const weight_kg = (vol_cm3 * mat.density) / 1000;
        const material_cost = weight_kg * pricePerKg;

        // 복잡도 팩터
        const complexityFactor = proc.complexity_factor ? (1 + (complexityVal - 5) * 0.05) : 1.0;
        const machining_cost = area_cm2 * (proc.base_rate / 10000) * mat.machinability * complexityFactor;
        const setup_amortized = proc.setup / qty;

        const tolMult = TOL_MULT[tol] ?? 1.0;
        const finMult = FIN_MULT[fin] ?? 1.0;
        const qtyDiscount = calcQtyDiscount(qty);

        return Math.round((material_cost + machining_cost + setup_amortized) * tolMult * finMult * qtyDiscount);
    }

    // ── 기능 2: PDF 인쇄 ──
    const handlePrintQuote = () => {
        if (!estimates || !geometry) return;

        const matLabel = MATERIALS.find(m => m.id === material)?.label || material;
        const procLabel = PROCESSES.find(p => p.id === process)?.label || process;
        const finLabel = FINISHES.find(f => f.id === finishType)?.label?.ko || finishType;
        const tolLabel = TOLERANCES.find(t => t.id === tolerance)?.label?.ko || tolerance;
        const now = new Date().toLocaleString('ko-KR');

        const aiSummary = aiReport?.summary ? String(aiReport.summary) : '';
        const difficulty = aiReport?.difficulty ? String(aiReport.difficulty) : '-';
        const dfmScore = aiReport?.dfm_score ? String(aiReport.dfm_score) : '-';
        const leadTime = aiReport?.lead_time_days ? String(aiReport.lead_time_days) : '-';

        const printCss = `
@media print {
  body * { visibility: hidden !important; }
  #nexyfab-print-area, #nexyfab-print-area * { visibility: visible !important; }
  #nexyfab-print-area { position: fixed; top: 0; left: 0; width: 100%; background: #fff; padding: 32px; box-sizing: border-box; font-family: 'Noto Sans KR', sans-serif; }
  @page { margin: 20mm; }
}
`;
        // 인쇄 전용 영역 생성
        const printDiv = document.createElement('div');
        printDiv.id = 'nexyfab-print-area';
        printDiv.innerHTML = `
<div style="border-bottom:2px solid #0b5cff;padding-bottom:16px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;">
  <div>
    <div style="font-size:24px;font-weight:900;color:#0b5cff;letter-spacing:-0.02em;">NexyFab</div>
    <div style="font-size:14px;color:#6b7280;margin-top:2px;">nexyfab.com</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:20px;font-weight:800;color:#111827;">제조 견적서</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:4px;">발행일시: ${now}</div>
  </div>
</div>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
  <tr style="background:#f8faff;">
    <th colspan="4" style="padding:10px 14px;text-align:left;font-size:14px;font-weight:800;color:#374151;border:1px solid #e5e7eb;">📐 부품 정보</th>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">볼륨</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${geometry.volume_cm3.toFixed(1)} cm³</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">표면적</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${geometry.surface_area_cm2.toFixed(1)} cm²</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">크기(bbox)</td>
    <td colspan="3" style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${geometry.bbox.w} × ${geometry.bbox.h} × ${geometry.bbox.d} mm</td>
  </tr>
</table>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
  <tr style="background:#f8faff;">
    <th colspan="4" style="padding:10px 14px;text-align:left;font-size:14px;font-weight:800;color:#374151;border:1px solid #e5e7eb;">⚙️ 선택 사양</th>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">재료</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${matLabel}</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">공정</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${procLabel}</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">표면처리</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${finLabel}</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">공차 등급</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${tolLabel}</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">수량</td>
    <td colspan="3" style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${quantity}개</td>
  </tr>
</table>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
  <tr style="background:#eff6ff;">
    <th colspan="2" style="padding:10px 14px;text-align:left;font-size:14px;font-weight:800;color:#0b5cff;border:1px solid #bfdbfe;">💰 견적 금액</th>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">단가 (1개)</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-size:18px;font-weight:900;color:#0b5cff;">${estimates.unit_cost.toLocaleString('ko-KR')}원</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">총액 (${quantity}개)</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-size:18px;font-weight:900;color:#059669;">${estimates.total_cost.toLocaleString('ko-KR')}원</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">무게</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${estimates.weight_kg.toFixed(3)} kg</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">원가 구성</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">
      재료비 ${estimates.breakdown.material.pct}% (${estimates.breakdown.material.amount.toLocaleString('ko-KR')}원) &nbsp;|&nbsp;
      가공비 ${estimates.breakdown.machining.pct}% (${estimates.breakdown.machining.amount.toLocaleString('ko-KR')}원) &nbsp;|&nbsp;
      셋업비 ${estimates.breakdown.setup.pct}% (${estimates.breakdown.setup.amount.toLocaleString('ko-KR')}원)
    </td>
  </tr>
</table>

${aiReport ? `
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
  <tr style="background:#f0fdf4;">
    <th colspan="4" style="padding:10px 14px;text-align:left;font-size:14px;font-weight:800;color:#065f46;border:1px solid #bbf7d0;">🤖 AI 분석 결과</th>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">난이도</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${difficulty}</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">DFM 점수</td>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${dfmScore}/100</td>
  </tr>
  <tr>
    <td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">리드타임</td>
    <td colspan="3" style="padding:8px 14px;border:1px solid #e5e7eb;font-weight:700;">${leadTime}일</td>
  </tr>
  ${aiSummary ? `<tr><td style="padding:8px 14px;border:1px solid #e5e7eb;color:#6b7280;font-weight:600;">종합의견</td><td colspan="3" style="padding:8px 14px;border:1px solid #e5e7eb;">${aiSummary}</td></tr>` : ''}
</table>
` : ''}

<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;">
  본 견적은 참고용이며 실제 견적은 문의 후 확정됩니다 &nbsp;·&nbsp; nexyfab.com
</div>
`;

        document.body.appendChild(printDiv);
        const styleEl = document.createElement('style');
        styleEl.id = 'nexyfab-print-style';
        styleEl.textContent = printCss;
        document.head.appendChild(styleEl);

        window.print();

        // 인쇄 후 정리
        setTimeout(() => {
            document.body.removeChild(printDiv);
            const s = document.getElementById('nexyfab-print-style');
            if (s) document.head.removeChild(s);
        }, 500);
    };

    // ── 문의하기 ──
    const handleInquiry = () => {
        if (!estimates || !geometry) return;
        router.push(`/${lang}/project-inquiry/?from=quick-quote&material=${material}&process=${process}&qty=${quantity}&unitCost=${estimates.unit_cost}&bbox=${JSON.stringify(geometry.bbox)}`);
    };

    // ─── 공통 스타일 ──────────────────────────────────────────────────────────
    const card: React.CSSProperties = {
        background: '#fff',
        borderRadius: '20px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        padding: '28px',
        marginBottom: '20px',
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '10px 14px',
        border: '1.5px solid #e5e7eb',
        borderRadius: '10px',
        fontSize: '15px',
        outline: 'none',
        transition: 'border-color 0.15s',
        background: '#fafafa',
        boxSizing: 'border-box',
    };

    const badgeAI: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: '#eff6ff', color: '#0b5cff', borderRadius: '20px',
        padding: '2px 10px', fontSize: '11px', fontWeight: 700,
        border: '1px solid #bfdbfe',
    };

    // ─── Render ────────────────────────────────────────────────────────────────
    return (
        <main style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', paddingBottom: '80px' }}>
            {/* Hero */}
            <section style={{ padding: '48px 24px 32px', textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '20px', padding: '6px 16px', fontSize: '13px', color: '#0b5cff', fontWeight: 700, marginBottom: '16px' }}>
                    <span>⚡</span> Quick Quote · AI-Powered
                </div>
                <h1 style={{ fontSize: 'clamp(24px,4vw,40px)', fontWeight: 900, color: '#111827', letterSpacing: '-0.02em', margin: '0 0 12px' }}>
                    {t.pageTitle}
                </h1>
                <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>{t.pageDesc}</p>

                {/* Step Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '28px' }}>
                    {[1, 2, 3, 4].map((s) => (
                        <React.Fragment key={s}>
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                background: step >= s ? '#0b5cff' : '#e5e7eb',
                                color: step >= s ? '#fff' : '#9ca3af',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '13px', fontWeight: 800, transition: 'all 0.3s',
                            }}>
                                {step > s ? '✓' : s}
                            </div>
                            {s < 4 && <div style={{ width: '40px', height: '2px', background: step > s ? '#0b5cff' : '#e5e7eb', borderRadius: '2px', transition: 'background 0.3s' }} />}
                        </React.Fragment>
                    ))}
                </div>
            </section>

            <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 24px' }}>

                {/* ── Step 1: 파일 업로드 ── */}
                {step === 1 && (
                    <div style={card}>
                        {/* 파일 타입 탭 */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                            {(['step', 'image'] as const).map(mode => (
                                <button key={mode} onClick={() => { setFileMode(mode); setSelectedFiles([]); setError(''); }}
                                    style={{
                                        flex: 1, padding: '12px', borderRadius: '14px', border: '2px solid',
                                        borderColor: fileMode === mode ? '#0b5cff' : '#e5e7eb',
                                        background: fileMode === mode ? '#eff6ff' : '#fff',
                                        color: fileMode === mode ? '#0b5cff' : '#6b7280',
                                        fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    }}>
                                    <span>{mode === 'step' ? '📁' : '🖼'}</span>
                                    {mode === 'step' ? t.uploadTab_step : t.uploadTab_image}
                                </button>
                            ))}
                        </div>

                        {/* Dropzone */}
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            style={{
                                border: `2px dashed ${isDragging ? '#0b5cff' : selectedFiles.length > 0 ? '#10b981' : '#d1d5db'}`,
                                borderRadius: '16px',
                                padding: '32px 24px',
                                textAlign: 'center',
                                cursor: 'pointer',
                                background: isDragging ? '#eff6ff' : selectedFiles.length > 0 ? '#f0fdf4' : '#f9fafb',
                                transition: 'all 0.2s',
                            }}
                        >
                            <input ref={fileInputRef} type="file" multiple
                                accept={fileMode === 'step' ? '.step,.stp,.stl,.obj,.blend' : 'image/jpeg,image/png,image/webp'}
                                style={{ display: 'none' }}
                                onChange={e => { if (e.target.files && e.target.files.length > 0) handleFileSelect(e.target.files); e.target.value = ''; }}
                            />
                            {selectedFiles.length > 0 ? (
                                <>
                                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
                                    <div style={{ fontWeight: 700, color: '#111827', marginBottom: '10px' }}>
                                        {selectedFiles.length}개 파일 선택됨
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                                        {selectedFiles.map(f => (
                                            <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '1px solid #d1fae5', borderRadius: '8px', padding: '6px 12px', fontSize: '13px' }}>
                                                <span style={{ color: '#065f46', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                                                    {f.name}
                                                </span>
                                                <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '8px', flexShrink: 0 }}>
                                                    {(f.size / 1024 / 1024).toFixed(1)}MB
                                                </span>
                                                <button onClick={() => removeFile(f.name)} style={{ marginLeft: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '16px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '8px' }}>클릭하여 파일 추가</div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: '36px', marginBottom: '12px' }}>📂</div>
                                    <div style={{ fontWeight: 700, color: '#374151', fontSize: '15px' }}>{t.dropzoneText}</div>
                                    <div style={{ color: '#9ca3af', fontSize: '13px', marginTop: '6px' }}>
                                        {fileMode === 'step' ? t.dropzoneHint_step : t.dropzoneHint_image}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 파일 보관 정책 고지 */}
                        <div style={{
                            marginTop: '8px', padding: '8px 12px',
                            background: '#f0f9ff', borderRadius: '8px',
                            border: '1px solid #bae6fd',
                            fontSize: '11px', color: '#0369a1', lineHeight: 1.5,
                        }}>
                            {t.retentionNotice}
                        </div>

                        {/* shake 애니메이션 */}
                        <style>{`
                            @keyframes shake {
                                0%,100% { transform: translateX(0); }
                                20% { transform: translateX(-6px); }
                                40% { transform: translateX(6px); }
                                60% { transform: translateX(-4px); }
                                80% { transform: translateX(4px); }
                            }
                        `}</style>

                        {/* 치수 입력 (이미지/blend 모드 또는 STEP 추출 실패 시) */}
                        {(needsDimensions || dimRequired) && (
                            <div
                                ref={dimSectionRef}
                                style={{
                                    marginTop: '20px', padding: '16px',
                                    background: dimRequired ? '#fff7ed' : '#f8faff',
                                    borderRadius: '12px',
                                    border: `1.5px solid ${(dimFieldError.w || dimFieldError.h || dimFieldError.d) ? '#ef4444' : dimRequired ? '#fed7aa' : '#e0e7ff'}`,
                                    animation: (dimFieldError.w || dimFieldError.h || dimFieldError.d) ? 'shake 0.4s ease' : 'none',
                                    transition: 'border-color 0.2s',
                                }}
                            >
                                <div style={{ fontWeight: 700, color: dimRequired ? '#c2410c' : '#374151', marginBottom: dimRequired ? '6px' : '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    📐 {dimRequired ? (lang === 'kr' ? '치수를 입력해야 분석이 가능합니다' : lang === 'ja' ? '寸法を入力してください' : lang === 'cn' ? '请输入尺寸以继续分析' : lang === 'es' ? 'Ingresa las dimensiones para continuar' : lang === 'ar' ? 'أدخل الأبعاد للمتابعة' : 'Dimensions required to continue') : t.dimTitle}
                                </div>
                                {dimRequired && (
                                    <div style={{ fontSize: '12px', color: '#92400e', marginBottom: '12px', padding: '8px 10px', background: '#fef3c7', borderRadius: '8px' }}>
                                        {lang === 'kr' ? '파일에서 치수를 자동 추출하지 못했습니다. 도면이나 실측값을 직접 입력해 주세요.' : lang === 'ja' ? 'ファイルから寸法を自動抽出できませんでした。図面や実測値を入力してください。' : lang === 'cn' ? '无法从文件自动提取尺寸，请手动输入图纸或实测值。' : lang === 'es' ? 'No se pudieron extraer automáticamente las dimensiones. Ingrésalas manualmente.' : lang === 'ar' ? 'تعذّر استخراج الأبعاد تلقائياً. يرجى إدخالها يدوياً.' : 'Could not auto-extract dimensions from the file. Please enter them manually.'}
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                    {[
                                        { label: t.dimW, val: dimW, set: setDimW, errKey: 'w' as const },
                                        { label: t.dimH, val: dimH, set: setDimH, errKey: 'h' as const },
                                        { label: t.dimD, val: dimD, set: setDimD, errKey: 'd' as const },
                                    ].map(({ label, val, set, errKey }) => {
                                        const hasErr = dimFieldError[errKey];
                                        return (
                                            <div key={label}>
                                                <label style={{ fontSize: '12px', color: hasErr ? '#dc2626' : '#6b7280', fontWeight: 600 }}>{label}</label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <input
                                                        type="number" min="0" value={val}
                                                        onChange={e => {
                                                            set(e.target.value);
                                                            if (e.target.value) setDimFieldError(prev => ({ ...prev, [errKey]: false }));
                                                        }}
                                                        placeholder="0"
                                                        style={{
                                                            ...inputStyle, width: '100%',
                                                            borderColor: hasErr ? '#ef4444' : undefined,
                                                            background: hasErr ? '#fef2f2' : undefined,
                                                        }}
                                                    />
                                                    <span style={{ color: '#9ca3af', fontSize: '12px', whiteSpace: 'nowrap' }}>{t.dimUnit}</span>
                                                </div>
                                                {hasErr && <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '3px' }}>필수 입력</div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 예시 파일 버튼 */}
                        {selectedFiles.length === 0 && fileMode === 'step' && (
                            <div style={{ marginTop: '16px', textAlign: 'center' }}>
                                <button
                                    onClick={loadExample}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                        padding: '8px 18px', borderRadius: '20px',
                                        border: '1.5px dashed #0b5cff', background: '#f5f8ff',
                                        color: '#0b5cff', fontSize: '13px', fontWeight: 700,
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#f5f8ff'; }}
                                >
                                    <span style={{ fontSize: '10px', fontWeight: 800, background: '#0b5cff', color: '#fff', borderRadius: '4px', padding: '1px 6px', letterSpacing: '0.04em' }}>{t.exampleLabel}</span>
                                    {t.exampleBtn}
                                </button>
                            </div>
                        )}

                        {error && (
                            <div style={{ marginTop: '12px', padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', color: '#dc2626', fontSize: '14px' }}>
                                ⚠️ {error}
                            </div>
                        )}

                        <button
                            onClick={handleAnalyze}
                            disabled={selectedFiles.length === 0}
                            style={{
                                width: '100%', marginTop: '20px', padding: '16px',
                                background: selectedFiles.length > 0 ? '#0b5cff' : '#e5e7eb',
                                color: selectedFiles.length > 0 ? '#fff' : '#9ca3af',
                                border: 'none', borderRadius: '16px',
                                fontWeight: 800, fontSize: '16px', cursor: selectedFiles.length > 0 ? 'pointer' : 'not-allowed',
                                boxShadow: selectedFiles.length > 0 ? '0 4px 16px rgba(11,92,255,0.3)' : 'none',
                                transition: 'all 0.2s',
                            }}
                        >
                            {selectedFiles.length > 1 ? `${selectedFiles.length}개 파일 ${t.analyzeBtn}` : t.analyzeBtn}
                        </button>
                    </div>
                )}

                {/* ── Step 2: 분석 중 ── */}
                {step === 2 && (
                    <div style={{ ...card, textAlign: 'center' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
                        <h2 style={{ fontWeight: 800, fontSize: '20px', color: '#111827', margin: '0 0 24px' }}>{t.analyzing}</h2>

                        <div style={{ maxWidth: '360px', margin: '0 auto', textAlign: 'left' }}>
                            {analyzeProgress.map((msg, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                                    <span style={{ color: '#10b981', fontSize: '16px' }}>✅</span>
                                    <span style={{ color: '#374151', fontSize: '14px' }}>{msg}</span>
                                </div>
                            ))}
                            {analyzing && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0' }}>
                                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '16px' }}>🔄</span>
                                    <span style={{ color: '#6b7280', fontSize: '14px' }}>{t.step_deepseek}</span>
                                </div>
                            )}
                        </div>

                        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {/* ── Step 3: 재료/공정 선택 ── */}
                {step === 3 && geometry && (
                    <>
                        {/* 분석 결과 요약 */}
                        <div style={card}>
                            <h2 style={{ margin: '0 0 16px', fontWeight: 800, fontSize: '18px', color: '#111827' }}>
                                📊 {t.analysisTitle}
                                {isCartMode && cartItems.length > 0 && (
                                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#6366f1', marginLeft: 8 }}>
                                        ({cartItems[0]?.shapeName} {cartItems.length > 1 ? `외 ${cartItems.length - 1}건` : ''})
                                    </span>
                                )}
                            </h2>

                            {/* Cart mode: thumbnail gallery */}
                            {isCartMode && cartItems.length > 0 && (
                                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', marginBottom: 16, paddingBottom: 8 }}>
                                    {cartItems.map((ci, idx) => (
                                        <div key={ci.id} style={{
                                            flexShrink: 0, width: 140, background: '#f9fafb', borderRadius: 12,
                                            border: '1px solid #e5e7eb', overflow: 'hidden',
                                        }}>
                                            <div style={{ width: '100%', height: 90, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                {ci.thumbnail ? (
                                                    <img src={ci.thumbnail} alt={ci.shapeName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <span style={{ fontSize: 28, opacity: 0.4 }}>🧊</span>
                                                )}
                                                <div style={{ position: 'absolute', top: 4, left: 4, background: '#6366f1', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</div>
                                            </div>
                                            <div style={{ padding: '6px 8px' }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ci.shapeName}</div>
                                                <div style={{ fontSize: 9, color: '#9ca3af' }}>{ci.bbox.w.toFixed(0)}×{ci.bbox.h.toFixed(0)}×{ci.bbox.d.toFixed(0)}mm · {ci.volume_cm3.toFixed(1)}cm³</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 3D 모델 뷰어 (STEP 파일만 — 자동 표시, 카트 모드가 아닐 때) */}
                            {!isCartMode && fileMode === 'step' && fileUrl && (
                                <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: '16px', height: '260px' }}>
                                    <ModelViewer url={fileUrl} filename={selectedFiles[0]?.name || 'model'} onClose={() => {}} />
                                </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                {[
                                    { label: t.volume, value: `${geometry.volume_cm3.toFixed(1)} cm³` },
                                    { label: t.surfaceArea, value: `${geometry.surface_area_cm2.toFixed(1)} cm²` },
                                    { label: t.size, value: `${geometry.bbox.w}×${geometry.bbox.h}×${geometry.bbox.d} mm` },
                                ].map(({ label, value }) => (
                                    <div key={label} style={{ background: '#f8faff', borderRadius: '10px', padding: '12px', border: '1px solid #e0e7ff' }}>
                                        <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>{label}</div>
                                        <div style={{ fontSize: '15px', fontWeight: 800, color: '#111827', marginTop: '4px' }}>{value}</div>
                                    </div>
                                ))}
                            </div>

                            {aiAnalysis && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{t.aiProcess}:</span>
                                        <span style={{ fontWeight: 700, color: '#111827', fontSize: '13px' }}>
                                            {PROCESSES.find(p => p.id === aiAnalysis.process)?.label || String(aiAnalysis.process || '')}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{t.complexity}:</span>
                                        <div style={{ display: 'flex', gap: '2px' }}>
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                <div key={n} style={{ width: '14px', height: '8px', borderRadius: '3px', background: n <= (aiAnalysis.complexity as number || 5) ? '#0b5cff' : '#e5e7eb' }} />
                                            ))}
                                        </div>
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{aiAnalysis.complexity as number || 5}/10</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 재질/공정/옵션 선택 */}
                        <div style={card}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '16px', color: '#111827' }}>🔩 {t.materialTitle}</h3>
                                {/* 전체 비교 버튼 + 실시간 가격 배지 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    {/* 전체 비교 보기 토글 버튼 */}
                                    <button
                                        onClick={() => setShowCompareTable(v => !v)}
                                        style={{
                                            padding: '5px 12px', borderRadius: '20px', border: '1.5px solid #0b5cff',
                                            background: showCompareTable ? '#0b5cff' : '#eff6ff',
                                            color: showCompareTable ? '#fff' : '#0b5cff',
                                            fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: '4px',
                                        }}
                                    >
                                        📊 {showCompareTable ? '비교 닫기' : '전체 비교 보기'}
                                    </button>
                                    {priceSource && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
                                            <span style={{
                                                background: priceSource === 'live' ? '#dcfce7' : '#fef9c3',
                                                color: priceSource === 'live' ? '#166534' : '#92400e',
                                                padding: '3px 10px', borderRadius: '20px',
                                                display: 'flex', alignItems: 'center', gap: '4px',
                                            }}>
                                                {priceSource === 'live' ? '📡 실시간 시세' : '📋 기준값'}
                                            </span>
                                            {liveUsdKrw && (
                                                <span style={{ color: '#6b7280' }}>USD/KRW {liveUsdKrw.toLocaleString()}원</span>
                                            )}
                                            {priceUpdatedAt && (
                                                <span style={{ color: '#9ca3af' }}>
                                                    {new Date(priceUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── 기능 1: 다재료 비교 테이블 ── */}
                            {showCompareTable && geometry && (() => {
                                const complexityVal = (aiAnalysis?.complexity as number) || 5;
                                // 각 재료에 대해 단가 계산
                                const rows = MATERIALS.map(m => {
                                    const matData = MATERIAL_DATA[m.id];
                                    if (!matData) return null;
                                    const pricePerKg = livePrices?.[m.id] ?? matData.price;
                                    const weight_kg = (geometry.volume_cm3 * matData.density) / 1000;
                                    const material_cost = weight_kg * pricePerKg;
                                    const unitCost = calcUnitCost(m.id, process, quantity, tolerance, finishType, geometry.volume_cm3, geometry.surface_area_cm2, complexityVal, pricePerKg);
                                    const isAI = (aiAnalysis?.materials as string[] | undefined)?.includes(m.id);
                                    return { id: m.id, label: m.label, density: matData.density, pricePerKg, weight_kg, material_cost, unitCost, isAI };
                                }).filter((r): r is NonNullable<typeof r> => r !== null);

                                // 가장 저렴한 재료 찾기
                                const minCost = Math.min(...rows.map(r => r.unitCost));

                                return (
                                    <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '560px' }}>
                                            <thead>
                                                <tr style={{ background: '#f8faff', borderBottom: '2px solid #e0e7ff' }}>
                                                    {['재료명', '밀도\ng/cm³', 'KRW/kg', '예상무게', '재료비', '예상단가', '선택'].map(h => (
                                                        <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#374151', whiteSpace: 'pre-line', fontSize: '11px' }}>
                                                            {h === '재료명' ? <span style={{ textAlign: 'left', display: 'block' }}>{h}</span> : h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map(row => {
                                                    const isCheapest = row.unitCost === minCost;
                                                    const isSelected = material === row.id;
                                                    return (
                                                        <tr key={row.id} style={{
                                                            background: isCheapest ? '#f0fdf4' : isSelected ? '#eff6ff' : '#fff',
                                                            borderBottom: '1px solid #f3f4f6',
                                                            cursor: 'pointer',
                                                            transition: 'background 0.1s',
                                                        }}
                                                            onClick={() => { setMaterial(row.id); setShowCompareTable(false); }}
                                                        >
                                                            <td style={{ padding: '8px 10px', fontWeight: 700, color: isCheapest ? '#065f46' : isSelected ? '#0b5cff' : '#111827' }}>
                                                                <span>{row.label}</span>
                                                                {row.isAI && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#0b5cff' }}>⭐</span>}
                                                                {isCheapest && <span style={{ marginLeft: '4px', fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '1px 5px', borderRadius: '8px', fontWeight: 700 }}>최저가</span>}
                                                            </td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280' }}>{row.density}</td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280' }}>{row.pricePerKg.toLocaleString()}</td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280' }}>{row.weight_kg.toFixed(3)}kg</td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280' }}>{Math.round(row.material_cost).toLocaleString()}원</td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: isCheapest ? '#059669' : '#111827', fontSize: '13px' }}>
                                                                {row.unitCost.toLocaleString()}원
                                                            </td>
                                                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                                                <span style={{
                                                                    display: 'inline-block', width: '20px', height: '20px', borderRadius: '50%',
                                                                    border: `2px solid ${isSelected ? '#0b5cff' : '#d1d5db'}`,
                                                                    background: isSelected ? '#0b5cff' : '#fff',
                                                                }} />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px', textAlign: 'right' }}>
                                            * 현재 선택된 공정({PROCESSES.find(p => p.id === process)?.label}), 수량({quantity}개), 공차({tolerance.toUpperCase()}) 기준 계산
                                        </div>
                                    </div>
                                );
                            })()}

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '24px' }}>
                                {MATERIALS.map(m => {
                                    const isAI = (aiAnalysis?.materials as string[] | undefined)?.includes(m.id);
                                    const isSelected = material === m.id;
                                    const livePrice = livePrices?.[m.id];
                                    return (
                                        <button key={m.id} onClick={() => setMaterial(m.id)}
                                            style={{
                                                padding: '10px 14px', borderRadius: '12px',
                                                border: `2px solid ${isSelected ? '#0b5cff' : '#e5e7eb'}`,
                                                background: isSelected ? '#eff6ff' : '#fff',
                                                color: isSelected ? '#0b5cff' : '#374151',
                                                fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
                                                transition: 'all 0.15s', textAlign: 'left',
                                            }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {m.label}
                                                {isAI && <span style={badgeAI}>⭐ {t.aiRecommended}</span>}
                                            </div>
                                            {livePrice && (
                                                <span style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? '#3b82f6' : '#9ca3af' }}>
                                                    ₩{livePrice.toLocaleString()}/kg
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            <h3 style={{ margin: '0 0 16px', fontWeight: 800, fontSize: '16px', color: '#111827' }}>⚙️ {t.processTitle}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '24px' }}>
                                {PROCESSES.map(p => {
                                    const isAI = aiAnalysis?.process === p.id;
                                    const isSelected = process === p.id;
                                    return (
                                        <button key={p.id} onClick={() => setProcess(p.id)}
                                            style={{
                                                padding: '10px 14px', borderRadius: '12px',
                                                border: `2px solid ${isSelected ? '#0b5cff' : '#e5e7eb'}`,
                                                background: isSelected ? '#eff6ff' : '#fff',
                                                color: isSelected ? '#0b5cff' : '#374151',
                                                fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                transition: 'all 0.15s', textAlign: 'left',
                                            }}>
                                            {p.label}
                                            {isAI && <span style={badgeAI}>⭐ {t.aiRecommended}</span>}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* 표면처리 / 공차 / 수량 */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ fontSize: '13px', color: '#374151', fontWeight: 700, display: 'block', marginBottom: '6px' }}>{t.finishLabel}</label>
                                    <select value={finishType} onChange={e => setFinishType(e.target.value)} style={inputStyle}>
                                        {FINISHES.map(f => (
                                            <option key={f.id} value={f.id}>{f.label[langMapCode[lang] as keyof typeof f.label] || f.label.ko}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: '13px', color: '#374151', fontWeight: 700, display: 'block', marginBottom: '6px' }}>{t.toleranceLabel}</label>
                                    <select value={tolerance} onChange={e => setTolerance(e.target.value)} style={inputStyle}>
                                        {TOLERANCES.map(to => (
                                            <option key={to.id} value={to.id}>{to.label[langMapCode[lang] as keyof typeof to.label] || to.label.ko}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ fontSize: '13px', color: '#374151', fontWeight: 700, display: 'block', marginBottom: '6px' }}>{t.quantityLabel}</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <input type="number" min="1" max="99999" value={quantity}
                                        onChange={e => setQuantity(Math.max(1, Number(e.target.value)))}
                                        style={{ ...inputStyle, width: '120px' }}
                                    />
                                    <span style={{ color: '#6b7280', fontSize: '14px' }}>{t.pcs}</span>
                                    <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 700 }}>
                                        {quantity >= 500 ? '-32%' : quantity >= 100 ? '-25%' : quantity >= 50 ? '-18%' : quantity >= 10 ? '-10%' : ''}
                                    </div>
                                </div>
                            </div>

                            <button onClick={handleEstimate}
                                style={{
                                    width: '100%', padding: '16px', background: '#0b5cff',
                                    color: '#fff', border: 'none', borderRadius: '16px',
                                    fontWeight: 800, fontSize: '16px', cursor: 'pointer',
                                    boxShadow: '0 4px 16px rgba(11,92,255,0.3)', transition: 'all 0.2s',
                                }}>
                                💰 {t.calcBtn}
                            </button>
                        </div>
                    </>
                )}

                {/* ── Step 4: 견적 결과 ── */}
                {step === 4 && estimates && (
                    <>
                        {/* 예상값 안내 배너 */}
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#92400e', lineHeight: 1.5 }}>
                            <span style={{ flexShrink: 0 }}>⚠️</span>
                            <span>
                                {lang === 'kr' ? '아래 견적은 AI가 추정한 예상값으로, 실제 제조 비용과 차이가 있을 수 있습니다. 정확한 견적은 파트너 공장의 공식 견적서를 통해 확인하세요.'
                                    : lang === 'ja' ? '以下の見積もりはAIによる推定値です。実際の製造費用とは異なる場合があります。正確な見積もりはパートナー工場の公式見積もりをご確認ください。'
                                    : lang === 'cn' ? '以下报价为AI估算值，可能与实际制造成本有所不同。请通过合作工厂的正式报价确认准确金额。'
                                    : lang === 'es' ? 'La siguiente cotización es una estimación de IA y puede diferir del costo real de fabricación. Consulte la cotización oficial del fabricante para valores precisos.'
                                    : lang === 'ar' ? 'الأسعار التالية هي تقديرات بالذكاء الاصطناعي وقد تختلف عن تكاليف التصنيع الفعلية.'
                                    : 'The following quote is an AI-estimated value and may differ from actual manufacturing costs. Please confirm with an official factory quote for precise figures.'}
                            </span>
                        </div>

                        {/* 메인 견적 */}
                        <div style={{ ...card, border: '2px solid #0b5cff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
                                <h2 style={{ margin: 0, fontWeight: 900, fontSize: '20px', color: '#111827' }}>💰 {t.resultTitle}</h2>
                                {priceSource && (
                                    <span style={{
                                        fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                                        background: priceSource === 'live' ? '#dcfce7' : '#fef9c3',
                                        color: priceSource === 'live' ? '#166534' : '#92400e',
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                    }}>
                                        {priceSource === 'live' ? '📡 실시간 시세 반영' : '📋 기준 시세 반영'}
                                        {liveUsdKrw && ` · $1 = ₩${liveUsdKrw.toLocaleString()}`}
                                    </span>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                <div style={{ background: '#eff6ff', borderRadius: '16px', padding: '20px', border: '1px solid #bfdbfe' }}>
                                    <div style={{ fontSize: '13px', color: '#3b82f6', fontWeight: 700, marginBottom: '6px' }}>{t.unitPrice} (1{t.pcs})</div>
                                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#0b5cff' }}>{fmtKRW(estimates.unit_cost)}</div>
                                </div>
                                <div style={{ background: '#f0fdf4', borderRadius: '16px', padding: '20px', border: '1px solid #bbf7d0' }}>
                                    <div style={{ fontSize: '13px', color: '#10b981', fontWeight: 700, marginBottom: '6px' }}>
                                        {t.totalPrice} ({quantity}{t.pcs})
                                    </div>
                                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#059669' }}>{fmtKRW(estimates.total_cost)}</div>
                                </div>
                            </div>

                            {/* 수량 변경 (즉시 재계산) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '14px', background: '#f9fafb', borderRadius: '12px' }}>
                                <span style={{ fontSize: '13px', color: '#374151', fontWeight: 700 }}>{t.quantityLabel}</span>
                                <input type="number" min="1" max="99999" value={quantity}
                                    onChange={e => handleQuantityChange(Math.max(1, Number(e.target.value)))}
                                    style={{ ...inputStyle, width: '100px' }}
                                />
                                <span style={{ fontSize: '13px', color: '#6b7280' }}>{t.pcs}</span>
                                {quantity >= 10 && (
                                    <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 700 }}>
                                        {quantity >= 500 ? '-32%' : quantity >= 100 ? '-25%' : quantity >= 50 ? '-18%' : '-10%'} 할인
                                    </span>
                                )}
                            </div>

                            {/* 무게 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#6b7280', padding: '8px 0' }}>
                                <span>⚖️</span>
                                <span style={{ fontWeight: 600 }}>예상 무게</span>
                                <span style={{ fontWeight: 700, color: '#374151' }}>{estimates.weight_kg.toFixed(3)} kg</span>
                            </div>
                        </div>

                        {/* ── 게이트 카드 (비로그인 시) ── */}
                        {!isLoggedIn && (
                            <div style={{
                                ...card,
                                border: '2px solid #0b5cff',
                                background: 'linear-gradient(135deg, #eff6ff 0%, #f5f0ff 100%)',
                                textAlign: 'center',
                            }}>
                                <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔒</div>
                                <h3 style={{ margin: '0 0 8px', fontWeight: 900, fontSize: '18px', color: '#111827' }}>
                                    {t.gateTitle}
                                </h3>
                                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '14px', lineHeight: 1.6 }}>
                                    {t.gateDesc}
                                </p>
                                {/* 포함 항목 */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px', textAlign: 'left', background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid #e0e7ff' }}>
                                    {[t.gateItem1, t.gateItem2, t.gateItem3, t.gateItem4].map((item, i) => (
                                        <div key={i} style={{ fontSize: '13px', color: '#374151', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ color: '#10b981', fontSize: '12px' }}>✓</span> {item}
                                        </div>
                                    ))}
                                </div>
                                {/* CTA 버튼 */}
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                    <a
                                        href={`${NEXYSYS_URL}/register`}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                                            padding: '14px 28px', borderRadius: '14px',
                                            background: '#0b5cff', color: '#fff',
                                            fontWeight: 800, fontSize: '15px', textDecoration: 'none',
                                            boxShadow: '0 4px 16px rgba(11,92,255,0.3)',
                                        }}
                                    >
                                        🚀 {t.gateSignup}
                                    </a>
                                    <a
                                        href="/login"
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                                            padding: '14px 22px', borderRadius: '14px',
                                            background: '#fff', color: '#374151',
                                            border: '2px solid #e5e7eb',
                                            fontWeight: 700, fontSize: '14px', textDecoration: 'none',
                                        }}
                                    >
                                        {t.gateLogin} →
                                    </a>
                                </div>
                            </div>
                        )}

                        {/* ── 게이트 섹션 ── */}
                        <div style={{ position: 'relative' }}>
                            {/* 게이트된 콘텐츠 (로그인 시 정상, 비로그인 시 블러) */}
                            <div style={{
                                filter: isLoggedIn ? 'none' : 'blur(5px)',
                                pointerEvents: isLoggedIn ? 'auto' : 'none',
                                userSelect: isLoggedIn ? 'auto' : 'none',
                            }}>

                            {/* 원가 구성 */}
                            <div style={card}>
                            <h3 style={{ margin: '0 0 14px', fontWeight: 800, fontSize: '15px', color: '#374151' }}>📊 {t.costBreakdown}</h3>
                            {[
                                { label: t.materialCost, data: estimates.breakdown.material, color: '#0b5cff' },
                                { label: t.machiningCost, data: estimates.breakdown.machining, color: '#7c3aed' },
                                { label: t.setupCost, data: estimates.breakdown.setup, color: '#f59e0b' },
                            ].map(({ label, data, color }) => (
                                <div key={label} style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>{label}</span>
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <span style={{ fontSize: '13px', color: '#6b7280' }}>{data.pct}%</span>
                                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{fmtKRW(data.amount)}</span>
                                        </div>
                                    </div>
                                    <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${data.pct}%`, background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
                                    </div>
                                </div>
                            ))}
                            </div>

                        {/* AI 분석 리포트 */}
                        {aiReport && (
                            <div style={card}>
                                <h3 style={{ margin: '0 0 16px', fontWeight: 800, fontSize: '16px', color: '#111827' }}>🤖 {t.aiReport}</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
                                    <div style={{ background: '#f8faff', borderRadius: '10px', padding: '12px', border: '1px solid #e0e7ff' }}>
                                        <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>{t.difficulty}</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#111827', marginTop: '4px' }}>{String(aiReport.difficulty || '-')}</div>
                                    </div>
                                    <div style={{ background: '#f8faff', borderRadius: '10px', padding: '12px', border: '1px solid #e0e7ff' }}>
                                        <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>{t.dfmScore}</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0b5cff', marginTop: '4px' }}>{String(aiReport.dfm_score || '-')}/100</div>
                                    </div>
                                    <div style={{ background: '#f8faff', borderRadius: '10px', padding: '12px', border: '1px solid #e0e7ff' }}>
                                        <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>{t.leadTime}</div>
                                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#111827', marginTop: '4px' }}>{String(aiReport.lead_time_days || '-')}{t.days}</div>
                                    </div>
                                </div>

                                {!!aiReport.summary && (
                                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px', marginBottom: '16px', fontSize: '14px', color: '#065f46', fontWeight: 600 }}>
                                        💡 {String(aiReport.summary)}
                                    </div>
                                )}

                                {/* 품질 리스크 */}
                                {Array.isArray(aiReport.quality_risks) && (aiReport.quality_risks as string[]).length > 0 && (
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#374151', marginBottom: '8px' }}>⚠️ {t.qualityRisks}</div>
                                        {(aiReport.quality_risks as string[]).map((risk, i) => (
                                            <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px', color: '#6b7280' }}>
                                                <span style={{ color: '#f59e0b' }}>•</span> {risk}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 비용 절감 대안 */}
                        {alternatives.length > 0 && (
                            <div style={card}>
                                <h3 style={{ margin: '0 0 16px', fontWeight: 800, fontSize: '16px', color: '#111827' }}>⚡ {t.alternatives}</h3>
                                {alternatives.map((alt, i) => (
                                    <div key={i} style={{
                                        padding: '14px', borderRadius: '12px', border: '1px solid #e5e7eb',
                                        background: '#f9fafb', marginBottom: '10px',
                                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                                    }}>
                                        <div style={{
                                            background: '#d1fae5', color: '#059669', borderRadius: '20px',
                                            padding: '4px 12px', fontSize: '13px', fontWeight: 800, whiteSpace: 'nowrap',
                                        }}>
                                            -{alt.saving_pct}% {t.saving}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 700, color: '#111827', fontSize: '13px' }}>
                                                {MATERIALS.find(m => m.id === alt.material)?.label || alt.material} + {PROCESSES.find(p => p.id === alt.process)?.label || alt.process}
                                            </div>
                                            <div style={{ color: '#6b7280', fontSize: '13px', marginTop: '4px' }}>{alt.reason}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ── 기능 3: LME 원자재 시세 추이 차트 ── */}
                        {chartData && chartData.aluminum.length > 0 && (() => {
                            const aluData = chartData.aluminum;
                            const copData = chartData.copper;
                            const allVals = [...aluData.map(d => d.value), ...copData.map(d => d.value)];
                            const minVal = Math.min(...allVals) * 0.95;
                            const maxVal = Math.max(...allVals) * 1.05;
                            const svgW = 700;
                            const svgH = 200;
                            const padL = 60; const padR = 16; const padT = 16; const padB = 36;
                            const plotW = svgW - padL - padR;
                            const plotH = svgH - padT - padB;
                            const n = Math.max(aluData.length, copData.length);

                            // X좌표: 등간격
                            const xPos = (i: number, len: number) => padL + (i / Math.max(len - 1, 1)) * plotW;
                            // Y좌표: 값 → 픽셀
                            const yPos = (v: number) => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

                            // 알루미늄/황동 선택 시 강조
                            const aluHL = material === 'aluminum_6061';
                            const copHL = material === 'brass';

                            // SVG 폴리라인 포인트 생성
                            const polyPoints = (data: typeof aluData) =>
                                data.map((d, i) => `${xPos(i, data.length).toFixed(1)},${yPos(d.value).toFixed(1)}`).join(' ');

                            // Y축 눈금 레이블
                            const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map(f => minVal + f * (maxVal - minVal));

                            // X축 레이블 (3개월마다)
                            const xLabels = aluData.filter((_, i) => i % Math.max(1, Math.floor(aluData.length / 6)) === 0 || i === aluData.length - 1);

                            return (
                                <div style={card}>
                                    <h3 style={{ margin: '0 0 12px', fontWeight: 800, fontSize: '16px', color: '#111827' }}>📈 LME 원자재 시세 추이 (12개월)</h3>
                                    <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '20px', height: '3px', background: aluHL ? '#0b5cff' : '#93c5fd', borderRadius: '2px' }} />
                                            <span style={{ fontWeight: aluHL ? 700 : 400, color: aluHL ? '#0b5cff' : '#6b7280' }}>알루미늄 (USD/ton)</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '20px', height: '3px', background: copHL ? '#f97316' : '#fdba74', borderRadius: '2px' }} />
                                            <span style={{ fontWeight: copHL ? 700 : 400, color: copHL ? '#f97316' : '#6b7280' }}>구리 (USD/ton)</span>
                                        </div>
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                        <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block', minWidth: '320px' }}>
                                            {/* Y축 눈금선 */}
                                            {yTicks.map((v, i) => (
                                                <g key={i}>
                                                    <line x1={padL} y1={yPos(v).toFixed(1)} x2={svgW - padR} y2={yPos(v).toFixed(1)}
                                                        stroke="#f3f4f6" strokeWidth="1" />
                                                    <text x={padL - 6} y={yPos(v) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
                                                        {Math.round(v).toLocaleString()}
                                                    </text>
                                                </g>
                                            ))}
                                            {/* X축 레이블 */}
                                            {xLabels.map((d) => {
                                                const i = aluData.indexOf(d);
                                                return (
                                                    <text key={d.date} x={xPos(i, aluData.length)} y={svgH - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
                                                        {d.date.slice(2)}
                                                    </text>
                                                );
                                            })}
                                            {/* 알루미늄 라인 */}
                                            {aluData.length > 1 && (
                                                <polyline points={polyPoints(aluData)}
                                                    fill="none"
                                                    stroke={aluHL ? '#0b5cff' : '#93c5fd'}
                                                    strokeWidth={aluHL ? 2.5 : 1.5}
                                                    strokeLinejoin="round" strokeLinecap="round"
                                                />
                                            )}
                                            {/* 구리 라인 */}
                                            {copData.length > 1 && (() => {
                                                const copAllVals = copData.map(d => d.value);
                                                const copMin = Math.min(...copAllVals) * 0.95;
                                                const copMax = Math.max(...copAllVals) * 1.05;
                                                const yCop = (v: number) => padT + plotH - ((v - copMin) / Math.max(copMax - copMin, 1)) * plotH;
                                                const copPoints = copData.map((d, i) => `${xPos(i, copData.length).toFixed(1)},${yCop(d.value).toFixed(1)}`).join(' ');
                                                return (
                                                    <polyline points={copPoints}
                                                        fill="none"
                                                        stroke={copHL ? '#f97316' : '#fdba74'}
                                                        strokeWidth={copHL ? 2.5 : 1.5}
                                                        strokeLinejoin="round" strokeLinecap="round"
                                                    />
                                                );
                                            })()}
                                            {/* 알루미늄 최신 점 */}
                                            {aluData.length > 0 && (() => {
                                                const last = aluData[aluData.length - 1];
                                                return <circle cx={xPos(aluData.length - 1, aluData.length)} cy={yPos(last.value)} r="4" fill={aluHL ? '#0b5cff' : '#93c5fd'} />;
                                            })()}
                                        </svg>
                                    </div>
                                    {chartData.lastUpdated && (
                                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px', textAlign: 'right' }}>
                                            업데이트: {new Date(chartData.lastUpdated).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* ── 기능 4: MOQ 손익분기 계산기 ── */}
                        {geometry && (() => {
                            const complexityVal = (aiAnalysis?.complexity as number) || 5;
                            const procData = PROCESS_DATA[process];
                            const matData = MATERIAL_DATA[material];
                            if (!procData || !matData) return null;

                            const pricePerKg = livePrices?.[material] ?? matData.price;

                            // 수량 구간
                            const qtySteps = [1, 5, 10, 30, 50, 100, 200, 500, 1000];
                            const unitCosts = qtySteps.map(q =>
                                calcUnitCost(material, process, q, tolerance, finishType, geometry.volume_cm3, geometry.surface_area_cm2, complexityVal, pricePerKg)
                            );

                            // 셋업비 (수량 분산)
                            const setupCosts = qtySteps.map(q => Math.round(procData.setup / q));

                            const currentUnitCost = calcUnitCost(material, process, quantity, tolerance, finishType, geometry.volume_cm3, geometry.surface_area_cm2, complexityVal, pricePerKg);
                            const currentTotalCost = currentUnitCost * quantity;
                            const currentSetup = Math.round(procData.setup / quantity);

                            // SVG 설정
                            const svgW2 = 700;
                            const svgH2 = 200;
                            const padL2 = 70; const padR2 = 16; const padT2 = 16; const padB2 = 36;
                            const plotW2 = svgW2 - padL2 - padR2;
                            const plotH2 = svgH2 - padT2 - padB2;

                            const maxCost = Math.max(...unitCosts) * 1.1;
                            const minCost = 0;

                            // 로그 스케일 X 위치
                            const logMin = Math.log10(1);
                            const logMax = Math.log10(1000);
                            const xLogPos = (q: number) => padL2 + ((Math.log10(q) - logMin) / (logMax - logMin)) * plotW2;
                            const yUnitPos = (v: number) => padT2 + plotH2 - ((v - minCost) / Math.max(maxCost - minCost, 1)) * plotH2;

                            const unitPolyline = qtySteps.map((q, i) => `${xLogPos(q).toFixed(1)},${yUnitPos(unitCosts[i]).toFixed(1)}`).join(' ');
                            const setupPolyline = qtySteps.map((q, i) => `${xLogPos(q).toFixed(1)},${yUnitPos(setupCosts[i]).toFixed(1)}`).join(' ');

                            // 현재 수량 X 위치
                            const curQty = Math.min(Math.max(quantity, 1), 1000);
                            const curX = xLogPos(curQty);

                            // Y축 눈금
                            const yTicks2 = [0, 0.25, 0.5, 0.75, 1.0].map(f => minCost + f * (maxCost - minCost));
                            const xLabelQtys = [1, 10, 50, 100, 500, 1000];

                            return (
                                <div style={card}>
                                    <h3 style={{ margin: '0 0 12px', fontWeight: 800, fontSize: '16px', color: '#111827' }}>📊 수량별 단가 & 손익분기점</h3>
                                    <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '12px', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '20px', height: '3px', background: '#0b5cff', borderRadius: '2px' }} />
                                            <span style={{ color: '#0b5cff', fontWeight: 700 }}>단가 곡선</span>
                                        </div>
                                        {procData.setup > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <div style={{ width: '20px', height: '3px', background: '#f59e0b', borderRadius: '2px', borderTop: '2px dashed #f59e0b' }} />
                                                <span style={{ color: '#f59e0b', fontWeight: 700 }}>셋업비 분산</span>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '2px', height: '16px', background: '#10b981', borderLeft: '2px dashed #10b981' }} />
                                            <span style={{ color: '#10b981', fontWeight: 700 }}>현재 수량</span>
                                        </div>
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                        <svg width="100%" viewBox={`0 0 ${svgW2} ${svgH2}`} style={{ display: 'block', minWidth: '320px' }}>
                                            {/* Y축 눈금선 */}
                                            {yTicks2.map((v, i) => (
                                                <g key={i}>
                                                    <line x1={padL2} y1={yUnitPos(v).toFixed(1)} x2={svgW2 - padR2} y2={yUnitPos(v).toFixed(1)}
                                                        stroke="#f3f4f6" strokeWidth="1" />
                                                    <text x={padL2 - 6} y={yUnitPos(v) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
                                                        {v >= 10000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString()}
                                                    </text>
                                                </g>
                                            ))}
                                            {/* X축 레이블 */}
                                            {xLabelQtys.map(q => (
                                                <text key={q} x={xLogPos(q)} y={svgH2 - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
                                                    {q}
                                                </text>
                                            ))}
                                            {/* 셋업비 분산선 (공정 셋업비가 있을 때만) */}
                                            {procData.setup > 0 && (
                                                <polyline points={setupPolyline}
                                                    fill="none" stroke="#f59e0b" strokeWidth="1.5"
                                                    strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round"
                                                />
                                            )}
                                            {/* 단가 곡선 */}
                                            <polyline points={unitPolyline}
                                                fill="none" stroke="#0b5cff" strokeWidth="2.5"
                                                strokeLinejoin="round" strokeLinecap="round"
                                            />
                                            {/* 현재 수량 세로 점선 */}
                                            <line x1={curX.toFixed(1)} y1={padT2} x2={curX.toFixed(1)} y2={svgH2 - padB2}
                                                stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 3"
                                            />
                                            {/* 현재 수량 점 */}
                                            <circle cx={curX.toFixed(1)} cy={yUnitPos(currentUnitCost).toFixed(1)} r="5" fill="#10b981" />
                                        </svg>
                                    </div>
                                    {/* 현재 수량 요약 */}
                                    <div style={{ marginTop: '10px', padding: '12px 16px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', fontSize: '13px', color: '#065f46', fontWeight: 600 }}>
                                        현재 수량 <strong>{quantity}개</strong>에서 단가 <strong>{currentUnitCost.toLocaleString()}원</strong>
                                        {procData.setup > 0 && ` · 셋업 ${currentSetup.toLocaleString()}원 분산`}
                                        {` · 총 ${currentTotalCost.toLocaleString()}원`}
                                    </div>
                                </div>
                            );
                        })()}

                            </div>{/* end blurred content */}

                            {/* 하단 페이드 (비로그인 시) */}
                            {!isLoggedIn && (
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, right: 0,
                                    height: '120px',
                                    background: 'linear-gradient(to bottom, transparent, #f8faff)',
                                    pointerEvents: 'none',
                                }} />
                            )}
                        </div>{/* end position:relative gate section */}

                        {/* 액션 버튼 */}
                        {isLoggedIn ? (
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={handleInquiry}
                                style={{
                                    flex: 2, padding: '16px', background: '#0b5cff',
                                    color: '#fff', border: 'none', borderRadius: '16px',
                                    fontWeight: 800, fontSize: '15px', cursor: 'pointer',
                                    boxShadow: '0 4px 16px rgba(11,92,255,0.3)',
                                }}>
                                📋 {t.inquiryBtn}
                            </button>
                            <button onClick={handlePrintQuote}
                                style={{
                                    flex: 1, padding: '16px', background: '#fff',
                                    color: '#7c3aed', border: '2px solid #7c3aed', borderRadius: '16px',
                                    fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                                }}>
                                🖨️ PDF
                            </button>
                            <button onClick={() => {
                                const data = { geometry, estimates, aiReport, alternatives, material, process, quantity, timestamp: new Date().toISOString() };
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `nexyfab-quote-${Date.now()}.json`;
                                a.click(); URL.revokeObjectURL(url);
                            }}
                                style={{
                                    flex: 1, padding: '16px', background: '#fff',
                                    color: '#374151', border: '2px solid #e5e7eb', borderRadius: '16px',
                                    fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                                }}>
                                💾 {t.saveBtn}
                            </button>
                        </div>
                        ) : (
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
                            <a
                                href={`${NEXYSYS_URL}/register`}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    padding: '14px 28px', borderRadius: '14px',
                                    background: '#0b5cff', color: '#fff',
                                    fontWeight: 800, fontSize: '15px', textDecoration: 'none',
                                    boxShadow: '0 4px 16px rgba(11,92,255,0.3)',
                                }}
                            >
                                🚀 {t.gateSignup}
                            </a>
                            <a
                                href="/login"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    padding: '14px 22px', borderRadius: '14px',
                                    background: '#fff', color: '#374151',
                                    border: '2px solid #e5e7eb',
                                    fontWeight: 700, fontSize: '14px', textDecoration: 'none',
                                }}
                            >
                                {t.gateLogin} →
                            </a>
                        </div>
                        )}

                        {/* 다시 시작 */}
                        <button onClick={() => { setStep(1); setSelectedFiles([]); setGeometry(null); setEstimates(null); setAiReport(null); setAlternatives([]); setError(''); }}
                            style={{
                                width: '100%', marginTop: '12px', padding: '12px',
                                background: 'transparent', color: '#9ca3af',
                                border: '1px solid #e5e7eb', borderRadius: '12px',
                                fontSize: '14px', cursor: 'pointer',
                            }}>
                            ← 처음으로
                        </button>
                    </>
                )}

                {error && step !== 1 && (
                    <div style={{ padding: '14px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#dc2626', fontSize: '14px', marginTop: '12px' }}>
                        ⚠️ {error}
                    </div>
                )}
            </div>
        </main>
    );
}

export default function QuickQuotePage() {
    return (
        <Suspense fallback={<div />}>
            <QuickQuotePageInner />
        </Suspense>
    );
}
