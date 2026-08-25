'use client';

import { useState } from 'react';
import { downloadBlob } from '@/lib/platform';
import { getComplexProductCommercialScopeCopy } from '@/lib/ai/complexProductCommercialScope';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type StageId = 'graph' | 'gearbox' | 'machine-skid' | 'welded-enclosure';
type StageReport = {
  schema: string;
  status: 'passed' | 'failed' | 'not_run';
  errors: string[];
  blockers: string[];
  releaseReady: boolean;
  sideEffects: Record<string, boolean>;
  graphReady?: boolean;
  familyContractReady?: boolean;
  familyContractRequired?: boolean;
  physicalValidationRequired?: boolean;
  physicalValidationComplete?: boolean;
  physicalCommissioningComplete?: boolean;
  finalExpertReviewComplete?: boolean;
  weldInspectionComplete?: boolean;
  dimensionalInspectionComplete?: boolean;
  ingressCertificationClaimed?: boolean;
  graphHash?: string | null;
  systemGraphHash?: string | null;
  applicationHash?: string | null;
};
type VerifyStage = (stage: StageId, graph: File, contract: File | null, artifacts: File[]) => Promise<StageReport>;
type ImpactReport = {
  schema: 'nexyfab.complex-system-change-impact-report.v1'; status: 'passed' | 'failed' | 'not_run'; impactPlanReady: boolean;
  scope: 'none' | 'partial' | 'full' | null; applicationHash: string | null; affectedNodeIds: string[]; affectedEdgeIds: string[];
  invalidatedEvidenceIds: string[]; reusableEvidenceIds: string[]; requiredReverificationKinds: string[]; revalidationRequired: boolean;
  errors: string[]; blockers: string[]; releaseReady: boolean; sideEffects: Record<string, boolean>;
};
type VerifyImpact = (baseGraph: File, targetGraph: File, baseArtifacts: File[], targetArtifacts: File[]) => Promise<ImpactReport>;
type ScaleReport = {
  schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1'; status: 'passed' | 'failed' | 'not_run'; benchmarkExecutionReady: boolean; benchmarkHash: string | null;
  tierSummaries: Array<{ occurrenceCount: number; workflow: string; slaPassed: boolean }>; errors: string[]; blockers: string[]; independentBenchmarkApprovalComplete: boolean; releaseReady: boolean; sideEffects: Record<string, boolean>;
};
type VerifyScale = (benchmark: File, artifacts: File[]) => Promise<ScaleReport>;
type StageDefinition = { id: StageId; endpoint: string; schema: string; title: string; titleKo: string; contract?: string; physicalGate: string; physicalGateKo: string };

type ComplexCopy = {
  summary: string; graph: string; artifacts: string; run: string; running: string; download: string;
  impact: string; impactSummary: string; previousGraph: string; previousArtifacts: string; analyze: string; analyzing: string; reverification: string; impactDownload: string;
  scale: string; scaleSummary: string; benchmark: string; scaleArtifacts: string; verifyScale: string; verifyingScale: string; scaleDownload: string; supported: string;
  stageTitles: Record<StageId, string>; stageGates: Record<StageId, string>; contracts: Record<StageId, string>;
};

