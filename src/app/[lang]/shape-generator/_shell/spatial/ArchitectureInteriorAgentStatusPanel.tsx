import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type ArchitectureInteriorTrack = 'ai_design' | 'precision_cad';
export type ArchitectureInteriorMaturity = 'concept' | 'exact' | 'release';
export type ArchitectureInteriorGeometryStatus = 'not_run' | 'contract_only' | 'verified' | 'failed';

export type ArchitectureInteriorGeometryVerification = {
  status: ArchitectureInteriorGeometryStatus;
  blocker?: string | null;
};

export type ArchitectureInteriorRemoteProfile = {
  exposable: boolean;
  blocker?: string | null;
};

export type ArchitectureInteriorAgentStatusPanelProps = {
  lang: string;
  track: ArchitectureInteriorTrack;
  maturity: ArchitectureInteriorMaturity;
  geometryVerification: ArchitectureInteriorGeometryVerification;
  remoteProfile: ArchitectureInteriorRemoteProfile;
  pending?: boolean;
};

type Copy = {
  title: string;
  track: string;
  maturity: string;
  trackLabels: Record<ArchitectureInteriorTrack, string>;
  maturityLabels: Record<ArchitectureInteriorMaturity, string>;
  geometry: string;
  remoteProfile: string;
  operation: string;
  blockers: string;
  status: {
    ready: string;
    blocked: string;
    pending: string;
    contractOnly: string;
  };
  geometryStatus: Record<ArchitectureInteriorGeometryStatus, string>;
  remoteExposable: string;
  remoteBlocked: string;
  operationByKey: Record<string, string>;
  blockedOperation: string;
  contractOperation: string;
  pendingOperation: string;
  blockersByKey: Record<string, string>;
  contractReason: string;
  geometryFailure: string;
};

