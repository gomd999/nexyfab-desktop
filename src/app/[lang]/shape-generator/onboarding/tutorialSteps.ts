// ─── 60-Second "Aha Moment" Tutorial Steps ──────────────────────────────────
// Multi-step "first quote in 60 seconds" flow for new users.
// Each step maps to data-tour attributes in the workspace.
// Supports 6 languages: ko, en, ja, cn, es, ar

export interface TutorialStep {
  id: string;
  targetSelector: string;
  fallbackText?: string;
  title: string;
  titleKo: string;
  titles?: Record<string, string>; // ja, cn, es, ar
  description: string;
  descriptionKo: string;
  descriptions?: Record<string, string>; // ja, cn, es, ar
  position: 'top' | 'bottom' | 'left' | 'right';
  highlightTarget?: boolean;
  skipable?: boolean;
  pulse?: boolean;
  autoAdvanceOn?: string;
}

/** Helper to get title/description for any lang */
export function getStepTitle(step: TutorialStep, lang: string): string {
  if (lang === 'ko') return step.titleKo;
  if (lang === 'en') return step.title;
  return step.titles?.[lang] ?? step.title;
}

export function getStepDescription(step: TutorialStep, lang: string): string {
  if (lang === 'ko') return step.descriptionKo;
  if (lang === 'en') return step.description;
  return step.descriptions?.[lang] ?? step.description;
}

