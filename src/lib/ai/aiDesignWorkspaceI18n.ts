import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type StageCopy = Readonly<{ label: string; explanation: string }>;

export interface AiDesignWorkspaceCopy {
  launcher: Readonly<{
    title: string;
    description: string;
    requestLabel: string;
    requestPlaceholder: string;
    creatingSession: string;
    startDesign: string;
  }>;
  client: Readonly<{
    confirmApply: string;
    precisionRequested: string;
  }>;
  surface: Readonly<{
    loading3d: string;
    title: string;
    conversationAria: string;
    chat: string;
    refresh: string;
    authorityBoundary: string;
    conceptOnly: string;
    linkedCanvas: string;
    fullScreen: string;
    emptyCanvas: string;
    inspector: string;
    close: string;
    model: string;
    gaugePreview: string;
    validationPrecision: string;
  }>;
  starterCards: readonly [
    Readonly<{ title: string; description: string; examplePrompt: string }>,
    Readonly<{ title: string; description: string; examplePrompt: string }>,
  ];
  stages: Readonly<Record<'intake' | 'understanding' | 'generation' | 'candidates' | 'edit' | 'precision' | 'recovery', StageCopy>>;
  boundary: Readonly<{ concept: string; precision: string }>;
  cards: Readonly<{
    intakeTitle: string; intakeSummary: string; add: string;
    questionTitle: string; confirmTitle: string; confirm: string; answer: string;
    generatingTitle: string; start: string; continue: string; generationSummary: string;
    candidateTitle: string; candidateSummary: string; compare: string; select: string;
    editTitle: string; editSummary: string; preview: string;
    precisionTitle: string; precisionSummary: string; precision: string; inspect: string;
    recoveryTitle: string; refresh: string; resume: string;
  }>;
  previewDecision: Readonly<{
    title: string;
    summary: string;
    apply: string;
    discard: string;
  }>;
}

