'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { evaluateExpression, isExpression, BUILT_IN_FUNCTION_NAMES, type ExprVariable } from './ExpressionEngine';
import { convertInputToActiveUnit, type UnitSystem } from './units';

const dict = {
  ko: {
    insertParam: '파라미터 삽입',
    insertTitle: '파라미터 삽입',
    syntaxHelp: '수식을 지원합니다: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round(). 파라미터 이름을 변수로 사용하세요.',
    invalid: '잘못된 수식',
  },
  en: {
    insertParam: 'Insert parameter',
    insertTitle: 'Insert parameter',
    syntaxHelp: 'Supports math expressions: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round(). Use parameter names as variables.',
    invalid: 'Invalid expression',
  },
  ja: {
    insertParam: 'パラメータを挿入',
    insertTitle: 'パラメータを挿入',
    syntaxHelp: '数式をサポート: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round(). パラメータ名を変数として使用できます。',
    invalid: '無効な式',
  },
  zh: {
    insertParam: '插入参数',
    insertTitle: '插入参数',
    syntaxHelp: '支持数学表达式: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round()。使用参数名作为变量。',
    invalid: '无效表达式',
  },
  es: {
    insertParam: 'Insertar parámetro',
    insertTitle: 'Insertar parámetro',
    syntaxHelp: 'Soporta expresiones matemáticas: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round(). Usa nombres de parámetros como variables.',
    invalid: 'Expresión no válida',
  },
  ar: {
    insertParam: 'إدراج معامل',
    insertTitle: 'إدراج معامل',
    syntaxHelp: 'يدعم التعبيرات الرياضية: +, -, *, /, sin(), cos(), sqrt(), pi, abs(), round(). استخدم أسماء المعاملات كمتغيرات.',
    invalid: 'تعبير غير صالح',
  },
};

interface ExpressionInputProps {
  /** Current raw expression text (may be a plain number or formula) */
  expression: string;
  /** Available variables (other parameter names + their current values) */
  variables: ExprVariable[];
  /** Called when a valid numeric value is produced */
  onValueChange: (value: number) => void;
  /** Called when the expression text changes */
  onExpressionChange: (expr: string) => void;
  /** Called on blur / Enter to commit */
  onCommit: () => void;
  /** Min/max/step for clamping */
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Active unit system for auto-conversion ("1in" → mm in mm-mode). */
  unitSystem?: UnitSystem;
  /** i18n label for expression tooltip */
  expressionLabel?: string;
}

