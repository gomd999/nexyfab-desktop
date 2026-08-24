import {
  CAD_MESSAGE_CODES,
  CAD_LOCALES,
  type CadLocale,
  type CadMessage,
  type CadMessageCode,
  type MessageParam,
  assertCadMessage,
  cadMessageParamKeys,
  isCadLocale,
} from './message';
import { toIsoLang } from '@/lib/i18n/normalize';

export type CadCatalog = Readonly<Record<CadMessageCode, string>>;
export type CadCatalogs = Readonly<Record<CadLocale, CadCatalog>>;

const en: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: 'Input is invalid: {{reason}}.',
  CAD_PERMISSION_DENIED: 'Permission denied for {{action}}.',
  CAD_LOCK_CONFLICT: 'Lock conflict for {{resource}}.',
  CAD_REVISION_STALE: 'Revision {{revision}} is stale.',
  CAD_MIGRATION_REQUIRED: 'Migration {{version}} is required.',
  CAD_PREFLIGHT_HOLD: 'Exact preflight is on hold: {{reason}}.',
  CAD_FEATURE_REGISTRY_MISMATCH: 'Feature registry {{registry}} does not match.',
  CAD_RUNTIME_IDENTITY_MISMATCH: 'Runtime identity field {{field}} does not match.',
  CAD_VERIFICATION_FAILED: 'Verification check {{check}} failed.',
  CAD_RELEASE_HOLD: 'Release is on hold: {{reason}}.',
  CAD_FEATURE_UNSUPPORTED: 'Feature {{feature}} is not supported.',
  CAD_EXACT_KERNEL_UNAVAILABLE: 'Exact kernel is unavailable.',
  CAD_ARTIFACT_VERSION_MISMATCH: 'Artifact version {{version}} is not supported.',
  CAD_RECEIPT_INVALID: 'Verification receipt is invalid: {{reason}}.',
};

const ko: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: '입력이 올바르지 않습니다: {{reason}}.',
  CAD_PERMISSION_DENIED: '{{action}} 권한이 없습니다.',
  CAD_LOCK_CONFLICT: '{{resource}} 잠금이 충돌했습니다.',
  CAD_REVISION_STALE: '리비전 {{revision}}이 오래되었습니다.',
  CAD_MIGRATION_REQUIRED: '마이그레이션 {{version}}이 필요합니다.',
  CAD_PREFLIGHT_HOLD: '정확한 사전 검사가 보류되었습니다: {{reason}}.',
  CAD_FEATURE_REGISTRY_MISMATCH: '기능 레지스트리 {{registry}}가 일치하지 않습니다.',
  CAD_RUNTIME_IDENTITY_MISMATCH: '런타임 식별자 필드 {{field}}가 일치하지 않습니다.',
  CAD_VERIFICATION_FAILED: '검증 검사 {{check}}가 실패했습니다.',
  CAD_RELEASE_HOLD: '릴리스가 보류되었습니다: {{reason}}.',
  CAD_FEATURE_UNSUPPORTED: '{{feature}} 기능은 지원되지 않습니다.',
  CAD_EXACT_KERNEL_UNAVAILABLE: '정확한 커널을 사용할 수 없습니다.',
  CAD_ARTIFACT_VERSION_MISMATCH: '{{version}} 아티팩트 버전은 지원되지 않습니다.',
  CAD_RECEIPT_INVALID: '검증 영수증이 올바르지 않습니다: {{reason}}.',
};

const ja: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: '入力が無効です: {{reason}}。',
  CAD_PERMISSION_DENIED: '{{action}} の権限がありません。',
  CAD_LOCK_CONFLICT: '{{resource}} のロックが競合しています。',
  CAD_REVISION_STALE: 'リビジョン {{revision}} は古くなっています。',
  CAD_MIGRATION_REQUIRED: '移行 {{version}} が必要です。',
  CAD_PREFLIGHT_HOLD: '正確な事前検査を保留しています: {{reason}}。',
  CAD_FEATURE_REGISTRY_MISMATCH: '機能レジストリ {{registry}} が一致しません。',
  CAD_RUNTIME_IDENTITY_MISMATCH: 'ランタイム識別子 {{field}} が一致しません。',
  CAD_VERIFICATION_FAILED: '検証項目 {{check}} に失敗しました。',
  CAD_RELEASE_HOLD: 'リリースを保留しています: {{reason}}。',
  CAD_FEATURE_UNSUPPORTED: '機能 {{feature}} は対応していません。',
  CAD_EXACT_KERNEL_UNAVAILABLE: '正確なカーネルを利用できません。',
  CAD_ARTIFACT_VERSION_MISMATCH: '成果物バージョン {{version}} は未対応です。',
  CAD_RECEIPT_INVALID: '検証レシートが無効です: {{reason}}。',
};

