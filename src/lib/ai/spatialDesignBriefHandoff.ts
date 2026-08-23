import type { DesignDomainId } from './domainProfile';
import { isSpatialAiCandidate, type SpatialAiCandidate } from './spatialAiCandidate';
import { loc } from '@/lib/i18n/loc';

export const SPATIAL_DESIGN_BRIEF_HANDOFF_KEY = 'nexyfab:spatial-design-brief-handoff:v1';
export const SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY = 'nexyfab:spatial-design-brief-handoff:v2';
export const SPATIAL_DESIGN_BRIEF_HANDOFF_V2_SCHEMA = 'nexyfab.spatial-design-brief-handoff.v2' as const;
export const SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY = 'nexyfab:spatial-design-candidate-return:v2';
export const SPATIAL_DESIGN_CANDIDATE_RETURN_V2_SCHEMA = 'nexyfab.spatial-design-candidate-return.v2' as const;
export const SPATIAL_AI_INSTRUCTION_KEY = 'nexyfab:spatial-ai-instruction:v1';
export const SPATIAL_AI_HANDOFF_REQUEST_EVENT = 'nexyfab:spatial-ai-handoff-request';

export type SpatialDesignDomain = Exclude<DesignDomainId, 'mechanical'>;
export type SpatialDraftValue = string | number | boolean;
export type SpatialDraftVerification = 'NOT_RUN' | 'RUNNING' | 'PREVIEW' | 'BLOCKED' | 'AUTH_REQUIRED';

export interface SpatialDesignBriefHandoff {
  schema: 'nexyfab.spatial-design-brief-handoff.v1';
  createdAt: number;
  domain: SpatialDesignDomain;
  unit: 'mm' | 'm';
  parameters: Record<string, SpatialDraftValue>;
  missingAuthority: string[];
  verification: SpatialDraftVerification;
}

export type SpatialAiHandoffMode = 'new_design' | 'request_only_edit';

/** Revision-bound handoff. v1 remains readable for old browser sessions. */
export interface SpatialDesignBriefHandoffV2 extends Omit<SpatialDesignBriefHandoff, 'schema'> {
  schema: typeof SPATIAL_DESIGN_BRIEF_HANDOFF_V2_SCHEMA;
  baseDocumentRevision: number;
  contentHash: string;
  documentId: string;
  parameterPaths: string[];
  locks: Array<{ id: string; target: { kind: 'workspace' | 'parameter' | 'feature' | 'assembly' | 'occurrence' | 'base_shape' | 'authoritative_input'; objectId: string; field?: string } }>;
  mode: SpatialAiHandoffMode;
}

export type SpatialDesignBrief = SpatialDesignBriefHandoff | SpatialDesignBriefHandoffV2;

export interface SpatialDesignCandidateReturnV2 {
  schema: typeof SPATIAL_DESIGN_CANDIDATE_RETURN_V2_SCHEMA;
  createdAt: number;
  handoff: SpatialDesignBriefHandoffV2;
  candidate: SpatialAiCandidate;
}

const DOMAINS: SpatialDesignDomain[] = ['building', 'civil', 'landscape', 'interior'];
const VERIFICATION: SpatialDraftVerification[] = ['NOT_RUN', 'RUNNING', 'PREVIEW', 'BLOCKED', 'AUTH_REQUIRED'];
const MAX_AGE_MS = 30 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;

interface SpatialAiInstruction {
  schema: 'nexyfab.spatial-ai-instruction.v1';
  createdAt: number;
  domain: SpatialDesignDomain;
  instruction: string;
}

export function saveSpatialAiInstruction(storage: Storage, domain: SpatialDesignDomain, instruction: string): void {
  const normalized = instruction.trim().slice(0, 2000);
  if (!normalized) {
    storage.removeItem(SPATIAL_AI_INSTRUCTION_KEY);
    return;
  }
  storage.setItem(SPATIAL_AI_INSTRUCTION_KEY, JSON.stringify({
    schema: 'nexyfab.spatial-ai-instruction.v1', createdAt: Date.now(), domain, instruction: normalized,
  } satisfies SpatialAiInstruction));
}

