'use client';

// G1 — Integrated user guide page.
//
// 7 categorized cards covering the end-to-end NexyFab journey:
// design → quote → order → review. Each card expands inline (no
// nested routes — keeps the URL flat for sharing/bookmarking).
//
// Search & inline tooltips are deliberate non-goals: real usage data
// should drive what to elaborate on. This page is the "is the door
// open?" first response, not a full documentation system.
//
// ⚠ 260802: this page used to reduce every route lang down to a
// `=== 'ko' ? 'ko' : 'en'` binary (both for SECTIONS content and for
// the CTA href prefix), so ja/zh/es/ar visitors silently got English
// text AND got their CTA links routed into /en/... instead of their
// own locale. Fixed to go through the site's full 6-lang set via
// toIsoLang/toRouteLang, same pattern as TrustClient.tsx.

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { toIsoLang, toRouteLang, type IsoLang } from '@/lib/i18n/normalize';

type LocalizedText = Record<IsoLang, string>;

interface Section {
  id: string;
  emoji: string;
  title: LocalizedText;
  blurb: LocalizedText;
  steps: LocalizedText[];
  cta?: { label: LocalizedText; href: string };
}

export const SECTIONS: Section[] = [
  {
    id: 'first-design',
    emoji: '✏️',
    title: {
      ko: '첫 설계 만들기', en: 'Create your first design', ja: '最初の設計を作成',
      zh: '创建您的第一个设计', es: 'Cree su primer diseño', ar: 'أنشئ تصميمك الأول',
    },
    blurb: {
      ko: '브라우저에서 바로 3D 모델을 만듭니다. 설치 불필요.',
      en: '3D model right in the browser — no install.',
      ja: 'ブラウザ上でそのまま3Dモデルを作成 — インストール不要。',
      zh: '直接在浏览器中生成3D模型 — 无需安装。',
      es: 'Modelo 3D directamente en el navegador — sin instalación.',
      ar: 'نموذج ثلاثي الأبعاد مباشرة في المتصفح — دون تثبيت.',
    },
    steps: [
      {
        ko: '홈(허브) 또는 기계 분야의 "전문가형 CAD" 카드 클릭 → shape generator 열림',
        en: 'Open it from the Hub or the "Expert CAD" card on the Mechanical page.',
        ja: 'ホーム(ハブ)または機械分野の「エキスパートCAD」カードをクリック → shape generatorが開きます',
        zh: '点击首页(枢纽)或机械分类中的"专家级CAD"卡片 → 打开 shape generator',
        es: 'Ábralo desde el Hub o la tarjeta "CAD experto" en la página de Mecánica → se abre el shape generator',
        ar: 'افتحه من الصفحة الرئيسية أو من بطاقة "CAD الاحترافي" في صفحة الميكانيكا ← يفتح shape generator',
      },
      {
        ko: '왼쪽 패널에서 시작 도형 (큐브/원기둥/구 등) 선택',
        en: 'Pick a starter shape (cube/cylinder/sphere) from the left panel.',
        ja: '左パネルで出発形状(キューブ/円柱/球など)を選択',
        zh: '在左侧面板中选择起始形状(立方体/圆柱/球体等)',
        es: 'Elija una forma inicial (cubo/cilindro/esfera) en el panel izquierdo',
        ar: 'اختر شكلاً ابتدائياً (مكعب/أسطوانة/كرة) من اللوحة اليسرى',
      },
      {
        ko: '파라미터 슬라이더로 치수 조절. 실시간으로 3D 뷰 갱신',
        en: 'Drag parameter sliders — the 3D view updates live.',
        ja: 'パラメータスライダーで寸法を調整。3Dビューがリアルタイムに更新されます',
        zh: '拖动参数滑块调整尺寸，3D视图实时更新',
        es: 'Arrastre los controles de parámetros — la vista 3D se actualiza en tiempo real',
        ar: 'اسحب أشرطة تمرير المعاملات — تتحدث المعاينة ثلاثية الأبعاد فوراً',
      },
      {
        ko: '오른쪽 위 메뉴 → "STL 내보내기" 또는 "STEP 내보내기"로 다운로드',
        en: 'Top-right → "Export STL" or "Export STEP" to download.',
        ja: '右上メニュー →「STLエクスポート」または「STEPエクスポート」でダウンロード',
        zh: '右上角菜单 → 选择"导出STL"或"导出STEP"进行下载',
        es: 'Arriba a la derecha → "Exportar STL" o "Exportar STEP" para descargar',
        ar: 'من القائمة أعلى اليمين ← "تصدير STL" أو "تصدير STEP" للتنزيل',
      },
    ],
    cta: {
      label: {
        ko: '3D 모델러 열기', en: 'Open 3D Modeler', ja: '3Dモデラーを開く',
        zh: '打开3D建模器', es: 'Abrir el modelador 3D', ar: 'افتح المصمم ثلاثي الأبعاد',
      },
      href: 'shape-generator',
    },
  },
  {
    id: 'ai-agent',
    emoji: '🤖',
    title: {
      ko: 'AI 에이전트 사용하기', en: 'Using the AI agent', ja: 'AIエージェントを使う',
      zh: '使用AI代理', es: 'Uso del agente de IA', ar: 'استخدام وكيل الذكاء الاصطناعي',
    },
    blurb: {
      ko: '"M8 50mm 볼트 4개 들어가는 마운트" 같은 자연어로 직접 설계.',
      en: 'Design via natural language: "mount with 4 M8 50mm bolt holes".',
      ja: '「M8 50mmボルト穴4つのマウント」のような自然言語で直接設計。',
      zh: '用自然语言直接设计，例如"带4个M8 50mm螺栓孔的支架"。',
      es: 'Diseñe con lenguaje natural: "soporte con 4 orificios para pernos M8 de 50 mm".',
      ar: 'صمّم بلغة طبيعية، مثل "حامل به 4 ثقوب براغي M8 بطول 50 مم".',
    },
    steps: [
      {
        ko: '3D 모델러 페이지에서 우상단 "AI Agent" 토글 활성화 (Pro 플랜)',
        en: '3D Modeler page → top-right "AI Agent" toggle (Pro plan).',
        ja: '3Dモデラーページ右上の「AI Agent」トグルを有効化(Proプラン)',
        zh: '在3D建模器页面右上角启用"AI Agent"开关(Pro套餐)',
        es: 'Página del modelador 3D → interruptor "AI Agent" arriba a la derecha (plan Pro)',
        ar: 'في صفحة المصمم ثلاثي الأبعاد ← فعّل مفتاح "AI Agent" أعلى اليمين (خطة Pro)',
      },
      {
        ko: '플로팅 패널 등장. "🎨 템플릿" 버튼으로 12+ 시작 템플릿 둘러보기',
        en: 'Floating panel appears. Browse 12+ starter templates via "🎨 Templates".',
        ja: 'フローティングパネルが表示されます。「🎨 テンプレート」ボタンで12種類以上の初期テンプレートを閲覧',
        zh: '浮动面板出现，点击"🎨 模板"浏览12+种起始模板',
        es: 'Aparece un panel flotante. Explore más de 12 plantillas iniciales con "🎨 Plantillas"',
        ar: 'تظهر لوحة عائمة. تصفح أكثر من 12 قالباً ابتدائياً عبر "🎨 القوالب"',
      },
      {
        ko: '또는 "💡 무엇을 시킬 수 있나요?" 클릭 → 카테고리별 예시 프롬프트',
        en: 'Or click "💡 What can I ask?" for category-grouped example prompts.',
        ja: 'または「💡 何を依頼できますか?」をクリック → カテゴリ別のプロンプト例',
        zh: '或点击"💡 我能让它做什么?"查看按类别分组的示例提示词',
        es: 'O haga clic en "💡 ¿Qué puedo pedir?" para ver ejemplos agrupados por categoría',
        ar: 'أو انقر على "💡 ماذا يمكنني أن أطلب؟" لعرض أمثلة مصنّفة حسب الفئة',
      },
      {
        ko: '입력창에 자연어로 요청 → 에이전트가 SCAD 코드 작성 + 자가 검증',
        en: 'Type your request — agent writes SCAD + self-verifies.',
        ja: '入力欄に自然言語でリクエスト → エージェントがSCADコードを作成し自己検証',
        zh: '在输入框中用自然语言提出需求 → 代理编写SCAD代码并自我验证',
        es: 'Escriba su solicitud en lenguaje natural — el agente escribe código SCAD y se autoverifica',
        ar: 'اكتب طلبك بلغة طبيعية ← يكتب الوكيل كود SCAD ويتحقق منه ذاتياً',
      },
      {
        ko: '결과는 "↗ canvas" 버튼으로 메인 뷰포트에 띄우거나 STEP/도면 export',
        en: 'Use "↗ canvas" to display in the main viewport, or export STEP/drawing.',
        ja: '結果は「↗ canvas」ボタンでメインビューポートに表示、またはSTEP/図面をエクスポート',
        zh: '通过"↗ canvas"按钮将结果显示在主视口，或导出STEP/图纸',
        es: 'Use "↗ canvas" para mostrar el resultado en la vista principal, o exporte STEP/plano',
        ar: 'استخدم زر "↗ canvas" لعرض النتيجة في العرض الرئيسي، أو صدّر STEP/مخطط',
      },
      {
        ko: '체크포인트 자동 저장 → 언제든 이전 시점으로 되돌리기 가능',
        en: 'Checkpoints save automatically — revert any time.',
        ja: 'チェックポイントは自動保存 — いつでも以前の状態に戻せます',
        zh: '检查点自动保存 — 随时可以回退到之前的状态',
        es: 'Los puntos de control se guardan automáticamente — puede revertir en cualquier momento',
        ar: 'تُحفظ نقاط التحقق تلقائياً ← يمكنك التراجع في أي وقت',
      },
    ],
  },
  {
    id: 'send-rfq',
    emoji: '📤',
    title: {
      ko: 'RFQ (견적 요청) 보내기', en: 'Send an RFQ (quote request)', ja: 'RFQ(見積依頼)を送る',
      zh: '发送RFQ(询价单)', es: 'Enviar una RFQ (solicitud de cotización)', ar: 'إرسال طلب عرض سعر (RFQ)',
    },
    blurb: {
      ko: 'STEP 파일 또는 모델러 결과를 제조사에 보냅니다.',
      en: 'Send your STEP file or modeler output to manufacturers.',
      ja: 'STEPファイルまたはモデラーの出力をメーカーに送信します。',
      zh: '将STEP文件或建模器结果发送给制造商。',
      es: 'Envíe su archivo STEP o el resultado del modelador a los fabricantes.',
      ar: 'أرسل ملف STEP أو نتيجة المصمم إلى المصنّعين.',
    },
    steps: [
      {
        ko: '"빠른 견적" 페이지에서 STEP/STL 업로드 → AI가 즉시 1차 추정 제시 (B4)',
        en: '"Quick Quote" page → upload STEP/STL → AI gives an instant first estimate (B4).',
        ja: '「クイック見積」ページでSTEP/STLをアップロード → AIが即座に初期見積を提示(B4)',
        zh: '在"快速报价"页面上传STEP/STL → AI立即给出初步估算(B4)',
        es: 'Página "Cotización rápida" → suba STEP/STL → la IA da una estimación inicial al instante (B4)',
        ar: 'صفحة "عرض سعر سريع" ← ارفع STEP/STL ← يقدّم الذكاء الاصطناعي تقديراً أولياً فورياً (B4)',
      },
      {
        ko: '재질/공정/수량 직접 조정 또는 AI 추천 그대로 사용',
        en: 'Tweak material/process/quantity or use the AI pick as-is.',
        ja: '材質/工程/数量を直接調整するか、AIの提案をそのまま使用',
        zh: '直接调整材料/工艺/数量，或直接采用AI推荐',
        es: 'Ajuste material/proceso/cantidad o use la recomendación de la IA tal cual',
        ar: 'عدّل المادة/العملية/الكمية يدوياً أو استخدم توصية الذكاء الاصطناعي كما هي',
      },
      {
        ko: '"견적 요청" 클릭 → RFQ 자동 작성 → 매칭 제조사들에게 알림 발송',
        en: 'Click "Request Quote" — RFQ auto-drafted, matched factories notified.',
        ja: '「見積依頼」をクリック → RFQが自動作成 → マッチしたメーカーに通知が送信されます',
        zh: '点击"请求报价" → 自动生成RFQ → 通知匹配的制造商',
        es: 'Haga clic en "Solicitar cotización" — se redacta la RFQ automáticamente y se notifica a los fabricantes coincidentes',
        ar: 'انقر "طلب عرض سعر" ← تُصاغ RFQ تلقائياً ← يُخطَر المصنّعون المطابقون',
      },
      {
        ko: '특정 제조사 한 곳에만 보내려면 /factories에서 회사 선택 → 직접 발송 (M3)',
        en: 'To send to one specific factory: pick from /factories → direct quote (M3).',
        ja: '特定のメーカー1社だけに送るには /factories で会社を選択 → 直接送信(M3)',
        zh: '若只想发送给某一家制造商，可在 /factories 中选择该公司 → 直接发送(M3)',
        es: 'Para enviarla a un solo fabricante: elíjalo en /factories → cotización directa (M3)',
        ar: 'لإرسالها إلى مصنّع واحد محدد فقط: اختره من /factories ← إرسال مباشر (M3)',
      },
      {
        ko: '자주 쓰는 RFQ는 "템플릿으로 저장" → 다음에 재발주 빠르게 (B7)',
        en: 'Save frequent RFQs as templates for quick re-quote (B7).',
        ja: 'よく使うRFQは「テンプレートとして保存」→ 次回の再発注が簡単に(B7)',
        zh: '将常用RFQ"保存为模板"，方便下次快速重新下单(B7)',
        es: 'Guarde las RFQ frecuentes como plantillas para volver a pedir más rápido (B7)',
        ar: 'احفظ طلبات RFQ المتكررة "كقالب" لإعادة الطلب بسرعة لاحقاً (B7)',
      },
    ],
    cta: {
      label: {
        ko: '빠른 견적 시작', en: 'Start Quick Quote', ja: 'クイック見積を開始',
        zh: '开始快速报价', es: 'Iniciar cotización rápida', ar: 'ابدأ عرض السعر السريع',
      },
      href: 'quick-quote',
    },
  },
  {
    id: 'compare-quotes',
    emoji: '🏆',
    title: {
      ko: '견적 비교 + 수락', en: 'Compare quotes + accept', ja: '見積を比較して承諾',
      zh: '比较报价并接受', es: 'Comparar cotizaciones y aceptar', ar: 'مقارنة العروض والقبول',
    },
    blurb: {
      ko: '여러 제조사가 견적을 보내면 차원별로 비교해서 결정.',
      en: 'When multiple factories quote, compare by dimension and decide.',
      ja: '複数のメーカーから見積が届いたら、項目ごとに比較して決定。',
      zh: '多家制造商报价后，可按维度比较并做出决定。',
      es: 'Cuando varios fabricantes cotizan, compare por dimensión y decida.',
      ar: 'عند وصول عروض من عدة مصنّعين، قارنها حسب البُعد واتخذ قرارك.',
    },
    steps: [
      {
        ko: 'RFQ 페이지에서 본인 RFQ 선택 → 도착한 견적 목록 표시',
        en: 'RFQ page → pick your RFQ → see arrived quotes.',
        ja: 'RFQページで自分のRFQを選択 → 届いた見積一覧が表示されます',
        zh: '在RFQ页面选择您的RFQ → 显示已收到的报价列表',
        es: 'Página de RFQ → elija su RFQ → vea las cotizaciones recibidas',
        ar: 'صفحة RFQ ← اختر طلبك ← اعرض قائمة العروض الواردة',
      },
      {
        ko: '2개 이상 견적 시 "🏆 견적 비교" 카드 자동 표시 (B5)',
        en: 'When 2+ quotes arrive, "🏆 Quote Comparison" card auto-shows (B5).',
        ja: '見積が2件以上になると「🏆 見積比較」カードが自動表示(B5)',
        zh: '收到2个及以上报价时，"🏆 报价比较"卡片会自动显示(B5)',
        es: 'Con 2 o más cotizaciones, la tarjeta "🏆 Comparar cotizaciones" aparece automáticamente (B5)',
        ar: 'عند وصول عرضين أو أكثر، تظهر بطاقة "🏆 مقارنة العروض" تلقائياً (B5)',
      },
      {
        ko: '가격/납기/제조사명으로 정렬. 최저가·최단납기 자동 강조',
        en: 'Sort by price/lead/name. Lowest + fastest auto-highlighted.',
        ja: '価格/納期/メーカー名で並べ替え。最安値・最短納期が自動でハイライト',
        zh: '按价格/交期/制造商名称排序，最低价与最短交期会自动高亮',
        es: 'Ordene por precio/plazo/nombre. Se destacan automáticamente el más barato y el más rápido',
        ar: 'رتّب حسب السعر/المدة/اسم المصنّع. يُبرَز تلقائياً الأرخص والأسرع',
      },
      {
        ko: '제조사 이름 클릭 → 평가, 인증, 최근 리뷰까지 미리보기 (M2)',
        en: 'Click a factory name → preview rating, certs, recent reviews (M2).',
        ja: 'メーカー名をクリック → 評価、認証、最近のレビューをプレビュー(M2)',
        zh: '点击制造商名称 → 预览评分、认证及近期评价(M2)',
        es: 'Haga clic en el nombre del fabricante → vista previa de calificación, certificaciones y reseñas recientes (M2)',
        ar: 'انقر على اسم المصنّع ← معاينة التقييم والشهادات وآخر المراجعات (M2)',
      },
      {
        ko: '"✓ 수락" 클릭 → 주문 자동 생성 + "주문 진행 상황 보기" 링크 (B6)',
        en: '"✓ Accept" → order auto-created + "View order progress" link (B6).',
        ja: '「✓ 承諾」をクリック → 注文が自動生成され「注文の進行状況を見る」リンクが表示(B6)',
        zh: '点击"✓ 接受" → 自动生成订单，并显示"查看订单进度"链接(B6)',
        es: '"✓ Aceptar" → el pedido se crea automáticamente + enlace "Ver progreso del pedido" (B6)',
        ar: 'انقر "✓ قبول" ← يُنشأ الطلب تلقائياً + رابط "عرض تقدم الطلب" (B6)',
      },
    ],
  },
  {
    id: 'track-order',
    emoji: '🚚',
    title: {
      ko: '주문 추적 + 메시지', en: 'Track order + messaging', ja: '注文の追跡 + メッセージ',
      zh: '追踪订单 + 消息', es: 'Seguimiento del pedido + mensajes', ar: 'تتبّع الطلب + الرسائل',
    },
    blurb: {
      ko: '진행 상황 사진과 양방향 대화로 끝까지 가시성 확보.',
      en: 'Photos + two-way chat keep you in the loop end-to-end.',
      ja: '進捗写真と双方向チャットで最後まで可視化。',
      zh: '通过进度照片与双向聊天，全程保持可见性。',
      es: 'Fotos de progreso y chat bidireccional para mantenerlo informado de principio a fin.',
      ar: 'صور التقدم ومحادثة ثنائية الاتجاه تبقيك على اطّلاع من البداية للنهاية.',
    },
    steps: [
      {
        ko: '/nexyfab/orders에서 주문 클릭 → 상세 drawer 열림',
        en: 'Click an order in /nexyfab/orders — detail drawer opens.',
        ja: '/nexyfab/orders で注文をクリック → 詳細ドロワーが開きます',
        zh: '在 /nexyfab/orders 中点击订单 → 打开详情抽屉',
        es: 'Haga clic en un pedido en /nexyfab/orders — se abre el panel de detalles',
        ar: 'انقر على طلب في /nexyfab/orders ← يفتح لوح التفاصيل',
      },
      {
        ko: '"마일스톤" 탭: 단계별 진행 + 파트너가 올린 사진/노트 (M4)',
        en: '"Milestones" tab: step progress + partner-uploaded photos/notes (M4).',
        ja: '「マイルストーン」タブ: 段階ごとの進捗 + パートナーがアップロードした写真/メモ(M4)',
        zh: '"里程碑"标签页: 分阶段进度 + 合作伙伴上传的照片/备注(M4)',
        es: 'Pestaña "Hitos": progreso por etapas + fotos/notas subidas por el socio (M4)',
        ar: 'تبويب "المعالم": التقدم حسب المراحل + صور/ملاحظات رفعها الشريك (M4)',
      },
      {
        ko: '"💬 대화" 탭: 파트너와 직접 메시지. 첨부 URL도 가능 (M1)',
        en: '"💬 Messages" tab: chat directly. Attachment URLs supported (M1).',
        ja: '「💬 メッセージ」タブ: パートナーと直接やり取り。添付URLにも対応(M1)',
        zh: '"💬 消息"标签页: 与合作伙伴直接沟通，支持附件URL(M1)',
        es: 'Pestaña "💬 Mensajes": chatee directamente con el socio. Admite URLs adjuntas (M1)',
        ar: 'تبويب "💬 الرسائل": تواصل مباشرة مع الشريك. يدعم روابط المرفقات (M1)',
      },
      {
        ko: '파트너가 이메일로 답해도 메시지 thread에 자동 도착 (M5, 설정 필요)',
        en: 'Partner email replies auto-route into the thread (M5, requires setup).',
        ja: 'パートナーがメールで返信しても、メッセージスレッドに自動で届きます(M5、要設定)',
        zh: '即使合作伙伴通过邮件回复，也会自动进入消息线程(M5，需要设置)',
        es: 'Las respuestas por correo del socio se enrutan automáticamente al hilo (M5, requiere configuración)',
        ar: 'حتى ردود الشريك عبر البريد الإلكتروني تصل تلقائياً إلى سلسلة الرسائل (M5، يتطلب إعداداً)',
      },
      {
        ko: '"배송 추적" 탭: 트래킹 번호 + 운송장 상태',
        en: '"Shipment" tab: tracking number + carrier status.',
        ja: '「配送追跡」タブ: 追跡番号 + 配送状況',
        zh: '"物流追踪"标签页: 追踪号码 + 承运商状态',
        es: 'Pestaña "Envío": número de seguimiento + estado del transportista',
        ar: 'تبويب "الشحن": رقم التتبع + حالة الناقل',
      },
    ],
  },
  {
    id: 'review',
    emoji: '⭐',
    title: {
      ko: '주문 리뷰 작성', en: 'Review the order', ja: '注文レビューを書く',
      zh: '撰写订单评价', es: 'Escribir una reseña del pedido', ar: 'كتابة تقييم للطلب',
    },
    blurb: {
      ko: '납기/품질/소통을 차원별로 평가. 다음 구매자에게 도움.',
      en: 'Rate deadline/quality/comms separately. Helps next buyer.',
      ja: '納期/品質/コミュニケーションを項目別に評価。次の購入者の助けになります。',
      zh: '分别评价交期/质量/沟通，帮助下一位买家。',
      es: 'Califique plazo/calidad/comunicación por separado. Ayuda al próximo comprador.',
      ar: 'قيّم الموعد والجودة والتواصل كل على حدة. يساعد المشتري التالي.',
    },
    steps: [
      {
        ko: '주문 상태가 "delivered"가 되면 "⭐ 리뷰 작성" 탭 활성화',
        en: 'Once order status is "delivered", "⭐ Review" tab unlocks.',
        ja: '注文ステータスが「delivered」になると「⭐ レビュー作成」タブが有効になります',
        zh: '订单状态变为"delivered"后，"⭐ 撰写评价"标签页解锁',
        es: 'Cuando el pedido pasa a "delivered", se desbloquea la pestaña "⭐ Reseña"',
        ar: 'عند تحوّل حالة الطلب إلى "delivered"، يُفعَّل تبويب "⭐ كتابة تقييم"',
      },
      {
        ko: '종합 평점 + 납기 + 품질 + 소통 4개 차원 별점 (B8)',
        en: 'Overall + Deadline + Quality + Communication, 4 axes (B8).',
        ja: '総合評価 + 納期 + 品質 + コミュニケーションの4項目で評価(B8)',
        zh: '综合评分 + 交期 + 质量 + 沟通，共4个维度评分(B8)',
        es: 'Calificación general + plazo + calidad + comunicación, 4 dimensiones (B8)',
        ar: 'التقييم العام + الموعد + الجودة + التواصل، 4 أبعاد (B8)',
      },
      {
        ko: '낮은 평가 (≤3점) 시 의견 입력 권유 — 제조사에 전달',
        en: 'Low ratings (≤3) prompt comment box — passed to the partner.',
        ja: '低評価(3点以下)の場合はコメント欄の入力を促されます — メーカーに伝達されます',
        zh: '评分较低(≤3分)时会提示填写意见 — 将转达给制造商',
        es: 'Las calificaciones bajas (≤3) solicitan un comentario — se envía al socio',
        ar: 'التقييمات المنخفضة (≤3) تطلب إدخال تعليق ← يُرسَل إلى الشريك',
      },
      {
        ko: '단일 합산 점수가 아닌 차원별 점수가 다른 구매자에게 표시됨',
        en: 'Buyers see dimensional scores (no single composite — per spec).',
        ja: '単一の合算スコアではなく、項目別スコアが他の購入者に表示されます',
        zh: '买家看到的是各维度分数，而非单一综合评分',
        es: 'Los compradores ven puntuaciones por dimensión, no un puntaje compuesto único',
        ar: 'يرى المشترون درجات كل بُعد على حدة، وليس درجة إجمالية واحدة',
      },
      {
        ko: '이메일 알림 링크로 직접 이동 가능: /nexyfab/review/{orderId}',
        en: 'Email link goes straight to /nexyfab/review/{orderId}.',
        ja: 'メール通知のリンクから直接移動できます: /nexyfab/review/{orderId}',
        zh: '可通过邮件通知链接直接前往: /nexyfab/review/{orderId}',
        es: 'El enlace del correo de notificación lleva directamente a /nexyfab/review/{orderId}',
        ar: 'يمكن الانتقال مباشرة عبر رابط إشعار البريد الإلكتروني: /nexyfab/review/{orderId}',
      },
    ],
  },
  {
    id: 'pro-tips',
    emoji: '💎',
    title: {
      ko: 'Pro+ 기능 알아두기', en: 'Pro+ feature highlights', ja: 'Pro+機能を知っておこう',
      zh: '了解Pro+功能', es: 'Funciones destacadas de Pro+', ar: 'تعرّف على ميزات Pro+',
    },
    blurb: {
      ko: '결제 활성 후 사용 가능한 고급 기능들.',
      en: 'Advanced features unlocked after subscribing.',
      ja: '契約後に利用できる高度な機能。',
      zh: '订阅后可解锁的高级功能。',
      es: 'Funciones avanzadas disponibles tras suscribirse.',
      ar: 'ميزات متقدمة تُفتح بعد الاشتراك.',
    },
    steps: [
      {
        ko: 'AI 에이전트 풀 사용 (Free는 잠금)',
        en: 'Full AI agent (Free is locked).',
        ja: 'AIエージェントをフル活用(Freeはロック)',
        zh: '完整使用AI代理(Free版已锁定)',
        es: 'Agente de IA completo (bloqueado en el plan Free)',
        ar: 'استخدام كامل لوكيل الذكاء الاصطناعي (مقفل في الخطة المجانية)',
      },
      {
        ko: '시뮬레이션 6종: CFD/MBD/CAM/Mold/Optics/Thermal — Pro 월 20회, Team 100회',
        en: '6 simulations: CFD/MBD/CAM/Mold/Optics/Thermal — Pro 20/mo, Team 100/mo.',
        ja: 'シミュレーション6種: CFD/MBD/CAM/金型/光学/熱 — Proは月20回、Teamは100回',
        zh: '6种仿真: CFD/MBD/CAM/模具/光学/热仿真 — Pro每月20次，Team每月100次',
        es: '6 simulaciones: CFD/MBD/CAM/Molde/Óptica/Térmica — Pro 20/mes, Team 100/mes',
        ar: '6 أنواع محاكاة: CFD/MBD/CAM/القوالب/البصريات/الحرارة — Pro 20 مرة شهرياً، Team 100 مرة',
      },
      {
        ko: 'PMI/MBD STEP AP242 export (GD&T 풀 스펙 + 데이텀 타겟 + 표면조도)',
        en: 'PMI/MBD STEP AP242 export (full GD&T + datum targets + surface finish).',
        ja: 'PMI/MBD STEP AP242エクスポート(GD&Tフルスペック + データムターゲット + 表面粗さ)',
        zh: 'PMI/MBD STEP AP242导出(完整GD&T规范 + 基准目标 + 表面粗糙度)',
        es: 'Exportación PMI/MBD STEP AP242 (GD&T completo + objetivos de datum + acabado superficial)',
        ar: 'تصدير PMI/MBD STEP AP242 (مواصفات GD&T كاملة + أهداف مرجعية + خشونة السطح)',
      },
      {
        ko: '엔지니어링 카탈로그 RAG: 베어링/시일/재료 자문',
        en: 'Engineering catalog RAG: bearings/seals/materials advisory.',
        ja: 'エンジニアリングカタログRAG: ベアリング/シール/材料に関するアドバイス',
        zh: '工程目录RAG: 轴承/密封件/材料咨询',
        es: 'RAG de catálogo de ingeniería: asesoría sobre rodamientos/sellos/materiales',
        ar: 'كتالوج هندسي RAG: استشارات المحامل/الحشوات/المواد',
      },
      {
        ko: '신뢰성 자료 (테스트 통과율, OCCT burn-in) → /trust 페이지 참조',
        en: 'Trust evidence (test pass rate, OCCT burn-in) → see /trust page.',
        ja: '信頼性データ(テスト合格率、OCCTバーンイン)→ /trust ページを参照',
        zh: '可信度数据(测试通过率、OCCT烧机测试)→ 参见 /trust 页面',
        es: 'Evidencia de confiabilidad (tasa de aprobación de pruebas, burn-in de OCCT) → vea la página /trust',
        ar: 'أدلة الموثوقية (نسبة اجتياز الاختبارات، اختبار OCCT burn-in) ← راجع صفحة /trust',
      },
    ],
    cta: {
      label: {
        ko: '요금제 보기', en: 'See pricing', ja: '料金プランを見る',
        zh: '查看定价', es: 'Ver precios', ar: 'عرض الأسعار',
      },
      href: 'nexyfab/pricing',
    },
  },
];

