'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  resolveArchitectureInteriorSelection,
  type ArchitectureInteriorInspectorField,
  type ArchitectureInteriorSelection,
  type ArchitectureInteriorSelectionSource,
  type ResolvedArchitectureInteriorSelection,
} from '@/lib/ai/architectureInteriorSelection';

type InspectorPatch = Readonly<Record<string, unknown>>;

type Copy = {
  title: string;
  none: string;
  unavailable: string;
  invalid: string;
  revision: string;
  document: string;
  kind: string;
  id: string;
  hosts: string;
  apply: string;
  pending: string;
  saved: string;
  failed: string;
  blocked: string;
  noTransaction: string;
};

const COPY: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', Copy> = {
  ko: { title: '건축·인테리어 검사기', none: '먼저 유효한 객체를 선택하세요.', unavailable: '이 워크스페이스에는 구조화된 건축·인테리어 선택 소스가 연결되지 않았습니다.', invalid: '선택이 현재 문서와 일치하지 않아 편집을 차단했습니다.', revision: '리비전', document: '문서', kind: '종류', id: 'ID', hosts: '호스트', apply: '적용', pending: '저장 중…', saved: '검토된 트랜잭션으로 저장했습니다.', failed: '저장에 실패하여 변경하지 않았습니다.', blocked: '편집 차단', noTransaction: '검토된 트랜잭션 경로가 없어 읽기 전용입니다.' },
  en: { title: 'Architecture / interior Inspector', none: 'Select a valid object first.', unavailable: 'This workspace has no structured architecture/interior selection source connected.', invalid: 'Editing is blocked because the selection does not match the current document.', revision: 'Revision', document: 'Document', kind: 'Kind', id: 'ID', hosts: 'Hosts', apply: 'Apply', pending: 'Saving…', saved: 'Saved through the reviewed transaction.', failed: 'Save failed; no change was applied.', blocked: 'Editing blocked', noTransaction: 'Read-only: no reviewed transaction path is connected.' },
  ja: { title: '建築・インテリアインスペクター', none: '有効なオブジェクトを選択してください。', unavailable: '構造化された建築・インテリア選択ソースがワークスペースに接続されていません。', invalid: '現在のドキュメントと選択が一致しないため編集を停止しました。', revision: 'リビジョン', document: 'ドキュメント', kind: '種類', id: 'ID', hosts: 'ホスト', apply: '適用', pending: '保存中…', saved: 'レビュー済みトランザクションで保存しました。', failed: '保存に失敗したため変更していません。', blocked: '編集を停止', noTransaction: 'レビュー済みトランザクションが未接続のため読み取り専用です。' },
  zh: { title: '建筑 / 室内检查器', none: '请先选择有效对象。', unavailable: '此工作区尚未连接结构化建筑/室内选择源。', invalid: '选择与当前文档不匹配，已阻止编辑。', revision: '修订版', document: '文档', kind: '类型', id: 'ID', hosts: '宿主', apply: '应用', pending: '保存中…', saved: '已通过审核事务保存。', failed: '保存失败，未应用更改。', blocked: '编辑已阻止', noTransaction: '未连接审核事务路径，因此为只读。' },
  es: { title: 'Inspector de arquitectura / interiores', none: 'Seleccione primero un objeto válido.', unavailable: 'Este espacio de trabajo no tiene conectada una fuente estructurada de selección.', invalid: 'La selección no coincide con el documento actual; se bloqueó la edición.', revision: 'Revisión', document: 'Documento', kind: 'Tipo', id: 'ID', hosts: 'Anfitriones', apply: 'Aplicar', pending: 'Guardando…', saved: 'Guardado mediante la transacción revisada.', failed: 'No se pudo guardar; no se aplicó ningún cambio.', blocked: 'Edición bloqueada', noTransaction: 'Solo lectura: no hay una transacción revisada conectada.' },
  ar: { title: 'مفتش العمارة / التصميم الداخلي', none: 'اختر كائنًا صالحًا أولًا.', unavailable: 'لا يوجد مصدر اختيار معماري/داخلي منظم متصل بمساحة العمل.', invalid: 'لا يطابق الاختيار المستند الحالي؛ تم حظر التحرير.', revision: 'المراجعة', document: 'المستند', kind: 'النوع', id: 'المعرّف', hosts: 'المضيفون', apply: 'تطبيق', pending: 'جارٍ الحفظ…', saved: 'تم الحفظ عبر المعاملة المراجعة.', failed: 'فشل الحفظ؛ لم يُطبَّق أي تغيير.', blocked: 'التحرير محظور', noTransaction: 'للقراءة فقط: لا توجد معاملة مراجعة متصلة.' },
};

function copyFor(lang: string): Copy {
  if (lang === 'kr') return COPY.ko;
  return COPY[lang as keyof typeof COPY] ?? COPY.en;
}

function isVector(field: ArchitectureInteriorInspectorField): field is ArchitectureInteriorInspectorField & { value: readonly number[] } {
  return (field.valueType === 'vector2' || field.valueType === 'vector3') && Array.isArray(field.value);
}