export function takeSpatialAiInstruction(storage: Storage, expectedDomain: SpatialDesignDomain, now = Date.now()): string | null {
  let value: unknown = null;
  try { value = JSON.parse(storage.getItem(SPATIAL_AI_INSTRUCTION_KEY) ?? 'null'); } catch { /* invalid session payload */ }
  storage.removeItem(SPATIAL_AI_INSTRUCTION_KEY);
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<SpatialAiInstruction>;
  if (item.schema !== 'nexyfab.spatial-ai-instruction.v1' || item.domain !== expectedDomain
    || typeof item.createdAt !== 'number' || now - item.createdAt < 0 || now - item.createdAt > MAX_AGE_MS
    || typeof item.instruction !== 'string' || !item.instruction.trim() || item.instruction.length > 2000) return null;
  return item.instruction.trim();
}

function safeParameters(value: unknown): value is Record<string, SpatialDraftValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 64 && entries.every(([key, item]) => (
    key.trim().length > 0 && key.length <= 80
    && (typeof item === 'string' ? item.length <= 240 : typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
  ));
}

export function isSpatialDesignBriefHandoff(value: unknown, now = Date.now()): value is SpatialDesignBriefHandoff {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SpatialDesignBriefHandoff>;
  return item.schema === 'nexyfab.spatial-design-brief-handoff.v1'
    && typeof item.createdAt === 'number'
    && now - item.createdAt >= 0
    && now - item.createdAt <= MAX_AGE_MS
    && DOMAINS.includes(item.domain as SpatialDesignDomain)
    && (item.unit === 'mm' || item.unit === 'm')
    && safeParameters(item.parameters)
    && Array.isArray(item.missingAuthority)
    && item.missingAuthority.length <= 32
    && item.missingAuthority.every(entry => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 240)
    && VERIFICATION.includes(item.verification as SpatialDraftVerification);
}

export function isSpatialDesignBriefHandoffV2(value: unknown, now = Date.now()): value is SpatialDesignBriefHandoffV2 {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SpatialDesignBriefHandoffV2>;
  if (item.schema !== SPATIAL_DESIGN_BRIEF_HANDOFF_V2_SCHEMA || !isSpatialDesignBriefHandoff({ ...item, schema: 'nexyfab.spatial-design-brief-handoff.v1' }, now)) return false;
  if (!Number.isSafeInteger(item.baseDocumentRevision) || (item.baseDocumentRevision ?? -1) < 0
    || typeof item.contentHash !== 'string' || !SHA256.test(item.contentHash)
    || typeof item.documentId !== 'string' || !item.documentId.trim() || item.documentId.length > 160
    || !Array.isArray(item.parameterPaths) || item.parameterPaths.length > 64
    || item.parameterPaths.some(path => typeof path !== 'string' || !path.trim() || path.length > 160 || path.includes('['))
    || (item.mode !== 'new_design' && item.mode !== 'request_only_edit')
    || !Array.isArray(item.locks) || item.locks.length > 64) return false;
  const lockIds = new Set<string>();
  return item.locks.every(lock => {
    if (!lock || typeof lock !== 'object' || typeof lock.id !== 'string' || !lock.id.trim() || lockIds.has(lock.id)
      || !lock.target || typeof lock.target !== 'object' || typeof lock.target.objectId !== 'string' || !lock.target.objectId.trim()
      || !['workspace', 'parameter', 'feature', 'assembly', 'occurrence', 'base_shape', 'authoritative_input'].includes(lock.target.kind)) return false;
    lockIds.add(lock.id); return true;
  });
}

export function saveSpatialDesignBriefHandoffV2(storage: Storage, handoff: Omit<SpatialDesignBriefHandoffV2, 'schema' | 'createdAt'>): void {
  const payload: SpatialDesignBriefHandoffV2 = { schema: SPATIAL_DESIGN_BRIEF_HANDOFF_V2_SCHEMA, createdAt: Date.now(), ...handoff };
  if (!isSpatialDesignBriefHandoffV2(payload)) throw new Error('Invalid spatial design brief handoff v2');
  storage.setItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY, JSON.stringify(payload));
}