export const dict: Record<IsoLang, {
  title: string; subtitle: string; expand: string; collapse: string; cta: string;
  contact: string; contactLink: string; intro: string; trust: string; trustLink: string;
}> = {
  ko: {
    title: '사용 가이드',
    subtitle: '첫 설계부터 리뷰까지 — NexyFab 전체 흐름을 한눈에',
    expand: '펼치기',
    collapse: '접기',
    cta: '관련 페이지 →',
    contact: '도움이 더 필요하시면',
    contactLink: 'nexyfab@nexysys.com',
    intro: '7개 카드 중 궁금한 것을 펼쳐보세요. 카드 안에 단계별 안내가 있고, 관련 페이지로 바로 가는 버튼도 있습니다.',
    trust: '기술 신뢰성 자료가 궁금하다면',
    trustLink: '신뢰성 페이지',
  },
  en: {
    title: 'User Guide',
    subtitle: 'First design to review — NexyFab end-to-end in one page',
    expand: 'Expand',
    collapse: 'Collapse',
    cta: 'Related page →',
    contact: 'Need more help?',
    contactLink: 'nexyfab@nexysys.com',
    intro: 'Expand whichever card answers your question. Each has step-by-step instructions and a button to jump straight to the relevant page.',
    trust: 'For technical credibility data, see the',
    trustLink: 'Trust page',
  },
  ja: {
    title: 'ユーザーガイド',
    subtitle: '最初の設計からレビューまで — NexyFabの全体像を一目で',
    expand: '展開',
    collapse: '折りたたむ',
    cta: '関連ページへ →',
    contact: 'さらにサポートが必要な場合',
    contactLink: 'nexyfab@nexysys.com',
    intro: '気になるカードを展開してください。各カードにステップバイステップの案内があり、関連ページへ直接移動できるボタンもあります。',
    trust: '技術的な信頼性データについては',
    trustLink: '信頼性ページ',
  },
  zh: {
    title: '使用指南',
    subtitle: '从首次设计到评价 — 一目了然的 NexyFab 全流程',
    expand: '展开',
    collapse: '收起',
    cta: '相关页面 →',
    contact: '需要更多帮助?',
    contactLink: 'nexyfab@nexysys.com',
    intro: '展开您想了解的卡片。每张卡片都有分步说明，并附有直达相关页面的按钮。',
    trust: '如需了解技术可信度数据，请查看',
    trustLink: '信任页面',
  },
  es: {
    title: 'Guía del usuario',
    subtitle: 'Del primer diseño a la reseña — todo el flujo de NexyFab de un vistazo',
    expand: 'Expandir',
    collapse: 'Contraer',
    cta: 'Página relacionada →',
    contact: '¿Necesita más ayuda?',
    contactLink: 'nexyfab@nexysys.com',
    intro: 'Expanda la tarjeta que responda su pregunta. Cada una incluye instrucciones paso a paso y un botón para ir directamente a la página correspondiente.',
    trust: 'Para datos de confiabilidad técnica, consulte la',
    trustLink: 'página de confiabilidad',
  },
  ar: {
    title: 'دليل الاستخدام',
    subtitle: 'من التصميم الأول إلى التقييم — رحلة NexyFab الكاملة في صفحة واحدة',
    expand: 'توسيع',
    collapse: 'طي',
    cta: 'الصفحة ذات الصلة ←',
    contact: 'هل تحتاج مساعدة إضافية؟',
    contactLink: 'nexyfab@nexysys.com',
    intro: 'وسّع البطاقة التي تجيب على سؤالك. تحتوي كل بطاقة على تعليمات خطوة بخطوة وزر للانتقال مباشرة إلى الصفحة ذات الصلة.',
    trust: 'للاطلاع على بيانات الموثوقية التقنية، راجع',
    trustLink: 'صفحة الموثوقية',
  },
};