const zh: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: '输入无效：{{reason}}。',
  CAD_PERMISSION_DENIED: '没有 {{action}} 权限。',
  CAD_LOCK_CONFLICT: '{{resource}} 锁发生冲突。',
  CAD_REVISION_STALE: '修订版 {{revision}} 已过期。',
  CAD_MIGRATION_REQUIRED: '需要迁移 {{version}}。',
  CAD_PREFLIGHT_HOLD: '精确预检已暂停：{{reason}}。',
  CAD_FEATURE_REGISTRY_MISMATCH: '功能注册表 {{registry}} 不匹配。',
  CAD_RUNTIME_IDENTITY_MISMATCH: '运行时标识字段 {{field}} 不匹配。',
  CAD_VERIFICATION_FAILED: '验证检查 {{check}} 失败。',
  CAD_RELEASE_HOLD: '发布已暂停：{{reason}}。',
  CAD_FEATURE_UNSUPPORTED: '不支持 {{feature}} 功能。',
  CAD_EXACT_KERNEL_UNAVAILABLE: '精确内核不可用。',
  CAD_ARTIFACT_VERSION_MISMATCH: '不支持工件版本 {{version}}。',
  CAD_RECEIPT_INVALID: '验证收据无效：{{reason}}。',
};

const es: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: 'La entrada no es válida: {{reason}}.',
  CAD_PERMISSION_DENIED: 'No hay permiso para {{action}}.',
  CAD_LOCK_CONFLICT: 'Conflicto de bloqueo para {{resource}}.',
  CAD_REVISION_STALE: 'La revisión {{revision}} está obsoleta.',
  CAD_MIGRATION_REQUIRED: 'Se requiere la migración {{version}}.',
  CAD_PREFLIGHT_HOLD: 'La precomprobación exacta está retenida: {{reason}}.',
  CAD_FEATURE_REGISTRY_MISMATCH: 'El registro de funciones {{registry}} no coincide.',
  CAD_RUNTIME_IDENTITY_MISMATCH: 'El campo de identidad {{field}} no coincide.',
  CAD_VERIFICATION_FAILED: 'Falló la comprobación {{check}}.',
  CAD_RELEASE_HOLD: 'La publicación está retenida: {{reason}}.',
  CAD_FEATURE_UNSUPPORTED: 'La función {{feature}} no es compatible.',
  CAD_EXACT_KERNEL_UNAVAILABLE: 'El kernel exacto no está disponible.',
  CAD_ARTIFACT_VERSION_MISMATCH: 'La versión de artefacto {{version}} no es compatible.',
  CAD_RECEIPT_INVALID: 'El recibo de verificación no es válido: {{reason}}.',
};

const ar: Record<CadMessageCode, string> = {
  CAD_INPUT_INVALID: 'الإدخال غير صالح: {{reason}}.',
  CAD_PERMISSION_DENIED: 'لا يوجد إذن لـ {{action}}.',
  CAD_LOCK_CONFLICT: 'تعارض قفل المورد {{resource}}.',
  CAD_REVISION_STALE: 'المراجعة {{revision}} قديمة.',
  CAD_MIGRATION_REQUIRED: 'الترحيل {{version}} مطلوب.',
  CAD_PREFLIGHT_HOLD: 'الفحص الدقيق معلّق: {{reason}}.',
  CAD_FEATURE_REGISTRY_MISMATCH: 'سجل الميزات {{registry}} غير متطابق.',
  CAD_RUNTIME_IDENTITY_MISMATCH: 'حقل هوية التشغيل {{field}} غير متطابق.',
  CAD_VERIFICATION_FAILED: 'فشل فحص التحقق {{check}}.',
  CAD_RELEASE_HOLD: 'الإصدار معلّق: {{reason}}.',
  CAD_FEATURE_UNSUPPORTED: 'الميزة {{feature}} غير مدعومة.',
  CAD_EXACT_KERNEL_UNAVAILABLE: 'النواة الدقيقة غير متاحة.',
  CAD_ARTIFACT_VERSION_MISMATCH: 'إصدار المصنف {{version}} غير مدعوم.',
  CAD_RECEIPT_INVALID: 'إيصال التحقق غير صالح: {{reason}}.',
};

