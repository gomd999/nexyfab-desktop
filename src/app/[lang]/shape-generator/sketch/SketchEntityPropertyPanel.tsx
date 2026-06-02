'use client';

/**
 * SketchEntityPropertyPanel — Phase 1.B sketch UX (ADR-013, own pro-CAD).
 *
 * Standalone property editor for the currently selected sketch entity.
 * A wrapper component (SolverSketchEditor or higher-level integrator)
 * decides what the current selection is, hands it to this panel together
 * with a typed snapshot of the entity geometry, and routes `onChange` and
 * `onDelete` calls into its solver.
 *
 * Standalone-by-design:
 *   - Has NO dependency on planegcs / SketchSolver. Tests can mount it
 *     in jsdom without booting WASM.
 *   - Entity snapshot is a thin discriminated union (kept compatible with
 *     the entity kinds exposed by lib/sketch/solver.ts).
 *
 * 4 entity kinds, layout:
 *   point  : x, y (editable)            + isFixed checkbox
 *   line   : x1, y1, x2, y2 (editable)  + length / angle (read-only)
 *   circle : cx, cy, radius (editable, radius>0)
 *   arc    : cx, cy, radius, startAngle (°), endAngle (°)
 *            (radius>0; angles displayed in degrees)
 *
 * Multi-select (Phase 1.B):
 *   - 2+ entities → "Multiple selection (N entities)" placeholder only.
 *     Bulk property editing is out of scope for Phase 1.B (would require
 *     a tri-state UI and matching solver primitives — Phase 2+).
 *   - 0 entities → "Select an entity to view properties" hint.
 *
 * Debouncing:
 *   - All numeric inputs are debounced 300ms before firing onChange.
 *     Rapid typing or arrow-key spam collapses into a single onChange
 *     with the final value. Each field has its own debounce timer (so
 *     editing x then immediately y both flush after their respective
 *     300ms windows).
 *   - isFixed checkbox is NOT debounced (boolean toggle fires immediately).
 *
 * Validation:
 *   - NaN / non-finite values → input gets a red border and onChange is
 *     suppressed for that field.
 *   - radius ≤ 0 → red border, suppressed.
 *   - On selection change the panel resets its local input state from
 *     the latest entityData snapshot.
 *
 * Test surface (data-testids):
 *   solver-entity-property-panel
 *   solver-entity-property-empty
 *   solver-entity-property-multi
 *   solver-entity-property-${field}-input      (point.x/y, line.x1..., circle.cx/cy/radius, arc.*)
 *   solver-entity-property-isFixed-checkbox
 *   solver-entity-property-length-readout
 *   solver-entity-property-angle-readout
 *   solver-entity-delete-button
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ─── i18n ─────────────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

// ─── entity snapshot types ────────────────────────────────────────────────

export type SketchEntityKind = 'point' | 'line' | 'circle' | 'arc';

export interface SketchEntityRef {
  kind: SketchEntityKind;
  id: string;
}

export interface PointEntityData {
  kind: 'point';
  id: string;
  x: number;
  y: number;
  isFixed?: boolean;
}

export interface LineEntityData {
  kind: 'line';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Derived: distance from (x1,y1) to (x2,y2). Read-only in the UI. */
  length: number;
  /** Derived: angle in radians from (x1,y1)→(x2,y2). Displayed in degrees. */
  angle: number;
}

export interface CircleEntityData {
  kind: 'circle';
  id: string;
  cx: number;
  cy: number;
  radius: number;
}

export interface ArcEntityData {
  kind: 'arc';
  id: string;
  cx: number;
  cy: number;
  radius: number;
  /** Radians. Displayed/edited in degrees in the UI. */
  startAngle: number;
  /** Radians. Displayed/edited in degrees in the UI. */
  endAngle: number;
}

export type EntityData =
  | PointEntityData
  | LineEntityData
  | CircleEntityData
  | ArcEntityData;

/** All numeric field names across the 4 entity kinds. */
export type EntityField =
  | 'x' | 'y'
  | 'x1' | 'y1' | 'x2' | 'y2'
  | 'cx' | 'cy'
  | 'radius'
  | 'startAngle' | 'endAngle'
  | 'isFixed';

/**
 * Value type for onChange callbacks. Angles are reported in RADIANS
 * (matching the solver's internal storage), even though the input field
 * shows degrees.
 */
export type EntityFieldValue = number | boolean;

// ─── i18n dict ────────────────────────────────────────────────────────────