export function takeSpatialDesignBriefHandoffAny(storage: Storage, expectedDomain?: SpatialDesignDomain): SpatialDesignBrief | null {
  let parsed: unknown = null;
  try { parsed = JSON.parse(storage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY) ?? 'null'); } catch { /* invalid v2 payload */ }
  if (isSpatialDesignBriefHandoffV2(parsed) && (!expectedDomain || parsed.domain === expectedDomain)) {
    storage.removeItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY); return parsed;
  }
  return takeSpatialDesignBriefHandoff(storage, expectedDomain);
}

export function saveSpatialDesignCandidateReturnV2(storage: Storage, input: { handoff: SpatialDesignBriefHandoffV2; candidate: SpatialAiCandidate }): void {
  if (!isSpatialDesignBriefHandoffV2(input.handoff) || !isSpatialAiCandidate(input.candidate)
    || input.handoff.documentId !== input.candidate.documentId || input.handoff.contentHash !== input.candidate.contentHash
    || input.handoff.baseDocumentRevision !== input.candidate.baseDocumentRevision || input.handoff.domain !== input.candidate.domain) {
    throw new Error('Invalid spatial design candidate return v2');
  }
  const payload: SpatialDesignCandidateReturnV2 = { schema: SPATIAL_DESIGN_CANDIDATE_RETURN_V2_SCHEMA, createdAt: Date.now(), ...input };
  storage.setItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY, JSON.stringify(payload));
}

export function takeSpatialDesignCandidateReturnV2(storage: Storage, expectedDomain?: SpatialDesignDomain, now = Date.now()): SpatialDesignCandidateReturnV2 | null {
  let parsed: unknown = null;
  try { parsed = JSON.parse(storage.getItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY) ?? 'null'); } catch { /* invalid one-shot packet */ }
  if (!parsed || typeof parsed !== 'object') {
    storage.removeItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY);
    return null;
  }
  const item = parsed as Partial<SpatialDesignCandidateReturnV2>;
  if (item.schema !== SPATIAL_DESIGN_CANDIDATE_RETURN_V2_SCHEMA || typeof item.createdAt !== 'number'
    || now - item.createdAt < 0 || now - item.createdAt > MAX_AGE_MS
    || !isSpatialDesignBriefHandoffV2(item.handoff, now) || !isSpatialAiCandidate(item.candidate)) {
    storage.removeItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY);
    return null;
  }
  if (expectedDomain && item.handoff.domain !== expectedDomain) return null;
  if (item.handoff.documentId !== item.candidate.documentId || item.handoff.contentHash !== item.candidate.contentHash
    || item.handoff.baseDocumentRevision !== item.candidate.baseDocumentRevision || item.handoff.domain !== item.candidate.domain) {
    storage.removeItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY);
    return null;
  }
  storage.removeItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY);
  // The return packet is the authoritative copy of its handoff. Clear paired
  // fallback packets so a re-render or later navigation cannot overwrite the
  // reviewed candidate with the older draft.
  storage.removeItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY);
  storage.removeItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY);
  return item as SpatialDesignCandidateReturnV2;
}

export function saveSpatialDesignBriefHandoff(
  storage: Storage,
  handoff: Omit<SpatialDesignBriefHandoff, 'schema' | 'createdAt'>,
): void {
  const payload: SpatialDesignBriefHandoff = {
    schema: 'nexyfab.spatial-design-brief-handoff.v1',
    createdAt: Date.now(),
    ...handoff,
  };
  if (!isSpatialDesignBriefHandoff(payload)) throw new Error('Invalid spatial design brief handoff');
  storage.setItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY, JSON.stringify(payload));
}

export function takeSpatialDesignBriefHandoff(
  storage: Storage,
  expectedDomain?: SpatialDesignDomain,
): SpatialDesignBriefHandoff | null {
  let parsed: unknown = null;
  try { parsed = JSON.parse(storage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY) ?? 'null'); } catch { /* invalid session payload */ }
  if (!isSpatialDesignBriefHandoff(parsed) || (expectedDomain && parsed.domain !== expectedDomain)) return null;
  storage.removeItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY);
  return parsed;
}

