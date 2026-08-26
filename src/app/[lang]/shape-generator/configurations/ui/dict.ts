/**
 * configurations/ui/dict.ts — i18n strings for the v2 UI bundle.
 *
 * Wave 2 Phase 2 Track A Week 4 (A4). Six languages — KR canonical per
 * the user's i18n policy, EN sync, JA/ZH/ES/AR translations. The
 * `Lang` type matches the existing shape-generator `ConfigurationTable`
 * panel (ko/en/ja/zh/es/ar) so the same `lang` prop flows through.
 *
 * Add new keys here, **not** inline in components — keeps the
 * Korean-canonical translation pass auditable in one place (per
 * `feedback_preferences` i18n notes).
 */

export type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface ConfigUiDict {
  title: string;
  close: string;
  master: string;
  add: string;
  rename: string;
  del: string;
  delConfirm: string;
  activate: string;
  active: string;
  parent: string;
  none: string;
  cycleError: string;
  variants: string;
  expressionVars: string;
  globalVars: string;
  addVar: string;
  removeVar: string;
  varName: string;
  varValue: string;
  inherited: string;
  expression: string;
  suppressed: string;
  unsuppressed: string;
  toggleSuppress: string;
  familyExport: string;
  familyExportTitle: string;
  familyExportAll: string;
  familyExportNone: string;
  familyExportGo: string;
  familyExportCancel: string;
  familyExportProgress: string;
  familyExportDone: string;
  familyExportDeferred: string;
  csvBom: string;
  csvBomTooltip: string;
  empty: string;
  switchedDiscarded: string;
  configCol: string;
  featureCol: string;
  paramCol: string;
}

const ko: ConfigUiDict = {
  title: '구성 테이블 v2',
  close: '닫기',
  master: '마스터',
  add: '+ 구성 추가',
  rename: '이름 변경',
  del: '삭제',
  delConfirm: '구성을 삭제하시겠습니까?',
  activate: '적용',
  active: '활성',
  parent: '부모 구성',
  none: '(없음)',
  cycleError: '순환 참조 — 부모 변경 거부',
  variants: '변형',
  expressionVars: '표현식 변수',
  globalVars: '전역 변수',
  addVar: '+ 변수',
  removeVar: '제거',
  varName: '이름',
  varValue: '값',
  inherited: '상속',
  expression: '표현식',
  suppressed: '억제됨',
  unsuppressed: '활성',
  toggleSuppress: '억제 전환',
  familyExport: '패밀리 내보내기',
  familyExportTitle: '패밀리 STEP 내보내기',
  familyExportAll: '모두 선택',
  familyExportNone: '선택 해제',
  familyExportGo: '내보내기',
  familyExportCancel: '취소',
  familyExportProgress: '진행 중',
  familyExportDone: '완료',
  familyExportDeferred: '플레이스홀더로 내보냄 — STEP 워커는 W4+에서 연결됨',
  csvBom: 'BOM CSV',
  csvBomTooltip: 'BOM CSV 내보내기 (구성별 1행)',
  empty: '구성이 없습니다 — "+ 구성 추가"로 시작하세요',
  switchedDiscarded: '구성 전환됨 — 저장하지 않은 편집은 폐기됨',
  configCol: '구성',
  featureCol: '피처',
  paramCol: '파라미터',
};

