/** Extra ribbon / radial tooltips (6 locales). IDs match CommandToolbar `sk-*` or radial command ids. */

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export function resolveSketchLang(lang?: string): Lang {
  const s = lang === 'kr' ? 'ko' : lang ?? 'en';
  if (s === 'ko' || s === 'ja' || s === 'zh' || s === 'es' || s === 'ar') return s;
  return 'en';
}

const RIBBON: Record<Lang, Partial<Record<string, string>>> = {
  en: {
    'sk-line': 'Right-click: marking menu · Sketch tab',
    'sk-arc': 'Right-click: marking menu · Sketch tab',
    'sk-circle': 'Right-click: marking menu · Sketch tab',
    'sk-rect': 'Right-click: marking menu · Sketch tab',
    'sk-polygon': 'Right-click: marking menu · Sketch tab',
    'sk-offset': 'Pick segment, then distance',
    'sk-trim': 'Click segments to trim',
    'sk-constraint': 'Choose constraint type in submenu',
    'sk-dim': 'Smart dimension on geometry',
    'sk-inspect-measure': 'Measure distance in 3D viewport',
    'sk-insert': 'Sketch mode: reference picker · otherwise part import',
    'sk-select-filter': 'Click to cycle: all · edges only · vertices only',
  },
  ko: {
    'sk-line': '우클릭: 마킹 메뉴 · 스케치 탭',
    'sk-arc': '우클릭: 마킹 메뉴 · 스케치 탭',
    'sk-circle': '우클릭: 마킹 메뉴 · 스케치 탭',
    'sk-rect': '우클릭: 마킹 메뉴 · 스케치 탭',
    'sk-polygon': '우클릭: 마킹 메뉴 · 스케치 탭',
    'sk-offset': '세그먼트 선택 후 거리',
    'sk-trim': '트림할 세그먼트 클릭',
    'sk-constraint': '하위 메뉴에서 구속 유형',
    'sk-dim': '형상에 스마트 치수',
    'sk-inspect-measure': '3D 뷰포트 거리 측정',
    'sk-insert': '스케치: 참조 파일 · 아니면 부품 가져오기',
    'sk-select-filter': '클릭: 전체 → 선분만 → 점만 순환',
  },
  ja: {
    'sk-line': '右クリック: マーキング · スケッチタブ',
    'sk-arc': '右クリック: マーキング · スケッチタブ',
    'sk-circle': '右クリック: マーキング · スケッチタブ',
    'sk-rect': '右クリック: マーキング · スケッチタブ',
    'sk-polygon': '右クリック: マーキング · スケッチタブ',
    'sk-offset': 'セグメント選択後に距離',
    'sk-trim': 'トリムするセグメントをクリック',
    'sk-constraint': 'サブメニューで拘束タイプ',
    'sk-dim': 'スマート寸法',
    'sk-inspect-measure': '3Dビューで測定',
    'sk-insert': 'スケッチ時は参照ファイル、それ以外はパート取り込み',
    'sk-select-filter': 'クリックで すべて→辺のみ→頂点のみ',
  },
  zh: {
    'sk-line': '右键: 标记菜单 · 草图选项卡',
    'sk-arc': '右键: 标记菜单 · 草图选项卡',
    'sk-circle': '右键: 标记菜单 · 草图选项卡',
    'sk-rect': '右键: 标记菜单 · 草图选项卡',
    'sk-polygon': '右键: 标记菜单 · 草图选项卡',
    'sk-offset': '选段后输入距离',
    'sk-trim': '点击要修剪的段',
    'sk-constraint': '子菜单选择约束',
    'sk-dim': '智能尺寸',
    'sk-inspect-measure': '在 3D 视口测量',
    'sk-insert': '草图：参考文件 · 否则为零件导入',
    'sk-select-filter': '单击循环：全部 · 仅边 · 仅顶点',
  },
  es: {
    'sk-line': 'Clic derecho: menú radial · pestaña Sketch',
    'sk-arc': 'Clic derecho: menú radial · pestaña Sketch',
    'sk-circle': 'Clic derecho: menú radial · pestaña Sketch',
    'sk-rect': 'Clic derecho: menú radial · pestaña Sketch',
    'sk-polygon': 'Clic derecho: menú radial · pestaña Sketch',
    'sk-offset': 'Segmento y distancia',
    'sk-trim': 'Clic para recortar',
    'sk-constraint': 'Tipo en submenú',
    'sk-dim': 'Cota inteligente',
    'sk-inspect-measure': 'Medir en vista 3D',
    'sk-insert': 'Boceto: referencia · si no, importar pieza',
    'sk-select-filter': 'Clic: todo → solo aristas → solo vértices',
  },
  ar: {
    'sk-line': 'زر أيمن: قائمة دائرية · تبويب الرسم',
    'sk-arc': 'زر أيمن: قائمة دائرية · تبويب الرسم',
    'sk-circle': 'زر أيمن: قائمة دائرية · تبويب الرسم',
    'sk-rect': 'زر أيمن: قائمة دائرية · تبويب الرسم',
    'sk-polygon': 'زر أيمن: قائمة دائرية · تبويب الرسم',
    'sk-offset': 'اختر قطعة ثم المسافة',
    'sk-trim': 'انقر للقص',
    'sk-constraint': 'نوع القيد من القائمة',
    'sk-dim': 'بعد ذكي',
    'sk-inspect-measure': 'قياس في العرض ثلاثي الأبعاد',
    'sk-insert': 'رسم: ملف مرجع · وإلا استيراد جزء',
    'sk-select-filter': 'نقرة للتبديل: الكل · حواف فقط · رؤوس فقط',
  },
};