export function formatSpatialDesignBriefPrompt(handoff: SpatialDesignBrief, lang: string): string {
  const copy = {
    heading: loc(lang, { ko: `[정밀 CAD에서 전달된 ${handoff.domain} 설계 브리프]`, en: `[${handoff.domain} design brief transferred from Precision CAD]`, ja: `[Precision CADから転送された${handoff.domain}設計ブリーフ]`, zh: `[从 Precision CAD 传来的 ${handoff.domain} 设计简报]`, es: `[Brief de diseño de ${handoff.domain} transferido desde Precision CAD]`, ar: `[موجز تصميم ${handoff.domain} منقول من Precision CAD]` }),
    draft: loc(lang, { ko: '현재 값은 작업공간 초안이며 승인된 권위 자료가 아닙니다.', en: 'Current values are workspace drafts, not approved authority data.', ja: '現在の値はワークスペースの草案であり、承認済みの権威データではありません。', zh: '当前值是工作区草稿，并非已批准的权威数据。', es: 'Los valores actuales son borradores del espacio de trabajo, no datos autorizados aprobados.', ar: 'القيم الحالية مسودات لمساحة العمل وليست بيانات معتمدة.' }),
    values: loc(lang, { ko: '현재 초안 값:', en: 'Current draft values:', ja: '現在の草案値:', zh: '当前草稿值：', es: 'Valores del borrador actual:', ar: 'قيم المسودة الحالية:' }),
    verification: loc(lang, { ko: `현재 로컬 검증 상태: ${handoff.verification}`, en: `Current local verification: ${handoff.verification}`, ja: `現在のローカル検証状態: ${handoff.verification}`, zh: `当前本地验证状态：${handoff.verification}`, es: `Verificación local actual: ${handoff.verification}`, ar: `حالة التحقق المحلي الحالية: ${handoff.verification}` }),
    missing: loc(lang, { ko: '누락 또는 미검증 권위 입력:', en: 'Missing or unverified authority inputs:', ja: '不足または未検証の権威入力:', zh: '缺失或未验证的权威输入：', es: 'Entradas autorizadas faltantes o no verificadas:', ar: 'المدخلات المعتمدة المفقودة أو غير المتحقق منها:' }),
    noMissing: loc(lang, { ko: '- 명시된 누락 항목 없음(승인 완료를 의미하지 않음)', en: '- No missing item was declared (this does not mean authority approval)', ja: '- 明示された不足項目はありません（権威データの承認を意味しません）', zh: '- 未声明缺失项（不代表已获得权威批准）', es: '- No se declararon elementos faltantes (esto no significa aprobación autorizada)', ar: '- لم يتم تحديد عناصر مفقودة (لا يعني ذلك اعتماد البيانات)' }),
    instruction: loc(lang, { ko: '값이나 검증 상태를 임의로 승인하지 마세요. 누락 입력을 한 번에 하나씩 질문하고, 먼저 변경 계획만 제안하며 사용자 확인 전에는 정밀 CAD 형상에 적용하지 마세요.', en: 'Do not approve values or verification states yourself. Ask for missing inputs one at a time, propose a change plan first, and do not apply it to Precision CAD before user confirmation.', ja: '値や検証状態を自分で承認しないでください。不足入力は一度に一つずつ尋ね、まず変更計画を提案し、ユーザー確認前にPrecision CADへ適用しないでください。', zh: '请勿自行批准数值或验证状态。一次询问一个缺失输入，先提出变更计划，未经用户确认不要应用到 Precision CAD。', es: 'No apruebes por tu cuenta los valores ni los estados de verificación. Pregunta las entradas faltantes de una en una, propone primero un plan de cambios y no lo apliques en Precision CAD sin confirmación del usuario.', ar: 'لا تعتمد القيم أو حالات التحقق بنفسك. اسأل عن المدخلات المفقودة واحدة تلو الأخرى، واقترح خطة تغيير أولًا، ولا تطبقها على Precision CAD قبل تأكيد المستخدم.' }),
  };
  // Parameter names supplied by the workspace carry their own unit where one
  // applies (for example `length (m)`). CRS codes, counts and percentages must
  // never inherit the workspace's geometric unit.
  const values = Object.entries(handoff.parameters).map(([key, value]) => `- ${key}: ${String(value)}`);
  const authority = handoff.missingAuthority.length
    ? handoff.missingAuthority.map(item => `- ${item}`)
    : [copy.noMissing];
  return [
    copy.heading,
    copy.draft,
    copy.values,
    ...values,
    copy.verification,
    copy.missing,
    ...authority,
    copy.instruction,
  ].join('\n');
}
