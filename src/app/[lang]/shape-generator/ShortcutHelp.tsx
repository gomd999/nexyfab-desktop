'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { shapeDict } from './shapeDict';
import {
  loadCustomShortcuts,
  saveCustomShortcuts,
  DEFAULT_SHORTCUTS,
} from './shortcutConfig';
import { CAD_WORKSPACE_ORDER } from './cadWorkspace/cadWorkspaceIds';
import { CAD_WORKSPACE_LABELS } from './constants/labels';

const dict = {
  ko: {
    titleHeader: '키보드 단축키',
    btnResetAll: '초기화',
    btnSave: '저장',
    btnCancel: '취소',
    btnCustomize: '단축키 편집',
    editModeHint: '🖊 편집 모드: 변경할 키 버튼 클릭 후 새 키를 누르세요',
    captureTooltip: '클릭 후 새 키를 누르세요',
    customBadge: '● 사용자 지정',
    footer: 'Esc 또는 바깥 클릭으로 닫기 · ? 키로 언제든지 열기',
    // Categories
    catGeneral: '일반',
    catViewport: '3D 뷰포트',
    catSketchMode: '스케치 모드',
    catSketchTools: '스케치 도구 (스케치 모드에서만)',
    catWorkspace: '작업공간 (리본)',
    // General
    actUndo: '실행 취소',
    actRedo: '다시 실행',
    actSave: '저장 (.nfab)',
    actSaveCloud: '클라우드 저장',
    actOpen: '열기 (.nfab)',
    actCmdPalette: '커맨드 팔레트',
    actCancel: '취소 / 닫기',
    actShowHelp: '단축키 도움말',
    // Viewport
    actTranslate: '이동 기즈모',
    actRotate: '회전 기즈모',
    actScale: '스케일 기즈모',
    actViewFit: '카메라 맞추기',
    actMeasure: '측정 토글',
    actMeasureEsc: '측정 중: Esc로 클릭 취소 → 다시 Esc로 측정 끄기',
    actDims: '치수 토글',
    actPerf: '성능 모니터',
    actVFront: '정면 뷰',
    actVTop: '상단 뷰',
    actVRight: '우측 뷰',
    actVIso: '등각 뷰',
    actVVertex: '버텍스 편집',
    actVEdge: '에지 편집',
    actVFace: '페이스 편집',
    // Sketch
    actSketch: '스케치 모드 전환',
    actSkLine: '선',
    actSkArc: '호',
    actSkCircle: '원',
    actSkRect: '직사각형',
    actSkPolygon: '다각형',
    actSkEllipse: '타원',
    actSkSlot: '슬롯',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: '오프셋',
    actSkTrim: '트림',
    actSkSelect: '선택',
    actSkDimension: '치수',
    actSkConstruction: '보조선',
  },
  en: {
    titleHeader: 'Keyboard Shortcuts',
    btnResetAll: 'Reset all',
    btnSave: 'Save',
    btnCancel: 'Cancel',
    btnCustomize: 'Customize',
    editModeHint: '🖊 Edit mode: click a key badge, then press the new key',
    captureTooltip: 'Click then press a new key',
    customBadge: '● custom',
    footer: 'Esc or click outside to close · press ? anytime to open',
    catGeneral: 'General',
    catViewport: '3D Viewport',
    catSketchMode: 'Sketch Mode',
    catSketchTools: 'Sketch Tools (sketch mode only)',
    catWorkspace: 'Workspace (ribbon)',
    actUndo: 'Undo',
    actRedo: 'Redo',
    actSave: 'Save (.nfab)',
    actSaveCloud: 'Cloud save',
    actOpen: 'Open (.nfab)',
    actCmdPalette: 'Command palette',
    actCancel: 'Cancel / Close',
    actShowHelp: 'Shortcut help',
    actTranslate: 'Translate gizmo',
    actRotate: 'Rotate gizmo',
    actScale: 'Scale gizmo',
    actViewFit: 'Fit to view',
    actMeasure: 'Toggle measure',
    actMeasureEsc: 'Measure on: Esc clears clicks, Esc again exits',
    actDims: 'Toggle dimensions',
    actPerf: 'Performance monitor',
    actVFront: 'Front view',
    actVTop: 'Top view',
    actVRight: 'Right view',
    actVIso: 'Isometric',
    actVVertex: 'Vertex edit mode',
    actVEdge: 'Edge edit mode',
    actVFace: 'Face edit mode',
    actSketch: 'Toggle sketch mode',
    actSkLine: 'Line',
    actSkArc: 'Arc',
    actSkCircle: 'Circle',
    actSkRect: 'Rectangle',
    actSkPolygon: 'Polygon',
    actSkEllipse: 'Ellipse',
    actSkSlot: 'Slot',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: 'Offset',
    actSkTrim: 'Trim',
    actSkSelect: 'Select',
    actSkDimension: 'Dimension',
    actSkConstruction: 'Construction',
  },
  ja: {
    titleHeader: 'キーボードショートカット',
    btnResetAll: 'すべてリセット',
    btnSave: '保存',
    btnCancel: 'キャンセル',
    btnCustomize: 'カスタマイズ',
    editModeHint: '🖊 編集モード: キーバッジをクリックして新しいキーを押してください',
    captureTooltip: 'クリックして新しいキーを押してください',
    customBadge: '● カスタム',
    footer: 'Escまたは外側クリックで閉じる · ?キーでいつでも開く',
    catGeneral: '一般',
    catViewport: '3Dビューポート',
    catSketchMode: 'スケッチモード',
    catSketchTools: 'スケッチツール(スケッチモードのみ)',
    catWorkspace: 'ワークスペース（リボン）',
    actUndo: '元に戻す',
    actRedo: 'やり直す',
    actSave: '保存 (.nfab)',
    actSaveCloud: 'クラウド保存',
    actOpen: '開く (.nfab)',
    actCmdPalette: 'コマンドパレット',
    actCancel: 'キャンセル / 閉じる',
    actShowHelp: 'ショートカットヘルプ',
    actTranslate: '移動ギズモ',
    actRotate: '回転ギズモ',
    actScale: 'スケールギズモ',
    actViewFit: 'ビューにフィット',
    actMeasure: '測定切替',
    actMeasureEsc: '測定中: Escでクリック解除 → もう一度Escで終了',
    actDims: '寸法切替',
    actPerf: 'パフォーマンスモニタ',
    actVFront: '正面ビュー',
    actVTop: '上面ビュー',
    actVRight: '右面ビュー',
    actVIso: 'アイソメトリック',
    actVVertex: '頂点編集モード',
    actVEdge: 'エッジ編集モード',
    actVFace: 'フェース編集モード',
    actSketch: 'スケッチモード切替',
    actSkLine: '線',
    actSkArc: '円弧',
    actSkCircle: '円',
    actSkRect: '長方形',
    actSkPolygon: '多角形',
    actSkEllipse: '楕円',
    actSkSlot: 'スロット',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: 'オフセット',
    actSkTrim: 'トリム',
    actSkSelect: '選択',
    actSkDimension: '寸法',
    actSkConstruction: '補助線',
  },
  zh: {
    titleHeader: '键盘快捷键',
    btnResetAll: '全部重置',
    btnSave: '保存',
    btnCancel: '取消',
    btnCustomize: '自定义',
    editModeHint: '🖊 编辑模式: 点击键徽章后按新键',
    captureTooltip: '点击后按新键',
    customBadge: '● 自定义',
    footer: 'Esc或点击外部关闭 · 按?键随时打开',
    catGeneral: '常规',
    catViewport: '3D视口',
    catSketchMode: '草图模式',
    catSketchTools: '草图工具(仅草图模式)',
    catWorkspace: '工作区（功能区）',
    actUndo: '撤销',
    actRedo: '重做',
    actSave: '保存 (.nfab)',
    actSaveCloud: '云端保存',
    actOpen: '打开 (.nfab)',
    actCmdPalette: '命令面板',
    actCancel: '取消 / 关闭',
    actShowHelp: '快捷键帮助',
    actTranslate: '移动控制器',
    actRotate: '旋转控制器',
    actScale: '缩放控制器',
    actViewFit: '适应视图',
    actMeasure: '切换测量',
    actMeasureEsc: '测量中：Esc 清除取点，再按 Esc 退出',
    actDims: '切换尺寸',
    actPerf: '性能监视器',
    actVFront: '正视图',
    actVTop: '顶视图',
    actVRight: '右视图',
    actVIso: '等轴视图',
    actVVertex: '顶点编辑模式',
    actVEdge: '边编辑模式',
    actVFace: '面编辑模式',
    actSketch: '切换草图模式',
    actSkLine: '直线',
    actSkArc: '圆弧',
    actSkCircle: '圆',
    actSkRect: '矩形',
    actSkPolygon: '多边形',
    actSkEllipse: '椭圆',
    actSkSlot: '槽',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: '偏移',
    actSkTrim: '修剪',
    actSkSelect: '选择',
    actSkDimension: '尺寸',
    actSkConstruction: '辅助线',
  },
  es: {
    titleHeader: 'Atajos de teclado',
    btnResetAll: 'Restablecer todo',
    btnSave: 'Guardar',
    btnCancel: 'Cancelar',
    btnCustomize: 'Personalizar',
    editModeHint: '🖊 Modo edición: haz clic en una tecla y luego pulsa la nueva',
    captureTooltip: 'Haz clic y pulsa una nueva tecla',
    customBadge: '● personalizado',
    footer: 'Esc o clic fuera para cerrar · pulsa ? para abrir en cualquier momento',
    catGeneral: 'General',
    catViewport: 'Viewport 3D',
    catSketchMode: 'Modo boceto',
    catSketchTools: 'Herramientas de boceto (solo en modo boceto)',
    catWorkspace: 'Espacio de trabajo (cinta)',
    actUndo: 'Deshacer',
    actRedo: 'Rehacer',
    actSave: 'Guardar (.nfab)',
    actSaveCloud: 'Guardar en la nube',
    actOpen: 'Abrir (.nfab)',
    actCmdPalette: 'Paleta de comandos',
    actCancel: 'Cancelar / Cerrar',
    actShowHelp: 'Ayuda de atajos',
    actTranslate: 'Gizmo de traslación',
    actRotate: 'Gizmo de rotación',
    actScale: 'Gizmo de escala',
    actViewFit: 'Ajustar a la vista',
    actMeasure: 'Alternar medición',
    actMeasureEsc: 'Medición: Esc borra puntos, otra vez Esc apaga',
    actDims: 'Alternar cotas',
    actPerf: 'Monitor de rendimiento',
    actVFront: 'Vista frontal',
    actVTop: 'Vista superior',
    actVRight: 'Vista derecha',
    actVIso: 'Isométrica',
    actVVertex: 'Modo edición de vértices',
    actVEdge: 'Modo edición de aristas',
    actVFace: 'Modo edición de caras',
    actSketch: 'Alternar modo boceto',
    actSkLine: 'Línea',
    actSkArc: 'Arco',
    actSkCircle: 'Círculo',
    actSkRect: 'Rectángulo',
    actSkPolygon: 'Polígono',
    actSkEllipse: 'Elipse',
    actSkSlot: 'Ranura',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: 'Desplazamiento',
    actSkTrim: 'Recortar',
    actSkSelect: 'Seleccionar',
    actSkDimension: 'Cota',
    actSkConstruction: 'Construcción',
  },
  ar: {
    titleHeader: 'اختصارات لوحة المفاتيح',
    btnResetAll: 'إعادة تعيين الكل',
    btnSave: 'حفظ',
    btnCancel: 'إلغاء',
    btnCustomize: 'تخصيص',
    editModeHint: '🖊 وضع التحرير: انقر على شارة المفتاح ثم اضغط المفتاح الجديد',
    captureTooltip: 'انقر ثم اضغط مفتاحًا جديدًا',
    customBadge: '● مخصص',
    footer: 'Esc أو انقر خارج النافذة للإغلاق · اضغط ؟ في أي وقت لفتحها',
    catGeneral: 'عام',
    catViewport: 'عرض ثلاثي الأبعاد',
    catSketchMode: 'وضع الرسم',
    catSketchTools: 'أدوات الرسم (في وضع الرسم فقط)',
    catWorkspace: 'مساحة العمل (الشريط)',
    actUndo: 'تراجع',
    actRedo: 'إعادة',
    actSave: 'حفظ (.nfab)',
    actSaveCloud: 'حفظ سحابي',
    actOpen: 'فتح (.nfab)',
    actCmdPalette: 'لوحة الأوامر',
    actCancel: 'إلغاء / إغلاق',
    actShowHelp: 'مساعدة الاختصارات',
    actTranslate: 'أداة التحريك',
    actRotate: 'أداة التدوير',
    actScale: 'أداة التحجيم',
    actViewFit: 'ملاءمة العرض',
    actMeasure: 'تبديل القياس',
    actMeasureEsc: 'أثناء القياس: Esc يلغي النقر، Esc مرة أخرى للخروج',
    actDims: 'تبديل الأبعاد',
    actPerf: 'مراقب الأداء',
    actVFront: 'العرض الأمامي',
    actVTop: 'العرض العلوي',
    actVRight: 'العرض الأيمن',
    actVIso: 'متساوي القياس',
    actVVertex: 'وضع تحرير الرؤوس',
    actVEdge: 'وضع تحرير الحواف',
    actVFace: 'وضع تحرير الأوجه',
    actSketch: 'تبديل وضع الرسم',
    actSkLine: 'خط',
    actSkArc: 'قوس',
    actSkCircle: 'دائرة',
    actSkRect: 'مستطيل',
    actSkPolygon: 'مضلع',
    actSkEllipse: 'قطع ناقص',
    actSkSlot: 'فتحة',
    actSkSpline: 'Spline',
    actSkFillet: 'Fillet',
    actSkMirror: 'Mirror',
    actSkOffset: 'إزاحة',
    actSkTrim: 'قص',
    actSkSelect: 'تحديد',
    actSkDimension: 'بُعد',
    actSkConstruction: 'خط إنشائي',
  },
} as const;