const RADIAL: Record<Lang, Partial<Record<string, string>>> = {
  en: {
    'finish-sketch': 'Generate extrusion / exit',
    'cancel-sketch': 'Discard sketch session',
    'sketch-undo': 'Ctrl+Z also works',
    'sketch-tool-line': 'Same as ribbon Line',
    'sketch-tool-circle': 'Same as ribbon Circle',
    'sketch-tool-rect': 'Same as ribbon Rectangle',
    'sketch-tool-trim': 'Trim segments',
    'measure': '3D measure toggle',
    'sketch-tool-offset': 'Offset segment',
    'sketch-tool-polygon': 'Regular polygon',
    'sketch-radial-dimension': 'Dimension tool + overlay',
    'sketch-clear': 'Clear profile',
    'sketch-insert-canvas': 'Tracing image underlay',
    'sketch-toggle-slice': 'Links to 3D section when body exists',
  },
  ko: {
    'finish-sketch': '돌출 생성 / 종료',
    'cancel-sketch': '스케치 세션 취소',
    'sketch-undo': 'Ctrl+Z 동일',
    'sketch-tool-line': '리본 선과 동일',
    'sketch-tool-circle': '리본 원과 동일',
    'sketch-tool-rect': '리본 사각형과 동일',
    'sketch-tool-trim': '세그먼트 트림',
    'measure': '3D 측정 토글',
    'sketch-tool-offset': '세그먼트 오프셋',
    'sketch-tool-polygon': '정다각형',
    'sketch-radial-dimension': '치수 도구 + 오버레이',
    'sketch-clear': '프로파일 비우기',
    'sketch-insert-canvas': '참조 이미지 언더레이',
    'sketch-toggle-slice': '본 있으면 3D 단면과 연동',
  },
  ja: {
    'finish-sketch': '押し出して終了',
    'cancel-sketch': 'スケッチを破棄',
    'sketch-undo': 'Ctrl+Z 可',
    'sketch-tool-line': 'リボンの線と同じ',
    'sketch-tool-circle': 'リボンの円と同じ',
    'sketch-tool-rect': 'リボンの矩形と同じ',
    'sketch-tool-trim': 'トリム',
    'measure': '3D 測定',
    'sketch-tool-offset': 'オフセット',
    'sketch-tool-polygon': '正多角形',
    'sketch-radial-dimension': '寸法ツール',
    'sketch-clear': 'プロファイル消去',
    'sketch-insert-canvas': '参照画像',
    'sketch-toggle-slice': '3D 断面と連動',
  },
  zh: {
    'finish-sketch': '拉伸并退出',
    'cancel-sketch': '放弃草图',
    'sketch-undo': '可用 Ctrl+Z',
    'sketch-tool-line': '同功能区直线',
    'sketch-tool-circle': '同功能区圆',
    'sketch-tool-rect': '同功能区矩形',
    'sketch-tool-trim': '修剪',
    'measure': '三维测量',
    'sketch-tool-offset': '偏移',
    'sketch-tool-polygon': '正多边形',
    'sketch-radial-dimension': '尺寸工具',
    'sketch-clear': '清空轮廓',
    'sketch-insert-canvas': '参考图',
    'sketch-toggle-slice': '与三维剖切联动',
  },
  es: {
    'finish-sketch': 'Extruir y salir',
    'cancel-sketch': 'Descartar boceto',
    'sketch-undo': 'También Ctrl+Z',
    'sketch-tool-line': 'Igual que Línea en cinta',
    'sketch-tool-circle': 'Igual que Círculo',
    'sketch-tool-rect': 'Igual que Rectángulo',
    'sketch-tool-trim': 'Recortar',
    'measure': 'Medir 3D',
    'sketch-tool-offset': 'Desfase',
    'sketch-tool-polygon': 'Polígono regular',
    'sketch-radial-dimension': 'Cota',
    'sketch-clear': 'Vaciar perfil',
    'sketch-insert-canvas': 'Imagen de referencia',
    'sketch-toggle-slice': 'Vincula a sección 3D',
  },
  ar: {
    'finish-sketch': 'بثق وخروج',
    'cancel-sketch': 'إلغاء الجلسة',
    'sketch-undo': 'Ctrl+Z',
    'sketch-tool-line': 'مثل الخط في الشريط',
    'sketch-tool-circle': 'مثل الدائرة',
    'sketch-tool-rect': 'مثل المستطيل',
    'sketch-tool-trim': 'قص',
    'measure': 'قياس 3D',
    'sketch-tool-offset': 'إزاحة',
    'sketch-tool-polygon': 'مضلع منتظم',
    'sketch-radial-dimension': 'بعد',
    'sketch-clear': 'مسح الملف',
    'sketch-insert-canvas': 'صورة مرجعية',
    'sketch-toggle-slice': 'يربط بمقطع 3D',
  },
};

/** Full title for ribbon button: "Label — hint" */
export function sketchRibbonFullTitle(lang: string | undefined, toolId: string, label: string): string {
  const L = resolveSketchLang(lang);
  const h = RIBBON[L][toolId] ?? RIBBON.en[toolId];
  return h ? `${label} — ${h}` : label;
}

/** Extra line for radial menu native tooltip */
export function radialCommandTitle(lang: string | undefined, commandId: string, label: string): string {
  const L = resolveSketchLang(lang);
  const h = RADIAL[L][commandId] ?? RADIAL.en[commandId];
  return h ? `${label} — ${h}` : label;
}
