import type { RadialItem, RadialLinearItem } from './SketchRadialMenu';
import { radialCommandTitle } from './sketchToolHints';

function withRadialTitle(lang: string, id: string, label: string, icon: string): RadialItem {
  return { id, label, icon, title: radialCommandTitle(lang, id, label) };
}

const T: Record<string, Record<string, string>> = {
  ko: {
    finish: '완료',
    cancel: '취소',
    undo: '실행 취소',
    line: '선',
    circle: '원',
    rect: '사각형',
    trim: '트림',
    measure: '측정',
    offset: '오프셋',
    polygon: '다각형',
    dimension: '치수',
    clear: '비우기',
    canvas: '참조',
    slice: '슬라이스',
  },
  en: {
    finish: 'Finish',
    cancel: 'Cancel',
    undo: 'Undo',
    line: 'Line',
    circle: 'Circle',
    rect: 'Rectangle',
    trim: 'Trim',
    measure: 'Measure',
    offset: 'Offset',
    polygon: 'Polygon',
    dimension: 'Dimension',
    clear: 'Clear',
    canvas: 'Canvas',
    slice: 'Slice',
  },
  ja: {
    finish: '完了',
    cancel: 'キャンセル',
    undo: '元に戻す',
    line: '線',
    circle: '円',
    rect: '矩形',
    trim: 'トリム',
    measure: '測定',
    offset: 'オフセット',
    polygon: '多角形',
    dimension: '寸法',
    clear: 'クリア',
    canvas: '参照',
    slice: 'スライス',
  },
  zh: {
    finish: '完成',
    cancel: '取消',
    undo: '撤销',
    line: '直线',
    circle: '圆',
    rect: '矩形',
    trim: '修剪',
    measure: '测量',
    offset: '偏移',
    polygon: '多边形',
    dimension: '尺寸',
    clear: '清空',
    canvas: '参考图',
    slice: '切片',
  },
  es: {
    finish: 'Finalizar',
    cancel: 'Cancelar',
    undo: 'Deshacer',
    line: 'Línea',
    circle: 'Círculo',
    rect: 'Rectángulo',
    trim: 'Recortar',
    measure: 'Medir',
    offset: 'Desfase',
    polygon: 'Polígono',
    dimension: 'Cota',
    clear: 'Vaciar',
    canvas: 'Ref.',
    slice: 'Corte',
  },
  ar: {
    finish: 'إنهاء',
    cancel: 'إلغاء',
    undo: 'تراجع',
    line: 'خط',
    circle: 'دائرة',
    rect: 'مستطيل',
    trim: 'قص',
    measure: 'قياس',
    offset: 'إزاحة',
    polygon: 'مضلع',
    dimension: 'بعد',
    clear: 'مسح',
    canvas: 'مرجع',
    slice: 'شريحة',
  },
};

function L(lang: string, key: keyof typeof T.en): string {
  const seg = lang === 'kr' ? 'ko' : lang;
  return (T[seg] ?? T.en)[key] ?? T.en[key];
}

/** Outer ring — primary sketch actions. */
export function getSketchRadialMainItems(lang: string): RadialItem[] {
  return [
    withRadialTitle(lang, 'finish-sketch', L(lang, 'finish'), '✓'),
    withRadialTitle(lang, 'cancel-sketch', L(lang, 'cancel'), '✕'),
    withRadialTitle(lang, 'sketch-undo', L(lang, 'undo'), '↩'),
    withRadialTitle(lang, 'sketch-tool-line', L(lang, 'line'), '╱'),
    withRadialTitle(lang, 'sketch-tool-circle', L(lang, 'circle'), '○'),
    withRadialTitle(lang, 'sketch-tool-rect', L(lang, 'rect'), '▭'),
    withRadialTitle(lang, 'sketch-tool-trim', L(lang, 'trim'), '✂'),
    withRadialTitle(lang, 'measure', L(lang, 'measure'), '📐'),
  ];
}

/** Inner ring — more tools (staggered angles in menu). */
export function getSketchRadialInnerItems(lang: string): RadialItem[] {
  return [
    withRadialTitle(lang, 'sketch-tool-offset', L(lang, 'offset'), '⧈'),
    withRadialTitle(lang, 'sketch-tool-polygon', L(lang, 'polygon'), '⬡'),
    withRadialTitle(lang, 'sketch-radial-dimension', L(lang, 'dimension'), '📏'),
    withRadialTitle(lang, 'sketch-clear', L(lang, 'clear'), '🗑'),
    withRadialTitle(lang, 'sketch-insert-canvas', L(lang, 'canvas'), '🖼'),
    withRadialTitle(lang, 'sketch-toggle-slice', L(lang, 'slice'), '◫'),
  ];
}

const LIN: Record<string, { ok: string; cancel: string; vis: string; find: string }> = {
  ko: { ok: '확인', cancel: '취소', vis: '표시/숨기기', find: '브라우저에서 찾기' },
  en: { ok: 'OK', cancel: 'Cancel', vis: 'Show / Hide', find: 'Find in Browser' },
  ja: { ok: 'OK', cancel: 'キャンセル', vis: '表示/非表示', find: 'ブラウザで検索' },
  zh: { ok: '确定', cancel: '取消', vis: '显示/隐藏', find: '在浏览器中查找' },
  es: { ok: 'Aceptar', cancel: 'Cancelar', vis: 'Mostrar / Ocultar', find: 'Buscar en navegador' },
  ar: { ok: 'موافق', cancel: 'إلغاء', vis: 'إظهار / إخفاء', find: 'بحث في المتصفح' },
};

function Lin(lang: string): { ok: string; cancel: string; vis: string; find: string } {
  const seg = lang === 'kr' ? 'ko' : lang;
  return LIN[seg] ?? LIN.en;
}

/** Vertical column — shortcuts shown like the context list. */
export function getSketchRadialLinearItems(lang: string): RadialLinearItem[] {
  const z = Lin(lang);
  return [
    { id: 'marking-ok', label: z.ok, shortcut: '↵' },
    { id: 'marking-cancel', label: z.cancel, shortcut: 'Esc' },
    { id: 'marking-toggle-visibility', label: z.vis, shortcut: 'V' },
    { id: 'marking-find-browser', label: z.find, shortcut: 'F' },
  ];
}

/** @deprecated Prefer getSketchRadialMainItems + getSketchRadialInnerItems */
export function getSketchRadialItems(lang: string): RadialItem[] {
  return getSketchRadialMainItems(lang);
}
