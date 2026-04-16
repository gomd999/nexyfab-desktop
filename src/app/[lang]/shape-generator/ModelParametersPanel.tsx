'use client';

import React, { useState, useCallback } from 'react';
import { evaluateExpression, type ExprVariable } from './ExpressionEngine';

export interface ModelVar {
  id: string;
  name: string;
  expression: string; // raw text — may be a formula or plain number
  value: number;       // resolved numeric value
}

interface ModelParametersPanelProps {
  vars: ModelVar[];
  onChange: (vars: ModelVar[]) => void;
  lang: string;
}

let _varIdSeq = 1;
function genVarId() { return `mv-${_varIdSeq++}`; }

/** Resolve all variables in order; later vars can reference earlier ones. */
export function resolveModelVars(vars: ModelVar[]): ModelVar[] {
  const resolved: ModelVar[] = [];
  for (const v of vars) {
    const context: ExprVariable[] = resolved.map(r => ({ name: r.name, value: r.value }));
    let value = v.value;
    try {
      const parsed = parseFloat(v.expression);
      if (!isNaN(parsed) && String(parsed) === v.expression.trim()) {
        value = parsed;
      } else {
        value = evaluateExpression(v.expression, context);
        if (!isFinite(value)) value = v.value;
      }
    } catch {
      // keep previous value on error
    }
    resolved.push({ ...v, value });
  }
  return resolved;
}

function isValidVarName(name: string) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export default function ModelParametersPanel({ vars, onChange, lang }: ModelParametersPanelProps) {
  const isKo = lang === 'ko';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const addVar = useCallback(() => {
    const newName = `var${vars.length + 1}`;
    const newVar: ModelVar = { id: genVarId(), name: newName, expression: '0', value: 0 };
    const next = resolveModelVars([...vars, newVar]);
    onChange(next);
    setEditingId(newVar.id);
    setEditName(newName);
  }, [vars, onChange]);

  const removeVar = useCallback((id: string) => {
    const next = resolveModelVars(vars.filter(v => v.id !== id));
    onChange(next);
  }, [vars, onChange]);

  const updateExpr = useCallback((id: string, expr: string) => {
    const updated = vars.map(v => v.id === id ? { ...v, expression: expr } : v);
    const next = resolveModelVars(updated);
    onChange(next);
  }, [vars, onChange]);

  const commitName = useCallback((id: string) => {
    const name = editName.trim();
    if (!name || !isValidVarName(name) || (vars.some(v => v.name === name && v.id !== id))) {
      setEditingId(null);
      return;
    }
    const updated = vars.map(v => v.id === id ? { ...v, name } : v);
    onChange(resolveModelVars(updated));
    setEditingId(null);
  }, [editName, vars, onChange]);

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      left: 260,
      zIndex: 510,
      width: 260,
      backgroundColor: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 12,
      color: '#e6edf3',
      fontFamily: 'sans-serif',
      fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid #30363d',
        fontWeight: 700, fontSize: 13,
      }}>
        <span>⚙️ {isKo ? '모델 파라미터' : 'Model Parameters'}</span>
        <button
          onClick={addVar}
          style={{
            padding: '3px 10px', borderRadius: 5, border: 'none',
            background: '#1f6feb', color: '#fff', fontWeight: 700,
            fontSize: 11, cursor: 'pointer',
          }}
        >
          + {isKo ? '추가' : 'Add'}
        </button>
      </div>

      {/* Variable list */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {vars.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: '#6e7681', fontSize: 11 }}>
            {isKo ? '파라미터를 추가해 수식에서 사용하세요' : 'Add parameters to use in expressions'}
          </div>
        ) : (
          vars.map((v, idx) => {
            const context: ExprVariable[] = vars.slice(0, idx).map(r => ({ name: r.name, value: r.value }));
            let exprError = false;
            try {
              const parsed = parseFloat(v.expression);
              if (isNaN(parsed) || String(parsed) !== v.expression.trim()) {
                evaluateExpression(v.expression, context);
              }
            } catch {
              exprError = true;
            }

            return (
              <div key={v.id} style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr 50px 24px',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                borderBottom: '1px solid #21262d',
              }}>
                {/* Name */}
                {editingId === v.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => commitName(v.id)}
                    onKeyDown={e => { if (e.key === 'Enter') commitName(v.id); if (e.key === 'Escape') setEditingId(null); }}
                    style={{
                      width: '100%', padding: '2px 5px', borderRadius: 4,
                      border: '1px solid #388bfd', background: '#0d1117',
                      color: '#e6edf3', fontSize: 11, fontFamily: 'monospace',
                    }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditingId(v.id); setEditName(v.name); }}
                    title={isKo ? '클릭하여 이름 변경' : 'Click to rename'}
                    style={{
                      color: '#79c0ff', fontWeight: 700, fontSize: 11,
                      fontFamily: 'monospace', cursor: 'pointer',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {v.name}
                  </span>
                )}

                {/* Expression */}
                <input
                  type="text"
                  value={v.expression}
                  onChange={e => updateExpr(v.id, e.target.value)}
                  placeholder="0"
                  style={{
                    width: '100%', padding: '2px 6px', borderRadius: 4,
                    border: `1px solid ${exprError ? '#f85149' : '#30363d'}`,
                    background: '#0d1117', color: '#e6edf3', fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />

                {/* Resolved value */}
                <span style={{
                  textAlign: 'right', fontSize: 10, fontFamily: 'monospace',
                  color: exprError ? '#f85149' : '#3fb950',
                  fontWeight: 700,
                }}>
                  {exprError ? 'err' : (Number.isInteger(v.value) ? v.value : v.value.toFixed(3))}
                </span>

                {/* Delete */}
                <button
                  onClick={() => removeVar(v.id)}
                  style={{
                    padding: 0, width: 20, height: 20,
                    borderRadius: 4, border: 'none', background: 'none',
                    color: '#6e7681', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  }}
                  title={isKo ? '삭제' : 'Remove'}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '6px 12px', borderTop: '1px solid #30363d',
        fontSize: 10, color: '#6e7681', lineHeight: 1.5,
      }}>
        {isKo
          ? '파라미터는 파라미터 슬라이더의 "fx" 버튼으로 수식 입력 시 사용 가능'
          : 'Use variables in param fields via the "fx" button on sliders'}
      </div>
    </div>
  );
}