/** Sketch-mode focused tutorial (4 steps) — started by useTutorial.startSketchTutorial() */
export const SKETCH_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'sk-enter',
    targetSelector: '[data-tour="sketch-btn"]',
    position: 'right',
    title: '① Enter Sketch Mode',
    titleKo: '① 스케치 모드 진입',
    titles: { ja: '① スケッチモードへ', cn: '① 进入草图模式', es: '① Modo Boceto', ar: '① وضع الرسم' },
    description: 'Click the Sketch button (or press S) to start drawing on the selected plane.',
    descriptionKo: 'Sketch 버튼을 클릭하거나 S 키를 누르세요. 선택한 평면에 2D 도형을 그립니다.',
    descriptions: {
      ja: 'スケッチボタンをクリック、またはSキーを押して選択した平面に描画を開始します。',
      cn: '点击草图按钮或按S键，在选定平面上开始绘制2D图形。',
      es: 'Haga clic en Boceto (o pulse S) para dibujar en el plano seleccionado.',
      ar: 'انقر على زر الرسم أو اضغط S لبدء الرسم على المستوى المحدد.',
    },
    highlightTarget: true,
  },
  {
    id: 'sk-tool',
    targetSelector: '[data-tour="sketch-toolbox"]',
    position: 'right',
    title: '② Pick a Draw Tool',
    titleKo: '② 도구 선택',
    titles: { ja: '② ツール選択', cn: '② 选择工具', es: '② Elige Herramienta', ar: '② اختر أداة' },
    description: 'Choose Line (L), Arc (A), Circle (C), or Rectangle (R). Press ? for all sketch shortcuts.',
    descriptionKo: '선(L), 호(A), 원(C), 사각형(R) 중 도구를 선택하세요. ?를 누르면 모든 단축키를 볼 수 있습니다.',
    descriptions: {
      ja: '線(L)・弧(A)・円(C)・矩形(R)からツールを選択。?でショートカット一覧。',
      cn: '选择线(L)、弧(A)、圆(C)或矩形(R)。按?查看所有快捷键。',
      es: 'Elige Línea (L), Arco (A), Círculo (C) o Rectángulo (R). Pulsa ? para atajos.',
      ar: 'اختر خطاً (L) أو قوساً (A) أو دائرة (C) أو مستطيلاً (R). اضغط ? للاختصارات.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'sk-draw',
    targetSelector: '[data-tour="sketch-canvas"]',
    position: 'top',
    title: '③ Draw a Closed Profile',
    titleKo: '③ 닫힌 프로파일 그리기',
    titles: { ja: '③ 閉じたプロファイルを描く', cn: '③ 绘制闭合轮廓', es: '③ Perfil Cerrado', ar: '③ ارسم ملفاً مغلقاً' },
    description: 'Click to place points. Click the first point again to close. Snap to 5mm grid. Shift = lock angle.',
    descriptionKo: '클릭해서 점을 찍으세요. 시작점을 다시 클릭하면 닫힙니다. 5mm 그리드 스냅. Shift=각도 고정.',
    descriptions: {
      ja: 'クリックで点を追加、最初の点で閉合。5mmグリッドスナップ、Shift=角度固定。',
      cn: '点击添加点，点击起始点闭合。5mm网格捕捉，Shift=锁定角度。',
      es: 'Clic para añadir puntos, clic en el primer punto para cerrar. Rejilla 5mm, Shift=ángulo fijo.',
      ar: 'انقر لإضافة نقاط، انقر النقطة الأولى للإغلاق. شبكة 5mm، Shift=تثبيت زاوية.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'sk-extrude',
    targetSelector: '[data-tour="extrude-cta"]',
    position: 'top',
    title: '④ Extrude to 3D',
    titleKo: '④ 3D 돌출',
    titles: { ja: '④ 3D押し出し', cn: '④ 拉伸为3D', es: '④ Extruir a 3D', ar: '④ بثق إلى 3D' },
    description: 'Once the profile is closed, click "Extrude" to generate a solid body. Adjust depth and operation.',
    descriptionKo: '프로파일이 닫히면 "돌출" 버튼이 나타납니다. 깊이와 연산 방식을 설정하고 클릭하세요.',
    descriptions: {
      ja: 'プロファイルを閉じると「押し出し」ボタンが表示。深さと演算方法を設定してクリック。',
      cn: '轮廓闭合后出现"拉伸"按钮，设置深度和操作方式后点击。',
      es: 'Al cerrar el perfil aparece "Extruir". Ajuste profundidad y operación.',
      ar: 'بعد إغلاق الملف يظهر زر "بثق". اضبط العمق والعملية وانقر.',
    },
    highlightTarget: true,
    pulse: true,
    skipable: true,
  },
];

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    targetSelector: '[data-tour="shape-selector"]',
    position: 'right',
    title: '👋 Welcome to NexyFab',
    titleKo: '👋 NexyFab에 오신 것을 환영합니다',
    titles: {
      ja: '👋 NexyFabへようこそ',
      cn: '👋 欢迎使用 NexyFab',
      es: '👋 Bienvenido a NexyFab',
      ar: '👋 مرحبًا بك في NexyFab',
    },
    description: 'Design your first part and get a manufacturing quote in 60 seconds.',
    descriptionKo: '60초 안에 첫 부품을 설계하고 제조 견적을 받아보세요.',
    descriptions: {
      ja: '60秒で最初のパーツを設計し、製造見積もりを取得しましょう。',
      cn: '在60秒内设计您的第一个零件并获取制造报价。',
      es: 'Diseñe su primera pieza y obtenga un presupuesto en 60 segundos.',
      ar: 'صمم أول قطعة واحصل على عرض سعر للتصنيع في 60 ثانية.',
    },
    highlightTarget: false,
  },
  {
    id: 'pick-shape',
    targetSelector: '[data-tour="shape-selector"]',
    position: 'right',
    title: '① Pick a Shape',
    titleKo: '① 형상 선택',
    titles: { ja: '① 形状を選択', cn: '① 选择形状', es: '① Elige una Forma', ar: '① اختر شكلاً' },
    description: 'Click "L-Bracket" — the most common part in manufacturing.',
    descriptionKo: '"L-브래킷"을 클릭하세요. 제조업에서 가장 많이 쓰이는 형상입니다.',
    descriptions: {
      ja: '「L-ブラケット」をクリック — 製造業で最も一般的なパーツです。',
      cn: '点击"L型支架" — 制造业中最常见的零件。',
      es: 'Haga clic en "L-Bracket" — la pieza más común en manufactura.',
      ar: 'انقر على "L-Bracket" — القطعة الأكثر شيوعًا في التصنيع.',
    },
    highlightTarget: true,
    autoAdvanceOn: 'shape-selected',
  },
  {
    id: 'adjust-params',
    targetSelector: '[data-tour="param-panel"]',
    position: 'right',
    title: '② Adjust Size',
    titleKo: '② 크기 조절',
    titles: { ja: '② サイズ調整', cn: '② 调整尺寸', es: '② Ajustar Tamaño', ar: '② اضبط الحجم' },
    description: 'Drag sliders or type values to adjust dimensions.',
    descriptionKo: '슬라이더를 드래그하거나 숫자를 입력해 부품 크기를 조절하세요.',
    descriptions: {
      ja: 'スライダーをドラッグするか数値を入力して寸法を調整します。',
      cn: '拖动滑块或输入数值来调整尺寸。',
      es: 'Arrastre los controles o escriba valores para ajustar dimensiones.',
      ar: 'اسحب أشرطة التمرير أو اكتب القيم لضبط الأبعاد.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'pick-material',
    targetSelector: '[data-tour="material-picker"]',
    position: 'right',
    title: '③ Choose Material',
    titleKo: '③ 재료 선택',
    titles: { ja: '③ 素材選択', cn: '③ 选择材料', es: '③ Elegir Material', ar: '③ اختر المادة' },
    description: 'Select "Aluminum 6061" — lightweight and machinable.',
    descriptionKo: '"알루미늄 6061"을 선택하세요 — 가볍고 가공하기 좋습니다.',
    descriptions: {
      ja: '「アルミニウム6061」を選択 — 軽量で加工しやすい素材です。',
      cn: '选择"铝6061" — 重量轻且易于加工。',
      es: 'Seleccione "Aluminio 6061" — ligero y fácil de mecanizar.',
      ar: 'اختر "ألمنيوم 6061" — خفيف الوزن وقابل للتشغيل.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'get-quote',
    targetSelector: '[data-tour="get-quote"]',
    position: 'bottom',
    title: '④ Get Your Quote!',
    titleKo: '④ 견적 받기!',
    titles: { ja: '④ 見積もりを取得!', cn: '④ 获取报价!', es: '④ ¡Obtener Presupuesto!', ar: '④ احصل على عرض سعر!' },
    description: 'Click "Get Quote" to send your design to manufacturers instantly.',
    descriptionKo: '"견적 요청" 버튼을 누르면 제조사에게 즉시 견적이 전달됩니다.',
    descriptions: {
      ja: '「見積もり」をクリックすると、デザインが即座にメーカーに送信されます。',
      cn: '点击"获取报价"将设计立即发送给制造商。',
      es: 'Haga clic en "Obtener Presupuesto" para enviar su diseño a fabricantes al instante.',
      ar: 'انقر "الحصول على عرض سعر" لإرسال تصميمك للمصنعين فورًا.',
    },
    highlightTarget: true,
    pulse: true,
  },
  {
    id: 'command-toolbar',
    targetSelector: '[data-tour="command-toolbar"]',
    position: 'bottom',
    title: '⑤ Pro Tools',
    titleKo: '⑤ 전문 도구',
    titles: { ja: '⑤ プロツール', cn: '⑤ 专业工具', es: '⑤ Herramientas Pro', ar: '⑤ أدوات احترافية' },
    description: 'Use the command toolbar for sketch, features, surface, and sheet metal tools — just like SolidWorks.',
    descriptionKo: '명령 도구 모음에서 스케치, 피처, 서피스, 판금 도구를 사용하세요 — SolidWorks처럼.',
    descriptions: {
      ja: 'コマンドツールバーでスケッチ、フィーチャー、サーフェス、板金ツールを使用 — SolidWorksのように。',
      cn: '使用命令工具栏进行草图、特征、曲面和钣金操作 — 就像SolidWorks一样。',
      es: 'Use la barra de herramientas para boceto, operaciones, superficies y chapa — como SolidWorks.',
      ar: 'استخدم شريط الأدوات للرسم والميزات والأسطح والصفائح المعدنية — مثل SolidWorks.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'optimize-tab',
    targetSelector: '[data-tour="optimize-tab"]',
    position: 'bottom',
    title: '⑥ Topology Optimization',
    titleKo: '⑥ 위상 최적화',
    titles: { ja: '⑥ トポロジー最適化', cn: '⑥ 拓扑优化', es: '⑥ Optimización Topológica', ar: '⑥ تحسين الطوبولوجيا' },
    description: 'Switch to Optimize tab to run generative design and reduce material while maintaining strength.',
    descriptionKo: '최적화 탭으로 전환하여 강도를 유지하면서 재료를 줄이는 제너레이티브 디자인을 실행하세요.',
    descriptions: {
      ja: '最適化タブに切り替えて、強度を維持しながら材料を削減するジェネレーティブデザインを実行。',
      cn: '切换到优化标签，运行创成式设计，在保持强度的同时减少材料。',
      es: 'Cambie a la pestaña Optimizar para ejecutar diseño generativo y reducir material manteniendo la resistencia.',
      ar: 'انتقل إلى علامة التحسين لتشغيل التصميم التوليدي وتقليل المواد مع الحفاظ على القوة.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'print-open',
    targetSelector: '[data-tour="ev-print-btn"]',
    position: 'bottom',
    title: '🖨 3D Printing Analysis',
    titleKo: '🖨 3D 프린팅 분석',
    titles: { ja: '🖨 3Dプリント解析', cn: '🖨 3D 打印分析', es: '🖨 Análisis de Impresión 3D', ar: '🖨 تحليل الطباعة ثلاثية الأبعاد' },
    description: 'Open the Evaluate tab and click "3D Print" to analyze printability, supports, and cost.',
    descriptionKo: '평가 탭에서 "3D 프린팅 분석"을 눌러 출력성, 서포트, 비용을 분석하세요.',
    descriptions: {
      ja: '評価タブで「3Dプリント」をクリックし、印刷適性・サポート・コストを解析。',
      cn: '在评估标签中点击"3D 打印"以分析可打印性、支撑和成本。',
      es: 'Abra la pestaña Evaluar y haga clic en "Impresión 3D" para analizar imprimibilidad, soportes y coste.',
      ar: 'افتح علامة التقييم وانقر على "طباعة 3D" لتحليل القابلية للطباعة والدعامات والتكلفة.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'print-auto-orient',
    targetSelector: '[data-tour="auto-orient-btn"]',
    position: 'left',
    title: '🧭 Auto-Orient',
    titleKo: '🧭 자동 방향 최적화',
    titles: { ja: '🧭 自動方向最適化', cn: '🧭 自动定向', es: '🧭 Auto-orientación', ar: '🧭 توجيه تلقائي' },
    description: 'Let NexyFab pick the best build direction to minimize supports and overhangs.',
    descriptionKo: 'NexyFab이 서포트와 오버행을 최소화하는 최적의 빌드 방향을 자동으로 찾아줍니다.',
    descriptions: {
      ja: 'NexyFabがサポートとオーバーハングを最小化する最適なビルド方向を選択します。',
      cn: '让 NexyFab 选择最佳构建方向，最大程度减少支撑和悬垂。',
      es: 'Deje que NexyFab elija la mejor dirección de construcción para minimizar soportes.',
      ar: 'اترك NexyFab يختار أفضل اتجاه بناء لتقليل الدعامات والنتوءات.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'print-cost',
    targetSelector: '[data-tour="print-panel"]',
    position: 'left',
    title: '💰 Time & Cost',
    titleKo: '💰 시간 및 비용',
    titles: { ja: '💰 時間とコスト', cn: '💰 时间与成本', es: '💰 Tiempo y Coste', ar: '💰 الوقت والتكلفة' },
    description: 'Adjust layer height, infill, and speed — costs and print time update in real time.',
    descriptionKo: '레이어 높이, 인필, 속도를 조정하면 비용과 출력 시간이 실시간으로 갱신됩니다.',
    descriptions: {
      ja: 'レイヤー高さ・インフィル・速度を調整 — コストと時間がリアルタイムで更新。',
      cn: '调整层高、填充和速度 — 成本和打印时间实时更新。',
      es: 'Ajuste altura de capa, relleno y velocidad — el coste y el tiempo se actualizan en tiempo real.',
      ar: 'اضبط ارتفاع الطبقة والتعبئة والسرعة — تتحدث التكلفة والوقت في الوقت الفعلي.',
    },
    highlightTarget: true,
    skipable: true,
  },
  {
    id: 'print-export',
    targetSelector: '[data-tour="export-slicer-btn"]',
    position: 'left',
    title: '📥 Send to Slicer',
    titleKo: '📥 슬라이서로 보내기',
    titles: { ja: '📥 スライサーへ送信', cn: '📥 发送到切片机', es: '📥 Enviar al Slicer', ar: '📥 إرسال إلى المُقطّع' },
    description: 'Export STL + 3MF with rotation and slicer settings baked in — open directly in Bambu / Prusa / Cura.',
    descriptionKo: '회전과 슬라이서 설정이 포함된 STL + 3MF로 내보내 Bambu / Prusa / Cura에서 바로 여세요.',
    descriptions: {
      ja: '回転とスライサー設定を含むSTL + 3MFを書き出し、Bambu / Prusa / Curaで直接開けます。',
      cn: '导出包含旋转和切片设置的 STL + 3MF — 可直接在 Bambu / Prusa / Cura 中打开。',
      es: 'Exporte STL + 3MF con rotación y ajustes incluidos — abra directo en Bambu / Prusa / Cura.',
      ar: 'تصدير STL + 3MF مع التدوير والإعدادات — افتحه مباشرة في Bambu / Prusa / Cura.',
    },
    highlightTarget: true,
    pulse: true,
    skipable: true,
  },
  {
    id: 'shortcut-help',
    targetSelector: '[data-tour="shortcut-help"]',
    position: 'top',
    title: '⑦ Keyboard Shortcuts',
    titleKo: '⑦ 키보드 단축키',
    titles: { ja: '⑦ キーボードショートカット', cn: '⑦ 键盘快捷键', es: '⑦ Atajos de Teclado', ar: '⑦ اختصارات لوحة المفاتيح' },
    description: 'Press ? anytime to see all shortcuts. Right-click for context menus.',
    descriptionKo: '?를 눌러 단축키 목록을 확인하세요. 오른쪽 클릭으로 컨텍스트 메뉴를 열 수 있습니다.',
    descriptions: {
      ja: '?を押すとすべてのショートカットを表示。右クリックでコンテキストメニュー。',
      cn: '按 ? 随时查看所有快捷键。右键单击打开上下文菜单。',
      es: 'Presione ? en cualquier momento para ver atajos. Clic derecho para menú contextual.',
      ar: 'اضغط ? في أي وقت لعرض جميع الاختصارات. انقر بزر الماوس الأيمن للقائمة.',
    },
    highlightTarget: true,
    skipable: true,
  },
];
