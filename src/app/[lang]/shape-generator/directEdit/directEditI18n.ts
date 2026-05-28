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
  /** E3 — body-level direct edit mode labels. */
  moveBody: string;
  moveBodyActive: string;
  rotateBody: string;
  rotateBodyActive: string;
  ariaMoveBody: string;
  ariaRotateBody: string;
  /** E3 — mode status hints shown in the toolbar status bar. */
  modeStatusPushPull: string;
  modeStatusMoveBody: string;
  modeStatusRotateBody: string;
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
  moveBody: '바디 이동',
  moveBodyActive: '바디 이동 (활성)',
  rotateBody: '바디 회전',
  rotateBodyActive: '바디 회전 (활성)',
  ariaMoveBody: '바디 이동 모드 전환',
  ariaRotateBody: '바디 회전 모드 전환',
  modeStatusPushPull: '밀기/당기기 모드 — 면을 드래그하세요',
  modeStatusMoveBody: '이동 모드 — 기즈모로 드래그',
  modeStatusRotateBody: '회전 모드 — 기즈모로 회전',
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
  moveBody: 'Move body',
  moveBodyActive: 'Move body (active)',
  rotateBody: 'Rotate body',
  rotateBodyActive: 'Rotate body (active)',
  ariaMoveBody: 'Toggle move-body mode',
  ariaRotateBody: 'Toggle rotate-body mode',
  modeStatusPushPull: 'Push/Pull — drag a face',
  modeStatusMoveBody: 'Move — drag the translation gizmo',
  modeStatusRotateBody: 'Rotate — drag the rotation gizmo',
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
  moveBody: 'ボディ移動',
  moveBodyActive: 'ボディ移動 (有効)',
  rotateBody: 'ボディ回転',
  rotateBodyActive: 'ボディ回転 (有効)',
  ariaMoveBody: 'ボディ移動モードの切替',
  ariaRotateBody: 'ボディ回転モードの切替',
  modeStatusPushPull: 'プッシュ/プル — 面をドラッグ',
  modeStatusMoveBody: '移動モード — ギズモをドラッグ',
  modeStatusRotateBody: '回転モード — ギズモを回転',
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
  moveBody: '移动实体',
  moveBodyActive: '移动实体(已激活)',
  rotateBody: '旋转实体',
  rotateBodyActive: '旋转实体(已激活)',
  ariaMoveBody: '切换移动实体模式',
  ariaRotateBody: '切换旋转实体模式',
  modeStatusPushPull: '推/拉 — 拖动面',
  modeStatusMoveBody: '移动模式 — 拖动操纵器',
  modeStatusRotateBody: '旋转模式 — 旋转操纵器',
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
  moveBody: 'Mover cuerpo',
  moveBodyActive: 'Mover cuerpo (activo)',
  rotateBody: 'Rotar cuerpo',
  rotateBodyActive: 'Rotar cuerpo (activo)',
  ariaMoveBody: 'Activar / desactivar mover cuerpo',
  ariaRotateBody: 'Activar / desactivar rotar cuerpo',
  modeStatusPushPull: 'Empujar/Tirar — arrastra una cara',
  modeStatusMoveBody: 'Mover — arrastra el manipulador',
  modeStatusRotateBody: 'Rotar — arrastra el manipulador',
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
  moveBody: 'تحريك الجسم',
  moveBodyActive: 'تحريك الجسم (نشط)',
  rotateBody: 'تدوير الجسم',
  rotateBodyActive: 'تدوير الجسم (نشط)',
  ariaMoveBody: 'تبديل وضع تحريك الجسم',
  ariaRotateBody: 'تبديل وضع تدوير الجسم',
  modeStatusPushPull: 'دفع/سحب — اسحب وجهًا',
  modeStatusMoveBody: 'وضع التحريك — اسحب أداة التحكم',
  modeStatusRotateBody: 'وضع التدوير — أدر أداة التحكم',
};

const ALL: Record<DirectEditLang, DirectEditStrings> = {
  ko: KO, en: EN, ja: JA, cn: CN, es: ES, ar: AR,
};

export function getDirectEditStrings(lang: string): DirectEditStrings {
  if (lang in ALL) return ALL[lang as DirectEditLang];
  return EN;
}