const en: ConfigUiDict = {
  title: 'Configuration Table v2',
  close: 'Close',
  master: 'Master',
  add: '+ Add Configuration',
  rename: 'Rename',
  del: 'Delete',
  delConfirm: 'Delete this configuration?',
  activate: 'Activate',
  active: 'Active',
  parent: 'Parent',
  none: '(none)',
  cycleError: 'Cycle — parent rejected',
  variants: 'Variants',
  expressionVars: 'Expression vars',
  globalVars: 'Global vars',
  addVar: '+ Var',
  removeVar: 'Remove',
  varName: 'Name',
  varValue: 'Value',
  inherited: 'inherited',
  expression: 'expression',
  suppressed: 'suppressed',
  unsuppressed: 'active',
  toggleSuppress: 'Toggle suppress',
  familyExport: 'Family Export',
  familyExportTitle: 'Family STEP Export',
  familyExportAll: 'Select All',
  familyExportNone: 'Clear',
  familyExportGo: 'Export',
  familyExportCancel: 'Cancel',
  familyExportProgress: 'Progress',
  familyExportDone: 'Done',
  familyExportDeferred: 'Exported as placeholders — STEP worker hookup deferred to W4+',
  csvBom: 'BOM CSV',
  csvBomTooltip: 'Export BOM CSV (one row per config)',
  empty: 'No configurations — click "+ Add Configuration" to start',
  switchedDiscarded: 'Switched configuration — unsaved edit discarded',
  configCol: 'Configuration',
  featureCol: 'Feature',
  paramCol: 'Param',
};

const ja: ConfigUiDict = {
  title: '構成テーブル v2',
  close: '閉じる',
  master: 'マスター',
  add: '+ 構成追加',
  rename: '名前変更',
  del: '削除',
  delConfirm: 'この構成を削除しますか？',
  activate: '適用',
  active: '有効',
  parent: '親構成',
  none: '（なし）',
  cycleError: '循環参照 — 親拒否',
  variants: '変種',
  expressionVars: '式変数',
  globalVars: 'グローバル変数',
  addVar: '+ 変数',
  removeVar: '削除',
  varName: '名前',
  varValue: '値',
  inherited: '継承',
  expression: '式',
  suppressed: '抑制',
  unsuppressed: '有効',
  toggleSuppress: '抑制切替',
  familyExport: 'ファミリーエクスポート',
  familyExportTitle: 'ファミリー STEP エクスポート',
  familyExportAll: 'すべて選択',
  familyExportNone: '選択解除',
  familyExportGo: 'エクスポート',
  familyExportCancel: 'キャンセル',
  familyExportProgress: '進行中',
  familyExportDone: '完了',
  familyExportDeferred: 'プレースホルダーとしてエクスポート — STEP ワーカー連携は W4+',
  csvBom: 'BOM CSV',
  csvBomTooltip: 'BOM CSV エクスポート（構成ごとに1行）',
  empty: '構成なし — "+ 構成追加" から開始',
  switchedDiscarded: '構成切替 — 未保存の編集は破棄',
  configCol: '構成',
  featureCol: 'フィーチャー',
  paramCol: 'パラメータ',
};

const zh: ConfigUiDict = {
  title: '配置表 v2',
  close: '关闭',
  master: '主版本',
  add: '+ 添加配置',
  rename: '重命名',
  del: '删除',
  delConfirm: '删除此配置？',
  activate: '应用',
  active: '激活',
  parent: '父配置',
  none: '（无）',
  cycleError: '检测到循环 — 父级被拒',
  variants: '变体',
  expressionVars: '表达式变量',
  globalVars: '全局变量',
  addVar: '+ 变量',
  removeVar: '移除',
  varName: '名称',
  varValue: '值',
  inherited: '继承',
  expression: '表达式',
  suppressed: '已抑制',
  unsuppressed: '激活',
  toggleSuppress: '切换抑制',
  familyExport: '系列导出',
  familyExportTitle: '系列 STEP 导出',
  familyExportAll: '全选',
  familyExportNone: '取消选择',
  familyExportGo: '导出',
  familyExportCancel: '取消',
  familyExportProgress: '进度',
  familyExportDone: '完成',
  familyExportDeferred: '已作为占位符导出 — STEP 工作者将在 W4+ 接入',
  csvBom: 'BOM CSV',
  csvBomTooltip: '导出 BOM CSV（每个配置一行）',
  empty: '无配置 — 点击 "+ 添加配置" 开始',
  switchedDiscarded: '已切换配置 — 未保存的编辑已丢弃',
  configCol: '配置',
  featureCol: '特征',
  paramCol: '参数',
};