const COPY: Record<IsoLang, Copy> = {
  ko: {
    title: '건축·인테리어 에이전트 상태', track: '트랙', maturity: '성숙도', trackLabels: { ai_design: 'AI 설계', precision_cad: '정밀 CAD' }, maturityLabels: { concept: '개념', exact: '정확', release: '릴리스' }, geometry: '형상 검증', remoteProfile: '원격 프로필', operation: '현재 가능한 작업', blockers: '차단 사유',
    status: { ready: '실행 가능', blocked: '차단됨', pending: '검증 대기 중', contractOnly: '계약만 정의됨' },
    geometryStatus: { not_run: '아직 실행하지 않음', contract_only: '계약 전용', verified: '검증 완료', failed: '검증 실패' },
    remoteExposable: '노출 가능', remoteBlocked: '노출 차단',
    operationByKey: { ai_design_concept: 'AI 설계 개념안 생성', ai_design_exact: 'AI 설계 정밀안 검토', ai_design_release: 'AI 설계 릴리스 검토', precision_cad_exact: '정밀 CAD 에이전트 작업', precision_cad_release: '정밀 CAD 릴리스 검증' },
    blockedOperation: '실행 가능한 작업 없음', contractOperation: '계약 검토만 가능 — 실행 불가', pendingOperation: '검증 결과를 기다리는 중',
    blockersByKey: { maturity: '정밀 CAD는 정확(exact) 또는 릴리스(release) 성숙도가 필요합니다.', geometry: '정확한 작업을 시작하려면 형상 검증이 필요합니다.', remote: '실행하려면 원격 프로필을 노출할 수 있어야 합니다.' },
    contractReason: '계약(contract_only)은 성공한 검증이나 실행 가능한 CAD 결과가 아닙니다.', geometryFailure: '형상 검증이 실패했습니다.',
  },
  en: {
    title: 'Architecture & interior agent status', track: 'Track', maturity: 'Maturity', trackLabels: { ai_design: 'AI design', precision_cad: 'Precision CAD' }, maturityLabels: { concept: 'Concept', exact: 'Exact', release: 'Release' }, geometry: 'Geometry verification', remoteProfile: 'Remote profile', operation: 'Currently available work', blockers: 'Blockers',
    status: { ready: 'Ready to run', blocked: 'Blocked', pending: 'Verification pending', contractOnly: 'Contract only' },
    geometryStatus: { not_run: 'Not run', contract_only: 'Contract only', verified: 'Verified', failed: 'Failed' },
    remoteExposable: 'Exposable', remoteBlocked: 'Exposure blocked',
    operationByKey: { ai_design_concept: 'Generate an AI design concept', ai_design_exact: 'Review an exact AI design', ai_design_release: 'Review an AI design release', precision_cad_exact: 'Run the precision CAD agent', precision_cad_release: 'Verify the precision CAD release' },
    blockedOperation: 'No executable work is available', contractOperation: 'Contract review only — execution unavailable', pendingOperation: 'Wait for verification results',
    blockersByKey: { maturity: 'Precision CAD requires exact or release maturity.', geometry: 'Geometry verification is required before exact work can run.', remote: 'An exposable remote profile is required to run this work.' },
    contractReason: 'A contract-only result is not a successful verification or executable CAD result.', geometryFailure: 'Geometry verification failed.',
  },
  ja: {
    title: '建築・インテリアエージェントの状態', track: 'トラック', maturity: '成熟度', trackLabels: { ai_design: 'AI設計', precision_cad: '精密CAD' }, maturityLabels: { concept: 'コンセプト', exact: '正確', release: 'リリース' }, geometry: '形状検証', remoteProfile: 'リモートプロファイル', operation: '現在可能な作業', blockers: 'ブロッカー',
    status: { ready: '実行可能', blocked: 'ブロック中', pending: '検証待ち', contractOnly: '契約のみ' },
    geometryStatus: { not_run: '未実行', contract_only: '契約のみ', verified: '検証済み', failed: '失敗' },
    remoteExposable: '公開可能', remoteBlocked: '公開ブロック',
    operationByKey: { ai_design_concept: 'AI設計コンセプトを生成', ai_design_exact: 'AI設計の正確性を確認', ai_design_release: 'AI設計リリースを確認', precision_cad_exact: '精密CADエージェントを実行', precision_cad_release: '精密CADリリースを検証' },
    blockedOperation: '実行可能な作業はありません', contractOperation: '契約レビューのみ — 実行不可', pendingOperation: '検証結果を待機中',
    blockersByKey: { maturity: '精密CADにはexactまたはreleaseの成熟度が必要です。', geometry: 'exact作業の前に形状検証が必要です。', remote: '実行には公開可能なリモートプロファイルが必要です。' },
    contractReason: '契約のみの結果は、成功した検証や実行可能なCAD結果ではありません。', geometryFailure: '形状検証に失敗しました。',
  },
  zh: {
    title: '建筑与室内代理状态', track: '轨道', maturity: '成熟度', trackLabels: { ai_design: 'AI 设计', precision_cad: '精密 CAD' }, maturityLabels: { concept: '概念', exact: '精确', release: '发布' }, geometry: '几何验证', remoteProfile: '远程配置', operation: '当前可执行工作', blockers: '阻断原因',
    status: { ready: '可以执行', blocked: '已阻断', pending: '等待验证', contractOnly: '仅合同', },
    geometryStatus: { not_run: '未运行', contract_only: '仅合同', verified: '已验证', failed: '失败' },
    remoteExposable: '可暴露', remoteBlocked: '暴露被阻断',
    operationByKey: { ai_design_concept: '生成 AI 设计概念', ai_design_exact: '审查精确 AI 设计', ai_design_release: '审查 AI 设计发布', precision_cad_exact: '运行精密 CAD 代理', precision_cad_release: '验证精密 CAD 发布' },
    blockedOperation: '没有可执行的工作', contractOperation: '仅可审查合同 — 无法执行', pendingOperation: '等待验证结果',
    blockersByKey: { maturity: '精密 CAD 需要 exact 或 release 成熟度。', geometry: '开始精确工作前需要完成几何验证。', remote: '运行此工作需要可暴露的远程配置。' },
    contractReason: '仅合同结果不是成功验证，也不是可执行的 CAD 结果。', geometryFailure: '几何验证失败。',
  },
  es: {
    title: 'Estado del agente de arquitectura e interiores', track: 'Pista', maturity: 'Madurez', trackLabels: { ai_design: 'Diseño con IA', precision_cad: 'CAD de precisión' }, maturityLabels: { concept: 'Concepto', exact: 'Exacto', release: 'Versión' }, geometry: 'Verificación geométrica', remoteProfile: 'Perfil remoto', operation: 'Trabajo disponible ahora', blockers: 'Bloqueos',
    status: { ready: 'Listo para ejecutar', blocked: 'Bloqueado', pending: 'Verificación pendiente', contractOnly: 'Solo contrato' },
    geometryStatus: { not_run: 'No ejecutada', contract_only: 'Solo contrato', verified: 'Verificada', failed: 'Fallida' },
    remoteExposable: 'Exponible', remoteBlocked: 'Exposición bloqueada',
    operationByKey: { ai_design_concept: 'Generar un concepto de diseño con IA', ai_design_exact: 'Revisar un diseño exacto con IA', ai_design_release: 'Revisar una versión de diseño con IA', precision_cad_exact: 'Ejecutar el agente CAD de precisión', precision_cad_release: 'Verificar la versión CAD de precisión' },
    blockedOperation: 'No hay trabajo ejecutable', contractOperation: 'Solo revisión del contrato — ejecución no disponible', pendingOperation: 'Esperar los resultados de verificación',
    blockersByKey: { maturity: 'El CAD de precisión requiere madurez exact o release.', geometry: 'Se requiere verificación geométrica antes del trabajo exacto.', remote: 'Se requiere un perfil remoto exponible para ejecutar este trabajo.' },
    contractReason: 'Un resultado de solo contrato no es una verificación exitosa ni un resultado CAD ejecutable.', geometryFailure: 'La verificación geométrica falló.',
  },
  ar: {
    title: 'حالة وكيل الهندسة المعمارية والداخلية', track: 'المسار', maturity: 'النضج', trackLabels: { ai_design: 'تصميم بالذكاء الاصطناعي', precision_cad: 'CAD دقيق' }, maturityLabels: { concept: 'تصور', exact: 'دقيق', release: 'إصدار' }, geometry: 'التحقق الهندسي', remoteProfile: 'الملف البعيد', operation: 'العمل المتاح حاليًا', blockers: 'أسباب الحظر',
    status: { ready: 'جاهز للتنفيذ', blocked: 'محظور', pending: 'بانتظار التحقق', contractOnly: 'العقد فقط' },
    geometryStatus: { not_run: 'لم يُشغّل', contract_only: 'العقد فقط', verified: 'تم التحقق', failed: 'فشل' },
    remoteExposable: 'قابل للكشف', remoteBlocked: 'الكشف محظور',
    operationByKey: { ai_design_concept: 'إنشاء تصور تصميم بالذكاء الاصطناعي', ai_design_exact: 'مراجعة تصميم دقيق بالذكاء الاصطناعي', ai_design_release: 'مراجعة إصدار تصميم بالذكاء الاصطناعي', precision_cad_exact: 'تشغيل وكيل CAD الدقيق', precision_cad_release: 'التحقق من إصدار CAD الدقيق' },
    blockedOperation: 'لا يوجد عمل قابل للتنفيذ', contractOperation: 'مراجعة العقد فقط — التنفيذ غير متاح', pendingOperation: 'انتظر نتائج التحقق',
    blockersByKey: { maturity: 'يتطلب CAD الدقيق نضج exact أو release.', geometry: 'يلزم التحقق الهندسي قبل تشغيل العمل الدقيق.', remote: 'يلزم ملف بعيد قابل للكشف لتشغيل هذا العمل.' },
    contractReason: 'نتيجة العقد فقط ليست تحققًا ناجحًا ولا نتيجة CAD قابلة للتنفيذ.', geometryFailure: 'فشل التحقق الهندسي.',
  },
};