interface Dict {
  panelLabel: string;
  emptyHint: string;
  multiSelection: (n: number) => string;
  delete: string;
  // entity titles
  point: string;
  line: string;
  circle: string;
  arc: string;
  // field labels
  x: string; y: string;
  startPoint: string; endPoint: string;
  center: string;
  radius: string;
  length: string; angle: string;
  startAngle: string; endAngle: string;
  isFixed: string;
  // units
  degrees: string;
  invalid: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    panelLabel: '엔티티 속성',
    emptyHint: '속성을 보려면 엔티티를 선택하세요',
    multiSelection: (n) => `다중 선택 (${n}개)`,
    delete: '삭제',
    point: '점',
    line: '선',
    circle: '원',
    arc: '호',
    x: 'X', y: 'Y',
    startPoint: '시작점', endPoint: '끝점',
    center: '중심',
    radius: '반지름',
    length: '길이', angle: '각도',
    startAngle: '시작 각도', endAngle: '끝 각도',
    isFixed: '고정',
    degrees: '°',
    invalid: '잘못된 값',
  },
  en: {
    panelLabel: 'Entity properties',
    emptyHint: 'Select an entity to view properties',
    multiSelection: (n) => `Multiple selection (${n} entities)`,
    delete: 'Delete',
    point: 'Point',
    line: 'Line',
    circle: 'Circle',
    arc: 'Arc',
    x: 'X', y: 'Y',
    startPoint: 'Start', endPoint: 'End',
    center: 'Center',
    radius: 'Radius',
    length: 'Length', angle: 'Angle',
    startAngle: 'Start angle', endAngle: 'End angle',
    isFixed: 'Fixed',
    degrees: '°',
    invalid: 'Invalid value',
  },
  ja: {
    panelLabel: 'エンティティのプロパティ',
    emptyHint: 'プロパティを表示するエンティティを選択してください',
    multiSelection: (n) => `複数選択 (${n}個)`,
    delete: '削除',
    point: '点',
    line: '線',
    circle: '円',
    arc: '円弧',
    x: 'X', y: 'Y',
    startPoint: '始点', endPoint: '終点',
    center: '中心',
    radius: '半径',
    length: '長さ', angle: '角度',
    startAngle: '開始角', endAngle: '終了角',
    isFixed: '固定',
    degrees: '°',
    invalid: '無効な値',
  },
  zh: {
    panelLabel: '实体属性',
    emptyHint: '选择一个实体以查看属性',
    multiSelection: (n) => `多选 (${n} 个)`,
    delete: '删除',
    point: '点',
    line: '直线',
    circle: '圆',
    arc: '圆弧',
    x: 'X', y: 'Y',
    startPoint: '起点', endPoint: '终点',
    center: '中心',
    radius: '半径',
    length: '长度', angle: '角度',
    startAngle: '起始角', endAngle: '终止角',
    isFixed: '固定',
    degrees: '°',
    invalid: '无效值',
  },
  es: {
    panelLabel: 'Propiedades de la entidad',
    emptyHint: 'Seleccione una entidad para ver sus propiedades',
    multiSelection: (n) => `Selección múltiple (${n} entidades)`,
    delete: 'Eliminar',
    point: 'Punto',
    line: 'Línea',
    circle: 'Círculo',
    arc: 'Arco',
    x: 'X', y: 'Y',
    startPoint: 'Inicio', endPoint: 'Fin',
    center: 'Centro',
    radius: 'Radio',
    length: 'Longitud', angle: 'Ángulo',
    startAngle: 'Ángulo inicial', endAngle: 'Ángulo final',
    isFixed: 'Fijo',
    degrees: '°',
    invalid: 'Valor no válido',
  },
  ar: {
    panelLabel: 'خصائص الكيان',
    emptyHint: 'اختر كيانًا لعرض الخصائص',
    multiSelection: (n) => `تحديد متعدد (${n} كيانات)`,
    delete: 'حذف',
    point: 'نقطة',
    line: 'خط',
    circle: 'دائرة',
    arc: 'قوس',
    x: 'X', y: 'Y',
    startPoint: 'البداية', endPoint: 'النهاية',
    center: 'المركز',
    radius: 'نصف القطر',
    length: 'الطول', angle: 'الزاوية',
    startAngle: 'زاوية البداية', endAngle: 'زاوية النهاية',
    isFixed: 'مثبت',
    degrees: '°',
    invalid: 'قيمة غير صالحة',
  },
};

// ─── debounce constant ───────────────────────────────────────────────────