const COPY: Record<IsoLang, ComplexCopy> = {
  ko: { summary: '복잡 제품 Verified Systems 검증', graph: '공통 Complex System Graph JSON', artifacts: '그래프에 선언된 원본 증거 파일 전체', run: '검증 실행', running: '서버 재계산 중…', download: '결과 JSON 다운로드', impact: 'Revision 부분 변경 영향 분석', impactSummary: '위 공통 graph·artifact를 target revision으로 사용합니다. 이전 revision의 graph와 전체 artifact를 추가하면 재검증할 dependency cone과 재사용 가능한 evidence를 서버가 계산합니다.', previousGraph: '이전 revision Graph JSON', previousArtifacts: '이전 revision 원본 증거 파일 전체', analyze: '변경 영향 분석', analyzing: '영향 재계산 중…', reverification: '재검증 종류', impactDownload: '영향 JSON 다운로드', scale: '20/100/500/1,000 조립체 성능 계약', scaleSummary: '고정 환경에서 각 단계 cold 3회·warm 3회와 raw trace·승인 SLA를 업로드합니다. 결정론·오류 0·p95 SLA를 서버가 재검산하며 독립 승인 전에는 출시 근거가 아닙니다.', benchmark: 'Scale benchmark JSON', scaleArtifacts: '원본 timing·trace·SLA·source artifact 전체', verifyScale: '성능 계약 검증', verifyingScale: '서버 재계산 중…', scaleDownload: '성능 결과 JSON 다운로드', supported: '현재 지원 제품군: 기어박스, 기계·스키드, 용접 구조물·인클로저. 로봇은 별도 고강도 Verified Systems 체인을 사용합니다.', stageTitles: { graph: '복잡 시스템 그래프 v2', gearbox: '기어박스 엔지니어링 계약', 'machine-skid': '기계·스키드 엔지니어링 계약', 'welded-enclosure': '용접 구조물·인클로저 계약' }, stageGates: { graph: '제품군 계약·실물 검증·최종 전문가 검토 필요', gearbox: '기어박스 시험 리그 실증·최종 전문가 검토 필요', 'machine-skid': '실물 시운전·최종 전문가 검토 필요', 'welded-enclosure': '용접·치수·방진방수 시험과 최종 전문가 검토 필요' }, contracts: { graph: '', gearbox: '기어박스 계약 JSON', 'machine-skid': '기계/스키드 계약 JSON', 'welded-enclosure': '용접/인클로저 계약 JSON' } },
  en: { summary: 'Complex-product Verified Systems verification', graph: 'Shared Complex System Graph JSON', artifacts: 'All source evidence declared by the graph', run: 'Run verification', running: 'Server recomputing…', download: 'Download result JSON', impact: 'Revision-scoped change impact', impactSummary: 'Uses the shared graph and artifacts above as the target revision. Add the previous graph and its full artifact set to compute the dependency cone requiring revalidation and evidence safe to reuse.', previousGraph: 'Previous-revision Graph JSON', previousArtifacts: 'All previous-revision source evidence', analyze: 'Analyze change impact', analyzing: 'Recomputing impact…', reverification: 'Reverification', impactDownload: 'Download impact JSON', scale: '20/100/500/1,000 assembly performance contract', scaleSummary: 'Upload three cold and three warm runs per tier from a fixed environment, plus raw traces and the approved SLA. The server recomputes determinism, zero-error and p95 SLA gates; this is not release evidence before independent approval.', benchmark: 'Scale benchmark JSON', scaleArtifacts: 'All raw timing, trace, SLA and source artifacts', verifyScale: 'Verify performance contract', verifyingScale: 'Server recomputing…', scaleDownload: 'Download performance JSON', supported: 'Supported families: gearbox, machine/skid, and welded structure/enclosure. Robots use the separate higher-assurance Verified Systems chain.', stageTitles: { graph: 'Complex System Graph v2', gearbox: 'Gearbox engineering contract', 'machine-skid': 'Machine / skid engineering contract', 'welded-enclosure': 'Welded structure / enclosure contract' }, stageGates: { graph: 'Product-family contract, physical validation and final expert review required', gearbox: 'Gearbox rig validation and final expert review required', 'machine-skid': 'Physical commissioning and final expert review required', 'welded-enclosure': 'Weld, dimensional and ingress tests plus final expert review required' }, contracts: { graph: '', gearbox: 'Gearbox contract JSON', 'machine-skid': 'Machine/skid contract JSON', 'welded-enclosure': 'Welded/enclosure contract JSON' } },
  ja: { summary: '複雑製品 Verified Systems 検証', graph: '共通 Complex System Graph JSON', artifacts: 'グラフに宣言されたすべての証拠ファイル', run: '検証を実行', running: 'サーバーで再計算中…', download: '結果 JSON をダウンロード', impact: 'リビジョン変更の影響分析', impactSummary: '共通グラフと証拠を対象リビジョンとして使用します。前リビジョンのグラフと証拠を追加すると、再検証範囲と再利用可能な証拠を計算します。', previousGraph: '前リビジョン Graph JSON', previousArtifacts: '前リビジョンの証拠ファイル', analyze: '変更影響を分析', analyzing: '影響を再計算中…', reverification: '再検証種別', impactDownload: '影響 JSON をダウンロード', scale: '20/100/500/1,000 アセンブリ性能契約', scaleSummary: '固定環境で各段階の cold/warm 実行、raw trace、承認済み SLA をアップロードします。独立承認前はリリース証拠ではありません。', benchmark: 'Scale benchmark JSON', scaleArtifacts: 'raw timing・trace・SLA・source artifact', verifyScale: '性能契約を検証', verifyingScale: 'サーバーで再計算中…', scaleDownload: '性能結果 JSON をダウンロード', supported: '対応製品群: ギアボックス、機械/スキッド、溶接構造/筐体。ロボットは別の高保証チェーンを使用します。', stageTitles: { graph: 'Complex System Graph v2', gearbox: 'ギアボックス技術契約', 'machine-skid': '機械 / スキッド技術契約', 'welded-enclosure': '溶接構造 / 筐体契約' }, stageGates: { graph: '製品群契約、実物検証、最終専門家レビューが必要', gearbox: '試験リグ検証と最終専門家レビューが必要', 'machine-skid': '実物試運転と最終専門家レビューが必要', 'welded-enclosure': '溶接・寸法・防水防塵試験と最終レビューが必要' }, contracts: { graph: '', gearbox: 'ギアボックス契約 JSON', 'machine-skid': '機械/スキッド契約 JSON', 'welded-enclosure': '溶接/筐体契約 JSON' } },
  zh: { summary: '复杂产品 Verified Systems 验证', graph: '共享 Complex System Graph JSON', artifacts: '图中声明的全部源证据文件', run: '运行验证', running: '服务器重新计算中…', download: '下载结果 JSON', impact: '修订范围变更影响分析', impactSummary: '使用共享图和证据作为目标修订。添加上一修订的图和全部证据后，服务器会计算需重新验证的依赖范围和可复用证据。', previousGraph: '上一修订 Graph JSON', previousArtifacts: '上一修订全部源证据', analyze: '分析变更影响', analyzing: '正在重新计算影响…', reverification: '重新验证类型', impactDownload: '下载影响 JSON', scale: '20/100/500/1,000 装配性能契约', scaleSummary: '从固定环境上传各层级 cold/warm 运行、原始 trace 和批准的 SLA。独立批准前不得作为发布证据。', benchmark: 'Scale benchmark JSON', scaleArtifacts: '全部原始 timing、trace、SLA 和源文件', verifyScale: '验证性能契约', verifyingScale: '服务器重新计算中…', scaleDownload: '下载性能 JSON', supported: '支持产品族：齿轮箱、机器/滑橇、焊接结构/外壳。机器人使用独立高保证链路。', stageTitles: { graph: '复杂系统图 v2', gearbox: '齿轮箱工程契约', 'machine-skid': '机器/滑橇工程契约', 'welded-enclosure': '焊接结构/外壳契约' }, stageGates: { graph: '需要产品族契约、实物验证和最终专家审查', gearbox: '需要齿轮箱试验台验证和最终专家审查', 'machine-skid': '需要实物调试和最终专家审查', 'welded-enclosure': '需要焊接、尺寸、防护测试和最终专家审查' }, contracts: { graph: '', gearbox: '齿轮箱契约 JSON', 'machine-skid': '机器/滑橇契约 JSON', 'welded-enclosure': '焊接/外壳契约 JSON' } },
  es: { summary: 'Verificación Verified Systems de producto complejo', graph: 'JSON del Complex System Graph compartido', artifacts: 'Todos los archivos de evidencia declarados por el grafo', run: 'Ejecutar verificación', running: 'Recalculando en el servidor…', download: 'Descargar resultado JSON', impact: 'Impacto del cambio por revisión', impactSummary: 'Usa el grafo y las evidencias compartidas como revisión objetivo. Añade el grafo y evidencias anteriores para calcular la zona que requiere reverificación y la evidencia reutilizable.', previousGraph: 'Graph JSON de la revisión anterior', previousArtifacts: 'Evidencias de la revisión anterior', analyze: 'Analizar impacto', analyzing: 'Recalculando impacto…', reverification: 'Tipos de reverificación', impactDownload: 'Descargar impacto JSON', scale: 'Contrato de rendimiento de ensamblajes 20/100/500/1.000', scaleSummary: 'Sube ejecuciones cold/warm, trazas y SLA aprobado desde un entorno fijo. No es evidencia de lanzamiento antes de la aprobación independiente.', benchmark: 'JSON de benchmark de escala', scaleArtifacts: 'Todos los tiempos, trazas, SLA y artefactos fuente', verifyScale: 'Verificar contrato de rendimiento', verifyingScale: 'Recalculando en el servidor…', scaleDownload: 'Descargar rendimiento JSON', supported: 'Familias compatibles: gearbox, máquina/skid y estructura/carcasa soldada. Los robots usan una cadena Verified Systems de mayor garantía.', stageTitles: { graph: 'Complex System Graph v2', gearbox: 'Contrato de ingeniería de gearbox', 'machine-skid': 'Contrato de ingeniería de máquina/skid', 'welded-enclosure': 'Contrato de estructura/carcasa soldada' }, stageGates: { graph: 'Requiere contrato de familia, validación física y revisión experta final', gearbox: 'Requiere validación del banco de gearbox y revisión experta final', 'machine-skid': 'Requiere puesta en marcha física y revisión experta final', 'welded-enclosure': 'Requiere pruebas de soldadura, dimensiones y estanqueidad y revisión final' }, contracts: { graph: '', gearbox: 'JSON de contrato de gearbox', 'machine-skid': 'JSON de contrato de máquina/skid', 'welded-enclosure': 'JSON de contrato soldado/carcasa' } },
  ar: { summary: 'التحقق من Verified Systems للمنتج المعقد', graph: 'JSON للرسم البياني المشترك للنظام المعقد', artifacts: 'كل ملفات الأدلة المصدر المعلنة في الرسم', run: 'تشغيل التحقق', running: 'إعادة الحساب على الخادم…', download: 'تنزيل JSON للنتيجة', impact: 'تحليل أثر التغيير حسب المراجعة', impactSummary: 'يستخدم الرسم والأدلة المشتركة كمراجعة مستهدفة. أضف رسم المراجعة السابقة وأدلتها لحساب نطاق إعادة التحقق والأدلة القابلة لإعادة الاستخدام.', previousGraph: 'Graph JSON للمراجعة السابقة', previousArtifacts: 'كل أدلة مصدر المراجعة السابقة', analyze: 'تحليل أثر التغيير', analyzing: 'إعادة حساب الأثر…', reverification: 'أنواع إعادة التحقق', impactDownload: 'تنزيل JSON للأثر', scale: 'عقد أداء التجميعات 20/100/500/1,000', scaleSummary: 'ارفع عمليات cold/warm والتتبعات وSLA المعتمد من بيئة ثابتة. لا يُعد ذلك دليلاً للإصدار قبل الاعتماد المستقل.', benchmark: 'JSON لمعيار القياس', scaleArtifacts: 'كل التوقيتات والتتبعات وSLA والملفات المصدر', verifyScale: 'التحقق من عقد الأداء', verifyingScale: 'إعادة الحساب على الخادم…', scaleDownload: 'تنزيل JSON للأداء', supported: 'العائلات المدعومة: علبة التروس، آلة/منصة، وهيكل/حاوية ملحومة. تستخدم الروبوتات سلسلة Verified Systems مستقلة عالية الضمان.', stageTitles: { graph: 'رسم النظام المعقد v2', gearbox: 'عقد هندسة علبة التروس', 'machine-skid': 'عقد هندسة الآلة/المنصة', 'welded-enclosure': 'عقد الهيكل/الحاوية الملحومة' }, stageGates: { graph: 'يتطلب عقد عائلة المنتج والتحقق الفيزيائي ومراجعة خبير نهائية', gearbox: 'يتطلب تحقق منصة الاختبار ومراجعة خبير نهائية', 'machine-skid': 'يتطلب تشغيلًا فعليًا ومراجعة خبير نهائية', 'welded-enclosure': 'يتطلب اختبارات اللحام والأبعاد والحماية ومراجعة نهائية' }, contracts: { graph: '', gearbox: 'JSON عقد علبة التروس', 'machine-skid': 'JSON عقد الآلة/المنصة', 'welded-enclosure': 'JSON عقد اللحام/الحاوية' } },
};