function operationKey(track: ArchitectureInteriorTrack, maturity: ArchitectureInteriorMaturity): string {
  return `${track}_${maturity}`;
}

export function ArchitectureInteriorAgentStatusPanel({ lang, track, maturity, geometryVerification, remoteProfile, pending = false }: ArchitectureInteriorAgentStatusPanelProps) {
  const t = COPY[toIsoLang(lang)];
  const blockers: string[] = [];
  const contractOnly = geometryVerification.status === 'contract_only';

  if (contractOnly) blockers.push(t.contractReason);
  if (!contractOnly && geometryVerification.status === 'failed') blockers.push(t.geometryFailure);
  if (!contractOnly && geometryVerification.status === 'not_run' && maturity !== 'concept') blockers.push(t.blockersByKey.geometry);
  if (!contractOnly && track === 'precision_cad' && maturity === 'concept') blockers.push(t.blockersByKey.maturity);
  if (maturity !== 'concept' && !remoteProfile.exposable) blockers.push(t.blockersByKey.remote);

  const state = contractOnly ? 'contract_only' : blockers.length ? 'blocked' : pending ? 'pending' : 'ready';
  const status = state === 'contract_only' ? t.status.contractOnly : state === 'pending' ? t.status.pending : state === 'blocked' ? t.status.blocked : t.status.ready;
  const operation = state === 'contract_only' ? t.contractOperation : state === 'pending' ? t.pendingOperation : state === 'blocked' ? t.blockedOperation : t.operationByKey[operationKey(track, maturity)];
  const geometryStatus = t.geometryStatus[geometryVerification.status];
  const remoteStatus = remoteProfile.exposable ? t.remoteExposable : t.remoteBlocked;

  return (
    <section
      data-testid="architecture-interior-agent-status-panel"
      data-state={state}
      dir={langDir(lang)}
      aria-live="polite"
      aria-busy={pending ? 'true' : 'false'}
      style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--nx-border, #334155)', borderRadius: 8, fontSize: 12 }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong data-testid="architecture-interior-agent-status-panel-title">{t.title}</strong>
        <span data-testid="architecture-interior-agent-status-panel-status" data-status={state}>{status}</span>
      </header>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 4, margin: 0 }}>
        <dt>{t.track}</dt><dd data-testid="architecture-interior-agent-status-panel-track" style={{ margin: 0 }}>{t.trackLabels[track]}</dd>
        <dt>{t.maturity}</dt><dd data-testid="architecture-interior-agent-status-panel-maturity" style={{ margin: 0 }}>{t.maturityLabels[maturity]}</dd>
        <dt>{t.geometry}</dt><dd data-testid="architecture-interior-agent-status-panel-geometry" style={{ margin: 0 }}>{geometryStatus}</dd>
        <dt>{t.remoteProfile}</dt><dd data-testid="architecture-interior-agent-status-panel-remote" style={{ margin: 0 }}>{remoteStatus}</dd>
      </dl>
      <div data-testid="architecture-interior-agent-status-panel-operation" style={{ padding: 8, borderRadius: 6, background: 'var(--nx-surface-muted, rgba(148, 163, 184, 0.12))' }}>
        <div>{t.operation}</div><strong>{operation}</strong>
      </div>
      {blockers.length > 0 && (
        <div data-testid="architecture-interior-agent-status-panel-blockers" role="alert">
          <div>{t.blockers}</div>
          <ul style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>{blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
