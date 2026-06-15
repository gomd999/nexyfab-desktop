'use client';

/**
 * StepCompareVersionPanel — B31 standalone panel exposing the QQQQQQQ
 * `stepDiffer.diffSteps()` change-tracking output as a self-contained
 * version-comparison UI.
 *
 * Inputs:
 *   - Two `.step` / `.stp` file inputs (oldSource / newSource), OR
 *   - Two paste-textareas containing raw STEP Part 21 source.
 *
 * On "Compare" we call `diffSteps(oldSource, newSource)` and render a
 * result block with:
 *   - Header diff (old → new, key-changed rows highlighted).
 *   - Entity count summary badges (added / removed / changed),
 *     colour-coded green / red / amber respectively.
 *   - Collapsible per-entity rows (kind + entity id + before/after raw
 *     snippet, truncated to RAW_SNIPPET_LIMIT chars so an OPEN_SHELL with
 *     a thousand-edge body does not blow up the DOM).
 *
 * SCOPE
 * -----
 * Pure presentation around `diffSteps`. We do NOT modify stepDiffer.ts and
 * we do NOT persist anywhere — the caller decides what to do with the
 * computed delta (e.g. show in a sidebar, attach to a commit, etc).
 *
 * FILE SIZE GUARD
 * ---------------
 * STEP files balloon quickly; a 5 MB cap is enforced per side. Above the
 * cap we throw a soft warning string into the UI and refuse to load —
 * `diffSteps` is O(n) but the resulting per-entity-row render is not, and
 * a multi-hundred-MB STEP would freeze the browser long before the user
 * gets useful output.
 */

import * as React from 'react';
import { diffSteps, type StepDiff } from '@/lib/brep-bridge/stepDiffer';

// ─── public types ────────────────────────────────────────────────────────

export interface StepCompareVersionPanelProps {
  lang: string;
}

// ─── constants ───────────────────────────────────────────────────────────

/** Per-side input cap. STEP files balloon fast; above this we warn. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Raw-text snippet length per side. Long enough to be diagnostic,
 *  short enough that a 10k-arg OPEN_SHELL does not explode the DOM. */
const RAW_SNIPPET_LIMIT = 240;

// ─── i18n ────────────────────────────────────────────────────────────────

interface Dict {
  stepCompare: string;
  oldSource: string;
  newSource: string;
  compareButton: string;
  added: string;
  removed: string;
  changed: string;
  noChanges: string;
  headerDiff: string;
  entityChanges: string;
  pickFile: string;
  pasteSource: string;
  expand: string;
  collapse: string;
  fileTooLarge: (mb: string) => string;
  before: string;
  after: string;
  field: string;
  summary: string;
  schemaChanged: string;
  productCountChange: string;
}

