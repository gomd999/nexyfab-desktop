import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type SixLanguageText = Record<IsoLang, string>;

const six = (ko: string, en: string, ja: string, zh: string, es: string, ar: string): SixLanguageText => ({
  ko, en, ja, zh, es, ar,
});

const CHROME = {
  untitledFile: six('무제.nxpart', 'Untitled.nxpart', '無題.nxpart', '未命名.nxpart', 'SinTitulo.nxpart', 'بدون عنوان.nxpart'),
  searchCommands: six('명령과 기능 검색…', 'Search commands and features…', 'コマンドと機能を検索…', '搜索命令和功能…', 'Buscar comandos y funciones…', 'البحث في الأوامر والميزات…'),
  share: six('공유', 'Share', '共有', '共享', 'Compartir', 'مشاركة'),
  publish: six('게시', 'Publish', '公開', '发布', 'Publicar', 'نشر'),
  hub: six('허브', 'Hub', 'ハブ', '中心', 'Inicio', 'المركز'),
  new: six('새로 만들기', 'New', '新規作成', '新建', 'Nuevo', 'جديد'),
  open: six('열기', 'Open', '開く', '打开', 'Abrir', 'فتح'),
  save: six('저장', 'Save', '保存', '保存', 'Guardar', 'حفظ'),
  undo: six('실행 취소', 'Undo', '元に戻す', '撤销', 'Deshacer', 'تراجع'),
  redo: six('다시 실행', 'Redo', 'やり直す', '重做', 'Rehacer', 'إعادة'),
  exit: six('나가기', 'Exit', '終了', '退出', 'Salir', 'خروج'),
  fullscreen: six('전체 화면', 'Fullscreen', '全画面', '全屏', 'Pantalla completa', 'ملء الشاشة'),
  exitFullscreen: six('전체 화면 종료', 'Exit fullscreen', '全画面を終了', '退出全屏', 'Salir de pantalla completa', 'الخروج من ملء الشاشة'),
  browserPanelWidth: six('브라우저 패널 너비', 'Browser panel width', 'ブラウザーパネルの幅', '浏览器面板宽度', 'Ancho del panel del navegador', 'عرض لوحة المتصفح'),
  inspectorPanelWidth: six('검사기 패널 너비', 'Inspector panel width', 'インスペクターパネルの幅', '检查器面板宽度', 'Ancho del panel del inspector', 'عرض لوحة الخصائص'),
  resizePanel: six('끌어서 크기 조절 · 화살표 키로 조정 · 두 번 클릭하여 초기화', 'Drag to resize · Arrow keys adjust · Double-click to reset', 'ドラッグでサイズ変更 · 矢印キーで調整 · ダブルクリックでリセット', '拖动调整大小 · 方向键微调 · 双击重置', 'Arrastra para cambiar el tamaño · Ajusta con las flechas · Doble clic para restablecer', 'اسحب لتغيير الحجم · عدّل بمفاتيح الأسهم · انقر مرتين لإعادة الضبط'),
  expandLeftPanel: six('왼쪽 패널 펼치기', 'Expand left panel', '左パネルを展開', '展开左侧面板', 'Expandir panel izquierdo', 'توسيع اللوحة اليسرى'),
  collapseLeftPanel: six('왼쪽 패널 접기', 'Collapse left panel', '左パネルを折りたたむ', '折叠左侧面板', 'Contraer panel izquierdo', 'طي اللوحة اليسرى'),
  expandRightPanel: six('오른쪽 패널 펼치기', 'Expand right panel', '右パネルを展開', '展开右侧面板', 'Expandir panel derecho', 'توسيع اللوحة اليمنى'),
  collapseRightPanel: six('오른쪽 패널 접기', 'Collapse right panel', '右パネルを折りたたむ', '折叠右侧面板', 'Contraer panel derecho', 'طي اللوحة اليمنى'),
  expand: six('펼치기', 'Expand', '展開', '展开', 'Expandir', 'توسيع'),
  collapse: six('접기', 'Collapse', '折りたたむ', '折叠', 'Contraer', 'طي'),
  closeDrawer: six('서랍 닫기', 'Close drawer', 'ドロワーを閉じる', '关闭抽屉', 'Cerrar panel', 'إغلاق الدرج'),
  dismiss: six('닫기', 'Dismiss', '閉じる', '关闭', 'Descartar', 'إغلاق'),
  workspaceTruth: six('작업공간 기능 및 검증 상태', 'Workspace capability and verification status', 'ワークスペースの機能と検証状態', '工作区功能和验证状态', 'Capacidad y estado de verificación del espacio de trabajo', 'قدرات مساحة العمل وحالة التحقق'),
  spatialBrowserPanelWidth: six('공간 브라우저 패널 너비', 'Spatial browser panel width', '空間ブラウザーパネルの幅', '空间浏览器面板宽度', 'Ancho del panel del navegador espacial', 'عرض لوحة متصفح المساحة'),
  spatialInspectorPanelWidth: six('공간 검사기 패널 너비', 'Spatial inspector panel width', '空間インスペクターパネルの幅', '空间检查器面板宽度', 'Ancho del panel del inspector espacial', 'عرض لوحة خصائص المساحة'),
  more: six('더 보기', 'More', 'その他', '更多', 'Más', 'المزيد'),
  less: six('간단히', 'Less', '少なく表示', '收起', 'Menos', 'أقل'),
  essentials: six('필수 도구', 'Essentials', '基本ツール', '基本工具', 'Herramientas esenciales', 'الأدوات الأساسية'),
  allTools: six('모든 도구', 'All tools', 'すべてのツール', '所有工具', 'Todas las herramientas', 'كل الأدوات'),
  projects: six('프로젝트', 'Projects', 'プロジェクト', '项目', 'Proyectos', 'المشاريع'),
  drawing: six('도면', 'Drawing', '図面', '工程图', 'Plano', 'الرسم'),
  renderStudio: six('렌더 스튜디오', 'Render Studio', 'レンダースタジオ', '渲染工作室', 'Estudio de render', 'استوديو التصيير'),
  spaceDesignLabs: six('공간 설계 연구소', 'Space Design Labs', '空間設計ラボ', '空间设计实验室', 'Laboratorio de diseño espacial', 'مختبر تصميم المساحات'),
  concept: six('콘셉트', 'concept', 'コンセプト', '概念', 'concepto', 'مفهوم'),
  preview: six('미리보기', 'PREVIEW', 'プレビュー', '预览', 'VISTA PREVIA', 'معاينة'),
  coordination: six('통합 조정', 'Coordination', '統合調整', '综合协调', 'Coordinación', 'التنسيق'),
  jobs: six('작업', 'Jobs', 'ジョブ', '任务', 'Trabajos', 'المهام'),
  verify: six('검증', 'Verify', '検証', '验证', 'Verificar', 'تحقق'),
} satisfies Record<string, SixLanguageText>;

