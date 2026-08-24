'use client';

import type { CSSProperties } from 'react';
import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type DomainProductQualificationState = 'NOT_RUN' | 'HOLD' | 'PASS' | 'STALE' | 'INVALID';

export const DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA = 'nexyfab.precision-cad.product-qualification-view.v1' as const;

/**
 * Browser-safe, serializable shape accepted by the panel. The UI deliberately
 * does not import the server-side receipt evaluator or expose its raw errors.
 */
export type DomainProductQualificationPanelResult = {
  schema: typeof DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA;
  status: DomainProductQualificationState;
  eligibleState: 'PRODUCT_QUALIFIED' | null;
  releaseEligible: boolean;
  projectId: string | null;
  domain: string | null;
  revisionId: string | null;
  revisionSequence: number | null;
  contentSha256: string | null;
  artifactSha256: string | null;
  receiptSha256: string | null;
  blockerCodes: readonly string[];
  blockerCount: number;
};

export type DomainProductQualificationPanelProps = {
  lang: string;
  /** An untrusted serialized adapter result. Missing data is NOT_RUN. */
  result?: unknown;
  projectId?: string | null;
  domain?: string | null;
  revisionId?: string | null;
  contentSha256?: string | null;
  artifactSha256?: string | null;
  receiptSha256?: string | null;
};

type Copy = {
  title: string;
  disclaimer: string;
  status: Record<DomainProductQualificationState, string>;
  qualification: string;
  releaseEligible: string;
  validationPassed: string;
  holdReason: string;
  blockers: string;
  blockerCount: string;
  identity: string;
  project: string;
  domain: string;
  revision: string;
  content: string;
  artifact: string;
  receipt: string;
  none: string;
};

