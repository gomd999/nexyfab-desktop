'use client';

/**
 * EquationPanel.tsx — Global variable editor.
 *
 * Displays the project's variables + lets the user define new
 * formulas. Each row shows name, expression, current value.
 * Editing triggers a re-evaluation of dependent variables.
 */

import React, { useState } from 'react';
import type { EquationManager, GlobalVariable } from './equationManager';

interface EquationPanelProps {
  lang: string;
  manager: EquationManager;
  /** Notified after every change. Caller refreshes feature pipeline. */
  onChange?: () => void;
  onClose?: () => void;
}

const COPY = {
  ko: {
    title: '전역 수식',
    name: '이름', expr: '식', value: '값',
    add: '+ 새 변수',
    save: '저장',
    cancel: '취소',
    remove: '삭제',
  },
  en: {
    title: 'Global Equations',
    name: 'Name', expr: 'Expression', value: 'Value',
    add: '+ New Variable',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Delete',
  },
} as const;

export default function EquationPanel({
  lang, manager, onChange, onClose,
}: EquationPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [vars, setVars] = useState<GlobalVariable[]>(manager.list());
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftExpr, setDraftExpr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => setVars([...manager.list()]);

  const handleSave = () => {
    try {
      manager.set(draftName, draftExpr);
      setEditing(null);
      setDraftName('');
      setDraftExpr('');
      setError(null);
      refresh();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRemove = (name: string) => {
    try {
      manager.remove(name);
      refresh();
      onChange?.();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', top: 80, right: 320,
        zIndex: 700, width: 360,
        background: 'var(--nx-panel)', color: 'var(--nx-text)',
        borderRadius: 10, padding: '14px 16px',
        boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--nx-border)', color: 'var(--nx-text-2)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{t.name}</th>
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{t.expr}</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>{t.value}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {vars.map(v => (
            <tr key={v.name} style={{ borderBottom: '1px solid var(--nx-panel-2)' }}>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{v.name}</td>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--nx-text-2)' }}>{v.expression}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                {Number.isFinite(v.value) ? v.value.toFixed(3) : '—'}
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <button
                  onClick={() => handleRemove(v.name)}
                  style={{
                    background: 'transparent', color: 'var(--nx-text-2)', border: 'none',
                    cursor: 'pointer', fontSize: 11,
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing === 'new' ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder={t.name}
              style={{
                flex: 1, background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
                border: '1px solid var(--nx-border)', borderRadius: 6,
                padding: '6px 8px', fontSize: 12, fontFamily: 'monospace',
              }}
            />
            <input
              type="text"
              value={draftExpr}
              onChange={e => setDraftExpr(e.target.value)}
              placeholder={t.expr}
              style={{
                flex: 2, background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
                border: '1px solid var(--nx-border)', borderRadius: 6,
                padding: '6px 8px', fontSize: 12, fontFamily: 'monospace',
              }}
            />
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave}
              style={{
                background: '#3b82f6', color: 'white', border: 'none',
                padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              }}
            >
              {t.save}
            </button>
            <button
              onClick={() => { setEditing(null); setDraftName(''); setDraftExpr(''); setError(null); }}
              style={{
                background: 'transparent', color: 'var(--nx-text-2)', border: 'none',
                padding: '6px 8px', fontSize: 11, cursor: 'pointer',
              }}
            >
              {t.cancel}
            </button>
          </div>
          {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
        </div>
      ) : (
        <button
          onClick={() => setEditing('new')}
          style={{
            width: '100%', marginTop: 8,
            background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)',
            border: '1px dashed var(--nx-border)', borderRadius: 6,
            padding: '8px 0', fontSize: 12, cursor: 'pointer',
          }}
        >
          {t.add}
        </button>
      )}
    </div>
  );
}