const GROUPS: Record<string, SixLanguageText> = {
  Sketch: six('스케치', 'Sketch', 'スケッチ', '草图', 'Croquis', 'رسم تخطيطي'),
  Create: six('생성', 'Create', '作成', '创建', 'Crear', 'إنشاء'),
  Modify: six('수정', 'Modify', '修正', '修改', 'Modificar', 'تعديل'),
  Pattern: six('패턴', 'Pattern', 'パターン', '阵列', 'Patrón', 'نمط'),
  Inspect: six('검사', 'Inspect', '検査', '检查', 'Inspeccionar', 'فحص'),
  'Nexy AI': six('Nexy AI', 'Nexy AI', 'Nexy AI', 'Nexy AI', 'Nexy AI', 'Nexy AI'),
  OpenSCAD: six('OpenSCAD', 'OpenSCAD', 'OpenSCAD', 'OpenSCAD', 'OpenSCAD', 'OpenSCAD'),
  Draw: six('그리기', 'Draw', '作図', '绘制', 'Dibujar', 'رسم'),
  Constrain: six('구속', 'Constrain', '拘束', '约束', 'Restringir', 'تقييد'),
  Project: six('투영', 'Project', '投影', '投影', 'Proyectar', 'إسقاط'),
  Body: six('바디', 'Body', 'ボディ', '实体', 'Cuerpo', 'جسم'),
  Finish: six('완료', 'Finish', '完了', '完成', 'Finalizar', 'إنهاء'),
  Components: six('부품', 'Components', 'コンポーネント', '组件', 'Componentes', 'المكونات'),
  Mate: six('메이트', 'Mate', '合致', '配合', 'Relaciones', 'العلاقات'),
  'Solve & Motion': six('해석 및 모션', 'Solve & Motion', '解析とモーション', '求解与运动', 'Resolver y movimiento', 'الحل والحركة'),
  BOM: six('BOM', 'BOM', 'BOM', 'BOM', 'BOM', 'BOM'),
  Sheet: six('시트', 'Sheet', 'シート', '图纸', 'Hoja', 'ورقة'),
  Output: six('출력', 'Output', '出力', '输出', 'Salida', 'الإخراج'),
  Bend: six('굽힘', 'Bend', '曲げ', '折弯', 'Doblar', 'ثني'),
  Form: six('성형', 'Form', '成形', '成形', 'Formar', 'تشكيل'),
  'Flat Pattern': six('전개도', 'Flat Pattern', '展開図', '展开图', 'Patrón plano', 'النمط المسطح'),
};