const COPY: Record<IsoLang, Copy> = {
  ko: {
    title: '제품 설계 자격 상태', disclaimer: '권위 있는 제품 영수증이 없으면 제품 출시 자격으로 간주하지 않습니다.',
    status: { NOT_RUN: '미실행', HOLD: '보류', PASS: '통과', STALE: '오래됨', INVALID: '무효' },
    qualification: '자격', releaseEligible: '출시 적격', validationPassed: '검증 통과(제품 자격 미확정)', holdReason: '권위 있는 자격 영수증 대기 중', blockers: '차단 코드', blockerCount: '차단 수',
    identity: '결속 정보', project: '프로젝트', domain: '분야', revision: '리비전', content: '콘텐츠 해시', artifact: '산출물 해시', receipt: '영수증 해시', none: '—',
  },
  en: {
    title: 'Product design qualification', disclaimer: 'Without an authoritative product receipt, this is not release qualification.',
    status: { NOT_RUN: 'NOT_RUN', HOLD: 'HOLD', PASS: 'PASS', STALE: 'STALE', INVALID: 'INVALID' },
    qualification: 'Qualification', releaseEligible: 'Release eligible', validationPassed: 'Validation passed (product qualification unconfirmed)', holdReason: 'Awaiting an authoritative qualification receipt', blockers: 'Blocker codes', blockerCount: 'Blocker count',
    identity: 'Bound identity', project: 'Project', domain: 'Domain', revision: 'Revision', content: 'Content hash', artifact: 'Artifact hash', receipt: 'Receipt hash', none: '—',
  },
  ja: {
    title: '製品設計の適格性', disclaimer: '権威ある製品レシートがない限り、リリース適格とはみなしません。',
    status: { NOT_RUN: '未実行', HOLD: '保留', PASS: '合格', STALE: '古い', INVALID: '無効' },
    qualification: '適格性', releaseEligible: 'リリース適格', validationPassed: '検証済み（製品適格性は未確定）', holdReason: '権威ある適格性レシートを待機中', blockers: 'ブロッカーコード', blockerCount: 'ブロッカー数',
    identity: '結合された識別情報', project: 'プロジェクト', domain: '分野', revision: 'リビジョン', content: 'コンテンツハッシュ', artifact: '成果物ハッシュ', receipt: 'レシートハッシュ', none: '—',
  },
  zh: {
    title: '产品设计资格状态', disclaimer: '没有权威产品收据时，不视为具备发布资格。',
    status: { NOT_RUN: '未运行', HOLD: '保留', PASS: '通过', STALE: '已过期', INVALID: '无效' },
    qualification: '资格', releaseEligible: '符合发布条件', validationPassed: '验证通过（产品资格未确认）', holdReason: '等待权威资格收据', blockers: '阻断代码', blockerCount: '阻断数',
    identity: '绑定标识', project: '项目', domain: '领域', revision: '修订版', content: '内容哈希', artifact: '产物哈希', receipt: '收据哈希', none: '—',
  },
  es: {
    title: 'Cualificación del diseño del producto', disclaimer: 'Sin un recibo de producto autoritativo, no hay cualificación de lanzamiento.',
    status: { NOT_RUN: 'NO EJECUTADO', HOLD: 'EN ESPERA', PASS: 'APROBADO', STALE: 'OBSOLETO', INVALID: 'NO VÁLIDO' },
    qualification: 'Cualificación', releaseEligible: 'Apto para lanzamiento', validationPassed: 'Validación aprobada (cualificación no confirmada)', holdReason: 'Esperando un recibo de cualificación autoritativo', blockers: 'Códigos de bloqueo', blockerCount: 'Cantidad de bloqueos',
    identity: 'Identidad vinculada', project: 'Proyecto', domain: 'Dominio', revision: 'Revisión', content: 'Hash del contenido', artifact: 'Hash del artefacto', receipt: 'Hash del recibo', none: '—',
  },
  ar: {
    title: 'تأهيل تصميم المنتج', disclaimer: 'من دون إيصال منتج موثوق، لا يُعد التصميم مؤهلاً للإصدار.',
    status: { NOT_RUN: 'لم يُشغّل', HOLD: 'معلّق', PASS: 'ناجح', STALE: 'قديم', INVALID: 'غير صالح' },
    qualification: 'التأهيل', releaseEligible: 'مؤهل للإصدار', validationPassed: 'نجح التحقق (تأهيل المنتج غير مؤكد)', holdReason: 'بانتظار إيصال تأهيل موثوق', blockers: 'رموز الحظر', blockerCount: 'عدد الحواجز',
    identity: 'الهوية المرتبطة', project: 'المشروع', domain: 'المجال', revision: 'المراجعة', content: 'تجزئة المحتوى', artifact: 'تجزئة الناتج', receipt: 'تجزئة الإيصال', none: '—',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RESULT_KEYS = [
  'schema', 'status', 'eligibleState', 'releaseEligible', 'projectId', 'domain',
  'revisionId', 'revisionSequence', 'contentSha256', 'artifactSha256',
  'receiptSha256', 'blockerCodes', 'blockerCount',
] as const;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  } catch {
    return false;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function bounded(value: unknown, fallback: string): string {
  const candidate = text(value);
  return candidate && candidate.length <= 96 && /^[A-Za-z0-9._:-]+$/u.test(candidate) ? candidate : fallback;
}

function boundedHash(value: unknown, fallback: string): string {
  const candidate = text(value);
  return candidate && /^[a-f0-9]{64}$/iu.test(candidate) ? `${candidate.slice(0, 8)}…` : fallback;
}

function normalizeState(value: unknown): DomainProductQualificationState {
  return value === 'NOT_RUN' || value === 'HOLD' || value === 'PASS' || value === 'STALE' || value === 'INVALID' ? value : 'INVALID';
}

function readResult(value: unknown): DomainProductQualificationPanelResult | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !exactKeys(value, RESULT_KEYS)) return null;
  let source: Record<string, unknown>;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (RESULT_KEYS.some(key => !descriptors[key] || !('value' in descriptors[key]))) return null;
    source = Object.fromEntries(RESULT_KEYS.map(key => [key, descriptors[key].value]));
  } catch {
    return null;
  }
  const status = normalizeState(source.status);
  const blockerCodes = Array.isArray(source.blockerCodes)
    ? source.blockerCodes.filter((code): code is string => typeof code === 'string' && /^[A-Z0-9_.:-]{1,48}$/u.test(code)).slice(0, 8)
    : [];
  const blockerCount = typeof source.blockerCount === 'number' && Number.isSafeInteger(source.blockerCount)
    ? Math.max(0, Math.min(99, source.blockerCount))
    : 99;
  return {
    schema: source.schema === DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA
      ? DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA
      : DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA,
    status: source.schema === DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA ? status : 'INVALID',
    eligibleState: source.eligibleState === 'PRODUCT_QUALIFIED' ? 'PRODUCT_QUALIFIED' : null,
    releaseEligible: source.releaseEligible === true,
    projectId: text(source.projectId), domain: text(source.domain), revisionId: text(source.revisionId),
    revisionSequence: typeof source.revisionSequence === 'number' && Number.isSafeInteger(source.revisionSequence) && source.revisionSequence >= 0 ? source.revisionSequence : null,
    contentSha256: text(source.contentSha256), artifactSha256: text(source.artifactSha256), receiptSha256: text(source.receiptSha256),
    blockerCodes,
    blockerCount,
  };
}