const DICT: Record<string, Dict> = {
  en: {
    stepCompare: 'STEP Version Compare',
    oldSource: 'Old source',
    newSource: 'New source',
    compareButton: 'Compare',
    added: 'added',
    removed: 'removed',
    changed: 'changed',
    noChanges: 'No changes',
    headerDiff: 'Header changes',
    entityChanges: 'Entity changes',
    pickFile: 'Pick .step / .stp file',
    pasteSource: 'Or paste STEP source',
    expand: 'Expand',
    collapse: 'Collapse',
    fileTooLarge: (mb) => `File too large (max 5 MB, got ${mb} MB)`,
    before: 'Before',
    after: 'After',
    field: 'Field',
    summary: 'Summary',
    schemaChanged: 'Schema changed',
    productCountChange: 'PRODUCT count change',
  },
  ko: {
    stepCompare: 'STEP 버전 비교',
    oldSource: '이전 소스',
    newSource: '새 소스',
    compareButton: '비교',
    added: '추가',
    removed: '제거',
    changed: '변경',
    noChanges: '변경 없음',
    headerDiff: '헤더 변경',
    entityChanges: '엔티티 변경',
    pickFile: '.step / .stp 파일 선택',
    pasteSource: '또는 STEP 소스 붙여넣기',
    expand: '펼치기',
    collapse: '접기',
    fileTooLarge: (mb) => `파일이 너무 큽니다 (최대 5 MB, 현재 ${mb} MB)`,
    before: '이전',
    after: '이후',
    field: '필드',
    summary: '요약',
    schemaChanged: '스키마 변경됨',
    productCountChange: 'PRODUCT 개수 변화',
  },
  ja: {
    stepCompare: 'STEPバージョン比較',
    oldSource: '旧ソース',
    newSource: '新ソース',
    compareButton: '比較',
    added: '追加',
    removed: '削除',
    changed: '変更',
    noChanges: '変更なし',
    headerDiff: 'ヘッダー変更',
    entityChanges: 'エンティティ変更',
    pickFile: '.step / .stp ファイル選択',
    pasteSource: 'または STEP ソースを貼り付け',
    expand: '展開',
    collapse: '折りたたみ',
    fileTooLarge: (mb) => `ファイルが大きすぎます (最大 5 MB, 現在 ${mb} MB)`,
    before: '変更前',
    after: '変更後',
    field: 'フィールド',
    summary: '概要',
    schemaChanged: 'スキーマ変更',
    productCountChange: 'PRODUCT数変化',
  },
  zh: {
    stepCompare: 'STEP版本对比',
    oldSource: '旧源',
    newSource: '新源',
    compareButton: '对比',
    added: '新增',
    removed: '删除',
    changed: '修改',
    noChanges: '无变更',
    headerDiff: '头部变更',
    entityChanges: '实体变更',
    pickFile: '选择 .step / .stp 文件',
    pasteSource: '或粘贴 STEP 源码',
    expand: '展开',
    collapse: '折叠',
    fileTooLarge: (mb) => `文件过大 (最大 5 MB, 当前 ${mb} MB)`,
    before: '修改前',
    after: '修改后',
    field: '字段',
    summary: '摘要',
    schemaChanged: 'Schema 已变更',
    productCountChange: 'PRODUCT 数量变化',
  },
  es: {
    stepCompare: 'Comparar versiones STEP',
    oldSource: 'Origen antiguo',
    newSource: 'Origen nuevo',
    compareButton: 'Comparar',
    added: 'añadidos',
    removed: 'eliminados',
    changed: 'modificados',
    noChanges: 'Sin cambios',
    headerDiff: 'Cambios de cabecera',
    entityChanges: 'Cambios de entidad',
    pickFile: 'Elegir archivo .step / .stp',
    pasteSource: 'O pegar fuente STEP',
    expand: 'Expandir',
    collapse: 'Contraer',
    fileTooLarge: (mb) => `Archivo demasiado grande (máx 5 MB, actual ${mb} MB)`,
    before: 'Antes',
    after: 'Después',
    field: 'Campo',
    summary: 'Resumen',
    schemaChanged: 'Esquema cambiado',
    productCountChange: 'Cambio de conteo de PRODUCT',
  },
  ar: {
    stepCompare: 'مقارنة إصدارات STEP',
    oldSource: 'المصدر القديم',
    newSource: 'المصدر الجديد',
    compareButton: 'قارن',
    added: 'مضاف',
    removed: 'محذوف',
    changed: 'متغير',
    noChanges: 'لا تغييرات',
    headerDiff: 'تغييرات الترويسة',
    entityChanges: 'تغييرات الكيان',
    pickFile: 'اختر ملف .step / .stp',
    pasteSource: 'أو الصق مصدر STEP',
    expand: 'توسيع',
    collapse: 'طي',
    fileTooLarge: (mb) => `الملف كبير جدًا (الحد الأقصى 5 ميجا، الحالي ${mb} ميجا)`,
    before: 'قبل',
    after: 'بعد',
    field: 'حقل',
    summary: 'ملخص',
    schemaChanged: 'تغير المخطط',
    productCountChange: 'تغير عدد PRODUCT',
  },
};

function pickDict(lang: string): Dict {
  const map: Record<string, keyof typeof DICT> = {
    en: 'en', ko: 'ko', kr: 'ko', ja: 'ja', jp: 'ja',
    zh: 'zh', cn: 'zh', es: 'es', ar: 'ar',
  };
  const key = map[lang] ?? 'en';
  return DICT[key] ?? DICT.en!;
}