/**
 * 300 ms is the sweet spot:
 *   - Long enough that arrow-key spam (~50 ms/repeat) and fast typing
 *     collapse into a single solver re-solve.
 *   - Short enough that a single keypress + pause feels immediate
 *     (well below the ~400 ms perception threshold).
 *   - Matches the convention used by other dimension inputs in the
 *     codebase (cf. OpenScadPanel sliders use 800 ms because they
 *     re-run a full STL bake; sketch field edits are far cheaper).
 */
export const PROPERTY_DEBOUNCE_MS = 300;

// ─── helpers ─────────────────────────────────────────────────────────────

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '';
  // Trim trailing zeros while keeping precision for sketches (≤ 4 decimals).
  return Number.parseFloat(n.toFixed(4)).toString();
}

function isValidNumber(raw: string): boolean {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  return Number.isFinite(n);
}

// ─── props ───────────────────────────────────────────────────────────────

export interface SketchEntityPropertyPanelProps {
  lang: EditorLang;
  selection: ReadonlyArray<SketchEntityRef>;
  entityData: ReadonlyArray<EntityData>;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  onDelete?: (id: string) => void;
  /** Override the debounce window. Mostly here for tests. */
  debounceMs?: number;
}

// ─── component ───────────────────────────────────────────────────────────

export default function SketchEntityPropertyPanel({
  lang,
  selection,
  entityData,
  onChange,
  onDelete,
  debounceMs = PROPERTY_DEBOUNCE_MS,
}: SketchEntityPropertyPanelProps): React.JSX.Element {
  const t = dict[lang] ?? dict.en;

  return (
    <div
      data-testid="solver-entity-property-panel"
      role="region"
      aria-label={t.panelLabel}
      style={panelStyle}
    >
      <PanelBody
        t={t}
        selection={selection}
        entityData={entityData}
        onChange={onChange}
        onDelete={onDelete}
        debounceMs={debounceMs}
      />
    </div>
  );
}

interface BodyProps {
  t: Dict;
  selection: ReadonlyArray<SketchEntityRef>;
  entityData: ReadonlyArray<EntityData>;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  onDelete?: (id: string) => void;
  debounceMs: number;
}

function PanelBody({ t, selection, entityData, onChange, onDelete, debounceMs }: BodyProps): React.JSX.Element {
  if (selection.length === 0) {
    return (
      <p data-testid="solver-entity-property-empty" style={hintStyle}>
        {t.emptyHint}
      </p>
    );
  }
  if (selection.length > 1) {
    return (
      <p data-testid="solver-entity-property-multi" style={hintStyle}>
        {t.multiSelection(selection.length)}
      </p>
    );
  }
  const ref = selection[0]!;
  const entity = entityData.find((e) => e.id === ref.id && e.kind === ref.kind);
  if (!entity) {
    return (
      <p data-testid="solver-entity-property-empty" style={hintStyle}>
        {t.emptyHint}
      </p>
    );
  }
  return (
    <EntityEditor
      t={t}
      entity={entity}
      onChange={onChange}
      onDelete={onDelete}
      debounceMs={debounceMs}
    />
  );
}

interface EditorProps {
  t: Dict;
  entity: EntityData;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  onDelete?: (id: string) => void;
  debounceMs: number;
}