export default function HelpClient() {
  const params = useParams();
  const langRaw = (params?.lang as string) ?? 'ko';
  const lang = toIsoLang(langRaw);
  const routeLang = toRouteLang(langRaw);
  const t = dict[lang] ?? dict.en;
  const [open, setOpen] = useState<Set<string>>(new Set([SECTIONS[0].id])); // first section open by default

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>{t.title}</h1>
      <p style={subtitleStyle}>{t.subtitle}</p>
      <p style={introStyle}>{t.intro}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SECTIONS.map(s => {
          const isOpen = open.has(s.id);
          return (
            <div key={s.id} style={cardStyle}>
              <button onClick={() => toggle(s.id)} style={cardHeaderBtn} aria-expanded={isOpen}>
                <span style={{ fontSize: 22, marginRight: 10 }}>{s.emoji}</span>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={cardTitleStyle}>{s.title[lang] ?? s.title.en}</div>
                  <div style={cardBlurbStyle}>{s.blurb[lang] ?? s.blurb.en}</div>
                </div>
                <span style={{ color: '#6b7280', fontSize: 18 }}>{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div style={cardBodyStyle}>
                  <ol style={stepListStyle}>
                    {s.steps.map((st, i) => (
                      <li key={i} style={stepItemStyle}>
                        {st[lang] ?? st.en}
                      </li>
                    ))}
                  </ol>
                  {s.cta && (
                    <a href={`/${routeLang}/${s.cta.href}`} style={ctaBtnStyle}>
                      {s.cta.label[lang] ?? s.cta.label.en} →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={footerNoticeStyle}>
        <div style={{ marginBottom: 8 }}>
          {t.trust}{' '}
          <a href={`/${routeLang}/trust`} style={linkStyle}>{t.trustLink}</a>
        </div>
        <div>
          {t.contact}{' '}
          <a href={`mailto:${t.contactLink}`} style={linkStyle}>{t.contactLink}</a>
        </div>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 880, margin: '0 auto', padding: '48px 24px',
  fontFamily: 'system-ui, sans-serif', color: '#1f2937',
};
const titleStyle: React.CSSProperties = { fontSize: 32, fontWeight: 800, marginBottom: 6 };
const subtitleStyle: React.CSSProperties = { color: '#6b7280', marginTop: 0, marginBottom: 8, fontSize: 15 };
const introStyle: React.CSSProperties = {
  color: '#475569', marginTop: 0, marginBottom: 32, fontSize: 13, lineHeight: 1.6,
  padding: '12px 16px', background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #3b82f6',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
  overflow: 'hidden', transition: 'border-color 0.15s',
};
const cardHeaderBtn: React.CSSProperties = {
  width: '100%', padding: '14px 18px',
  display: 'flex', alignItems: 'center', gap: 4,
  background: 'transparent', border: 'none',
  cursor: 'pointer', textAlign: 'left',
};
const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#111827' };
const cardBlurbStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 2 };
const cardBodyStyle: React.CSSProperties = {
  padding: '0 18px 18px 56px',
  borderTop: '1px solid #f3f4f6',
};
const stepListStyle: React.CSSProperties = {
  margin: '14px 0 12px', padding: '0 0 0 18px',
  fontSize: 13, lineHeight: 1.7, color: '#374151',
};
const stepItemStyle: React.CSSProperties = { marginBottom: 6 };
const ctaBtnStyle: React.CSSProperties = {
  display: 'inline-block', marginTop: 6,
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  background: '#2563eb', color: '#fff',
  borderRadius: 6, textDecoration: 'none',
};
const footerNoticeStyle: React.CSSProperties = {
  marginTop: 48, padding: 16,
  background: '#eff6ff', border: '1px solid #bfdbfe',
  borderRadius: 8, fontSize: 13, color: '#1e40af',
};
const linkStyle: React.CSSProperties = {
  color: '#1e40af', fontWeight: 600, textDecoration: 'underline',
};