type Lang = keyof typeof shapeDict;

interface ShortcutHelpProps {
  visible: boolean;
  onClose: () => void;
  lang: string;
}

interface ShortcutItem {
  id: string;
  keys: string[];
  label: string;
  customizable?: boolean;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

// Re-export for backward-compat callers
export { loadCustomShortcuts, saveCustomShortcuts };
export function getCustomKey(actionId: string, defaultKey: string): string {
  const map = loadCustomShortcuts();
  return map[actionId] ?? defaultKey;
}

export default function ShortcutHelp({ visible, onClose, lang }: ShortcutHelpProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const overlayRef = useRef<HTMLDivElement>(null);
  // Keep for shapeDict compatibility (not directly used in rendered text)
  void (shapeDict[lang as Lang] ?? shapeDict.en);

  const [editMode, setEditMode] = useState(false);
  const [customKeys, setCustomKeys] = useState<Record<string, string>>({});
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load saved shortcuts when panel opens
  useEffect(() => {
    if (visible) setCustomKeys(loadCustomShortcuts());
  }, [visible]);

  // Key capture handler
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (capturingId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setCustomKeys(prev => ({ ...prev, [capturingId]: e.key.toUpperCase() }));
          setCapturingId(null);
          setDirty(true);
        } else if (e.key === 'Escape') {
          setCapturingId(null);
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible, onClose, capturingId]);