function validDraftValue(field: ArchitectureInteriorInspectorField, value: unknown): boolean {
  if (field.valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.valueType === 'text' || field.valueType === 'enum') return typeof value === 'string' && value.trim().length > 0;
  const expectedLength = field.valueType === 'vector2' ? 2 : 3;
  return Array.isArray(value) && value.length === expectedLength
    && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

export function ArchitectureInteriorInspector({
  selection,
  source,
  lang,
  pending = false,
  onCommit,
  onInvalidSelection,
  explicitApply = false,
}: {
  selection: ArchitectureInteriorSelection | null;
  source: ArchitectureInteriorSelectionSource | null;
  lang: string;
  pending?: boolean;
  onCommit?: (resolved: ResolvedArchitectureInteriorSelection, patch: InspectorPatch) => boolean | Promise<boolean>;
  onInvalidSelection?: () => void;
  /** Live server workspaces require an explicit Apply action before challenge/approval. */
  explicitApply?: boolean;
}) {
  const t = copyFor(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const resolution = useMemo(
    () => selection && source ? resolveArchitectureInteriorSelection(selection, source) : null,
    [selection, source],
  );
  const resolved = resolution?.ok ? resolution.value : null;
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    setDraft(Object.fromEntries((resolved?.editableFields ?? []).map(field => [field.key, structuredClone(field.value)])));
    setStatus('idle');
  }, [resolved]);

  useEffect(() => {
    if (selection && source && !resolved) onInvalidSelection?.();
  }, [onInvalidSelection, resolved, selection, source]);

  const canEdit = Boolean(resolved && onCommit && !pending && status !== 'pending');
  const commit = async (field: ArchitectureInteriorInspectorField, value: unknown) => {
    if (!resolved || !onCommit || pending || status === 'pending') return;
    if (!validDraftValue(field, value)) {
      setStatus('failed');
      return;
    }
    setStatus('pending');
    try {
      const ok = await onCommit(resolved, { [field.key]: structuredClone(value) });
      setStatus(ok ? 'saved' : 'failed');
    } catch {
      setStatus('failed');
    }
  };

  const editField = (field: ArchitectureInteriorInspectorField, index: number | null, raw: string) => {
    const current = draft[field.key] ?? field.value;
    const value = index === null
      ? field.valueType === 'number' ? raw.trim() === '' ? raw : Number(raw) : raw
      : Array.isArray(current) ? current.map((item, itemIndex) => itemIndex === index ? raw.trim() === '' ? raw : Number(raw) : item) : current;
    setDraft(previous => ({ ...previous, [field.key]: value }));
  };

  const renderField = (field: ArchitectureInteriorInspectorField) => {
    const value = draft[field.key] ?? field.value;
    const fieldCanEdit = canEdit && field.editable;
    const apply = <button type="button" data-testid={`architecture-interior-apply-${field.key}`} onClick={() => void commit(field, draft[field.key] ?? field.value)} disabled={!fieldCanEdit}>{t.apply}</button>;
    if (isVector(field)) {
      return <div key={field.key} data-testid={`architecture-interior-field-${field.key}`} style={{ display: 'grid', gap: 3 }}>
        <span>{field.key}{field.unit ? ` (${field.unit})` : ''}</span>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${field.valueType === 'vector2' ? 2 : 3}, minmax(0, 1fr))`, gap: 3 }}>
          {field.value.map((_, index) => <input key={index} aria-label={`${field.key} ${index + 1}`} type="number" value={Array.isArray(value) ? String(value[index] ?? '') : ''} disabled={!fieldCanEdit} onChange={event => editField(field, index, event.target.value)} onBlur={explicitApply ? undefined : () => void commit(field, draft[field.key] ?? field.value)} />)}
        </div>
        {explicitApply && apply}
      </div>;
    }
    return <label key={field.key} data-testid={`architecture-interior-field-${field.key}`} style={{ display: 'grid', gap: 3 }}>
      <span>{field.key}{field.unit ? ` (${field.unit})` : ''}</span>
      <input aria-label={field.key} type={field.valueType === 'number' ? 'number' : 'text'} value={String(value ?? '')} disabled={!fieldCanEdit} onChange={event => editField(field, null, event.target.value)} onBlur={explicitApply ? undefined : () => void commit(field, draft[field.key] ?? field.value)} />
      {explicitApply && apply}
    </label>;
  };

  return <section data-testid="architecture-interior-inspector" aria-live="polite" dir={dir} style={{ display: 'grid', gap: 7, fontSize: 10.5 }}>
    <b>{t.title}</b>
    {!selection ? <span data-testid="architecture-interior-inspector-empty">{t.none}</span> : !source ? <span data-testid="architecture-interior-inspector-unavailable" role="status">{t.unavailable}</span> : !resolved ? <span data-testid="architecture-interior-inspector-invalid" role="alert">{t.invalid}</span> : <>
      <dl data-testid="architecture-interior-inspector-identity" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 3, margin: 0 }}>
        <dt>{t.id}</dt><dd data-testid="architecture-interior-selection-id" style={{ margin: 0, userSelect: 'text' }}>{resolved.selection.objectId}</dd>
        <dt>{t.kind}</dt><dd style={{ margin: 0 }}>{resolved.selection.kind}</dd>
        <dt>{t.document}</dt><dd style={{ margin: 0 }}>{resolved.selection.document}</dd>
        <dt>{t.revision}</dt><dd style={{ margin: 0 }}>{resolved.selection.revision}</dd>
        <dt>{t.hosts}</dt><dd data-testid="architecture-interior-selection-hosts" style={{ margin: 0 }}>{resolved.hostIds.join(' · ') || '—'}</dd>
      </dl>
      {!onCommit && <span data-testid="architecture-interior-inspector-readonly" role="status">{t.noTransaction}</span>}
      {resolved.editableFields.map(renderField)}
      {status === 'pending' && <span data-testid="architecture-interior-inspector-pending">{t.pending}</span>}
      {status === 'saved' && <span data-testid="architecture-interior-inspector-saved">{t.saved}</span>}
      {status === 'failed' && <span data-testid="architecture-interior-inspector-failed" role="alert">{t.failed}</span>}
      {!canEdit && pending && <span data-testid="architecture-interior-inspector-blocked" role="status">{t.blocked}</span>}
    </>}
  </section>;
}
