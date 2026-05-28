/**
 * directEditI18n.ts — Wave 2 Phase 3 Track E1 / Track P3.
 *
 * Direct-edit strings, 6-lang. Kept local to the directEdit/ folder
 * to avoid bloating the existing 1900-line constants/labels.ts during
 * Phase 3 W3. The Track P4 polish pass folds these into the main
 * label registry; for now we ship them adjacent to the feature.
 *
 * Strings come from the spec dictionary in tracker P3 (`밀기/당기기`,
 * `면 직접편집`). Ja / zh follow KR canonical conventions used
 * elsewhere in shape-generator.
 */

export type DirectEditLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

export interface DirectEditStrings {
  /** Toolbar mode toggle. */
  modeButton: string;
  modeButtonActive: string;
  /** Undo last direct edit. */
  undo: string;
  /** Clear all direct edits in the session. */
  clearAll: string;
  /** Status indicator: "N direct edits applied this session". */
  statusNone: string;
  statusCount: (n: number) => string;
  /** Toast emitted when the parametric history is re-run and the
   *  session stack is invalidated. */
  invalidatedToast: (n: number) => string;
  /** Tooltip / aria-label fallback. */
  ariaModeToggle: string;
}

const KO: DirectEditStrings = {
  modeButton: '직접편집',
  modeButtonActive: '직접편집 (활성)',
  undo: '직접편집 되돌리기',
  clearAll: '모든 직접편집 지우기',
  statusNone: '직접편집 없음',
  statusCount: (n) => `${n}개의 직접편집 적용됨 (세션 한정)`,
  invalidatedToast: (n) =>
    `히스토리가 재실행되어 직접편집 ${n}건이 초기화되었습니다.`,
  ariaModeToggle: '직접편집 모드 전환',
};

const EN: DirectEditStrings = {
  modeButton: 'Direct edit',
  modeButtonActive: 'Direct edit (active)',
  undo: 'Undo direct edit',
  clearAll: 'Clear all direct edits',
  statusNone: 'No direct edits',
  statusCount: (n) => `${n} direct edit${n === 1 ? '' : 's'} applied this session`,
  invalidatedToast: (n) =>
    `Direct edits cleared (${n}) — history was rerun.`,
  ariaModeToggle: 'Toggle direct edit mode',
};

const JA: DirectEditStrings = {
  modeButton: '直接編集',
  modeButtonActive: '直接編集 (有効)',
  undo: '直接編集を元に戻す',
  clearAll: 'すべての直接編集をクリア',
  statusNone: '直接編集なし',
  statusCount: (n) => `${n}件の直接編集が適用済み(セッション限定)`,
  invalidatedToast: (n) =>
    `履歴が再実行されたため、直接編集 ${n}件をクリアしました。`,
  ariaModeToggle: '直接編集モードの切替',
};

const CN: DirectEditStrings = {
  modeButton: '直接编辑',
  modeButtonActive: '直接编辑(已激活)',
  undo: '撤销直接编辑',
  clearAll: '清除所有直接编辑',
  statusNone: '无直接编辑',
  statusCount: (n) => `已应用 ${n} 个直接编辑(仅本会话)`,
  invalidatedToast: (n) =>
    `历史已重新执行,${n} 个直接编辑已清除。`,
  ariaModeToggle: '切换直接编辑模式',
};

const ES: DirectEditStrings = {
  modeButton: 'Edición directa',
  modeButtonActive: 'Edición directa (activa)',
  undo: 'Deshacer edición directa',
  clearAll: 'Borrar todas las ediciones directas',
  statusNone: 'Sin ediciones directas',
  statusCount: (n) => `${n} edición${n === 1 ? '' : 'es'} directa${n === 1 ? '' : 's'} aplicada${n === 1 ? '' : 's'} en esta sesión`,
  invalidatedToast: (n) =>
    `Ediciones directas borradas (${n}) — el historial fue reejecutado.`,
  ariaModeToggle: 'Activar / desactivar edición directa',
};

const AR: DirectEditStrings = {
  modeButton: 'تحرير مباشر',
  modeButtonActive: 'تحرير مباشر (نشط)',
  undo: 'تراجع عن التحرير المباشر',
  clearAll: 'مسح جميع التحريرات المباشرة',
  statusNone: 'لا توجد تحريرات مباشرة',
  statusCount: (n) => `${n} تحرير مباشر مطبق في هذه الجلسة`,
  invalidatedToast: (n) =>
    `تم مسح التحريرات المباشرة (${n}) - أعيد تنفيذ السجل.`,
  ariaModeToggle: 'تبديل وضع التحرير المباشر',
};

const ALL: Record<DirectEditLang, DirectEditStrings> = {
  ko: KO, en: EN, ja: JA, cn: CN, es: ES, ar: AR,
};

export function getDirectEditStrings(lang: string): DirectEditStrings {
  if (lang in ALL) return ALL[lang as DirectEditLang];
  return EN;
}