export function DomainProductQualificationPanel({ lang, result: rawResult, projectId, domain, revisionId, contentSha256, artifactSha256, receiptSha256 }: DomainProductQualificationPanelProps) {
  const locale = toIsoLang(lang);
  const direction = langDir(lang);
  const t = COPY[locale];
  const result = readResult(rawResult);
  const identityComplete = Boolean(
    result
    && bounded(result.projectId, '')
    && bounded(result.domain, '')
    && bounded(result.revisionId, '')
    && result.revisionSequence !== null
    && boundedHash(result.contentSha256, '')
    && boundedHash(result.artifactSha256, '')
    && boundedHash(result.receiptSha256, ''),
  );
  const productQualified = result?.status === 'PASS'
    && result.eligibleState === 'PRODUCT_QUALIFIED'
    && identityComplete
    && result.blockerCount === 0
    && result.blockerCodes.length === 0;
  const state: DomainProductQualificationState = result === null
    ? rawResult == null ? 'NOT_RUN' : 'INVALID'
    : result.status === 'PASS' && !productQualified ? 'INVALID' : result.status;
  const releaseEligible = productQualified && result?.releaseEligible === true;
  const codes = result?.blockerCodes ?? [];
  const blockerCount = result?.blockerCount ?? codes.length;
  const value = (key: keyof DomainProductQualificationPanelResult, fallback?: string | null) => result?.[key] ?? fallback;

  return (
    <section data-testid="domain-product-qualification-panel" data-state={state} dir={direction} aria-live="polite" aria-labelledby="domain-product-qualification-title" style={styles.panel}>
      <header style={styles.heading}>
        <strong id="domain-product-qualification-title" data-testid="domain-product-qualification-title">{t.title}</strong>
        <span role="status" aria-label={t.qualification} data-testid="domain-product-qualification-status" data-status={state}>{t.status[state]}</span>
      </header>
      <p data-testid="domain-product-qualification-disclaimer" style={styles.muted}>{t.disclaimer}</p>
      {productQualified ? (
        <div data-testid="domain-product-qualification-claim" style={styles.success}>
          <strong>{t.qualification}: PRODUCT_QUALIFIED</strong>
          {releaseEligible && <span data-testid="domain-product-release-eligible">{t.releaseEligible}</span>}
        </div>
      ) : (
        <div data-testid="domain-product-qualification-hold" style={styles.warning}>
          {state === 'PASS' ? t.validationPassed : t.holdReason}
        </div>
      )}
      <dl data-testid="domain-product-qualification-identity" style={styles.details}>
        <div><dt>{t.project}</dt><dd>{bounded(value('projectId', projectId), t.none)}</dd></div>
        <div><dt>{t.domain}</dt><dd>{bounded(value('domain', domain), t.none)}</dd></div>
        <div><dt>{t.revision}</dt><dd>{bounded(value('revisionId', revisionId), t.none)}{result?.revisionSequence !== null && result?.revisionSequence !== undefined ? ` @${result.revisionSequence}` : ''}</dd></div>
        <div><dt>{t.content}</dt><dd>{boundedHash(value('contentSha256', contentSha256), t.none)}</dd></div>
        <div><dt>{t.artifact}</dt><dd>{boundedHash(value('artifactSha256', artifactSha256), t.none)}</dd></div>
        <div><dt>{t.receipt}</dt><dd>{boundedHash(value('receiptSha256', receiptSha256), t.none)}</dd></div>
      </dl>
      {(codes.length > 0 || blockerCount > 0) && (
        <div data-testid="domain-product-qualification-blockers" role="status" style={styles.muted}>
          <span>{t.blockers}: {codes.length > 0 ? codes.join(', ') : t.none}</span>
          <span data-testid="domain-product-qualification-blocker-count"> ({t.blockerCount}: {Math.min(99, Math.max(0, blockerCount))})</span>
        </div>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { display: 'grid', gap: 8, padding: 12, border: '1px solid var(--nx-border, #334155)', borderRadius: 8, fontSize: 12, lineHeight: 1.45 },
  heading: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  details: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 4, margin: 0 },
  muted: { margin: 0, color: 'var(--nx-text-2, #8b949e)' },
  warning: { padding: 8, borderRadius: 6, color: '#f0c36d', background: 'var(--nx-surface-muted, rgba(148, 163, 184, 0.12))' },
  success: { display: 'grid', gap: 4, padding: 8, borderRadius: 6, color: 'var(--nx-success, #4ade80)', background: 'var(--nx-surface-muted, rgba(148, 163, 184, 0.12))' },
};