const COPY: Readonly<Record<IsoLang, AiDesignWorkspaceCopy>> = {
  ko: {
    launcher: {
      title: '무엇을 설계할까요?',
      description: '첫 요청은 이 프로젝트와 새 설계 세션의 revision에 결속됩니다. 다음 화면에서는 2D와 3D가 같은 선택 상태를 공유합니다.',
      requestLabel: '설계 요청',
      requestPlaceholder: '예: 벽 두께 3 mm, 폭 120 mm의 센서 브래킷을 설계해 줘.',
      creatingSession: '세션 생성 중…',
      startDesign: '대화형 설계 시작',
    },
    client: {
      confirmApply: '현재 서버 revision에 이 요청을 적용할까요?',
      precisionRequested: 'Precision CAD 요청이 접수되었습니다. 정확 형상 실행과 PASS는 아직 아닙니다.',
    },
    surface: {
      loading3d: '3D 개념 뷰 불러오는 중…', title: '대화형 설계 워크스페이스', conversationAria: '설계 대화',
      chat: '대화', refresh: '새로고침', authorityBoundary: '권한 경계', conceptOnly: '현재 화면은 개념 설계·미리보기 전용입니다.',
      linkedCanvas: '연동 캔버스', fullScreen: '전체 화면', emptyCanvas: '입력 또는 후보가 준비되면 연동 뷰가 표시됩니다.',
      inspector: '검사기', close: '닫기', model: '모델', gaugePreview: '게이지 미리보기', validationPrecision: '검증 · Precision',
    },
    starterCards: [
      { title: '아이디어 설명하기', description: '일상적인 말로 만들 제품이나 형상을 설명하세요.', examplePrompt: '벽에 고정하는 소형 공구걸이를 후크 3개로 설계해 줘.' },
      { title: '참고 자료로 시작하기', description: '2D 도면, 이미지·스케치 또는 기존 3D 모델을 올리세요.', examplePrompt: '이 자료의 핵심 기능은 유지하고 더 단순하고 가볍게 바꿔 줘.' },
    ],
    stages: {
      intake: { label: '아이디어 또는 자료 추가', explanation: '설계할 내용을 말하거나 참고 자료를 첨부하세요.' },
      understanding: { label: '이해한 내용 확인', explanation: '후보를 만들기 전에 AI가 이해한 내용을 확인하세요.' },
      generation: { label: '설계 후보 생성 계속', explanation: '현재 생성 단계를 진행하고 결과 근거를 확인하세요.' },
      candidates: { label: '설계 후보 선택', explanation: '후보를 비교하고 다듬을 하나를 선택하세요.' },
      edit: { label: '변경 미리보기', explanation: '변경을 설명하고 2D·3D 결과를 적용 전에 확인하세요.' },
      precision: { label: 'Precision CAD 요청', explanation: '승인한 개념을 정확한 형상과 제조 검증을 위해 Precision CAD로 보내세요.' },
      recovery: { label: '서버 상태에서 복구', explanation: '최신 서버 버전을 확인한 뒤 안전하게 이어가세요.' },
    },
    boundary: {
      concept: 'AI Design은 개념 생성과 편집만 수행합니다. 정확 형상과 제조 판단은 Precision CAD가 담당합니다.',
      precision: 'Precision CAD가 정확 형상과 제조 검증을 담당합니다. AI Design은 개념 설계 보조 역할을 유지합니다.',
    },
    cards: {
      intakeTitle: '무엇을 설계할까요?', intakeSummary: '설명하거나 2D 도면, 이미지·스케치, 기존 3D를 추가하세요.', add: '입력 추가',
      questionTitle: '이 항목만 확인해 주세요', confirmTitle: '이해한 내용 확인', confirm: '이대로 후보 만들기', answer: '답변하기',
      generatingTitle: '설계 후보 준비', start: '후보 생성', continue: '계속 생성', generationSummary: '진행 상태와 모델 변경 이유를 대화에서 확인할 수 있습니다.',
      candidateTitle: '후보를 비교하고 선택하세요', candidateSummary: '2D와 3D를 함께 보며 변경 영향과 검증 상태를 비교합니다.', compare: '후보 비교', select: '이 후보 선택',
      editTitle: '변경을 먼저 미리보세요', editSummary: '게이지 변경은 2D와 3D에 함께 미리보기되며 확인 전에는 저장되지 않습니다.', preview: '2D·3D 미리보기',
      precisionTitle: 'Precision CAD로 넘길 준비', precisionSummary: '정확한 형상과 제조 검증은 Precision CAD에서 수행합니다.', precision: 'Precision CAD 요청', inspect: '검증 근거 보기',
      recoveryTitle: '작업을 안전하게 복구하세요', refresh: '서버 상태 새로고침', resume: '이어하기',
    },
    previewDecision: {
      title: '개념 변경 미리보기', summary: '2D와 3D에만 표시된 비영구 미리보기입니다. 형상·위상·제조 검증은 실행되지 않았습니다.',
      apply: '세션에 적용', discard: '미리보기 취소',
    },
  },
  en: {
    launcher: {
      title: 'What would you like to design?',
      description: 'Your first request is revision-bound to this project and a new design session. The next screen keeps 2D and 3D selection synchronized.',
      requestLabel: 'Design request', requestPlaceholder: 'Example: Design a sensor bracket, 3 mm wall thickness and 120 mm wide.',
      creatingSession: 'Creating session…', startDesign: 'Start conversational design',
    },
    client: {
      confirmApply: 'Apply this request to the current server revision?',
      precisionRequested: 'Precision CAD request accepted. Exact execution and PASS have not occurred.',
    },
    surface: {
      loading3d: 'Loading 3D concept view…', title: 'Conversational design workspace', conversationAria: 'Design conversation',
      chat: 'Chat', refresh: 'Refresh', authorityBoundary: 'Authority boundary', conceptOnly: 'This workspace is for concept orchestration and preview.',
      linkedCanvas: 'Linked canvas', fullScreen: 'Full screen', emptyCanvas: 'Linked views appear when input or a candidate is ready.',
      inspector: 'Inspector', close: 'Close', model: 'Model', gaugePreview: 'Gauge preview', validationPrecision: 'Validation · Precision',
    },
    starterCards: [
      { title: 'Describe an idea', description: 'Start with a plain-language product or shape idea.', examplePrompt: 'Design a compact wall-mounted tool holder with three hooks.' },
      { title: 'Bring a reference', description: 'Upload a 2D drawing, image, sketch, or existing 3D model.', examplePrompt: 'Use this reference and make a simpler, lighter concept.' },
    ],
    stages: {
      intake: { label: 'Add an idea or reference', explanation: 'Tell the assistant what to design or attach a reference.' },
      understanding: { label: 'Review the understanding', explanation: 'Check what the assistant inferred before candidates are made.' },
      generation: { label: 'Continue generating candidates', explanation: 'Continue the current generation stage and review its evidence.' },
      candidates: { label: 'Choose a concept', explanation: 'Compare the generated concepts and choose one to refine.' },
      edit: { label: 'Refine the concept', explanation: 'Describe a change and review the updated concept.' },
      precision: { label: 'Open Precision CAD', explanation: 'Send the approved concept to Precision CAD for exact geometry and manufacturing checks.' },
      recovery: { label: 'Recover from server state', explanation: 'Refresh the authoritative server revision before continuing.' },
    },
    boundary: {
      concept: 'AI Design creates and edits concepts only. Exact geometry and manufacturing decisions belong to Precision CAD.',
      precision: 'Precision CAD owns exact geometry and manufacturing checks. AI Design remains a concept assistant.',
    },
    cards: {
      intakeTitle: 'What would you like to design?', intakeSummary: 'Describe it or add a 2D drawing, image or sketch, or existing 3D model.', add: 'Add input',
      questionTitle: 'Please confirm one detail', confirmTitle: 'Review the understanding', confirm: 'Generate from this understanding', answer: 'Answer',
      generatingTitle: 'Prepare design candidates', start: 'Generate candidates', continue: 'Continue generation', generationSummary: 'Follow progress and model-change reasons in the conversation.',
      candidateTitle: 'Compare and choose a candidate', candidateSummary: 'Review 2D and 3D together with change impact and verification state.', compare: 'Compare candidates', select: 'Choose this candidate',
      editTitle: 'Preview the change first', editSummary: 'Gauge changes preview in 2D and 3D together and are not saved before confirmation.', preview: 'Preview in 2D and 3D',
      precisionTitle: 'Ready for Precision CAD', precisionSummary: 'Precision CAD owns exact geometry and manufacturing verification.', precision: 'Request Precision CAD', inspect: 'View verification evidence',
      recoveryTitle: 'Recover your work safely', refresh: 'Refresh server state', resume: 'Resume',
    },
    previewDecision: {
      title: 'Concept change preview', summary: 'This is a nonpersistent 2D/3D preview. Geometry, topology, and manufacturing verification were not run.',
      apply: 'Apply to session', discard: 'Discard preview',
    },
  },
  ja: {
    launcher: {
      title: '何を設計しますか？', description: '最初の依頼は、このプロジェクトと新しい設計セッションのリビジョンに結び付けられます。次の画面では2Dと3Dの選択が同期されます。',
      requestLabel: '設計依頼', requestPlaceholder: '例：肉厚3 mm、幅120 mmのセンサーブラケットを設計してください。', creatingSession: 'セッションを作成中…', startDesign: '対話型設計を開始',
    },
    client: { confirmApply: 'この依頼を現在のサーバーリビジョンに適用しますか？', precisionRequested: 'Precision CADへの依頼を受け付けました。正確な形状処理とPASS判定はまだ実行されていません。' },
    surface: {
      loading3d: '3Dコンセプトビューを読み込み中…', title: '対話型設計ワークスペース', conversationAria: '設計会話', chat: 'チャット', refresh: '更新',
      authorityBoundary: '権限の境界', conceptOnly: 'このワークスペースはコンセプト設計とプレビュー専用です。', linkedCanvas: '連動キャンバス', fullScreen: '全画面',
      emptyCanvas: '入力または候補が準備されると連動ビューが表示されます。', inspector: 'インスペクター', close: '閉じる', model: 'モデル', gaugePreview: 'ゲージプレビュー', validationPrecision: '検証 · Precision',
    },
    starterCards: [
      { title: 'アイデアを説明', description: '作りたい製品や形状を普段の言葉で説明してください。', examplePrompt: '壁付けの小型工具ホルダーをフック3個で設計してください。' },
      { title: '参考資料から開始', description: '2D図面、画像・スケッチ、または既存の3Dモデルをアップロードしてください。', examplePrompt: 'この資料の主要機能を保ちながら、より簡潔で軽い案にしてください。' },
    ],
    stages: {
      intake: { label: 'アイデアまたは資料を追加', explanation: '設計内容を伝えるか、参考資料を添付してください。' },
      understanding: { label: '理解内容を確認', explanation: '候補を作る前にAIの理解内容を確認してください。' },
      generation: { label: '設計候補の生成を続行', explanation: '現在の生成段階を進め、根拠を確認してください。' },
      candidates: { label: '設計候補を選択', explanation: '生成された候補を比較し、調整する案を選択してください。' },
      edit: { label: '変更をプレビュー', explanation: '変更内容を説明し、適用前に2D・3D結果を確認してください。' },
      precision: { label: 'Precision CADを依頼', explanation: '承認したコンセプトを正確な形状と製造検証のためPrecision CADへ送ります。' },
      recovery: { label: 'サーバー状態から復旧', explanation: '続行前に正式なサーバーリビジョンを更新してください。' },
    },
    boundary: { concept: 'AI Designはコンセプトの生成と編集のみを行います。正確な形状と製造判断はPrecision CADが担当します。', precision: '正確な形状と製造検証はPrecision CADが担当します。AI Designはコンセプト設計支援を続けます。' },
    cards: {
      intakeTitle: '何を設計しますか？', intakeSummary: '説明するか、2D図面、画像・スケッチ、既存3Dモデルを追加してください。', add: '入力を追加',
      questionTitle: 'この項目を確認してください', confirmTitle: '理解内容を確認', confirm: 'この内容で候補を生成', answer: '回答',
      generatingTitle: '設計候補を準備', start: '候補を生成', continue: '生成を続行', generationSummary: '進行状況とモデル変更の理由を会話で確認できます。',
      candidateTitle: '候補を比較して選択', candidateSummary: '2Dと3Dを同時に見ながら変更影響と検証状態を比較します。', compare: '候補を比較', select: 'この候補を選択',
      editTitle: '変更を先にプレビュー', editSummary: 'ゲージ変更は2Dと3Dに同時表示され、確認前には保存されません。', preview: '2D・3Dでプレビュー',
      precisionTitle: 'Precision CADへ送る準備完了', precisionSummary: '正確な形状と製造検証はPrecision CADで実行されます。', precision: 'Precision CADを依頼', inspect: '検証根拠を表示',
      recoveryTitle: '作業を安全に復旧', refresh: 'サーバー状態を更新', resume: '再開',
    },
    previewDecision: { title: 'コンセプト変更のプレビュー', summary: '2Dと3Dだけに表示される非永続プレビューです。形状、トポロジー、製造検証は実行されていません。', apply: 'セッションに適用', discard: 'プレビューを破棄' },
  },
  zh: {
    launcher: {
      title: '您想设计什么？', description: '首次请求将绑定到此项目和新设计会话的修订版本。下一页会同步2D和3D选择。', requestLabel: '设计请求',
      requestPlaceholder: '示例：设计一个壁厚3 mm、宽120 mm的传感器支架。', creatingSession: '正在创建会话…', startDesign: '开始对话式设计',
    },
    client: { confirmApply: '要将此请求应用到当前服务器修订版本吗？', precisionRequested: 'Precision CAD请求已受理。精确几何执行和PASS判定尚未发生。' },
    surface: {
      loading3d: '正在加载3D概念视图…', title: '对话式设计工作区', conversationAria: '设计对话', chat: '对话', refresh: '刷新', authorityBoundary: '权限边界',
      conceptOnly: '此工作区仅用于概念编排和预览。', linkedCanvas: '联动画布', fullScreen: '全屏', emptyCanvas: '输入或候选方案准备好后将显示联动视图。',
      inspector: '检查器', close: '关闭', model: '模型', gaugePreview: '参数预览', validationPrecision: '验证 · Precision',
    },
    starterCards: [
      { title: '描述想法', description: '用日常语言描述要制作的产品或形状。', examplePrompt: '设计一个带三个挂钩的紧凑型壁挂工具架。' },
      { title: '从参考资料开始', description: '上传2D图纸、图像、草图或现有3D模型。', examplePrompt: '保留此资料的核心功能，并生成更简单、更轻的方案。' },
    ],
    stages: {
      intake: { label: '添加想法或资料', explanation: '说明要设计的内容或附加参考资料。' },
      understanding: { label: '检查理解内容', explanation: '生成候选方案前检查AI的理解。' },
      generation: { label: '继续生成设计候选', explanation: '继续当前生成阶段并检查依据。' },
      candidates: { label: '选择设计候选', explanation: '比较生成的概念并选择一个继续优化。' },
      edit: { label: '预览更改', explanation: '描述更改并在应用前检查2D和3D结果。' },
      precision: { label: '请求Precision CAD', explanation: '将已批准的概念发送到Precision CAD进行精确几何和制造检查。' },
      recovery: { label: '从服务器状态恢复', explanation: '继续前刷新权威服务器修订版本。' },
    },
    boundary: { concept: 'AI Design仅创建和编辑概念。精确几何与制造判断由Precision CAD负责。', precision: 'Precision CAD负责精确几何与制造检查。AI Design仍是概念设计助手。' },
    cards: {
      intakeTitle: '您想设计什么？', intakeSummary: '请描述需求，或添加2D图纸、图像、草图或现有3D模型。', add: '添加输入',
      questionTitle: '请确认这一项', confirmTitle: '检查理解内容', confirm: '按此理解生成候选', answer: '回答',
      generatingTitle: '准备设计候选', start: '生成候选', continue: '继续生成', generationSummary: '可在对话中查看进度和模型更改原因。',
      candidateTitle: '比较并选择候选', candidateSummary: '同时查看2D和3D，比较更改影响与验证状态。', compare: '比较候选', select: '选择此候选',
      editTitle: '先预览更改', editSummary: '参数更改会同时在2D和3D中预览，确认前不会保存。', preview: '在2D和3D中预览',
      precisionTitle: '已准备发送至Precision CAD', precisionSummary: '精确几何和制造验证由Precision CAD执行。', precision: '请求Precision CAD', inspect: '查看验证依据',
      recoveryTitle: '安全恢复工作', refresh: '刷新服务器状态', resume: '继续',
    },
    previewDecision: { title: '概念更改预览', summary: '这是仅显示在2D和3D中的非持久预览。尚未执行几何、拓扑和制造验证。', apply: '应用到会话', discard: '放弃预览' },
  },
  es: {
    launcher: {
      title: '¿Qué le gustaría diseñar?', description: 'La primera solicitud queda vinculada a la revisión de este proyecto y de una nueva sesión de diseño. La siguiente pantalla sincroniza la selección 2D y 3D.',
      requestLabel: 'Solicitud de diseño', requestPlaceholder: 'Ejemplo: Diseña un soporte para sensor de 120 mm de ancho y pared de 3 mm.', creatingSession: 'Creando sesión…', startDesign: 'Iniciar diseño conversacional',
    },
    client: { confirmApply: '¿Aplicar esta solicitud a la revisión actual del servidor?', precisionRequested: 'Se aceptó la solicitud de Precision CAD. Aún no se han ejecutado la geometría exacta ni el resultado PASS.' },
    surface: {
      loading3d: 'Cargando vista conceptual 3D…', title: 'Espacio de diseño conversacional', conversationAria: 'Conversación de diseño', chat: 'Chat', refresh: 'Actualizar',
      authorityBoundary: 'Límite de autoridad', conceptOnly: 'Este espacio sirve para orquestar y previsualizar conceptos.', linkedCanvas: 'Lienzo vinculado', fullScreen: 'Pantalla completa',
      emptyCanvas: 'Las vistas vinculadas aparecen cuando hay una entrada o un candidato preparado.', inspector: 'Inspector', close: 'Cerrar', model: 'Modelo', gaugePreview: 'Vista previa del parámetro', validationPrecision: 'Validación · Precision',
    },
    starterCards: [
      { title: 'Describir una idea', description: 'Describa con palabras sencillas el producto o la forma que desea crear.', examplePrompt: 'Diseña un portaherramientas compacto de pared con tres ganchos.' },
      { title: 'Empezar con una referencia', description: 'Suba un plano 2D, una imagen, un boceto o un modelo 3D existente.', examplePrompt: 'Conserva la función principal de esta referencia y crea un concepto más sencillo y ligero.' },
    ],
    stages: {
      intake: { label: 'Añadir una idea o referencia', explanation: 'Explique qué debe diseñarse o adjunte una referencia.' },
      understanding: { label: 'Revisar la interpretación', explanation: 'Compruebe lo que interpretó la IA antes de crear candidatos.' },
      generation: { label: 'Continuar generando candidatos', explanation: 'Continúe la etapa actual y revise sus evidencias.' },
      candidates: { label: 'Elegir un concepto', explanation: 'Compare los conceptos generados y elija uno para perfeccionarlo.' },
      edit: { label: 'Previsualizar el cambio', explanation: 'Describa un cambio y revise el resultado 2D y 3D antes de aplicarlo.' },
      precision: { label: 'Solicitar Precision CAD', explanation: 'Envíe el concepto aprobado a Precision CAD para la geometría exacta y las comprobaciones de fabricación.' },
      recovery: { label: 'Recuperar desde el servidor', explanation: 'Actualice la revisión autoritativa del servidor antes de continuar.' },
    },
    boundary: { concept: 'AI Design solo crea y edita conceptos. La geometría exacta y las decisiones de fabricación corresponden a Precision CAD.', precision: 'Precision CAD controla la geometría exacta y las comprobaciones de fabricación. AI Design sigue siendo un asistente conceptual.' },
    cards: {
      intakeTitle: '¿Qué le gustaría diseñar?', intakeSummary: 'Descríbalo o añada un plano 2D, una imagen, un boceto o un modelo 3D existente.', add: 'Añadir entrada',
      questionTitle: 'Confirme este detalle', confirmTitle: 'Revisar la interpretación', confirm: 'Generar desde esta interpretación', answer: 'Responder',
      generatingTitle: 'Preparar candidatos de diseño', start: 'Generar candidatos', continue: 'Continuar generación', generationSummary: 'Siga el progreso y las razones de los cambios del modelo en la conversación.',
      candidateTitle: 'Comparar y elegir un candidato', candidateSummary: 'Revise 2D y 3D junto con el impacto del cambio y el estado de verificación.', compare: 'Comparar candidatos', select: 'Elegir este candidato',
      editTitle: 'Previsualizar primero el cambio', editSummary: 'Los cambios de parámetros se previsualizan en 2D y 3D y no se guardan antes de confirmarlos.', preview: 'Previsualizar en 2D y 3D',
      precisionTitle: 'Listo para Precision CAD', precisionSummary: 'Precision CAD controla la geometría exacta y la verificación de fabricación.', precision: 'Solicitar Precision CAD', inspect: 'Ver evidencia de verificación',
      recoveryTitle: 'Recuperar el trabajo con seguridad', refresh: 'Actualizar estado del servidor', resume: 'Reanudar',
    },
    previewDecision: { title: 'Vista previa del cambio conceptual', summary: 'Es una vista previa 2D/3D no persistente. No se ejecutaron verificaciones de geometría, topología ni fabricación.', apply: 'Aplicar a la sesión', discard: 'Descartar vista previa' },
  },
  ar: {
    launcher: {
      title: 'ما الذي تريد تصميمه؟', description: 'يرتبط الطلب الأول بمراجعة هذا المشروع وجلسة تصميم جديدة. تحافظ الشاشة التالية على تزامن التحديد ثنائي وثلاثي الأبعاد.',
      requestLabel: 'طلب التصميم', requestPlaceholder: 'مثال: صمّم حاملاً لمستشعر بعرض 120 مم وسماكة جدار 3 مم.', creatingSession: 'جارٍ إنشاء الجلسة…', startDesign: 'بدء التصميم الحواري',
    },
    client: { confirmApply: 'هل تريد تطبيق هذا الطلب على مراجعة الخادم الحالية؟', precisionRequested: 'تم قبول طلب Precision CAD. لم يتم بعد تنفيذ الهندسة الدقيقة أو إصدار نتيجة PASS.' },
    surface: {
      loading3d: 'جارٍ تحميل عرض المفهوم ثلاثي الأبعاد…', title: 'مساحة عمل التصميم الحواري', conversationAria: 'محادثة التصميم', chat: 'المحادثة', refresh: 'تحديث',
      authorityBoundary: 'حدود الصلاحية', conceptOnly: 'مساحة العمل هذه مخصصة لتنظيم المفاهيم ومعاينتها.', linkedCanvas: 'لوحة مترابطة', fullScreen: 'ملء الشاشة',
      emptyCanvas: 'تظهر العروض المترابطة عند تجهيز إدخال أو مرشح.', inspector: 'أداة الفحص', close: 'إغلاق', model: 'النموذج', gaugePreview: 'معاينة المعلمة', validationPrecision: 'التحقق · Precision',
    },
    starterCards: [
      { title: 'صف فكرة', description: 'صف المنتج أو الشكل المطلوب بلغة بسيطة.', examplePrompt: 'صمّم حاملاً صغيراً للأدوات يثبت على الحائط وله ثلاثة خطافات.' },
      { title: 'ابدأ من مرجع', description: 'ارفع رسماً ثنائي الأبعاد أو صورة أو مخططاً أو نموذجاً ثلاثي الأبعاد موجوداً.', examplePrompt: 'حافظ على الوظيفة الأساسية لهذا المرجع وأنشئ مفهوماً أبسط وأخف.' },
    ],
    stages: {
      intake: { label: 'إضافة فكرة أو مرجع', explanation: 'اشرح ما يجب تصميمه أو أرفق مرجعاً.' },
      understanding: { label: 'مراجعة الفهم', explanation: 'تحقق مما استنتجه الذكاء الاصطناعي قبل إنشاء المرشحين.' },
      generation: { label: 'متابعة إنشاء المرشحين', explanation: 'تابع مرحلة الإنشاء الحالية وراجع أدلتها.' },
      candidates: { label: 'اختيار مفهوم', explanation: 'قارن المفاهيم المنشأة واختر واحداً لتحسينه.' },
      edit: { label: 'معاينة التغيير', explanation: 'صف التغيير وراجع نتيجة 2D و3D قبل تطبيقه.' },
      precision: { label: 'طلب Precision CAD', explanation: 'أرسل المفهوم المعتمد إلى Precision CAD للهندسة الدقيقة وفحوص التصنيع.' },
      recovery: { label: 'الاستعادة من حالة الخادم', explanation: 'حدّث مراجعة الخادم المعتمدة قبل المتابعة.' },
    },
    boundary: { concept: 'ينشئ AI Design المفاهيم ويحررها فقط. تتبع الهندسة الدقيقة وقرارات التصنيع لنظام Precision CAD.', precision: 'يتولى Precision CAD الهندسة الدقيقة وفحوص التصنيع. ويبقى AI Design مساعداً للمفاهيم.' },
    cards: {
      intakeTitle: 'ما الذي تريد تصميمه؟', intakeSummary: 'صفه أو أضف رسماً ثنائي الأبعاد أو صورة أو مخططاً أو نموذجاً ثلاثي الأبعاد موجوداً.', add: 'إضافة إدخال',
      questionTitle: 'يرجى تأكيد هذا التفصيل', confirmTitle: 'مراجعة الفهم', confirm: 'إنشاء المرشحين وفق هذا الفهم', answer: 'إجابة',
      generatingTitle: 'إعداد مرشحي التصميم', start: 'إنشاء المرشحين', continue: 'متابعة الإنشاء', generationSummary: 'تابع التقدم وأسباب تغييرات النموذج في المحادثة.',
      candidateTitle: 'قارن مرشحاً واختره', candidateSummary: 'راجع العرضين 2D و3D مع أثر التغيير وحالة التحقق.', compare: 'مقارنة المرشحين', select: 'اختيار هذا المرشح',
      editTitle: 'عاين التغيير أولاً', editSummary: 'تظهر تغييرات المعلمات في 2D و3D ولا تحفظ قبل التأكيد.', preview: 'معاينة في 2D و3D',
      precisionTitle: 'جاهز لنظام Precision CAD', precisionSummary: 'يتولى Precision CAD الهندسة الدقيقة والتحقق من التصنيع.', precision: 'طلب Precision CAD', inspect: 'عرض دليل التحقق',
      recoveryTitle: 'استعادة العمل بأمان', refresh: 'تحديث حالة الخادم', resume: 'متابعة',
    },
    previewDecision: { title: 'معاينة تغيير المفهوم', summary: 'هذه معاينة غير دائمة ثنائية وثلاثية الأبعاد. لم يتم تشغيل التحقق من الهندسة أو الطوبولوجيا أو التصنيع.', apply: 'تطبيق على الجلسة', discard: 'تجاهل المعاينة' },
  },
};

export function getAiDesignWorkspaceCopy(locale: string | undefined | null): AiDesignWorkspaceCopy {
  return COPY[toIsoLang(locale)];
}

export function getAiDesignWorkspaceLocale(locale: string | undefined | null): IsoLang {
  return toIsoLang(locale);
}