const TABS: Record<string, SixLanguageText> = {
  file: six('파일', 'File', 'ファイル', '文件', 'Archivo', 'ملف'),
  solid: six('솔리드', 'Solid', 'ソリッド', '实体', 'Sólido', 'مجسم'),
  assembly: six('어셈블리', 'Assembly', 'アセンブリ', '装配', 'Ensamblaje', 'تجميع'),
  sheetmetal: six('판금', 'Sheet Metal', '板金', '钣金', 'Chapa metálica', 'صفائح معدنية'),
  drawing: six('도면', 'Drawing', '図面', '工程图', 'Plano', 'رسم'),
  inspect: six('검사', 'Inspect', '検査', '检查', 'Inspeccionar', 'فحص'),
  render: six('렌더', 'Render', 'レンダー', '渲染', 'Render', 'تصيير'),
  view: six('보기', 'View', '表示', '视图', 'Vista', 'عرض'),
  'sketch.draw': six('그리기', 'Draw', '作図', '绘制', 'Dibujar', 'رسم'),
  'sketch.constrain': six('구속', 'Constrain', '拘束', '约束', 'Restringir', 'تقييد'),
  'sketch.finish': six('완료', 'Finish', '完了', '完成', 'Finalizar', 'إنهاء'),
};

const ACTIONS: Record<string, SixLanguageText> = {
  sketch: six('스케치 생성', 'Create Sketch', 'スケッチを作成', '创建草图', 'Crear croquis', 'إنشاء رسم تخطيطي'),
  'sketch.line': six('선', 'Line', '線', '直线', 'Línea', 'خط'),
  'sketch.rect': six('사각형', 'Rectangle', '長方形', '矩形', 'Rectángulo', 'مستطيل'),
  'sketch.circle': six('원', 'Circle', '円', '圆', 'Círculo', 'دائرة'),
  extrude: six('돌출', 'Extrude', '押し出し', '拉伸', 'Extruir', 'بثق'),
  revolve: six('회전', 'Revolve', '回転', '旋转', 'Revolución', 'دوران'),
  sweep: six('스윕', 'Sweep', 'スイープ', '扫掠', 'Barrido', 'سحب'),
  loft: six('로프트', 'Loft', 'ロフト', '放样', 'Recubrir', 'وصل المقاطع'),
  hole: six('구멍', 'Hole', '穴', '孔', 'Taladro', 'ثقب'),
  fillet: six('필렛', 'Fillet', 'フィレット', '圆角', 'Redondeo', 'تدوير الحافة'),
  variableFillet: six('가변 필렛', 'Variable Fillet', '可変フィレット', '可变圆角', 'Redondeo variable', 'تدوير متغير'),
  chamfer: six('모따기', 'Chamfer', '面取り', '倒角', 'Chaflán', 'شطف'),
  shell: six('쉘', 'Shell', 'シェル', '抽壳', 'Vaciado', 'تفريغ'),
  draft: six('구배', 'Draft', 'ドラフト', '拔模', 'Ángulo de salida', 'ميل الصب'),
  'push-pull': six('밀기/당기기', 'Push/Pull', 'プッシュ/プル', '推/拉', 'Empujar/Tirar', 'دفع/سحب'),
  'direct.delete-face': six('면 삭제', 'Delete Face', '面を削除', '删除面', 'Eliminar cara', 'حذف الوجه'),
  'direct.offset-face': six('면 오프셋', 'Offset Face', '面をオフセット', '偏移面', 'Desfase de cara', 'إزاحة الوجه'),
  'pattern.linear': six('선형 패턴', 'Linear Pattern', '直線パターン', '线性阵列', 'Patrón lineal', 'نمط خطي'),
  mirror: six('대칭', 'Mirror', 'ミラー', '镜像', 'Simetría', 'انعكاس'),
  combine: six('결합', 'Combine', '結合', '组合', 'Combinar', 'دمج'),
  measure: six('측정', 'Measure', '計測', '测量', 'Medir', 'قياس'),
  section: six('단면 보기', 'Section View', '断面表示', '剖面视图', 'Vista de sección', 'عرض مقطعي'),
  'mass-props': six('물성치', 'Mass Properties', '質量特性', '质量属性', 'Propiedades de masa', 'خصائص الكتلة'),
  interference: six('간섭', 'Interference', '干渉', '干涉', 'Interferencia', 'تداخل'),
  'ai.suggest': six('제안', 'Suggest', '提案', '建议', 'Sugerir', 'اقتراح'),
  'ai.lighten': six('30% 경량화', 'Lighten −30%', '30% 軽量化', '减重 30%', 'Aligerar un 30%', 'تخفيف 30%'),
  'ai.ribs': six('리브 추가', 'Add Ribs', 'リブを追加', '添加加强筋', 'Añadir nervios', 'إضافة أضلاع'),
  'ai.fillet': six('자동 필렛', 'Auto-fillet', '自動フィレット', '自动圆角', 'Redondeo automático', 'تدوير تلقائي'),
  'view.scad': six('SCAD 보기', 'View SCAD', 'SCAD を表示', '查看 SCAD', 'Ver SCAD', 'عرض SCAD'),
  'sketch.arc': six('호', 'Arc', '円弧', '圆弧', 'Arco', 'قوس'),
  'sketch.poly': six('다각형', 'Polygon', '多角形', '多边形', 'Polígono', 'مضلع'),
  'sketch.spline': six('스플라인', 'Spline', 'スプライン', '样条曲线', 'Spline', 'منحنى سلس'),
  'sketch.trim': six('자르기', 'Trim', 'トリム', '修剪', 'Recortar', 'تشذيب'),
  'sketch.offset': six('오프셋', 'Offset', 'オフセット', '偏移', 'Desfase', 'إزاحة'),
  'sketch.mirror': six('대칭', 'Mirror', 'ミラー', '镜像', 'Simetría', 'انعكاس'),
  'sketch.dim': six('치수', 'Dimension', '寸法', '尺寸', 'Cota', 'بُعد'),
  'sketch.constraint': six('구속조건', 'Constraint', '拘束', '约束', 'Restricción', 'قيد'),
  'sketch.project': six('형상 투영', 'Project Geometry', 'ジオメトリを投影', '投影几何体', 'Proyectar geometría', 'إسقاط الهندسة'),
  'sketch.extrude-active': six('바디 생성 후 계속', 'Create Body & Continue', 'ボディを作成して続行', '创建实体并继续', 'Crear cuerpo y continuar', 'إنشاء جسم والمتابعة'),
  'sketch.revolve': six('회전', 'Revolve', '回転', '旋转', 'Revolución', 'دوران'),
  'sketch.sweep-path': six('스윕 경로', 'Sweep Path', 'スイープパス', '扫掠路径', 'Trayectoria de barrido', 'مسار السحب'),
  'sketch.finish': six('스케치 완료', 'Finish Sketch', 'スケッチを終了', '完成草图', 'Finalizar croquis', 'إنهاء الرسم التخطيطي'),
  'asm.insert': six('삽입', 'Insert', '挿入', '插入', 'Insertar', 'إدراج'),
  'mate.coincident': six('일치', 'Coincident', '一致', '重合', 'Coincidente', 'متطابق'),
  'mate.concentric': six('동심', 'Concentric', '同心', '同心', 'Concéntrico', 'متحد المركز'),
  'mate.distance': six('거리', 'Distance', '距離', '距离', 'Distancia', 'مسافة'),
  'mate.angle': six('각도', 'Angle', '角度', '角度', 'Ángulo', 'زاوية'),
  'mate.hinge': six('힌지', 'Hinge', 'ヒンジ', '铰链', 'Bisagra', 'مفصلة'),
  'mate.gear': six('기어', 'Gear', 'ギア', '齿轮', 'Engranaje', 'ترس'),
  'mate.limitDistance': six('한계', 'Limit', '制限', '限位', 'Límite', 'حد'),
  'mate.width': six('너비', 'Width', '幅', '宽度', 'Anchura', 'عرض'),
  'asm.solve': six('해석', 'Solve', '解析', '求解', 'Resolver', 'حل'),
  'motion.drive': six('구동', 'Drive', '駆動', '驱动', 'Accionar', 'تشغيل'),
  'asm.interference': six('간섭', 'Interference', '干渉', '干涉', 'Interferencia', 'تداخل'),
  'bom.show': six('BOM', 'BOM', 'BOM', 'BOM', 'BOM', 'BOM'),
  'bom.export': six('내보내기', 'Export', '書き出し', '导出', 'Exportar', 'تصدير'),
  'sheet.new': six('새 시트', 'New Sheet', '新規シート', '新建图纸', 'Nueva hoja', 'ورقة جديدة'),
  'output.pdf': six('PDF', 'PDF', 'PDF', 'PDF', 'PDF', 'PDF'),
  'output.dxf': six('DXF', 'DXF', 'DXF', 'DXF', 'DXF', 'DXF'),
  'output.print': six('인쇄', 'Print', '印刷', '打印', 'Imprimir', 'طباعة'),
  'render.final': six('최종 · 4K', 'Final · 4K', '最終 · 4K', '最终 · 4K', 'Final · 4K', 'نهائي · 4K'),
  'sm.edge-flange': six('에지 플랜지', 'Edge Flange', 'エッジフランジ', '边线法兰', 'Pestaña de arista', 'شفة حافة'),
  'sm.miter-flange': six('마이터 플랜지', 'Miter Flange', 'マイターフランジ', '斜接法兰', 'Pestaña a inglete', 'شفة مائلة'),
  'sm.bend': six('굽힘', 'Bend', '曲げ', '折弯', 'Doblar', 'ثني'),
  'sm.unbend': six('굽힘 해제', 'Unbend', '曲げ解除', '展开折弯', 'Desdoblar', 'فك الثني'),
  'sm.tab': six('탭', 'Tab', 'タブ', '凸缘', 'Pestaña', 'لسان'),
  'sm.cut': six('절단', 'Cut', 'カット', '切除', 'Cortar', 'قطع'),
  'sm.hem': six('헤밍', 'Hem', 'ヘム', '卷边', 'Dobladillo', 'ثنية طرفية'),
  'sm.corner-relief': six('코너 릴리프', 'Corner Relief', 'コーナーリリーフ', '拐角释放槽', 'Alivio de esquina', 'تفريغ الزاوية'),
  'sm.bend-relief': six('굽힘 릴리프', 'Bend Relief', '曲げリリーフ', '折弯释放槽', 'Alivio de pliegue', 'تفريغ الثني'),
  'sm.flatten': six('전개', 'Flatten', '展開', '展平', 'Aplanar', 'تسطيح'),
  'sm.export-dxf': six('DXF 내보내기', 'Export DXF', 'DXF 書き出し', '导出 DXF', 'Exportar DXF', 'تصدير DXF'),
};

export type ShellChromeKey = keyof typeof CHROME;

export function shellChromeText(lang: string | undefined | null, key: ShellChromeKey): string {
  return CHROME[key][toIsoLang(lang)];
}

export function localizeRibbonGroup(title: string, lang: string | undefined | null): string {
  return GROUPS[title]?.[toIsoLang(lang)] ?? title;
}

export function localizeRibbonAction(id: string, fallback: string, lang: string | undefined | null): string {
  return ACTIONS[id]?.[toIsoLang(lang)] ?? fallback;
}

export function localizeRibbonTabs<T extends { id: string; label: string }>(tabs: readonly T[], lang: string | undefined | null): T[] {
  const locale = toIsoLang(lang);
  return tabs.map(tab => ({ ...tab, label: TABS[tab.id]?.[locale] ?? tab.label }));
}

export const SHELL_CHROME_LOCALES: readonly IsoLang[] = ['ko', 'en', 'ja', 'zh', 'es', 'ar'];
