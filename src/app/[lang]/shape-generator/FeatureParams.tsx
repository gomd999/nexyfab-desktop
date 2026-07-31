'use client';

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import type { FeatureDefinition, FeatureInstance } from './features/types';
import type { ExprVariable } from './ExpressionEngine';
import {
  evaluateParamExpression,
  paramScopeFor,
  parseParamInput,
} from './equations/featureParamExpressions';

interface FeatureParamsProps {
  instance: FeatureInstance;
  definition: FeatureDefinition;
  t: Record<string, string>;
  onParamChange: (id: string, key: string, value: number) => void;
  /** SolidWorks-style "=expression" support (optional — value-only when absent).
   *  Raw expression per param key; `instance.params` holds evaluated values. */
  expressions?: Record<string, string>;
  /** Variable scope offered to expressions (global variables + base params).
   *  Sibling params of this feature are appended automatically. */
  variables?: ExprVariable[];
  /** Commit raw typed input ("=W/2", "12", "") for a param. The host decides
   *  whether it assigns an expression, clears one, or just sets a number. */
  onExpressionCommit?: (id: string, key: string, raw: string) => void;
  lang?: string;
}

const EXPR_COPY = {
  ko: {
    exprHint: '값 또는 =수식 (예: =W/2)',
    exprBroken: '수식 오류 — 마지막 값 유지됨',
    editExpr: '클릭하여 수식 편집',
    editValue: '클릭하여 값/수식 입력',
  },
  en: {
    exprHint: 'Value or =expression (e.g. =W/2)',
    exprBroken: 'Expression error — last value kept',
    editExpr: 'Click to edit expression',
    editValue: 'Click to type a value or =expression',
  },
  ja: {
    exprHint: '値または =数式 (例: =W/2)',
    exprBroken: '数式エラー — 直前の値を保持',
    editExpr: 'クリックして数式を編集',
    editValue: 'クリックして値または =数式を入力',
  },
  zh: {
    exprHint: '数值或 =表达式（例：=W/2）',
    exprBroken: '表达式错误 — 保留上一个值',
    editExpr: '点击编辑表达式',
    editValue: '点击输入数值或 =表达式',
  },
  es: {
    exprHint: 'Valor o =expresión (p. ej., =W/2)',
    exprBroken: 'Error en la expresión: se mantiene el último valor',
    editExpr: 'Haga clic para editar la expresión',
    editValue: 'Haga clic para escribir un valor o una =expresión',
  },
  ar: {
    exprHint: 'قيمة أو =معادلة (مثال: ‎=W/2)',
    exprBroken: 'خطأ في المعادلة — تم الإبقاء على آخر قيمة',
    editExpr: 'انقر لتحرير المعادلة',
    editValue: 'انقر لإدخال قيمة أو =معادلة',
  },
} as const;