export default function ExpressionInput({
  expression,
  variables,
  onValueChange,
  onExpressionChange,
  onCommit,
  min,
  max,
  step,
  unit,
  unitSystem,
  expressionLabel = 'Expression',
}: ExpressionInputProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const [localExpr, setLocalExpr] = useState(expression);
  const [error, setError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<number | null>(null);
  const [unitConvertNote, setUnitConvertNote] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPosRef = useRef<number>(0);

  // Sync from parent when expression prop changes externally
  useEffect(() => {
    setLocalExpr(expression);
  }, [expression]);

  // Re-evaluate whenever localExpr or variables change
  useEffect(() => {
    const trimmed = localExpr.trim();
    if (trimmed === '') {
      setError(null);
      setEvalResult(null);
      return;
    }
    try {
      const result = evaluateExpression(trimmed, variables);
      setError(null);
      setEvalResult(result);
    } catch (e: any) {
      setError(e.message || t.invalid);
      setEvalResult(null);
    }
  }, [localExpr, variables]);

  // Build suggestions: parameter variable names + built-in function names
  const getSuggestions = useCallback((): string[] => {
    const trimmed = localExpr.trim();
    if (!trimmed) return [];
    const match = trimmed.match(/([a-zA-Z_]\w*)$/);
    if (!match) return [];
    const fragment = match[1].toLowerCase();
    const candidates = [
      ...variables.map(v => v.name),
      ...BUILT_IN_FUNCTION_NAMES,
    ];
    return candidates.filter(c => c.toLowerCase().startsWith(fragment) && c.toLowerCase() !== fragment);
  }, [localExpr, variables]);

  const suggestions = showSuggestions ? getSuggestions() : [];

  const applySuggestion = (suggestion: string) => {
    const match = localExpr.match(/([a-zA-Z_]\w*)$/);
    if (match) {
      const before = localExpr.slice(0, localExpr.length - match[1].length);
      const newExpr = before + suggestion;
      setLocalExpr(newExpr);
      onExpressionChange(newExpr);
    }
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  /** Insert a param name at cursor position from the ⊕ link menu */
  const insertParam = (name: string) => {
    const pos = cursorPosRef.current;
    const before = localExpr.slice(0, pos);
    const after = localExpr.slice(pos);
    const newExpr = before + name + after;
    setLocalExpr(newExpr);
    onExpressionChange(newExpr);
    setShowLinkMenu(false);
    setTimeout(() => {
      inputRef.current?.focus();
      const newPos = pos + name.length;
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalExpr(val);
    onExpressionChange(val);
    setShowSuggestions(true);
    setSuggestionIdx(0);
    cursorPosRef.current = e.target.selectionStart ?? val.length;
  };

  const commitValue = () => {
    const trimmed = localExpr.trim();
    if (trimmed === '') return;
    // Try unit-aware parse first (e.g. "1in" → 25.4 in mm-mode).
    if (unitSystem) {
      const conv = convertInputToActiveUnit(trimmed, unitSystem);
      if (conv.value !== null && conv.note) {
        const clamped = Math.min(max, Math.max(min, conv.value));
        const display = clamped.toString();
        setLocalExpr(display);
        onExpressionChange(display);
        onValueChange(clamped);
        setUnitConvertNote(conv.note);
        setTimeout(() => setUnitConvertNote(null), 2500);
        onCommit();
        setShowSuggestions(false);
        return;
      }
    }
    try {
      const result = evaluateExpression(trimmed, variables);
      const clamped = Math.min(max, Math.max(min, result));
      onValueChange(clamped);
      onCommit();
    } catch {
      // Don't commit invalid expressions
    }
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0 && showSuggestions) {
        applySuggestion(suggestions[suggestionIdx]);
      } else {
        commitValue();
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setShowLinkMenu(false);
    } else if (e.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setSuggestionIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      applySuggestion(suggestions[suggestionIdx]);
    }
  };

  const hasExpr = isExpression(localExpr);
  const borderColor = error ? '#f85149' : hasExpr ? '#6366f1' : '#30363d';
  const paramVars = variables.filter(v => !BUILT_IN_FUNCTION_NAMES.includes(v.name));

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {/* fx badge — expression mode indicator */}
        {hasExpr && (
          <span
            title={expressionLabel}
            style={{
              fontSize: 9, fontWeight: 800, fontStyle: 'italic',
              color: '#a78bfa', background: '#6366f122',
              borderRadius: 3, padding: '1px 4px', lineHeight: 1.3,
              userSelect: 'none', flexShrink: 0,
            }}
          >
            fx
          </span>
        )}

        {/* ⊕ quick param-link button */}
        {paramVars.length > 0 && (
          <button
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              cursorPosRef.current = inputRef.current?.selectionStart ?? localExpr.length;
              setShowLinkMenu(v => !v);
              setShowSuggestions(false);
            }}
            title={t.insertTitle}
            style={{
              flexShrink: 0, width: 14, height: 14,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%', border: `1px solid ${showLinkMenu ? '#388bfd' : '#30363d'}`,
              background: showLinkMenu ? '#388bfd22' : 'transparent',
              color: showLinkMenu ? '#58a6ff' : '#484f58',
              fontSize: 11, cursor: 'pointer', lineHeight: 1,
              transition: 'all 0.15s',
            }}
          >
            ⊕
          </button>
        )}

        {/* Expression syntax help tooltip */}
        <span
          title={t.syntaxHelp}
          style={{
            fontSize: 10, fontWeight: 700, color: '#484f58', cursor: 'help',
            userSelect: 'none', flexShrink: 0, width: 14, height: 14,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%', border: '1px solid #30363d', lineHeight: 1,
          }}
        >
          ?
        </span>

        <input
          ref={inputRef}
          type="text"
          value={localExpr}
          onChange={handleChange}
          onBlur={() => { commitValue(); setTimeout(() => setShowLinkMenu(false), 150); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onClick={e => { cursorPosRef.current = (e.target as HTMLInputElement).selectionStart ?? localExpr.length; }}
          title={error || (evalResult !== null && hasExpr ? `= ${evalResult}` : undefined)}
          style={{
            width: 72, padding: '3px 6px', borderRadius: 6,
            border: `1px solid ${borderColor}`, fontSize: 12, fontWeight: 700,
            color: error ? '#f85149' : '#6366f1', textAlign: 'right',
            outline: 'none', background: '#0d1117',
            fontFamily: hasExpr ? 'monospace' : 'inherit',
            transition: 'border-color 0.15s',
          }}
        />
        <span style={{ fontSize: 10, color: '#9ca3af', minWidth: 22 }}>{unit}</span>
      </div>

      {/* Evaluated result preview */}
      {hasExpr && evalResult !== null && !error && (
        <div style={{ fontSize: 10, color: '#a78bfa', textAlign: 'right', paddingRight: 26, fontFamily: 'monospace' }}>
          = {Math.round(evalResult * 1000) / 1000}{unit ? ` ${unit}` : ''}
        </div>
      )}

      {/* Unit conversion note */}
      {unitConvertNote && (
        <div style={{
          fontSize: 10, color: '#3fb950', textAlign: 'right', paddingRight: 26,
          fontFamily: 'monospace', fontWeight: 600,
        }}>
          {unitConvertNote}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{ fontSize: 10, color: '#f85149', textAlign: 'right', paddingRight: 26, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {error}
        </div>
      )}

      {/* ⊕ Param link dropdown */}
      {showLinkMenu && paramVars.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 26, zIndex: 200,
          background: '#161b22', border: '1px solid #388bfd55', borderRadius: 6,
          boxShadow: '0 4px 14px rgba(0,0,0,0.5)', minWidth: 130,
        }}>
          <div style={{ padding: '4px 8px 2px', fontSize: 9, color: '#6e7681', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {t.insertParam}
          </div>
          {paramVars.map(v => (
            <div
              key={v.name}
              onMouseDown={(e) => { e.preventDefault(); insertParam(v.name); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontFamily: 'monospace',
                color: '#c9d1d9', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#21262d')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: '#79c0ff' }}>{v.name}</span>
              <span style={{ color: '#484f58' }}>{Math.round(v.value * 100) / 100}</span>
            </div>
          ))}
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 26, zIndex: 100,
          background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)', maxHeight: 120, overflowY: 'auto', minWidth: 100,
        }}>
          {suggestions.map((s, i) => (
            <div
              key={s}
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                color: i === suggestionIdx ? '#58a6ff' : '#c9d1d9',
                background: i === suggestionIdx ? '#21262d' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