const es: ConfigUiDict = {
  title: 'Tabla de Configuración v2',
  close: 'Cerrar',
  master: 'Maestro',
  add: '+ Añadir configuración',
  rename: 'Renombrar',
  del: 'Eliminar',
  delConfirm: '¿Eliminar esta configuración?',
  activate: 'Activar',
  active: 'Activo',
  parent: 'Padre',
  none: '(ninguno)',
  cycleError: 'Ciclo detectado — padre rechazado',
  variants: 'Variantes',
  expressionVars: 'Variables de expresión',
  globalVars: 'Variables globales',
  addVar: '+ Var',
  removeVar: 'Quitar',
  varName: 'Nombre',
  varValue: 'Valor',
  inherited: 'heredado',
  expression: 'expresión',
  suppressed: 'suprimido',
  unsuppressed: 'activo',
  toggleSuppress: 'Alternar supresión',
  familyExport: 'Exportar familia',
  familyExportTitle: 'Exportar familia STEP',
  familyExportAll: 'Seleccionar todo',
  familyExportNone: 'Limpiar',
  familyExportGo: 'Exportar',
  familyExportCancel: 'Cancelar',
  familyExportProgress: 'Progreso',
  familyExportDone: 'Hecho',
  familyExportDeferred: 'Exportado como marcadores — conexión del worker STEP aplazada a W4+',
  csvBom: 'BOM CSV',
  csvBomTooltip: 'Exportar BOM CSV (una fila por configuración)',
  empty: 'Sin configuraciones — haga clic en "+ Añadir configuración"',
  switchedDiscarded: 'Configuración cambiada — edición no guardada descartada',
  configCol: 'Configuración',
  featureCol: 'Característica',
  paramCol: 'Parámetro',
};

const ar: ConfigUiDict = {
  title: 'جدول التكوين v2',
  close: 'إغلاق',
  master: 'الرئيسي',
  add: '+ إضافة تكوين',
  rename: 'إعادة تسمية',
  del: 'حذف',
  delConfirm: 'حذف هذا التكوين؟',
  activate: 'تنشيط',
  active: 'نشط',
  parent: 'الأصل',
  none: '(لا شيء)',
  cycleError: 'تم اكتشاف دورة — الأصل مرفوض',
  variants: 'المتغيرات',
  expressionVars: 'متغيرات التعبير',
  globalVars: 'متغيرات عامة',
  addVar: '+ متغير',
  removeVar: 'إزالة',
  varName: 'الاسم',
  varValue: 'القيمة',
  inherited: 'موروث',
  expression: 'تعبير',
  suppressed: 'مكبوت',
  unsuppressed: 'نشط',
  toggleSuppress: 'تبديل الكبت',
  familyExport: 'تصدير العائلة',
  familyExportTitle: 'تصدير عائلة STEP',
  familyExportAll: 'تحديد الكل',
  familyExportNone: 'مسح',
  familyExportGo: 'تصدير',
  familyExportCancel: 'إلغاء',
  familyExportProgress: 'التقدم',
  familyExportDone: 'تم',
  familyExportDeferred: 'تم التصدير كعناصر نائبة — تأجيل ربط العامل STEP إلى W4+',
  csvBom: 'BOM CSV',
  csvBomTooltip: 'تصدير BOM CSV (صف واحد لكل تكوين)',
  empty: 'لا توجد تكوينات — انقر "+ إضافة تكوين" للبدء',
  switchedDiscarded: 'تم تبديل التكوين — تم تجاهل التعديل غير المحفوظ',
  configCol: 'التكوين',
  featureCol: 'الميزة',
  paramCol: 'المعلمة',
};

export const CONFIG_UI_DICT: Record<Lang, ConfigUiDict> = { ko, en, ja, zh, es, ar };

/** Pick the dict for a language with a safe `en` fallback so the UI
 *  never blows up on an unknown locale segment. */
export function pickDict(lang: string | undefined): ConfigUiDict {
  if (lang && lang in CONFIG_UI_DICT) {
    return CONFIG_UI_DICT[lang as Lang];
  }
  return CONFIG_UI_DICT.en;
}
