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
  // ─── E5 (W7) commit-to-history strings ───────────────────────────────────
  /** Toolbar button label that opens the commit modal. */
  commitButton: string;
  /** Aria-label for the commit button. */
  ariaCommit: string;
  /** Modal title. */
  commitModalTitle: string;
  /** Modal body preamble: "About to commit N ops to history". */
  commitModalBody: (n: number) => string;
  /** Modal confirm button. */
  commitConfirm: string;
  /** Modal cancel button. */
  commitCancel: string;
  /** Modal partial-commit button label (visible after a rejection). */
  commitPartial: string;
  /** Partial-failure preamble shown in the modal. */
  commitPartialBody: (committed: number, total: number, reason: string) => string;
  /** Localized rejection-reason strings. */
  reasonUnknownOpKind: string;
  reasonMissingOwnerFeature: string;
  reasonInvalidOffset: string;
  reasonInvalidRadius: string;
  reasonInvalidDistance: string;
  /** Toast after a successful full commit. */
  commitSuccessToast: (n: number) => string;
  /** Toast after a successful partial commit. */
  commitPartialToast: (committed: number, remaining: number) => string;
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
  commitButton: '히스토리에 적용',
  ariaCommit: '직접편집을 히스토리에 적용',
  commitModalTitle: '직접편집을 히스토리에 적용하시겠습니까?',
  commitModalBody: (n) => `${n}건의 직접편집이 파라메트릭 히스토리 노드로 변환되어 영구 저장됩니다.`,
  commitConfirm: '적용',
  commitCancel: '취소',
  commitPartial: '부분 적용',
  commitPartialBody: (c, t, r) =>
    `${t}건 중 ${c}건만 변환 가능합니다 (사유: ${r}). 부분 적용을 진행하시겠습니까?`,
  reasonUnknownOpKind: '알 수 없는 작업 종류',
  reasonMissingOwnerFeature: '면을 소유하는 피처를 찾을 수 없음',
  reasonInvalidOffset: '잘못된 오프셋',
  reasonInvalidRadius: '잘못된 반경',
  reasonInvalidDistance: '잘못된 거리',
  commitSuccessToast: (n) => `직접편집 ${n}건을 히스토리에 적용했습니다.`,
  commitPartialToast: (c, r) => `${c}건을 히스토리에 적용했습니다. ${r}건은 스택에 남아 있습니다.`,
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
  commitButton: 'Commit to history',
  ariaCommit: 'Commit direct edits to history',
  commitModalTitle: 'Commit direct edits to history?',
  commitModalBody: (n) =>
    `${n} direct edit${n === 1 ? '' : 's'} will be converted to parametric history node${n === 1 ? '' : 's'} and persisted on save.`,
  commitConfirm: 'Commit',
  commitCancel: 'Cancel',
  commitPartial: 'Commit partial',
  commitPartialBody: (c, t, r) =>
    `Committed ${c}/${t} ops; ${t - c} could not be mapped (reason: ${r}). Continue with partial commit?`,
  reasonUnknownOpKind: 'unknown op kind',
  reasonMissingOwnerFeature: 'face has no owning feature',
  reasonInvalidOffset: 'invalid offset',
  reasonInvalidRadius: 'invalid radius',
  reasonInvalidDistance: 'invalid distance',
  commitSuccessToast: (n) =>
    `${n} direct edit${n === 1 ? '' : 's'} committed to history.`,
  commitPartialToast: (c, r) =>
    `${c} committed; ${r} remain${r === 1 ? 's' : ''} in the stack.`,
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
  commitButton: '履歴に確定',
  ariaCommit: '直接編集を履歴に確定',
  commitModalTitle: '直接編集を履歴に確定しますか?',
  commitModalBody: (n) =>
    `${n}件の直接編集がパラメトリック履歴ノードに変換され、保存時に永続化されます。`,
  commitConfirm: '確定',
  commitCancel: 'キャンセル',
  commitPartial: '部分確定',
  commitPartialBody: (c, t, r) =>
    `${t}件のうち ${c}件を確定済み。${t - c}件は変換できません (理由: ${r})。部分確定を続行しますか?`,
  reasonUnknownOpKind: '不明な操作種別',
  reasonMissingOwnerFeature: '面の所有フィーチャーが見つかりません',
  reasonInvalidOffset: 'オフセットが不正',
  reasonInvalidRadius: '半径が不正',
  reasonInvalidDistance: '距離が不正',
  commitSuccessToast: (n) => `直接編集 ${n}件を履歴に確定しました。`,
  commitPartialToast: (c, r) => `${c}件を確定。${r}件がスタックに残っています。`,
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
  commitButton: '提交到历史',
  ariaCommit: '将直接编辑提交到历史',
  commitModalTitle: '将直接编辑提交到历史?',
  commitModalBody: (n) =>
    `${n} 个直接编辑将被转换为参数化历史节点,并在保存时持久化。`,
  commitConfirm: '提交',
  commitCancel: '取消',
  commitPartial: '部分提交',
  commitPartialBody: (c, t, r) =>
    `已提交 ${c}/${t} 个;${t - c} 个无法映射 (原因: ${r})。是否继续部分提交?`,
  reasonUnknownOpKind: '未知操作类型',
  reasonMissingOwnerFeature: '该面没有所属特征',
  reasonInvalidOffset: '偏移量无效',
  reasonInvalidRadius: '半径无效',
  reasonInvalidDistance: '距离无效',
  commitSuccessToast: (n) => `已将 ${n} 个直接编辑提交到历史。`,
  commitPartialToast: (c, r) => `已提交 ${c} 个;${r} 个仍在堆栈中。`,
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
  commitButton: 'Confirmar al historial',
  ariaCommit: 'Confirmar ediciones directas al historial',
  commitModalTitle: '¿Confirmar las ediciones directas en el historial?',
  commitModalBody: (n) =>
    `${n} edición${n === 1 ? '' : 'es'} directa${n === 1 ? '' : 's'} se convertir${n === 1 ? 'á' : 'án'} a nodos paramétricos y persistir${n === 1 ? 'á' : 'án'} al guardar.`,
  commitConfirm: 'Confirmar',
  commitCancel: 'Cancelar',
  commitPartial: 'Confirmación parcial',
  commitPartialBody: (c, t, r) =>
    `Se confirmaron ${c}/${t}; ${t - c} no pudieron mapearse (motivo: ${r}). ¿Continuar con la confirmación parcial?`,
  reasonUnknownOpKind: 'tipo de operación desconocido',
  reasonMissingOwnerFeature: 'la cara no tiene función propietaria',
  reasonInvalidOffset: 'desplazamiento no válido',
  reasonInvalidRadius: 'radio no válido',
  reasonInvalidDistance: 'distancia no válida',
  commitSuccessToast: (n) =>
    `${n} edición${n === 1 ? '' : 'es'} directa${n === 1 ? '' : 's'} confirmada${n === 1 ? '' : 's'} al historial.`,
  commitPartialToast: (c, r) =>
    `${c} confirmada${c === 1 ? '' : 's'}; ${r} permanece${r === 1 ? '' : 'n'} en la pila.`,
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
  commitButton: 'تثبيت في السجل',
  ariaCommit: 'تثبيت التحريرات المباشرة في السجل',
  commitModalTitle: 'تثبيت التحريرات المباشرة في السجل؟',
  commitModalBody: (n) =>
    `سيتم تحويل ${n} تحرير مباشر إلى عُقد بارامترية في السجل وحفظها.`,
  commitConfirm: 'تثبيت',
  commitCancel: 'إلغاء',
  commitPartial: 'تثبيت جزئي',
  commitPartialBody: (c, t, r) =>
    `تم تثبيت ${c}/${t} عملية؛ ${t - c} لم يمكن تحويلها (السبب: ${r}). هل تريد المتابعة بالتثبيت الجزئي؟`,
  reasonUnknownOpKind: 'نوع عملية غير معروف',
  reasonMissingOwnerFeature: 'لا يوجد عنصر مالك للوجه',
  reasonInvalidOffset: 'إزاحة غير صالحة',
  reasonInvalidRadius: 'نصف قطر غير صالح',
  reasonInvalidDistance: 'مسافة غير صالحة',
  commitSuccessToast: (n) => `تم تثبيت ${n} تحرير مباشر في السجل.`,
  commitPartialToast: (c, r) => `تم تثبيت ${c}؛ ${r} لا تزال في المكدس.`,
};

const ALL: Record<DirectEditLang, DirectEditStrings> = {
  ko: KO, en: EN, ja: JA, cn: CN, es: ES, ar: AR,
};

export function getDirectEditStrings(lang: string): DirectEditStrings {
  if (lang in ALL) return ALL[lang as DirectEditLang];
  return EN;
}

/** Resolve a `CommitRejectionReason` string against the given locale.
 *  Defined here (rather than in commitToHistory.ts) so the strings table
 *  stays the single source of localized copy. */
export function getCommitRejectionReasonString(
  strings: DirectEditStrings,
  reason:
    | 'unknown_op_kind'
    | 'missing_owner_feature'
    | 'invalid_offset'
    | 'invalid_radius'
    | 'invalid_distance',
): string {
  switch (reason) {
    case 'unknown_op_kind': return strings.reasonUnknownOpKind;
    case 'missing_owner_feature': return strings.reasonMissingOwnerFeature;
    case 'invalid_offset': return strings.reasonInvalidOffset;
    case 'invalid_radius': return strings.reasonInvalidRadius;
    case 'invalid_distance': return strings.reasonInvalidDistance;
    default: return reason;
  }
}