  const handleSave = useCallback(() => {
    saveCustomShortcuts(customKeys);
    setDirty(false);
    setEditMode(false);
    window.dispatchEvent(new CustomEvent('nexyfab:shortcuts-updated'));
  }, [customKeys]);

  const handleReset = useCallback(() => {
    saveCustomShortcuts({});
    setCustomKeys({});
    setDirty(false);
    window.dispatchEvent(new CustomEvent('nexyfab:shortcuts-updated'));
  }, []);

  if (!visible) return null;

  // Effective display key for a customizable item
  const dk = (id: string) => customKeys[id] ?? DEFAULT_SHORTCUTS[id] ?? '';

  const Lws = CAD_WORKSPACE_LABELS[lang] ?? CAD_WORKSPACE_LABELS.en;
  const workspaceHotkeyItems: ShortcutItem[] = CAD_WORKSPACE_ORDER.map((id, i) => {
    let keys: string[];
    if (i <= 8) keys = ['Alt', String(i + 1)];
    else if (i === 9) keys = ['Alt', '0'];
    else keys = ['Alt', '-'];
    return { id: `ws_hotkey_${id}`, keys, label: Lws[id] };
  });

  const categories: ShortcutCategory[] = [
    {
      title: t.catGeneral,
      items: [
        { id: 'undo',        keys: ['Ctrl', 'Z'],        label: t.actUndo },
        { id: 'redo',        keys: ['Ctrl', 'Shift', 'Z'], label: t.actRedo },
        { id: 'save',        keys: ['Ctrl', 'S'],        label: t.actSave },
        { id: 'saveCloud',   keys: ['Ctrl', 'Shift', 'S'], label: t.actSaveCloud },
        { id: 'open',        keys: ['Ctrl', 'O'],        label: t.actOpen },
        { id: 'cmd_palette', keys: ['Ctrl', 'K'],        label: t.actCmdPalette },
        { id: 'cancel',      keys: ['Esc'],              label: t.actCancel },
        { id: 'showHelp',    keys: ['?'],                label: t.actShowHelp },
      ],
    },
    {
      title: t.catWorkspace,
      items: workspaceHotkeyItems,
    },
    {
      title: t.catViewport,
      items: [
        { id: 'translate', keys: [dk('translate')], label: t.actTranslate, customizable: true },
        { id: 'rotate',    keys: [dk('rotate')],    label: t.actRotate,    customizable: true },
        { id: 'scale',     keys: [dk('scale')],     label: t.actScale,     customizable: true },
        { id: 'view_fit',  keys: [dk('view_fit')],  label: t.actViewFit,   customizable: true },
        { id: 'measure',   keys: [dk('measure')],   label: t.actMeasure,   customizable: true },
        { id: 'measure_esc', keys: ['Esc'],         label: t.actMeasureEsc },
        { id: 'dims',      keys: [dk('dims')],      label: t.actDims,      customizable: true },
        { id: 'perf',      keys: [dk('perf')],      label: t.actPerf,      customizable: true },
        { id: 'v_front',   keys: ['5'],             label: t.actVFront },
        { id: 'v_top',     keys: ['7'],             label: t.actVTop },
        { id: 'v_right',   keys: ['6'],             label: t.actVRight },
        { id: 'v_iso',     keys: ['0'],             label: t.actVIso },
        { id: 'v_vertex',  keys: ['1'],             label: t.actVVertex },
        { id: 'v_edge',    keys: ['2'],             label: t.actVEdge },
        { id: 'v_face',    keys: ['3'],             label: t.actVFace },
      ],
    },
    {
      title: t.catSketchMode,
      items: [
        { id: 'sketch', keys: [dk('sketch')], label: t.actSketch, customizable: true },
      ],
    },
    {
      title: t.catSketchTools,
      items: [
        { id: 'sk_line',         keys: [dk('sk_line')],         label: t.actSkLine,         customizable: true },
        { id: 'sk_arc',          keys: [dk('sk_arc')],          label: t.actSkArc,          customizable: true },
        { id: 'sk_circle',       keys: [dk('sk_circle')],       label: t.actSkCircle,       customizable: true },
        { id: 'sk_rect',         keys: [dk('sk_rect')],         label: t.actSkRect,         customizable: true },
        { id: 'sk_polygon',      keys: [dk('sk_polygon')],      label: t.actSkPolygon,      customizable: true },
        { id: 'sk_ellipse',      keys: [dk('sk_ellipse')],      label: t.actSkEllipse,      customizable: true },
        { id: 'sk_slot',         keys: [dk('sk_slot')],         label: t.actSkSlot,         customizable: true },
        { id: 'sk_spline',       keys: [dk('sk_spline')],       label: t.actSkSpline,       customizable: true },
        { id: 'sk_fillet',       keys: [dk('sk_fillet')],       label: t.actSkFillet,       customizable: true },
        { id: 'sk_mirror',       keys: [dk('sk_mirror')],       label: t.actSkMirror,       customizable: true },
        { id: 'sk_offset',       keys: [dk('sk_offset')],       label: t.actSkOffset,       customizable: true },
        { id: 'sk_trim',         keys: [dk('sk_trim')],         label: t.actSkTrim,         customizable: true },
        { id: 'sk_select',       keys: [dk('sk_select')],       label: t.actSkSelect,       customizable: true },
        { id: 'sk_dimension',    keys: [dk('sk_dimension')],    label: t.actSkDimension,    customizable: true },
        { id: 'sk_construction', keys: [dk('sk_construction')], label: t.actSkConstruction, customizable: true },
      ],
    },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current && !capturingId) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
        padding: '20px 24px', width: 'min(720px, 96vw)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#c9d1d9', letterSpacing: -0.3 }}>
            ⌨️ {t.titleHeader}
          </h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {editMode ? (
              <>
                <button onClick={handleReset} style={btnStyle('#f85149')}>
                  {t.btnResetAll}
                </button>
                <button
                  onClick={handleSave}
                  style={btnStyle(dirty ? '#3fb950' : '#484f58')}
                >
                  {t.btnSave}
                </button>
                <button
                  onClick={() => { setEditMode(false); setCustomKeys(loadCustomShortcuts()); setCapturingId(null); }}
                  style={btnStyle('#8b949e')}
                >
                  {t.btnCancel}
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)} style={btnStyle('#58a6ff')}>
                ✏️ {t.btnCustomize}
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.background = '#21262d'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = 'none'; }}
            >
              ×
            </button>
          </div>
        </div>

        {editMode && (
          <div style={{ fontSize: 10, color: '#f0883e', background: '#f0883e0a', borderRadius: 5, padding: '5px 10px', marginBottom: 10, border: '1px solid #f0883e22' }}>
            {t.editModeHint}
          </div>
        )}

        {/* Scrollable categories — card grid (not a single long key / label list) */}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {categories.map((cat) => (
            <div key={cat.title}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase',
                letterSpacing: 1.2, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #21262d',
              }}>
                {cat.title}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
                gap: 8,
              }}>
                {cat.items.map((item) => {
                  const isCapturing = capturingId === item.id;
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minWidth: 0,
                        padding: '8px 12px',
                        background: '#0d1117',
                        border: '1px solid #21262d',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 3,
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        flexShrink: 0,
                      }}>
                        {item.keys.map((key, ki) => (
                          <React.Fragment key={ki}>
                            {ki > 0 && <span style={{ color: '#484f58', fontSize: 10, userSelect: 'none' }}>+</span>}
                            {editMode && item.customizable && item.keys.length === 1 ? (
                              <button
                                type="button"
                                onClick={() => setCapturingId(isCapturing ? null : item.id)}
                                style={{
                                  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                  background: isCapturing ? '#f0883e22' : '#21262d',
                                  border: `1px solid ${isCapturing ? '#f0883e' : '#388bfd'}`,
                                  color: isCapturing ? '#f0883e' : '#58a6ff',
                                  fontSize: 11, fontWeight: 700,
                                  fontFamily: 'ui-monospace, monospace',
                                  lineHeight: '18px', minWidth: 24, textAlign: 'center',
                                  cursor: 'pointer',
                                }}
                                title={t.captureTooltip}
                              >
                                {isCapturing ? '…' : key}
                              </button>
                            ) : (
                              <kbd style={kbdStyle}>{key}</kbd>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 500, lineHeight: 1.35 }}>
                          {item.label}
                        </span>
                        {item.customizable && customKeys[item.id] && (
                          <span style={{ fontSize: 9, color: '#3fb950', fontWeight: 700, flexShrink: 0 }}>
                            {t.customBadge}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #21262d', fontSize: 10, color: '#484f58', textAlign: 'center' }}>
          {t.footer}
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────────

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${color}30`,
    background: `${color}10`,
    color, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  };
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  background: '#21262d', border: '1px solid #484f58',
  color: '#c9d1d9', fontSize: 11, fontWeight: 600,
  fontFamily: 'ui-monospace, monospace',
  lineHeight: '18px', minWidth: 24, textAlign: 'center',
};