function EntityEditor({ t, entity, onChange, onDelete, debounceMs }: EditorProps): React.JSX.Element {
  const title = (() => {
    switch (entity.kind) {
      case 'point': return t.point;
      case 'line': return t.line;
      case 'circle': return t.circle;
      case 'arc': return t.arc;
    }
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {title} <span style={{ color: '#6b7280', fontWeight: 400 }}>#{entity.id}</span>
        </span>
        {onDelete ? (
          <button
            type="button"
            data-testid="solver-entity-delete-button"
            onClick={() => onDelete(entity.id)}
            aria-label={t.delete}
            title={t.delete}
            style={deleteButtonStyle}
          >
            {t.delete}
          </button>
        ) : null}
      </header>

      {entity.kind === 'point' ? (
        <PointFields t={t} entity={entity} onChange={onChange} debounceMs={debounceMs} />
      ) : null}
      {entity.kind === 'line' ? (
        <LineFields t={t} entity={entity} onChange={onChange} debounceMs={debounceMs} />
      ) : null}
      {entity.kind === 'circle' ? (
        <CircleFields t={t} entity={entity} onChange={onChange} debounceMs={debounceMs} />
      ) : null}
      {entity.kind === 'arc' ? (
        <ArcFields t={t} entity={entity} onChange={onChange} debounceMs={debounceMs} />
      ) : null}
    </div>
  );
}

// ─── per-kind field groups ───────────────────────────────────────────────

interface PointFieldsProps {
  t: Dict;
  entity: PointEntityData;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  debounceMs: number;
}

function PointFields({ t, entity, onChange, debounceMs }: PointFieldsProps): React.JSX.Element {
  return (
    <>
      <NumberField
        testid="solver-entity-property-x-input"
        label={t.x}
        value={entity.x}
        onCommit={(v) => onChange(entity.id, 'x', v)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:x`}
      />
      <NumberField
        testid="solver-entity-property-y-input"
        label={t.y}
        value={entity.y}
        onCommit={(v) => onChange(entity.id, 'y', v)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:y`}
      />
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          data-testid="solver-entity-property-isFixed-checkbox"
          checked={!!entity.isFixed}
          onChange={(e) => onChange(entity.id, 'isFixed', e.target.checked)}
        />
        <span style={{ fontSize: 12 }}>{t.isFixed}</span>
      </label>
    </>
  );
}

interface LineFieldsProps {
  t: Dict;
  entity: LineEntityData;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  debounceMs: number;
}

function LineFields({ t, entity, onChange, debounceMs }: LineFieldsProps): React.JSX.Element {
  return (
    <>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{t.startPoint}</legend>
        <NumberField
          testid="solver-entity-property-x1-input"
          label={t.x}
          value={entity.x1}
          onCommit={(v) => onChange(entity.id, 'x1', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:x1`}
        />
        <NumberField
          testid="solver-entity-property-y1-input"
          label={t.y}
          value={entity.y1}
          onCommit={(v) => onChange(entity.id, 'y1', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:y1`}
        />
      </fieldset>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{t.endPoint}</legend>
        <NumberField
          testid="solver-entity-property-x2-input"
          label={t.x}
          value={entity.x2}
          onCommit={(v) => onChange(entity.id, 'x2', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:x2`}
        />
        <NumberField
          testid="solver-entity-property-y2-input"
          label={t.y}
          value={entity.y2}
          onCommit={(v) => onChange(entity.id, 'y2', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:y2`}
        />
      </fieldset>
      <div style={readoutRowStyle}>
        <span style={readoutLabelStyle}>{t.length}</span>
        <span data-testid="solver-entity-property-length-readout" style={readoutValueStyle}>
          {fmtNum(entity.length)}
        </span>
      </div>
      <div style={readoutRowStyle}>
        <span style={readoutLabelStyle}>{t.angle}</span>
        <span data-testid="solver-entity-property-angle-readout" style={readoutValueStyle}>
          {fmtNum(entity.angle * RAD_TO_DEG)}{t.degrees}
        </span>
      </div>
    </>
  );
}

interface CircleFieldsProps {
  t: Dict;
  entity: CircleEntityData;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  debounceMs: number;
}

function CircleFields({ t, entity, onChange, debounceMs }: CircleFieldsProps): React.JSX.Element {
  return (
    <>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{t.center}</legend>
        <NumberField
          testid="solver-entity-property-cx-input"
          label={t.x}
          value={entity.cx}
          onCommit={(v) => onChange(entity.id, 'cx', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:cx`}
        />
        <NumberField
          testid="solver-entity-property-cy-input"
          label={t.y}
          value={entity.cy}
          onCommit={(v) => onChange(entity.id, 'cy', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:cy`}
        />
      </fieldset>
      <NumberField
        testid="solver-entity-property-radius-input"
        label={t.radius}
        value={entity.radius}
        onCommit={(v) => onChange(entity.id, 'radius', v)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:radius`}
        validate={(n) => n > 0}
      />
    </>
  );
}

interface ArcFieldsProps {
  t: Dict;
  entity: ArcEntityData;
  onChange: (id: string, field: EntityField, value: EntityFieldValue) => void;
  debounceMs: number;
}

function ArcFields({ t, entity, onChange, debounceMs }: ArcFieldsProps): React.JSX.Element {
  return (
    <>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{t.center}</legend>
        <NumberField
          testid="solver-entity-property-cx-input"
          label={t.x}
          value={entity.cx}
          onCommit={(v) => onChange(entity.id, 'cx', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:cx`}
        />
        <NumberField
          testid="solver-entity-property-cy-input"
          label={t.y}
          value={entity.cy}
          onCommit={(v) => onChange(entity.id, 'cy', v)}
          debounceMs={debounceMs}
          resetKey={`${entity.id}:cy`}
        />
      </fieldset>
      <NumberField
        testid="solver-entity-property-radius-input"
        label={t.radius}
        value={entity.radius}
        onCommit={(v) => onChange(entity.id, 'radius', v)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:radius`}
        validate={(n) => n > 0}
      />
      {/*
        Angles are stored in radians in the solver but humans edit degrees.
        Convert at the boundary so the parent (and the solver) always sees
        radians, while users see/edit a familiar unit.
      */}
      <NumberField
        testid="solver-entity-property-startAngle-input"
        label={`${t.startAngle} (${t.degrees})`}
        value={entity.startAngle * RAD_TO_DEG}
        onCommit={(v) => onChange(entity.id, 'startAngle', v * DEG_TO_RAD)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:startAngle`}
      />
      <NumberField
        testid="solver-entity-property-endAngle-input"
        label={`${t.endAngle} (${t.degrees})`}
        value={entity.endAngle * RAD_TO_DEG}
        onCommit={(v) => onChange(entity.id, 'endAngle', v * DEG_TO_RAD)}
        debounceMs={debounceMs}
        resetKey={`${entity.id}:endAngle`}
      />
    </>
  );
}

// ─── debounced number input ──────────────────────────────────────────────

interface NumberFieldProps {
  testid: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  debounceMs: number;
  /** Stable key — when it changes the local draft is reset from `value`. */
  resetKey: string;
  /** Optional extra validator beyond Number.isFinite. Returning false flags
   *  the input as invalid and suppresses onCommit. */
  validate?: (n: number) => boolean;
}

function NumberField({
  testid, label, value, onCommit, debounceMs, resetKey, validate,
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string>(() => fmtNum(value));
  const [invalid, setInvalid] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  const validateRef = useRef(validate);
  // Track the value last reported to the parent so external echoes don't
  // clobber an in-progress local edit.
  const lastCommittedRef = useRef<number>(value);

  // Keep refs current so the debounced timer always sees the latest callbacks.
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { validateRef.current = validate; }, [validate]);

  // Reset the draft when the selected entity / field changes (resetKey
  // moves) OR when the upstream value moves outside what we last committed
  // (e.g. the solver re-solved and snapped the field somewhere else).
  useEffect(() => {
    setDraft(fmtNum(value));
    setInvalid(false);
    lastCommittedRef.current = value;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // If the upstream value changes for a reason other than our own commit
  // (e.g. the solver moved the point), pull the new value into the draft.
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setDraft(fmtNum(value));
      setInvalid(false);
      lastCommittedRef.current = value;
    }
  }, [value]);

  const handleChange = useCallback((raw: string) => {
    setDraft(raw);
    const ok = isValidNumber(raw);
    if (!ok) {
      setInvalid(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    const n = Number(raw);
    const passesExtra = validateRef.current ? validateRef.current(n) : true;
    if (!passesExtra) {
      setInvalid(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    setInvalid(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastCommittedRef.current = n;
      onCommitRef.current(n);
    }, debounceMs);
  }, [debounceMs]);

  return (
    <label style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <input
        type="number"
        step="any"
        data-testid={testid}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        aria-invalid={invalid || undefined}
        style={{
          ...inputStyle,
          border: `1px solid ${invalid ? '#dc2626' : '#d1d5db'}`,
        }}
      />
    </label>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  minWidth: 220,
  fontSize: 12,
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px 4px',
  color: '#6b7280',
  fontSize: 12,
  textAlign: 'center',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  paddingBottom: 4,
  borderBottom: '1px solid #e5e7eb',
};

const deleteButtonStyle: React.CSSProperties = {
  padding: '3px 8px',
  border: '1px solid #fecaca',
  borderRadius: 3,
  background: '#fff',
  color: '#b91c1c',
  fontSize: 11,
  cursor: 'pointer',
};

const fieldsetStyle: React.CSSProperties = {
  margin: 0,
  padding: '4px 8px 6px',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const legendStyle: React.CSSProperties = {
  padding: '0 4px',
  fontSize: 11,
  color: '#6b7280',
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  flex: '0 0 auto',
  minWidth: 64,
  color: '#374151',
  fontSize: 11,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 12,
  minWidth: 0,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const readoutRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '2px 4px',
  background: '#f3f4f6',
  borderRadius: 3,
};

const readoutLabelStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
};

const readoutValueStyle: React.CSSProperties = {
  color: '#111827',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
};