const STAGES: StageDefinition[] = [
  { id: 'graph', endpoint: '/api/cad/v1/system/verify', schema: 'nexyfab.complex-system-graph-report.v2', title: 'Complex System Graph v2', titleKo: '복잡 시스템 그래프 v2', physicalGate: 'Product-family contract, physical validation and final expert review required', physicalGateKo: '제품군 계약·실물 검증·최종 전문가 검토 필요' },
  { id: 'gearbox', endpoint: '/api/cad/v1/system/gearbox/verify', schema: 'nexyfab.gearbox-family-contract-report.v1', title: 'Gearbox engineering contract', titleKo: '기어박스 엔지니어링 계약', contract: 'Gearbox contract JSON', physicalGate: 'Gearbox rig validation and final expert review required', physicalGateKo: '기어박스 시험 리그 실증·최종 전문가 검토 필요' },
  { id: 'machine-skid', endpoint: '/api/cad/v1/system/machine-skid/verify', schema: 'nexyfab.machine-skid-family-contract-report.v1', title: 'Machine / skid engineering contract', titleKo: '기계·스키드 엔지니어링 계약', contract: 'Machine/skid contract JSON', physicalGate: 'Physical commissioning and final expert review required', physicalGateKo: '실물 시운전·최종 전문가 검토 필요' },
  { id: 'welded-enclosure', endpoint: '/api/cad/v1/system/welded-enclosure/verify', schema: 'nexyfab.welded-enclosure-family-contract-report.v1', title: 'Welded structure / enclosure contract', titleKo: '용접 구조물·인클로저 계약', contract: 'Welded/enclosure contract JSON', physicalGate: 'Weld, dimensional and ingress tests plus final expert review required', physicalGateKo: '용접·치수·방진방수 시험과 최종 전문가 검토 필요' },
];