function freezeCatalogs(value: Record<CadLocale, Record<CadMessageCode, string>>): CadCatalogs {
  for (const locale of CAD_LOCALES) Object.freeze(value[locale]);
  return Object.freeze(value) as CadCatalogs;
}

export const CAD_CATALOG: CadCatalogs = freezeCatalogs({ en, ko, ja, zh, es, ar });

/** Translation review is explicit; unreviewed locales remain usable but marked. */
export const VERIFIED_CAD_LOCALES: ReadonlySet<CadLocale> = new Set(['en', 'ko']);

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/gu;
const MAX_TEMPLATE_TEXT = 512;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isSafeTemplate(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_TEMPLATE_TEXT
    && !/[<>]/u.test(value)
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map(match => match[1]!);
}

export interface CatalogReport { missing: string[]; unused: string[]; placeholderMismatches: string[]; }

export function validateCadCatalogs(catalogs: Partial<CadCatalogs> | unknown = CAD_CATALOG): CatalogReport {
  const missing: string[] = [];
  const unused: string[] = [];
  const placeholderMismatches: string[] = [];
  try {
    if (!isPlainRecord(catalogs)) return { missing: ['*:catalog'], unused, placeholderMismatches };
    const codes = [...CAD_MESSAGE_CODES];
    for (const key of Object.keys(catalogs)) {
      if (!isCadLocale(key)) unused.push(`${key}:catalog`);
    }
    for (const locale of CAD_LOCALES) {
      const catalog = dataValue(catalogs, locale);
      if (!isPlainRecord(catalog)) {
        missing.push(`${locale}:catalog`);
        continue;
      }
      for (const code of codes) {
        const text = dataValue(catalog, code);
        if (!isSafeTemplate(text)) {
          missing.push(`${locale}:${code}`);
          continue;
        }
        const expected = [...cadMessageParamKeys(code)].sort().join('|');
        const actual = placeholders(text).sort().join('|');
        if (actual !== expected) placeholderMismatches.push(`${locale}:${code}`);
      }
      for (const code of Object.keys(catalog)) {
        if (!codes.includes(code as CadMessageCode)) unused.push(`${locale}:${code}`);
      }
    }
  } catch {
    missing.push('*:catalog');
  }
  return { missing, unused, placeholderMismatches };
}

export interface ResolvedCadMessage {
  text: string;
  /** Requested ISO locale after route normalization. */
  locale: CadLocale;
  requestedLocale: string;
  /** Locale that supplied the template; English is explicit on fallback. */
  resolvedLocale: CadLocale;
  fallback: boolean;
  missing: boolean;
  unverified: boolean;
}

function escapePlaceholder(value: MessageParam): string {
  return String(value).replace(/[&<>"']/gu, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function resolveCadMessage(
  message: CadMessage,
  requestedLocale: string | undefined | null,
  catalogs: Partial<CadCatalogs> | unknown = CAD_CATALOG,
): ResolvedCadMessage {
  const validMessage = assertCadMessage(message);
  const requested = requestedLocale === undefined || requestedLocale === null
    ? 'en'
    : typeof requestedLocale === 'string' && requestedLocale.length <= 64 ? requestedLocale : 'en';
  let locale: CadLocale = 'en';
  try {
    locale = toIsoLang(requested);
  } catch {
    locale = 'en';
  }

  const safeCatalogs = isPlainRecord(catalogs) ? catalogs : CAD_CATALOG;
  let localCatalog: CadCatalog | undefined;
  try {
    const candidate = dataValue(safeCatalogs, locale);
    localCatalog = isPlainRecord(candidate) ? candidate as CadCatalog : undefined;
  } catch {
    localCatalog = undefined;
  }
  const localTemplate = localCatalog ? dataValue(localCatalog, validMessage.code) : undefined;
  const missing = !isSafeTemplate(localTemplate);
  const resolvedLocale: CadLocale = missing ? 'en' : locale;
  const template = (missing ? CAD_CATALOG.en[validMessage.code] : localTemplate) as string;
  const params = validMessage.params as Readonly<Record<string, MessageParam>> | undefined;
  const text = template.replace(PLACEHOLDER, (_, key: string) => {
    const value = params?.[key];
    return value === undefined ? `{{${key}}}` : escapePlaceholder(value);
  });
  return {
    text,
    locale,
    requestedLocale: requested,
    resolvedLocale,
    fallback: locale !== requested || missing,
    missing,
    unverified: !VERIFIED_CAD_LOCALES.has(locale) || missing,
  };
}
