'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { evaluateExpression, type ExprVariable } from './ExpressionEngine';

const dict = {
  ko: {
    title: '모델 파라미터',
    add: '추가',
    empty: '파라미터를 추가해 수식에서 사용하세요',
    rename: '클릭하여 이름 변경',
    remove: '삭제',
    hint: '파라미터는 파라미터 슬라이더의 "fx" 버튼으로 수식 입력 시 사용 가능',
  },
  en: {
    title: 'Model Parameters',
    add: 'Add',
    empty: 'Add parameters to use in expressions',
    rename: 'Click to rename',
    remove: 'Remove',
    hint: 'Use variables in param fields via the "fx" button on sliders',
  },
  ja: {
    title: 'モデルパラメータ',
    add: '追加',
    empty: '式で使用するパラメータを追加してください',
    rename: 'クリックして名前を変更',
    remove: '削除',
    hint: 'スライダーの "fx" ボタンから式フィールドで変数を使用できます',
  },
  zh: {
    title: '模型参数',
    add: '添加',
    empty: '添加参数以在表达式中使用',
    rename: '点击重命名',
    remove: '删除',
    hint: '通过滑块上的 "fx" 按钮在参数字段中使用变量',
  },
  es: {
    title: 'Parámetros del Modelo',
    add: 'Añadir',
    empty: 'Añade parámetros para usar en expresiones',
    rename: 'Clic para renombrar',
    remove: 'Eliminar',
    hint: 'Usa variables en los campos de parámetros con el botón "fx" de los deslizadores',
  },
  ar: {
    title: 'معاملات النموذج',
    add: 'إضافة',
    empty: 'أضف معاملات لاستخدامها في التعبيرات',
    rename: 'انقر لإعادة التسمية',
    remove: 'إزالة',
    hint: 'استخدم المتغيرات في حقول المعاملات عبر زر "fx" على شرائط التمرير',
  },
};

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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
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
        <span>⚙️ {t.title}</span>
        <button
          onClick={addVar}
          style={{
            padding: '3px 10px', borderRadius: 5, border: 'none',
            background: '#1f6feb', color: '#fff', fontWeight: 700,
            fontSize: 11, cursor: 'pointer',
          }}
        >
          + {t.add}
        </button>
      </div>

      {/* Variable list */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {vars.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: '#6e7681', fontSize: 11 }}>
            {t.empty}
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
                    title={t.rename}
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
                  title={t.remove}
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
        {t.hint}
      </div>
    </div>
  );
}