async function readApiResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label} failed (HTTP ${response.status}): empty response`);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Reverse proxies and platform upload limits frequently return HTML. Do
    // not expose that body in the UI, but retain the actionable HTTP status.
    throw new Error(`${label} failed (HTTP ${response.status}): non-JSON response`);
  }
}

const defaultVerify: VerifyStage = async (stage, graph, contract, artifacts) => {
  const definition = STAGES.find(item => item.id === stage)!;
  const form = new FormData();
  form.set('graph', graph);
  if (contract) form.set('contract', contract);
  for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch(definition.endpoint, { method: 'POST', body: form });
  const body = await readApiResponse<{ report?: StageReport; message?: string }>(response, definition.title);
  if (!body.report) throw new Error(body.message ?? `${definition.title} failed (${response.status})`);
  return body.report;
};

const defaultVerifyImpact: VerifyImpact = async (baseGraph, targetGraph, baseArtifacts, targetArtifacts) => {
  const form = new FormData(); form.set('baseGraph', baseGraph); form.set('targetGraph', targetGraph);
  for (const artifact of baseArtifacts) form.append('baseArtifact', artifact);
  for (const artifact of targetArtifacts) form.append('targetArtifact', artifact);
  const response = await fetch('/api/cad/v1/system/change-impact/verify', { method: 'POST', body: form });
  const body = await readApiResponse<{ report?: ImpactReport; message?: string }>(response, 'Change-impact verification');
  if (!body.report) throw new Error(body.message ?? `Change-impact verification failed (${response.status})`);
  return body.report;
};

const defaultVerifyScale: VerifyScale = async (benchmark, artifacts) => {
  const form = new FormData(); form.set('benchmark', benchmark); for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch('/api/cad/v1/system/scale/verify', { method: 'POST', body: form });
  const body = await readApiResponse<{ report?: ScaleReport; message?: string }>(response, 'Scale benchmark verification');
  if (!body.report) throw new Error(body.message ?? `Scale benchmark verification failed (${response.status})`);
  return body.report;
};

function stageReady(stage: StageId, report: StageReport) {
  return stage === 'graph' ? report.graphReady === true : report.familyContractReady === true;
}

function validateReport(stage: StageDefinition, report: StageReport) {
  const ready = stageReady(stage.id, report);
  if (report.schema !== stage.schema || report.releaseReady !== false || !Array.isArray(report.errors) || !Array.isArray(report.blockers) || !report.sideEffects || Object.values(report.sideEffects).some(value => value !== false)) return false;
  if (ready && (report.status !== 'passed' || report.errors.length !== 0 || report.blockers.length === 0)) return false;
  if (!ready && report.status === 'passed') return false;
  if (stage.id === 'graph' && (report.familyContractRequired !== true || report.physicalValidationRequired !== true)) return false;
  if (stage.id === 'gearbox' && (report.physicalValidationComplete !== false || report.finalExpertReviewComplete !== false)) return false;
  if (stage.id === 'machine-skid' && report.physicalCommissioningComplete !== false) return false;
  if (stage.id === 'welded-enclosure' && (report.weldInspectionComplete !== false || report.dimensionalInspectionComplete !== false || report.ingressCertificationClaimed !== false)) return false;
  return true;
}

function validateImpactReport(report: ImpactReport) {
  if (report.schema !== 'nexyfab.complex-system-change-impact-report.v1' || report.status !== 'passed' || report.impactPlanReady !== true || !report.scope || report.releaseReady !== false || report.errors.length !== 0 || report.blockers.length === 0 || Object.values(report.sideEffects).some(value => value !== false)) return false;
  if (!report.revalidationRequired && (report.scope !== 'none' || report.invalidatedEvidenceIds.length !== 0 || report.requiredReverificationKinds.length !== 0)) return false;
  if (report.scope !== 'none' && (!report.revalidationRequired || report.invalidatedEvidenceIds.length === 0)) return false;
  return true;
}

function validateScaleReport(report: ScaleReport) {
  return report.schema === 'nexyfab.complex-assembly-scale-benchmark-report.v1' && report.status === 'passed' && report.benchmarkExecutionReady === true && report.releaseReady === false && report.independentBenchmarkApprovalComplete === false && report.errors.length === 0 && report.blockers.length > 0 && report.tierSummaries.map(item => item.occurrenceCount).join(',') === '20,100,500,1000' && report.tierSummaries.every(item => item.slaPassed) && Object.values(report.sideEffects).every(value => value === false);
}

export default function ComplexVerifiedSystemsPanel({ lang, verify = defaultVerify, verifyImpact = defaultVerifyImpact, verifyScale = defaultVerifyScale }: { lang: string; verify?: VerifyStage; verifyImpact?: VerifyImpact; verifyScale?: VerifyScale }) {
  const copy = COPY[toIsoLang(lang)];
  const commercialScope = getComplexProductCommercialScopeCopy(lang);
  const [graph, setGraph] = useState<File | null>(null);
  const [artifacts, setArtifacts] = useState<File[]>([]);
  const [contracts, setContracts] = useState<Partial<Record<StageId, File>>>({});
  const [reports, setReports] = useState<Partial<Record<StageId, StageReport>>>({});
  const [errors, setErrors] = useState<Partial<Record<StageId, string>>>({});
  const [busy, setBusy] = useState<StageId | 'impact' | 'scale' | null>(null);
  const [baseGraph, setBaseGraph] = useState<File | null>(null);
  const [baseArtifacts, setBaseArtifacts] = useState<File[]>([]);
  const [impactReport, setImpactReport] = useState<ImpactReport | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [scaleBenchmark, setScaleBenchmark] = useState<File | null>(null);
  const [scaleArtifacts, setScaleArtifacts] = useState<File[]>([]);
  const [scaleReport, setScaleReport] = useState<ScaleReport | null>(null);
  const [scaleError, setScaleError] = useState<string | null>(null);

  const resetAll = () => { setReports({}); setErrors({}); setImpactReport(null); setImpactError(null); };
  const updateContract = (stage: StageId, file?: File) => {
    setContracts(current => ({ ...current, [stage]: file }));
    setReports(current => ({ ...current, [stage]: undefined }));
    setErrors(current => ({ ...current, [stage]: undefined }));
  };
  const run = async (definition: StageDefinition) => {
    const contract = contracts[definition.id] ?? null;
    if (busy || !graph || artifacts.length === 0 || (definition.contract && !contract)) return;
    setBusy(definition.id);
    setReports(current => ({ ...current, [definition.id]: undefined }));
    setErrors(current => ({ ...current, [definition.id]: undefined }));
    try {
      const report = await verify(definition.id, graph, contract, artifacts);
      if (!validateReport(definition, report)) throw new Error('unsafe or contradictory complex-system response');
      setReports(current => ({ ...current, [definition.id]: report }));
    } catch (cause) {
      setErrors(current => ({ ...current, [definition.id]: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setBusy(null); }
  };
  const download = async (stage: StageId, report: StageReport) => {
    const identity = report.applicationHash ?? report.graphHash ?? report.systemGraphHash ?? report.schema;
    await downloadBlob(`complex-system-${stage}-${identity}.json`, new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));
  };
  const runImpact = async () => {
    if (busy || !baseGraph || !graph || baseArtifacts.length === 0 || artifacts.length === 0) return;
    setBusy('impact'); setImpactReport(null); setImpactError(null);
    try {
      const report = await verifyImpact(baseGraph, graph, baseArtifacts, artifacts);
      if (!validateImpactReport(report)) throw new Error('unsafe or contradictory change-impact response');
      setImpactReport(report);
    } catch (cause) { setImpactError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const downloadImpact = async (report: ImpactReport) => downloadBlob(`complex-system-change-impact-${report.applicationHash ?? 'blocked'}.json`, new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));
  const runScale = async () => {
    if (busy || !scaleBenchmark || scaleArtifacts.length === 0) return;
    setBusy('scale'); setScaleReport(null); setScaleError(null);
    try { const report = await verifyScale(scaleBenchmark, scaleArtifacts); if (!validateScaleReport(report)) throw new Error('unsafe or contradictory scale-benchmark response'); setScaleReport(report); }
    catch (cause) { setScaleError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const downloadScale = async (report: ScaleReport) => downloadBlob(`complex-assembly-scale-${report.benchmarkHash ?? 'blocked'}.json`, new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));

  return <details data-testid="complex-verified-systems" style={{ marginTop: 8 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{copy.summary}</summary>
    <div style={{ marginTop: 6, display: 'grid', gap: 7 }}>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-2)' }}>
        {copy.summary}
      </div>
      <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>
        {copy.graph}
        <input data-testid="complex-verified-graph-file" type="file" accept="application/json,.json" onChange={event => { setGraph(event.target.files?.[0] ?? null); resetAll(); }} />
      </label>
      <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>
        {copy.artifacts}
        <input data-testid="complex-verified-artifacts" type="file" multiple onChange={event => { setArtifacts(Array.from(event.target.files ?? [])); resetAll(); }} />
      </label>
      {STAGES.map((definition, index) => {
        const report = reports[definition.id];
        const ready = Boolean(graph && artifacts.length && (!definition.contract || contracts[definition.id]));
        return <details key={definition.id} data-testid={`complex-verified-${definition.id}`} style={{ border: '1px solid var(--nx-border)', borderRadius: 5, padding: 7 }}>
          <summary style={{ cursor: 'pointer' }}><b>{index + 1}. {copy.stageTitles[definition.id]}</b> · {report ? (stageReady(definition.id, report) ? 'passed' : 'blocked') : 'not_run'}</summary>
          <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
            {definition.contract && <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{copy.contracts[definition.id]}<input data-testid={`complex-verified-${definition.id}-contract`} type="file" accept="application/json,.json" onChange={event => updateContract(definition.id, event.target.files?.[0])} /></label>}
            <button data-testid={`complex-verified-${definition.id}-run`} type="button" disabled={!ready || busy !== null} onClick={() => run(definition)}>{busy === definition.id ? copy.running : copy.run}</button>
            {errors[definition.id] && <div data-testid={`complex-verified-${definition.id}-error`} role="alert" style={{ color: '#b91c1c' }}>{errors[definition.id]}</div>}
            {report && <div data-testid={`complex-verified-${definition.id}-report`} style={{ color: stageReady(definition.id, report) ? '#166534' : '#b91c1c' }}>
              <b>{report.status}</b> · release false
              <div style={{ color: '#92400e' }}>{copy.stageGates[definition.id]}</div>
              {report.errors.map(message => <div key={message}>{message}</div>)}
              <button data-testid={`complex-verified-${definition.id}-download`} type="button" onClick={() => download(definition.id, report)}>{copy.download}</button>
            </div>}
          </div>
        </details>;
      })}
      <details data-testid="complex-verified-impact" style={{ border: '1px solid var(--nx-border)', borderRadius: 5, padding: 7 }}>
        <summary style={{ cursor: 'pointer' }}><b>5. {copy.impact}</b> · {impactReport ? 'passed' : 'not_run'}</summary>
        <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
          <div style={{ fontSize: 10.5, color: 'var(--nx-text-2)' }}>{copy.impactSummary}</div>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{copy.previousGraph}<input data-testid="complex-verified-impact-base-graph" type="file" accept="application/json,.json" onChange={event => { setBaseGraph(event.target.files?.[0] ?? null); setImpactReport(null); setImpactError(null); }} /></label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{copy.previousArtifacts}<input data-testid="complex-verified-impact-base-artifacts" type="file" multiple onChange={event => { setBaseArtifacts(Array.from(event.target.files ?? [])); setImpactReport(null); setImpactError(null); }} /></label>
          <button data-testid="complex-verified-impact-run" type="button" disabled={busy !== null || !baseGraph || !graph || baseArtifacts.length === 0 || artifacts.length === 0} onClick={runImpact}>{busy === 'impact' ? copy.analyzing : copy.analyze}</button>
          {impactError && <div data-testid="complex-verified-impact-error" role="alert" style={{ color: '#b91c1c' }}>{impactError}</div>}
          {impactReport && <div data-testid="complex-verified-impact-report" style={{ color: impactReport.revalidationRequired ? '#92400e' : '#166534' }}>
            <b>{impactReport.scope}</b> · affected nodes {impactReport.affectedNodeIds.length} · edges {impactReport.affectedEdgeIds.length} · stale evidence {impactReport.invalidatedEvidenceIds.length} · reusable {impactReport.reusableEvidenceIds.length} · release false
            {impactReport.requiredReverificationKinds.length > 0 && <div>{copy.reverification}: {impactReport.requiredReverificationKinds.join(', ')}</div>}
            <button data-testid="complex-verified-impact-download" type="button" onClick={() => downloadImpact(impactReport)}>{copy.impactDownload}</button>
          </div>}
        </div>
      </details>
      <details data-testid="complex-verified-scale" style={{ border: '1px solid var(--nx-border)', borderRadius: 5, padding: 7 }}>
        <summary style={{ cursor: 'pointer' }}><b>6. {copy.scale}</b> · {scaleReport ? 'passed' : 'not_run'}</summary>
        <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
          <div style={{ fontSize: 10.5, color: 'var(--nx-text-2)' }}>{copy.scaleSummary}</div>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{copy.benchmark}<input data-testid="complex-verified-scale-benchmark" type="file" accept="application/json,.json" onChange={event => { setScaleBenchmark(event.target.files?.[0] ?? null); setScaleReport(null); setScaleError(null); }} /></label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{copy.scaleArtifacts}<input data-testid="complex-verified-scale-artifacts" type="file" multiple onChange={event => { setScaleArtifacts(Array.from(event.target.files ?? [])); setScaleReport(null); setScaleError(null); }} /></label>
          <button data-testid="complex-verified-scale-run" type="button" disabled={busy !== null || !scaleBenchmark || scaleArtifacts.length === 0} onClick={runScale}>{busy === 'scale' ? copy.verifyingScale : copy.verifyScale}</button>
          {scaleError && <div data-testid="complex-verified-scale-error" role="alert" style={{ color: '#b91c1c' }}>{scaleError}</div>}
          {scaleReport && <div data-testid="complex-verified-scale-report" style={{ color: '#166534' }}><b>passed</b> · tiers {scaleReport.tierSummaries.map(item => item.occurrenceCount).join('/')} · SLA pass · independent approval pending · release false<button data-testid="complex-verified-scale-download" type="button" onClick={() => downloadScale(scaleReport)}>{copy.scaleDownload}</button></div>}
        </div>
      </details>
      <div data-testid="complex-commercial-scope" style={{ display: 'grid', gap: 3, padding: 7, border: '1px solid #b7791f', borderRadius: 5, color: '#92400e', fontSize: 10.5 }}>
        <b>{commercialScope.badge}</b>
        <span>{commercialScope.families}</span>
        <span>{commercialScope.boundary}</span>
        <span>{commercialScope.gates.join(' → ')}</span>
        <span>{copy.supported}</span>
      </div>
    </div>
  </details>;
}
