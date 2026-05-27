'use client';

/**
 * ConfigurationPanel.tsx
 *
 * Side panel for browsing / editing the project's configurations
 * (design variants). The actual state lives in
 * ConfigurationManager; this panel is the interaction surface.
 */

import React, { useState } from 'react';
import type { ConfigurationManager, Configuration } from './configurationManager';

interface ConfigurationPanelProps {
  lang: string;
  manager: ConfigurationManager;
  /** Notifies parent that the active config changed — caller should
   *  re-evaluate the feature pipeline. */
  onActivate: (configId: string) => void;
  onClose?: () => void;
}

const COPY = {
  ko: {
    title: '구성',
    add: '+ 새 구성',
    newName: '새 구성 이름',
    activate: '활성화',
    active: '활성',
    remove: '삭제',
    cancel: '취소',
    confirm: '추가',
    inheritsFrom: '상속:',
  },
  en: {
    title: 'Configurations',
    add: '+ New Configuration',
    newName: 'Configuration name',
    activate: 'Activate',
    active: 'Active',
    remove: 'Delete',
    cancel: 'Cancel',
    confirm: 'Add',
    inheritsFrom: 'Inherits:',
  },
} as const;

export default function ConfigurationPanel({
  lang, manager, onActivate, onClose,
}: ConfigurationPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [configs, setConfigs] = useState<Configuration[]>(manager.list());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const activeId = manager.active()?.id ?? null;

  const refresh = () => setConfigs([...manager.list()]);

  const handleAdd = () => {
    const id = newName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!id) return;
    try {
      manager.add({ id, name: newName.trim() });
      refresh();
      setNewName('');
      setAdding(false);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleRemove = (id: string) => {
    if (confirm(`Remove configuration "${id}"?`)) {
      manager.remove(id);
      refresh();
    }
  };

  return (
    <div
      style={{
        position: 'fixed', top: 80, right: 20,
        zIndex: 700, width: 280,
        background: '#0f172a', color: '#f1f5f9',
        borderRadius: 10, padding: '14px 16px',
        boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
          >
            ✕
          </button>
        )}
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', maxHeight: '40vh', overflowY: 'auto' }}>
        {configs.map(c => (
          <li
            key={c.id}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              marginBottom: 4,
              background: c.id === activeId ? '#1e293b' : 'transparent',
              border: c.id === activeId ? '1px solid #3b82f6' : '1px solid transparent',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: c.id === activeId ? 700 : 400 }}>{c.name}</span>
              {c.id === activeId && (
                <span style={{ color: '#22c55e', fontSize: 10, marginLeft: 8 }}>● {t.active}</span>
              )}
            </div>
            {c.parentId && (
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                {t.inheritsFrom} {c.parentId}
              </div>
            )}
            <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
              {c.id !== activeId && (
                <button
                  onClick={() => { manager.activate(c.id); onActivate(c.id); refresh(); }}
                  style={{
                    background: '#3b82f6', color: 'white', border: 'none',
                    padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {t.activate}
                </button>
              )}
              <button
                onClick={() => handleRemove(c.id)}
                style={{
                  background: 'transparent', color: '#94a3b8', border: 'none',
                  padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                }}
              >
                {t.remove}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t.newName}
            autoFocus
            style={{
              flex: 1,
              background: '#1e293b', color: '#f1f5f9',
              border: '1px solid #334155',
              borderRadius: 6, padding: '6px 8px', fontSize: 12,
            }}
          />
          <button
            onClick={handleAdd}
            style={{
              background: '#3b82f6', color: 'white', border: 'none',
              padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
            }}
          >
            {t.confirm}
          </button>
          <button
            onClick={() => { setAdding(false); setNewName(''); }}
            style={{
              background: 'transparent', color: '#94a3b8', border: 'none',
              padding: '6px 8px', fontSize: 11, cursor: 'pointer',
            }}
          >
            {t.cancel}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            width: '100%',
            background: '#1e293b', color: '#94a3b8',
            border: '1px dashed #334155', borderRadius: 6,
            padding: '8px 0', fontSize: 12, cursor: 'pointer',
          }}
        >
          {t.add}
        </button>
      )}
    </div>
  );
}
