'use client';

import { useEffect, useMemo, useState } from 'react';
import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import type { AgentRun, AgentRunEvent } from '@/lib/precision-cad-agent/runState';
import type { AgentControllerErrorCode, PrecisionCadAgentController } from '@/lib/precision-cad-agent/usePrecisionCadAgentController';

type PanelCopy = {
  title: string;
  request: string;
  requestPlaceholder: string;
  provider: string;
  model: string;
  start: string;
  progress: string;
  ledger: string;
  pending: string;
  arguments: string;
  approve: string;
  reject: string;
  cancel: string;
  resume: string;
  retry: string;
  ready: string;
  running: string;
  approval: string;
  completed: string;
  failed: string;
  cancelled: string;
  queued: string;
  revalidating: string;
  planning: string;
  eventLabels: Record<AgentRunEvent['type'], string>;
  scopeLabels: Record<'read' | 'propose' | 'apply' | 'export', string>;
};

export const PRECISION_CAD_AGENT_COPY: Record<IsoLang, PanelCopy> = {
  ko: { title: '정밀 CAD 에이전트', request: '요청', requestPlaceholder: '검토하거나 설계할 내용을 입력하세요', provider: '제공자', model: '모델', start: '실행 시작', progress: '진행', ledger: '이벤트 기록', pending: '승인 대기 도구 호출', arguments: '인수', approve: '승인', reject: '거부', cancel: '취소', resume: '재개', retry: '재시도', ready: '대기 중', running: '도구 실행 중', approval: '승인 대기', completed: '완료', failed: '실패', cancelled: '취소됨', queued: '서버 실행 대기열', revalidating: '재검증 중', planning: '계획 중', eventLabels: { run_created: '실행 생성', state_changed: '상태 변경', tool_call_requested: '도구 호출', approval_requested: '승인 요청', approval_granted: '승인됨', approval_rejected: '승인 거부', tool_result: '도구 결과', run_queued: '상용 실행 대기열 등록', run_failed: '실행 실패', run_cancelled: '실행 취소', run_resumed: '실행 재개', run_retried: '실행 재시도' }, scopeLabels: { read: '읽기', propose: '제안', apply: '적용', export: '내보내기' } },
  en: { title: 'Precision CAD agent', request: 'Request', requestPlaceholder: 'Describe what to inspect or design', provider: 'Provider', model: 'Model', start: 'Start run', progress: 'Progress', ledger: 'Event ledger', pending: 'Tool call awaiting approval', arguments: 'Arguments', approve: 'Approve', reject: 'Reject', cancel: 'Cancel', resume: 'Resume', retry: 'Retry', ready: 'Ready', running: 'Tool running', approval: 'Awaiting approval', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued on server', revalidating: 'Revalidating', planning: 'Planning', eventLabels: { run_created: 'Run created', state_changed: 'State changed', tool_call_requested: 'Tool call', approval_requested: 'Approval requested', approval_granted: 'Approval granted', approval_rejected: 'Approval rejected', tool_result: 'Tool result', run_queued: 'Commercial execution queued', run_failed: 'Run failed', run_cancelled: 'Run cancelled', run_resumed: 'Run resumed', run_retried: 'Run retried' }, scopeLabels: { read: 'Read', propose: 'Propose', apply: 'Apply', export: 'Export' } },
  ja: { title: '精密CADエージェント', request: 'リクエスト', requestPlaceholder: '確認または設計する内容を入力', provider: 'プロバイダー', model: 'モデル', start: '実行開始', progress: '進行状況', ledger: 'イベント記録', pending: '承認待ちのツール呼び出し', arguments: '引数', approve: '承認', reject: '拒否', cancel: 'キャンセル', resume: '再開', retry: '再試行', ready: '待機中', running: 'ツール実行中', approval: '承認待ち', completed: '完了', failed: '失敗', cancelled: 'キャンセル済み', queued: 'サーバー実行待ち', revalidating: '再検証中', planning: '計画中', eventLabels: { run_created: '実行を作成', state_changed: '状態変更', tool_call_requested: 'ツール呼び出し', approval_requested: '承認を要求', approval_granted: '承認済み', approval_rejected: '承認を拒否', tool_result: 'ツール結果', run_queued: '商用実行をキュー登録', run_failed: '実行失敗', run_cancelled: '実行キャンセル', run_resumed: '実行再開', run_retried: '実行再試行' }, scopeLabels: { read: '読み取り', propose: '提案', apply: '適用', export: '書き出し' } },
  zh: { title: '精密 CAD 代理', request: '请求', requestPlaceholder: '描述要检查或设计的内容', provider: '提供商', model: '模型', start: '开始运行', progress: '进度', ledger: '事件记录', pending: '等待批准的工具调用', arguments: '参数', approve: '批准', reject: '拒绝', cancel: '取消', resume: '继续', retry: '重试', ready: '就绪', running: '工具运行中', approval: '等待批准', completed: '已完成', failed: '失败', cancelled: '已取消', queued: '服务器队列中', revalidating: '重新验证中', planning: '规划中', eventLabels: { run_created: '创建运行', state_changed: '状态变更', tool_call_requested: '工具调用', approval_requested: '请求批准', approval_granted: '已批准', approval_rejected: '已拒绝', tool_result: '工具结果', run_queued: '商业执行已入队', run_failed: '运行失败', run_cancelled: '运行取消', run_resumed: '运行继续', run_retried: '运行重试' }, scopeLabels: { read: '读取', propose: '提议', apply: '应用', export: '导出' } },
  es: { title: 'Agente CAD de precisión', request: 'Solicitud', requestPlaceholder: 'Describe qué inspeccionar o diseñar', provider: 'Proveedor', model: 'Modelo', start: 'Iniciar ejecución', progress: 'Progreso', ledger: 'Registro de eventos', pending: 'Llamada de herramienta pendiente de aprobación', arguments: 'Argumentos', approve: 'Aprobar', reject: 'Rechazar', cancel: 'Cancelar', resume: 'Reanudar', retry: 'Reintentar', ready: 'Listo', running: 'Herramienta en ejecución', approval: 'Esperando aprobación', completed: 'Completado', failed: 'Fallido', cancelled: 'Cancelado', queued: 'En cola del servidor', revalidating: 'Revalidando', planning: 'Planificando', eventLabels: { run_created: 'Ejecución creada', state_changed: 'Estado cambiado', tool_call_requested: 'Llamada de herramienta', approval_requested: 'Aprobación solicitada', approval_granted: 'Aprobada', approval_rejected: 'Rechazada', tool_result: 'Resultado de herramienta', run_queued: 'Ejecución comercial en cola', run_failed: 'Ejecución fallida', run_cancelled: 'Ejecución cancelada', run_resumed: 'Ejecución reanudada', run_retried: 'Ejecución reintentada' }, scopeLabels: { read: 'Lectura', propose: 'Proponer', apply: 'Aplicar', export: 'Exportar' } },
  ar: { title: 'وكيل CAD الدقيق', request: 'الطلب', requestPlaceholder: 'صف ما تريد فحصه أو تصميمه', provider: 'المزوّد', model: 'النموذج', start: 'بدء التشغيل', progress: 'التقدم', ledger: 'سجل الأحداث', pending: 'استدعاء أداة بانتظار الموافقة', arguments: 'المعاملات', approve: 'موافقة', reject: 'رفض', cancel: 'إلغاء', resume: 'استئناف', retry: 'إعادة المحاولة', ready: 'جاهز', running: 'الأداة قيد التشغيل', approval: 'بانتظار الموافقة', completed: 'مكتمل', failed: 'فشل', cancelled: 'أُلغي', queued: 'في قائمة انتظار الخادم', revalidating: 'إعادة التحقق', planning: 'تخطيط', eventLabels: { run_created: 'إنشاء التشغيل', state_changed: 'تغيير الحالة', tool_call_requested: 'استدعاء أداة', approval_requested: 'طلب موافقة', approval_granted: 'تمت الموافقة', approval_rejected: 'رُفضت الموافقة', tool_result: 'نتيجة الأداة', run_queued: 'تمت جدولة التنفيذ التجاري', run_failed: 'فشل التشغيل', run_cancelled: 'إلغاء التشغيل', run_resumed: 'استئناف التشغيل', run_retried: 'إعادة تشغيل المحاولة' }, scopeLabels: { read: 'قراءة', propose: 'اقتراح', apply: 'تطبيق', export: 'تصدير' } },
};

const CATALOG_COPY: Record<IsoLang, { loading: string; ready: string }> = {
  ko: { loading: '도구 카탈로그를 불러오는 중입니다.', ready: '도구 카탈로그가 준비되었습니다.' },
  en: { loading: 'Loading the tool catalog.', ready: 'Tool catalog is ready.' },
  ja: { loading: 'ツールカタログを読み込んでいます。', ready: 'ツールカタログの準備ができました。' },
  zh: { loading: '正在加载工具目录。', ready: '工具目录已准备就绪。' },
  es: { loading: 'Cargando el catálogo de herramientas.', ready: 'El catálogo de herramientas está listo.' },
  ar: { loading: 'جارٍ تحميل كتالوج الأدوات.', ready: 'أصبح كتالوج الأدوات جاهزًا.' },
};

type LifecycleCopy = {
  title: string;
  phases: readonly [string, string, string, string, string, string];
  approvalBoundary: string;
  queueNotice: string;
  recoveryTitle: string;
  recovery: string;
};

export const PRECISION_CAD_LIFECYCLE_COPY: Record<IsoLang, LifecycleCopy> = {
  ko: { title: '통제 실행 단계', phases: ['계획', '검토', '승인', '실행', '검증', '복구'], approvalBoundary: '이 승인에는 표시된 도구·범위·인수 해시만 포함됩니다. 승인 전에는 CAD가 변경되지 않습니다.', queueNotice: '서버가 실행을 인계했습니다. 새 권위 리비전이 확인될 때까지 브라우저 연속 실행을 중지합니다.', recoveryTitle: '복구·되돌리기', recovery: '실패한 검증은 커밋하지 않습니다. 성공한 변경은 새 불변 리비전이며, 되돌리기도 이전 리비전을 덮지 않는 별도 승인 리비전으로 수행해야 합니다.' },
  en: { title: 'Governed execution', phases: ['Plan', 'Review', 'Approve', 'Execute', 'Verify', 'Recover'], approvalBoundary: 'This approval covers only the displayed tool, scope, arguments, and hash. CAD is unchanged before approval.', queueNotice: 'The server owns this execution now. Browser continuation is stopped until a new authoritative revision is available.', recoveryTitle: 'Recovery / rollback', recovery: 'Failed validation does not commit. A successful change creates an immutable revision; rollback must be a separately approved revision that preserves history.' },
  ja: { title: '統制された実行', phases: ['計画', '確認', '承認', '実行', '検証', '復旧'], approvalBoundary: '承認対象は表示されたツール、範囲、引数、ハッシュのみです。承認前に CAD は変更されません。', queueNotice: 'サーバーが実行を引き継ぎました。新しい確定リビジョンが得られるまでブラウザー継続を停止します。', recoveryTitle: '復旧・ロールバック', recovery: '検証失敗はコミットされません。成功した変更は不変リビジョンとなり、ロールバックも履歴を残す別承認リビジョンとして行います。' },
  zh: { title: '受控执行', phases: ['计划', '审查', '批准', '执行', '验证', '恢复'], approvalBoundary: '本次批准仅涵盖所示工具、范围、参数和哈希。批准前不会更改 CAD。', queueNotice: '服务器已接管执行。出现新的权威版本前，浏览器不会继续运行。', recoveryTitle: '恢复/回滚', recovery: '验证失败不会提交。成功变更会创建不可变版本；回滚也必须作为保留历史的单独批准版本执行。' },
  es: { title: 'Ejecución gobernada', phases: ['Plan', 'Revisión', 'Aprobación', 'Ejecución', 'Verificación', 'Recuperación'], approvalBoundary: 'La aprobación cubre solo la herramienta, el alcance, los argumentos y el hash mostrados. CAD no cambia antes de aprobar.', queueNotice: 'El servidor controla ahora la ejecución. El navegador se detiene hasta disponer de una nueva revisión autoritativa.', recoveryTitle: 'Recuperación / reversión', recovery: 'Una validación fallida no se confirma. Un cambio correcto crea una revisión inmutable; revertir requiere otra revisión aprobada que preserve el historial.' },
  ar: { title: 'تنفيذ محكوم', phases: ['الخطة', 'المراجعة', 'الموافقة', 'التنفيذ', 'التحقق', 'الاستعادة'], approvalBoundary: 'تشمل الموافقة الأداة والنطاق والمعاملات والتجزئة المعروضة فقط. لا يتغير CAD قبل الموافقة.', queueNotice: 'أصبح التنفيذ الآن تحت سيطرة الخادم، ويتوقف استمرار المتصفح حتى تتوفر مراجعة موثوقة جديدة.', recoveryTitle: 'الاستعادة / التراجع', recovery: 'فشل التحقق لا يُعتمد. ينشئ التغيير الناجح مراجعة غير قابلة للتغيير، ويتطلب التراجع مراجعة منفصلة معتمدة تحفظ السجل.' },
};

type ResultCopy = {
  title: string;
  isolated: string;
  persisted: string;
  artifacts: string;
  revision: string;
  releaseReady: string;
  notReleaseReady: string;
  reportOnly: string;
  promotionQueued: string;
  promotionBlocked: string;
};

export const PRECISION_CAD_RESULT_COPY: Record<IsoLang, ResultCopy> = {
  ko: { title: '최근 도구 결과', isolated: '격리 실행', persisted: '불변 저장', artifacts: '산출물', revision: '새 CAD 리비전', releaseReady: '릴리스 가능', notReleaseReady: '릴리스 불가', reportOnly: '보고서·미리보기만 생성됨', promotionQueued: '정확 B-rep 승격 대기열 등록', promotionBlocked: '정확 B-rep 승격 차단됨' },
  en: { title: 'Latest tool result', isolated: 'Isolated execution', persisted: 'Immutable persistence', artifacts: 'Artifacts', revision: 'New CAD revision', releaseReady: 'Release ready', notReleaseReady: 'Not release ready', reportOnly: 'Report and preview only', promotionQueued: 'Exact B-rep promotion queued', promotionBlocked: 'Exact B-rep promotion blocked' },
  ja: { title: '最新のツール結果', isolated: '分離実行', persisted: '不変保存', artifacts: '成果物', revision: '新しい CAD リビジョン', releaseReady: 'リリース可能', notReleaseReady: 'リリース不可', reportOnly: 'レポートとプレビューのみ', promotionQueued: '正確な B-rep 昇格をキュー登録', promotionBlocked: '正確な B-rep 昇格はブロック中' },
  zh: { title: '最新工具结果', isolated: '隔离执行', persisted: '不可变保存', artifacts: '产物', revision: '新 CAD 版本', releaseReady: '可发布', notReleaseReady: '不可发布', reportOnly: '仅生成报告和预览', promotionQueued: '精确 B-rep 升级已排队', promotionBlocked: '精确 B-rep 升级受阻' },
  es: { title: 'Último resultado', isolated: 'Ejecución aislada', persisted: 'Persistencia inmutable', artifacts: 'Artefactos', revision: 'Nueva revisión CAD', releaseReady: 'Listo para publicar', notReleaseReady: 'No listo para publicar', reportOnly: 'Solo informe y vista previa', promotionQueued: 'Promoción B-rep exacta en cola', promotionBlocked: 'Promoción B-rep exacta bloqueada' },
  ar: { title: 'أحدث نتيجة للأداة', isolated: 'تنفيذ معزول', persisted: 'حفظ غير قابل للتغيير', artifacts: 'المخرجات', revision: 'مراجعة CAD جديدة', releaseReady: 'جاهز للإصدار', notReleaseReady: 'غير جاهز للإصدار', reportOnly: 'تقرير ومعاينة فقط', promotionQueued: 'تمت جدولة ترقية B-rep الدقيقة', promotionBlocked: 'ترقية B-rep الدقيقة محظورة' },
};

const ERROR_COPY: Record<IsoLang, Record<AgentControllerErrorCode, string>> = {
  ko: { CATALOG_NOT_READY: '도구 카탈로그가 아직 준비되지 않았습니다.', CATALOG_LOAD_FAILED: '도구 카탈로그를 불러오지 못했습니다.', CATALOG_INVALID: '도구 카탈로그 검증에 실패했습니다.', TURN_FAILED: 'AI 실행에 실패했습니다.', TOOL_NOT_IN_CATALOG: '허용되지 않은 도구 호출입니다.', INVALID_TOOL_ARGUMENTS: '도구 인수가 유효하지 않습니다.', PARALLEL_TOOL_CALLS_UNSUPPORTED: '동시에 여러 도구를 실행할 수 없습니다.', TOOL_FAILED: '도구 실행에 실패했습니다.', BOUNDS_EXCEEDED: '실행 한도를 초과했습니다.', INVALID_APPROVAL_TOKEN: '승인 정보가 일치하지 않습니다.', APPROVAL_REJECTED: '승인이 거부되었습니다.', INVALID_RESUME: '실행을 재개할 수 없습니다.', INVALID_RETRY: '실행을 재시도할 수 없습니다.', CANCELLED: '실행이 취소되었습니다.', VALIDATION_REQUIRED: '완료 전 결정적 검증이 필요합니다.' },
  en: { CATALOG_NOT_READY: 'The tool catalog is not ready.', CATALOG_LOAD_FAILED: 'The tool catalog could not be loaded.', CATALOG_INVALID: 'The tool catalog failed validation.', TURN_FAILED: 'The AI run failed.', TOOL_NOT_IN_CATALOG: 'This tool call is not allowed.', INVALID_TOOL_ARGUMENTS: 'The tool arguments are invalid.', PARALLEL_TOOL_CALLS_UNSUPPORTED: 'Parallel tool calls are not supported.', TOOL_FAILED: 'The tool run failed.', BOUNDS_EXCEEDED: 'The run limit was exceeded.', INVALID_APPROVAL_TOKEN: 'The approval does not match this call.', APPROVAL_REJECTED: 'Approval was rejected.', INVALID_RESUME: 'The run cannot be resumed.', INVALID_RETRY: 'The run cannot be retried.', CANCELLED: 'The run was cancelled.', VALIDATION_REQUIRED: 'Deterministic validation is required before completion.' },
  ja: { CATALOG_NOT_READY: 'ツールカタログが準備できていません。', CATALOG_LOAD_FAILED: 'ツールカタログを読み込めませんでした。', CATALOG_INVALID: 'ツールカタログの検証に失敗しました。', TURN_FAILED: 'AI 実行に失敗しました。', TOOL_NOT_IN_CATALOG: '許可されていないツール呼び出しです。', INVALID_TOOL_ARGUMENTS: 'ツールの引数が無効です。', PARALLEL_TOOL_CALLS_UNSUPPORTED: '複数ツールの同時実行には対応していません。', TOOL_FAILED: 'ツール実行に失敗しました。', BOUNDS_EXCEEDED: '実行上限を超えました。', INVALID_APPROVAL_TOKEN: '承認情報がこの呼び出しと一致しません。', APPROVAL_REJECTED: '承認が拒否されました。', INVALID_RESUME: '実行を再開できません。', INVALID_RETRY: '実行を再試行できません。', CANCELLED: '実行をキャンセルしました。', VALIDATION_REQUIRED: '完了前に決定的な検証が必要です。' },
  zh: { CATALOG_NOT_READY: '工具目录尚未准备好。', CATALOG_LOAD_FAILED: '无法加载工具目录。', CATALOG_INVALID: '工具目录验证失败。', TURN_FAILED: 'AI 运行失败。', TOOL_NOT_IN_CATALOG: '此工具调用不被允许。', INVALID_TOOL_ARGUMENTS: '工具参数无效。', PARALLEL_TOOL_CALLS_UNSUPPORTED: '不支持并行工具调用。', TOOL_FAILED: '工具运行失败。', BOUNDS_EXCEEDED: '已超过运行限制。', INVALID_APPROVAL_TOKEN: '批准信息与此调用不匹配。', APPROVAL_REJECTED: '批准已被拒绝。', INVALID_RESUME: '无法继续运行。', INVALID_RETRY: '无法重试运行。', CANCELLED: '运行已取消。', VALIDATION_REQUIRED: '完成前需要确定性验证。' },
  es: { CATALOG_NOT_READY: 'El catálogo de herramientas no está listo.', CATALOG_LOAD_FAILED: 'No se pudo cargar el catálogo de herramientas.', CATALOG_INVALID: 'El catálogo de herramientas no superó la validación.', TURN_FAILED: 'Falló la ejecución de IA.', TOOL_NOT_IN_CATALOG: 'Esta llamada de herramienta no está permitida.', INVALID_TOOL_ARGUMENTS: 'Los argumentos de la herramienta no son válidos.', PARALLEL_TOOL_CALLS_UNSUPPORTED: 'No se admiten llamadas paralelas.', TOOL_FAILED: 'Falló la ejecución de la herramienta.', BOUNDS_EXCEEDED: 'Se superó el límite de ejecución.', INVALID_APPROVAL_TOKEN: 'La aprobación no coincide con esta llamada.', APPROVAL_REJECTED: 'La aprobación fue rechazada.', INVALID_RESUME: 'No se puede reanudar la ejecución.', INVALID_RETRY: 'No se puede reintentar la ejecución.', CANCELLED: 'La ejecución fue cancelada.', VALIDATION_REQUIRED: 'Se requiere validación determinista antes de completar.' },
  ar: { CATALOG_NOT_READY: 'كتالوج الأدوات غير جاهز.', CATALOG_LOAD_FAILED: 'تعذر تحميل كتالوج الأدوات.', CATALOG_INVALID: 'فشل التحقق من كتالوج الأدوات.', TURN_FAILED: 'فشل تشغيل الذكاء الاصطناعي.', TOOL_NOT_IN_CATALOG: 'استدعاء الأداة هذا غير مسموح.', INVALID_TOOL_ARGUMENTS: 'معاملات الأداة غير صالحة.', PARALLEL_TOOL_CALLS_UNSUPPORTED: 'لا يُسمح باستدعاءات الأدوات المتوازية.', TOOL_FAILED: 'فشل تشغيل الأداة.', BOUNDS_EXCEEDED: 'تم تجاوز حد التشغيل.', INVALID_APPROVAL_TOKEN: 'لا تتطابق الموافقة مع هذا الاستدعاء.', APPROVAL_REJECTED: 'تم رفض الموافقة.', INVALID_RESUME: 'لا يمكن استئناف التشغيل.', INVALID_RETRY: 'لا يمكن إعادة تشغيل المحاولة.', CANCELLED: 'تم إلغاء التشغيل.', VALIDATION_REQUIRED: 'يلزم التحقق الحتمي قبل الإكمال.' },
};

type Props = { lang: string; controller: PrecisionCadAgentController; initialRequest?: string };

const statusKey = (run: AgentRun, t: PanelCopy): string => ({ idle: t.ready, planning: t.planning, running_tool: t.running, awaiting_approval: t.approval, revalidating: t.revalidating, queued: t.queued, completed: t.completed, failed: t.failed, cancelled: t.cancelled })[run.state];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resultDetails(value: unknown) {
  const outer = asRecord(value);
  const tool = outer?.execution || outer?.persistence
    ? outer
    : asRecord(outer?.toolResult) ?? outer;
  const execution = asRecord(tool?.execution);
  const persistence = asRecord(tool?.persistence);
  const exactPromotion = asRecord(tool?.exactPromotion);
  const artifacts = Array.isArray(persistence?.artifacts)
    ? persistence.artifacts.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return { tool, execution, persistence, exactPromotion, artifacts };
}

function lifecyclePosition(run: AgentRun): number {
  if (run.state === 'completed') return 5;
  if (run.state === 'revalidating') return 4;
  if (run.state === 'queued' || run.state === 'running_tool') return 3;
  if (run.state === 'awaiting_approval') return 2;
  if (run.events.some(event => event.type === 'approval_granted' || event.type === 'tool_result')) return 3;
  if (run.events.some(event => event.type === 'approval_requested')) return 2;
  return 0;
}

export default function PrecisionCadAgentPanel({ lang, controller, initialRequest }: Props) {
  const t = PRECISION_CAD_AGENT_COPY[toIsoLang(lang)];
  const locale = toIsoLang(lang);
  const [request, setRequest] = useState(initialRequest?.trim() || controller.run.request.request || '');
  const run = controller.run;
  const pending = run.pendingApproval;
  const direction = langDir(lang);
  const progress = useMemo(() => `${run.steps}/${run.limits.maxSteps} · ${run.toolCalls}/${run.limits.maxToolCalls}`, [run.steps, run.toolCalls, run.limits]);
  const resultCopy = PRECISION_CAD_RESULT_COPY[locale];
  const lifecycleCopy = PRECISION_CAD_LIFECYCLE_COPY[locale];
  const latest = resultDetails(run.result);
  const lifecycle = lifecyclePosition(run);

  useEffect(() => {
    if (run.state === 'idle' && !run.request.request && initialRequest?.trim()) setRequest(initialRequest.trim());
  }, [initialRequest, run.request.request, run.state]);

  function start() {
    void controller.start(request);
  }

  function approve() {
    if (!pending) return;
    void controller.approve(pending.token);
  }

  function reject() {
    controller.reject();
  }

  function cancel() {
    controller.cancel();
  }

  function resume() {
    void controller.resume();
  }

  function retry() {
    void controller.retry();
  }

  return (
    <section dir={direction} aria-label={t.title} style={styles.panel}>
      <div style={styles.header}>
        <div><h2 style={styles.title}>{t.title}</h2><span style={styles.status}>{statusKey(run, t)}</span></div>
        <div style={styles.meta}><span>{t.provider}: {run.request.provider}</span><span>{t.model}: {run.request.model}</span></div>
      </div>
      {controller.loadingCatalog && <p role="status" style={styles.notice}>{CATALOG_COPY[locale].loading}</p>}
      {!controller.loadingCatalog && controller.catalog.length > 0 && <p role="status" style={styles.notice}>{CATALOG_COPY[locale].ready}</p>}
      {controller.error && <p role="alert" style={styles.error}>{ERROR_COPY[locale][controller.error.code]}{controller.error.detailCode && <code style={styles.errorCode}>{controller.error.detailCode}</code>}</p>}
      <label style={styles.label}>{t.request}<textarea value={request} onChange={(event) => setRequest(event.target.value)} placeholder={t.requestPlaceholder} rows={3} style={styles.textarea} /></label>
      <button type="button" onClick={start} disabled={controller.loadingCatalog || controller.catalog.length === 0 || !request.trim() || run.state === 'running_tool' || run.state === 'awaiting_approval' || run.state === 'queued'} style={styles.primary}>{t.start}</button>
      <div style={styles.progress}><strong>{t.progress}</strong><span>{progress}</span></div>
      <section data-testid="precision-cad-agent-lifecycle" style={styles.lifecycle} aria-label={lifecycleCopy.title}>
        <h3 style={styles.subheading}>{lifecycleCopy.title}</h3>
        <ol style={styles.lifecycleList}>{lifecycleCopy.phases.map((phase, index) => <li key={phase} data-state={index < lifecycle ? 'complete' : index === lifecycle ? 'current' : 'pending'} style={index < lifecycle ? styles.phaseComplete : index === lifecycle ? styles.phaseCurrent : styles.phasePending}><b>{index + 1}</b><span>{phase}</span></li>)}</ol>
      </section>
      {pending && run.state === 'awaiting_approval' && <div style={styles.approvalBox}><h3 style={styles.subheading}>{t.pending}</h3><p style={styles.toolName}>{pending.call.toolName} · {t.scopeLabels[pending.call.scope]}</p><p style={styles.approvalBoundary}>{lifecycleCopy.approvalBoundary}</p><code style={styles.approvalHash}>arguments {pending.argumentsHash}</code><h4 style={styles.argHeading}>{t.arguments}</h4><pre style={styles.args}>{JSON.stringify(pending.call.arguments, null, 2)}</pre><div style={styles.actions}><button type="button" onClick={approve} style={styles.approve}>{t.approve}</button><button type="button" onClick={reject} style={styles.reject}>{t.reject}</button></div></div>}
      {run.state === 'queued' && <p data-testid="precision-cad-agent-queued" role="status" style={styles.queueNotice}>{lifecycleCopy.queueNotice}</p>}
      {latest.tool && (
        <div style={styles.resultBox} data-testid="precision-cad-agent-result">
          <h3 style={styles.subheading}>{resultCopy.title}</h3>
          <div style={styles.resultBadges}>
            {latest.execution && <span style={styles.badge}>{resultCopy.isolated}: {String(latest.execution.status ?? 'succeeded')}</span>}
            {latest.persistence && <span style={styles.badge}>{resultCopy.persisted}: {latest.persistence.code === 'PENDING' ? t.queued : latest.persistence.ok === true ? t.completed : t.failed}</span>}
            {latest.persistence && <span style={latest.persistence.releaseReady === true ? styles.releaseBadge : styles.warningBadge}>{latest.persistence.releaseReady === true ? resultCopy.releaseReady : resultCopy.notReleaseReady}</span>}
          </div>
          {latest.persistence?.promotionStatus === 'report_preview_only' && <p style={styles.limitation}>{resultCopy.reportOnly}</p>}
          {latest.exactPromotion?.status === 'queued' && <p style={styles.promotion}>{resultCopy.promotionQueued} · {String(latest.exactPromotion.jobId ?? '')}</p>}
          {latest.exactPromotion?.status === 'blocked' && <p style={styles.limitation}>{resultCopy.promotionBlocked} · {String(latest.exactPromotion.code ?? '')}</p>}
          {latest.artifacts.length > 0 && <div style={styles.artifacts}><strong>{resultCopy.artifacts}</strong>{latest.artifacts.map((artifact, index) => <span key={String(artifact.artifactId ?? index)}>{String(artifact.filename ?? artifact.format ?? artifact.kind ?? `#${index + 1}`)} · {String(artifact.format ?? '')} · {String(artifact.contentSha256 ?? '').slice(0, 12)}</span>)}</div>}
          {asRecord(latest.persistence?.revision) && <p style={styles.revision}>{resultCopy.revision}: {String(asRecord(latest.persistence?.revision)?.revision ?? '')}</p>}
        </div>
      )}
      <section data-testid="precision-cad-agent-recovery" style={styles.recoveryBox}><h3 style={styles.subheading}>{lifecycleCopy.recoveryTitle}</h3><p style={styles.recoveryText}>{lifecycleCopy.recovery}</p></section>
      <div style={styles.ledger}><h3 style={styles.subheading}>{t.ledger}</h3>{run.events.map((entry) => <div key={`${entry.sequence}-${entry.type}`} style={styles.event}><span>#{entry.sequence + 1}</span><span>{t.eventLabels[entry.type]}</span>{entry.callId && <code>{entry.callId}</code>}</div>)}</div>
      <div style={styles.actions}>{!['queued', 'completed', 'failed', 'cancelled'].includes(run.state) && <button type="button" onClick={cancel} style={styles.secondary}>{t.cancel}</button>}{run.state === 'cancelled' && <button type="button" onClick={resume} style={styles.secondary}>{t.resume}</button>}{run.state === 'failed' && <button type="button" onClick={retry} style={styles.secondary}>{t.retry}</button>}</div>
    </section>
  );
}

const styles = {
  panel: { display: 'grid', gap: 14, padding: 20, border: '1px solid var(--nx-border, #30363d)', borderRadius: 14, background: 'var(--nx-panel, #161b22)', color: 'var(--nx-text, #e6edf3)', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const },
  title: { margin: 0, fontSize: 19 },
  status: { display: 'inline-block', marginTop: 5, color: 'var(--nx-text-2, #8b949e)', fontSize: 13 },
  notice: { margin: 0, color: 'var(--nx-text-2, #8b949e)', fontSize: 13 },
  error: { margin: 0, color: '#f85149', fontSize: 13 },
  errorCode: { display: 'block', marginTop: 4, color: '#ffb4a9', fontSize: 11 },
  meta: { display: 'grid', gap: 4, color: 'var(--nx-text-2, #8b949e)', fontSize: 12, textAlign: 'end' as const },
  label: { display: 'grid', gap: 7, fontSize: 13, fontWeight: 600 },
  textarea: { width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const, padding: 10, borderRadius: 8, border: '1px solid var(--nx-border, #30363d)', background: 'var(--nx-bg, #0d1117)', color: 'inherit', font: 'inherit' },
  primary: { justifySelf: 'start', padding: '9px 15px', border: 0, borderRadius: 8, background: '#238636', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  progress: { display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--nx-text-2, #8b949e)', fontSize: 13 },
  lifecycle: { display: 'grid', gap: 9, padding: 12, border: '1px solid var(--nx-border, #30363d)', borderRadius: 10, background: 'var(--nx-bg, #0d1117)' },
  lifecycleList: { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(72px, 1fr))', gap: 6, margin: 0, padding: 0, listStyle: 'none' },
  phaseComplete: { display: 'grid', gap: 5, placeItems: 'center', padding: 7, borderRadius: 7, color: '#56d364', background: '#12351f', fontSize: 11, textAlign: 'center' as const },
  phaseCurrent: { display: 'grid', gap: 5, placeItems: 'center', padding: 7, border: '1px solid #58a6ff', borderRadius: 7, color: '#79c0ff', background: '#0b2745', fontSize: 11, textAlign: 'center' as const },
  phasePending: { display: 'grid', gap: 5, placeItems: 'center', padding: 7, borderRadius: 7, color: '#8b949e', background: '#161b22', fontSize: 11, textAlign: 'center' as const },
  approvalBox: { padding: 14, border: '1px solid #d29922', borderRadius: 10, background: '#2b2111' },
  approvalBoundary: { margin: '6px 0', color: '#f0c36d', fontSize: 12, lineHeight: 1.5 },
  approvalHash: { display: 'block', color: '#d2a8ff', fontSize: 11 },
  queueNotice: { margin: 0, padding: 12, border: '1px solid #388bfd', borderRadius: 9, color: '#79c0ff', background: '#0b1830', fontSize: 12, lineHeight: 1.5 },
  recoveryBox: { display: 'grid', gap: 6, padding: 12, border: '1px solid #6e5b24', borderRadius: 10, background: '#17170f' },
  recoveryText: { margin: 0, color: '#d7c98b', fontSize: 12, lineHeight: 1.5 },
  resultBox: { display: 'grid', gap: 9, padding: 14, border: '1px solid #388bfd', borderRadius: 10, background: '#0b1830' },
  resultBadges: { display: 'flex', gap: 7, flexWrap: 'wrap' as const },
  badge: { padding: '4px 7px', borderRadius: 999, background: '#1f2937', color: '#c9d1d9', fontSize: 11 },
  releaseBadge: { padding: '4px 7px', borderRadius: 999, background: '#12351f', color: '#56d364', fontSize: 11, fontWeight: 700 },
  warningBadge: { padding: '4px 7px', borderRadius: 999, background: '#3b2a12', color: '#e3b341', fontSize: 11, fontWeight: 700 },
  limitation: { margin: 0, color: '#e3b341', fontSize: 12 },
  promotion: { margin: 0, color: '#58a6ff', fontSize: 12 },
  artifacts: { display: 'grid', gap: 4, color: 'var(--nx-text-2, #8b949e)', fontSize: 12 },
  revision: { margin: 0, color: '#56d364', fontSize: 12 },
  subheading: { margin: 0, fontSize: 14 },
  toolName: { margin: '7px 0', color: '#e3b341', fontSize: 13 },
  argHeading: { margin: '10px 0 5px', fontSize: 12 },
  args: { margin: 0, maxHeight: 180, overflow: 'auto', padding: 10, borderRadius: 7, background: '#010409', fontSize: 12, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  ledger: { display: 'grid', gap: 6 },
  event: { display: 'flex', gap: 9, alignItems: 'center', padding: '7px 9px', borderRadius: 7, background: 'var(--nx-bg, #0d1117)', color: 'var(--nx-text-2, #8b949e)', fontSize: 12 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  approve: { padding: '8px 13px', border: 0, borderRadius: 7, background: '#238636', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  reject: { padding: '8px 13px', border: '1px solid #f85149', borderRadius: 7, background: 'transparent', color: '#f85149', fontWeight: 700, cursor: 'pointer' },
  secondary: { padding: '8px 13px', border: '1px solid var(--nx-border, #30363d)', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer' },
};