export default function FeatureParams({
  instance, definition, t, onParamChange,
  expressions, variables, onExpressionCommit, lang,
}: FeatureParamsProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: `ko ? COPY.ko : COPY.en` 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const et = EXPR_COPY[toIsoLang(lang)] ?? EXPR_COPY.en;
  // Which param key is currently being typed into (inline text editor).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const exprEnabled = !!onExpressionCommit;

  const openEditor = (key: string, initial: string) => {
    setEditingKey(key);
    setDraft(initial);
  };

  const commitDraft = (key: string) => {
    setEditingKey(null);
    if (!exprEnabled) return;
    const parsed = parseParamInput(draft);
    if (parsed.kind === 'empty' && !(expressions && expressions[key])) return; // nothing to clear
    onExpressionCommit!(instance.id, key, draft);
  };

  // Guard: a feature/shape with no registered definition (e.g. a freshly created
  // sketchExtrude that isn't in SHAPE_MAP) used to crash the whole panel at
  // definition.params.map → "Cannot read properties of undefined (reading 'params')".
  if (!definition?.params || !instance?.params) {
    return (
      <div style={{ fontSize: 12, color: 'var(--nx-text-2)', padding: '4px 0' }}>
        {ko ? '편집할 파라미터가 없습니다' : 'No editable parameters'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {definition.params.map(sp => {
        const label = sp.labelKey ? t[sp.labelKey] ?? sp.key : sp.key;
        const val = instance.params[sp.key] ?? sp.default;

        // Enum-style param (axis, plane, hole type)
        if (sp.options) {
          return (
            <div key={sp.key}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', display: 'block', marginBottom: 4 }}>{label}</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {sp.options.map(opt => {
                  const active = Math.round(val) === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onParamChange(instance.id, sp.key, opt.value)}
                      style={{
                        flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                        border: active ? '2px solid var(--nx-accent)' : '1px solid var(--nx-border)',
                        background: active ? 'var(--nx-accent)22' : 'var(--nx-bg)',
                        color: active ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {t[opt.labelKey] ?? opt.labelKey}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        // Numeric param — optionally expression-driven ("=W/2").
        const expr = exprEnabled ? expressions?.[sp.key] : undefined;
        const driven = typeof expr === 'string' && expr.trim() !== '';
        // Live evaluation for the error badge (deleted/renamed variable keeps
        // the last value — never a silent NaN — but the badge flags it).
        const evalRes = driven
          ? evaluateParamExpression(expr!, paramScopeFor(instance, sp.key, variables ?? []))
          : null;
        const broken = evalRes !== null && !evalRes.ok;
        const isEditing = editingKey === sp.key;

        return (
          <div key={sp.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text)', flexShrink: 0 }}>{label}</label>
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => commitDraft(sp.key)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitDraft(sp.key); }
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  placeholder={et.exprHint}
                  title={et.exprHint}
                  style={{
                    flex: 1, minWidth: 0, padding: '3px 6px', borderRadius: 6,
                    border: '1px solid var(--nx-accent)', background: 'var(--nx-bg)',
                    color: 'var(--nx-accent)', fontSize: 12, fontWeight: 700,
                    fontFamily: 'monospace', textAlign: 'right', outline: 'none',
                  }}
                />
              ) : (
                <span
                  onClick={exprEnabled ? () => openEditor(sp.key, driven ? `=${expr}` : String(val)) : undefined}
                  title={
                    !exprEnabled ? undefined
                    : broken ? `${et.exprBroken}${evalRes && !evalRes.ok ? ` (${evalRes.error})` : ''}`
                    : driven ? et.editExpr
                    : et.editValue
                  }
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    cursor: exprEnabled ? 'pointer' : 'default',
                    minWidth: 0,
                  }}
                >
                  {driven && (
                    // fx badge — expression-driven marker (red when broken)
                    <span style={{
                      fontSize: 9, fontWeight: 800, fontStyle: 'italic',
                      color: broken ? 'var(--nx-error)' : 'var(--nx-accent-2)',
                      background: broken ? 'var(--nx-error)22' : 'var(--nx-accent)22',
                      borderRadius: 3, padding: '1px 4px', lineHeight: 1.3,
                      userSelect: 'none', flexShrink: 0,
                    }}>
                      {broken ? 'fx!' : 'fx'}
                    </span>
                  )}
                  {driven && (
                    <span style={{
                      fontSize: 11, fontFamily: 'monospace', color: 'var(--nx-text-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
                    }}>
                      ={expr}
                    </span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: broken ? 'var(--nx-error)' : 'var(--nx-accent-2)', flexShrink: 0 }}>
                    {val}{sp.unit ? ` ${sp.unit}` : ''}
                  </span>
                </span>
              )}
            </div>
            {/* Slider only for free (non-driven) params — a driven param is
                edited through its expression, mirroring SolidWorks. */}
            {!driven && (
              <>
                <input
                  type="range"
                  min={sp.min}
                  max={sp.max}
                  step={sp.step}
                  value={val}
                  onChange={e => onParamChange(instance.id, sp.key, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--nx-accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--nx-border-strong)' }}>
                  <span>{sp.min}{sp.unit}</span>
                  <span>{sp.max}{sp.unit}</span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