// ─── helpers ─────────────────────────────────────────────────────────────

/** Truncate raw entity text for display. Long bodies (e.g. an OPEN_SHELL
 *  with thousands of edge refs) are clipped to RAW_SNIPPET_LIMIT chars
 *  with an ellipsis so the panel stays scrollable. */
function snippet(s: string): string {
  if (!s) return '';
  if (s.length <= RAW_SNIPPET_LIMIT) return s;
  return s.slice(0, RAW_SNIPPET_LIMIT) + '…';
}

function fmtMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

// ─── component ───────────────────────────────────────────────────────────

export default function StepCompareVersionPanel(
  props: StepCompareVersionPanelProps,
): React.ReactElement {
  const { lang } = props;
  const dict = pickDict(lang);

  const [oldSource, setOldSource] = React.useState('');
  const [newSource, setNewSource] = React.useState('');
  const [oldError, setOldError] = React.useState<string | null>(null);
  const [newError, setNewError] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<StepDiff | null>(null);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  // ─── file handlers ────────────────────────────────────────────────────

  function readFile(
    file: File,
    setSrc: (s: string) => void,
    setErr: (s: string | null) => void,
  ): void {
    if (file.size > MAX_FILE_BYTES) {
      setErr(dict.fileTooLarge(fmtMb(file.size)));
      return;
    }
    setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setSrc(text);
    };
    reader.onerror = () => {
      setErr('read error');
    };
    reader.readAsText(file);
  }

  function onOldFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    readFile(f, setOldSource, setOldError);
  }

  function onNewFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    readFile(f, setNewSource, setNewError);
  }

  // ─── compare ──────────────────────────────────────────────────────────

  function onCompare(): void {
    const d = diffSteps(oldSource, newSource);
    setDiff(d);
    setExpanded(new Set());
  }

  function toggleRow(id: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── derived ──────────────────────────────────────────────────────────

  const noChanges =
    diff !== null &&
    diff.entitiesAdded.length === 0 &&
    diff.entitiesRemoved.length === 0 &&
    diff.entitiesModified.length === 0 &&
    diff.headerChanges.length === 0 &&
    !diff.schemaChanged &&
    diff.productCountChange === 0;

  // ─── render ───────────────────────────────────────────────────────────

  return (
    <div
      data-testid="drawing-step-compare-panel"
      style={{
        padding: 16,
        background: '#fff',
        color: '#111',
        fontFamily: 'system-ui, sans-serif',
        border: '1px solid #ddd',
        borderRadius: 8,
        maxWidth: 880,
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{dict.stepCompare}</h2>

      {/* ── inputs row ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <SourceColumn
          label={dict.oldSource}
          testidInput="drawing-step-compare-old-input"
          testidTextarea="drawing-step-compare-old-textarea"
          value={oldSource}
          onChangeText={setOldSource}
          onFile={onOldFile}
          error={oldError}
          dict={dict}
        />
        <SourceColumn
          label={dict.newSource}
          testidInput="drawing-step-compare-new-input"
          testidTextarea="drawing-step-compare-new-textarea"
          value={newSource}
          onChangeText={setNewSource}
          onFile={onNewFile}
          error={newError}
          dict={dict}
        />
      </div>

      {/* ── compare button ── */}
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="drawing-step-compare-compare-button"
          onClick={onCompare}
          style={{
            padding: '6px 14px',
            background: '#1d4ed8',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {dict.compareButton}
        </button>
      </div>

      {/* ── result ── */}
      {diff !== null && (
        <div
          data-testid="drawing-step-compare-result"
          style={{ marginTop: 16 }}
        >
          {noChanges ? (
            <div
              data-testid="drawing-step-compare-no-changes"
              style={{ color: '#666', fontStyle: 'italic' }}
            >
              {dict.noChanges}
            </div>
          ) : (
            <>
              {/* Summary line + counts row */}
              <div
                data-testid="drawing-step-compare-summary"
                style={{ fontSize: 13, color: '#444', marginBottom: 8 }}
              >
                {dict.summary}: {diff.summary}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 12,
                  flexWrap: 'wrap',
                }}
              >
                <Badge
                  testid="drawing-step-compare-badge-added"
                  count={diff.entitiesAdded.length}
                  label={dict.added}
                  color="#16a34a"
                />
                <Badge
                  testid="drawing-step-compare-badge-removed"
                  count={diff.entitiesRemoved.length}
                  label={dict.removed}
                  color="#dc2626"
                />
                <Badge
                  testid="drawing-step-compare-badge-changed"
                  count={diff.entitiesModified.length}
                  label={dict.changed}
                  color="#d97706"
                />
                {diff.schemaChanged && (
                  <span
                    data-testid="drawing-step-compare-schema-changed"
                    style={{
                      padding: '3px 8px',
                      background: '#fef3c7',
                      color: '#78350f',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {dict.schemaChanged}
                  </span>
                )}
                {diff.productCountChange !== 0 && (
                  <span
                    data-testid="drawing-step-compare-product-delta"
                    style={{
                      padding: '3px 8px',
                      background: '#e0f2fe',
                      color: '#075985',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {dict.productCountChange}: {diff.productCountChange > 0 ? '+' : ''}
                    {diff.productCountChange}
                  </span>
                )}
              </div>

              {/* Header diff */}
              {diff.headerChanges.length > 0 && (
                <div
                  data-testid="drawing-step-compare-header-diff"
                  style={{
                    marginBottom: 16,
                    border: '1px solid #fde68a',
                    background: '#fffbeb',
                    borderRadius: 4,
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {dict.headerDiff}
                  </div>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr style={{ textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px' }}>{dict.field}</th>
                        <th style={{ padding: '4px 6px' }}>{dict.before}</th>
                        <th style={{ padding: '4px 6px' }}>{dict.after}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.headerChanges.map((h) => (
                        <tr
                          key={h.field}
                          data-testid={`drawing-step-compare-header-row-${h.field}`}
                          style={{ borderTop: '1px solid #fde68a' }}
                        >
                          <td
                            style={{
                              padding: '4px 6px',
                              fontWeight: 600,
                              color: '#92400e',
                            }}
                          >
                            {h.field}
                          </td>
                          <td
                            style={{
                              padding: '4px 6px',
                              color: '#7f1d1d',
                              fontFamily: 'monospace',
                              wordBreak: 'break-all',
                            }}
                          >
                            {snippet(h.old) || <em style={{ color: '#999' }}>—</em>}
                          </td>
                          <td
                            style={{
                              padding: '4px 6px',
                              color: '#14532d',
                              fontFamily: 'monospace',
                              wordBreak: 'break-all',
                            }}
                          >
                            {snippet(h.new) || <em style={{ color: '#999' }}>—</em>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Entity changes */}
              {(diff.entitiesAdded.length > 0 ||
                diff.entitiesRemoved.length > 0 ||
                diff.entitiesModified.length > 0) && (
                <div data-testid="drawing-step-compare-entity-list">
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {dict.entityChanges}
                  </div>

                  {/* Added */}
                  {diff.entitiesAdded.map((e) => (
                    <EntityRow
                      key={`add-${e.id}`}
                      kindClass="added"
                      kindColor="#16a34a"
                      id={e.id}
                      name={e.name}
                      oldRaw=""
                      newRaw=""
                      expanded={expanded.has(e.id)}
                      onToggle={() => toggleRow(e.id)}
                      dict={dict}
                    />
                  ))}

                  {/* Removed */}
                  {diff.entitiesRemoved.map((e) => (
                    <EntityRow
                      key={`rem-${e.id}`}
                      kindClass="removed"
                      kindColor="#dc2626"
                      id={e.id}
                      name={e.name}
                      oldRaw=""
                      newRaw=""
                      expanded={expanded.has(e.id)}
                      onToggle={() => toggleRow(e.id)}
                      dict={dict}
                    />
                  ))}

                  {/* Modified */}
                  {diff.entitiesModified.map((e) => (
                    <EntityRow
                      key={`mod-${e.id}`}
                      kindClass="changed"
                      kindColor="#d97706"
                      id={e.id}
                      name={e.name}
                      oldRaw={e.oldRaw}
                      newRaw={e.newRaw}
                      expanded={expanded.has(e.id)}
                      onToggle={() => toggleRow(e.id)}
                      dict={dict}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────

interface SourceColumnProps {
  label: string;
  testidInput: string;
  testidTextarea: string;
  value: string;
  onChangeText: (v: string) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  dict: Dict;
}

function SourceColumn(p: SourceColumnProps): React.ReactElement {
  return (
    <div style={{ flex: '1 1 320px', minWidth: 280 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
        {p.label}
      </label>
      <input
        type="file"
        accept=".step,.stp"
        data-testid={p.testidInput}
        onChange={p.onFile}
        style={{ display: 'block', marginBottom: 6 }}
      />
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
        {p.dict.pasteSource}
      </div>
      <textarea
        data-testid={p.testidTextarea}
        value={p.value}
        onChange={(e) => p.onChangeText(e.target.value)}
        rows={6}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: 6,
          border: '1px solid #ccc',
          borderRadius: 4,
          resize: 'vertical',
        }}
      />
      {p.error && (
        <div
          data-testid={`${p.testidInput}-error`}
          style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}
        >
          {p.error}
        </div>
      )}
    </div>
  );
}

interface BadgeProps {
  testid: string;
  count: number;
  label: string;
  color: string;
}

function Badge(p: BadgeProps): React.ReactElement {
  return (
    <span
      data-testid={p.testid}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        background: p.color,
        color: '#fff',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span data-testid={`${p.testid}-count`}>{p.count}</span>
      <span>{p.label}</span>
    </span>
  );
}

interface EntityRowProps {
  kindClass: 'added' | 'removed' | 'changed';
  kindColor: string;
  id: number;
  name: string;
  oldRaw: string;
  newRaw: string;
  expanded: boolean;
  onToggle: () => void;
  dict: Dict;
}

function EntityRow(p: EntityRowProps): React.ReactElement {
  return (
    <div
      data-testid={`drawing-step-compare-entity-row-${p.id}`}
      data-kind={p.kindClass}
      style={{
        borderTop: '1px solid #eee',
        padding: '6px 4px',
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
        onClick={p.onToggle}
        role="button"
        data-testid={`drawing-step-compare-entity-row-${p.id}-toggle`}
      >
        <span
          style={{
            display: 'inline-block',
            width: 60,
            textAlign: 'center',
            background: p.kindColor,
            color: '#fff',
            borderRadius: 4,
            fontSize: 11,
            padding: '2px 0',
            textTransform: 'uppercase',
          }}
        >
          {p.kindClass}
        </span>
        <span style={{ fontFamily: 'monospace', color: '#444' }}>#{p.id}</span>
        <span style={{ fontWeight: 600 }}>{p.name || '(composite)'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
          {p.expanded ? p.dict.collapse : p.dict.expand}
        </span>
      </div>
      {p.expanded && (
        <div
          data-testid={`drawing-step-compare-entity-row-${p.id}-body`}
          style={{ marginTop: 6, paddingLeft: 68 }}
        >
          {p.kindClass === 'changed' ? (
            <>
              <div
                data-testid={`drawing-step-compare-entity-row-${p.id}-before`}
                style={{
                  background: '#fee2e2',
                  color: '#7f1d1d',
                  padding: 6,
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  marginBottom: 4,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ fontWeight: 600 }}>{p.dict.before}: </span>
                {snippet(p.oldRaw)}
              </div>
              <div
                data-testid={`drawing-step-compare-entity-row-${p.id}-after`}
                style={{
                  background: '#dcfce7',
                  color: '#14532d',
                  padding: 6,
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ fontWeight: 600 }}>{p.dict.after}: </span>
                {snippet(p.newRaw)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#666' }}>
              {p.kindClass === 'added' ? '+' : '−'} #{p.id} {p.name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
