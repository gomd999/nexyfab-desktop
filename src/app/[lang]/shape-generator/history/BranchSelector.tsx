'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { DesignBranch } from './DesignBranch';
import { DEFAULT_BRANCH_ID } from './DesignBranch';
import type { Theme } from '../theme';

const dict = {
  ko: {
    branch: '브랜치', newBranch: '새 브랜치', create: '생성', cancel: '취소',
    delete: '삭제', confirmDelete: '삭제하시겠습니까?',
    cannotDeleteMain: 'main 브랜치는 삭제할 수 없습니다', yes: '예',
    branchNamePh: '브랜치 이름...',
  },
  en: {
    branch: 'Branch', newBranch: 'New Branch', create: 'Create', cancel: 'Cancel',
    delete: 'Delete', confirmDelete: 'Delete this branch?',
    cannotDeleteMain: 'Cannot delete main branch', yes: 'Yes',
    branchNamePh: 'Branch name...',
  },
  ja: {
    branch: 'ブランチ', newBranch: '新規ブランチ', create: '作成', cancel: 'キャンセル',
    delete: '削除', confirmDelete: '削除しますか？',
    cannotDeleteMain: 'main ブランチは削除できません', yes: 'はい',
    branchNamePh: 'ブランチ名...',
  },
  zh: {
    branch: '分支', newBranch: '新建分支', create: '创建', cancel: '取消',
    delete: '删除', confirmDelete: '确定要删除吗？',
    cannotDeleteMain: '无法删除 main 分支', yes: '是',
    branchNamePh: '分支名称...',
  },
  es: {
    branch: 'Rama', newBranch: 'Nueva Rama', create: 'Crear', cancel: 'Cancelar',
    delete: 'Eliminar', confirmDelete: '¿Eliminar esta rama?',
    cannotDeleteMain: 'No se puede eliminar la rama main', yes: 'Sí',
    branchNamePh: 'Nombre de rama...',
  },
  ar: {
    branch: 'فرع', newBranch: 'فرع جديد', create: 'إنشاء', cancel: 'إلغاء',
    delete: 'حذف', confirmDelete: 'هل تريد الحذف؟',
    cannotDeleteMain: 'لا يمكن حذف الفرع الرئيسي main', yes: 'نعم',
    branchNamePh: 'اسم الفرع...',
  },
};

interface BranchSelectorProps {
  branches: DesignBranch[];
  activeBranch: string;
  onCreateBranch: (name: string) => void;
  onSwitchBranch: (branchId: string) => void;
  onDeleteBranch: (branchId: string) => void;
  theme: Theme;
  lang: string;
}

export default function BranchSelector({
  branches,
  activeBranch,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  theme,
  lang,
}: BranchSelectorProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [open, setOpen] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labels = {
    branch: t.branch,
    newBranch: t.newBranch,
    create: t.create,
    cancel: t.cancel,
    delete: t.delete,
    confirmDelete: t.confirmDelete,
    cannotDeleteMain: t.cannotDeleteMain,
    yes: t.yes,
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewInput(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when showing new branch input
  useEffect(() => {
    if (showNewInput && inputRef.current) inputRef.current.focus();
  }, [showNewInput]);

  const currentBranch = branches.find(b => b.id === activeBranch);

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreateBranch(trimmed);
    setNewName('');
    setShowNewInput(false);
    setOpen(false);
  }, [newName, onCreateBranch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    else if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
  }, [handleCreate]);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 6,
          border: `1px solid ${theme.border}`,
          background: theme.cardBg,
          color: theme.text,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.12s',
          minWidth: 100,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.border; }}
      >
        {/* Color dot */}
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: currentBranch?.color || theme.accent,
          flexShrink: 0,
        }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {currentBranch?.name || 'main'}
        </span>
        <span style={{ fontSize: 8, opacity: 0.6 }}>{open ? '\u25B4' : '\u25BE'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          minWidth: 200,
          background: theme.cardBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 1000,
          overflow: 'hidden',
        }}>
          {/* Branch list */}
          <div style={{ maxHeight: 200, overflowY: 'auto', padding: 4 }}>
            {branches.map(b => {
              const isActive = b.id === activeBranch;
              const isConfirmingDelete = confirmDeleteId === b.id;
              return (
                <div key={b.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isActive ? `${theme.accent}20` : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onClick={() => {
                      if (!isActive) onSwitchBranch(b.id);
                      setOpen(false);
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.background = theme.hoverBg;
                    }}
                    onMouseLeave={e => {
                      if (!isActive) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: b.color,
                      flexShrink: 0,
                    }} />
                    <span style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? theme.accentBright : theme.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {b.name}
                    </span>
                    {isActive && (
                      <span style={{ fontSize: 10, color: theme.accentBright }}>&#10003;</span>
                    )}
                    {b.id !== DEFAULT_BRANCH_ID && (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(b.id); }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: theme.textMuted,
                          fontSize: 10,
                          cursor: 'pointer',
                          padding: '0 4px',
                          borderRadius: 4,
                          transition: 'color 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#f85149'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = theme.textMuted; }}
                        title={labels.delete}
                      >
                        &#x2715;
                      </button>
                    )}
                  </div>
                  {/* Delete confirmation */}
                  {isConfirmingDelete && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px 4px 26px',
                      fontSize: 10,
                    }}>
                      <span style={{ color: '#f85149', fontWeight: 600, flex: 1 }}>
                        {labels.confirmDelete}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteBranch(b.id);
                          setConfirmDeleteId(null);
                        }}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: 'none',
                          background: '#f85149',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.yes}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBg,
                          color: theme.textMuted,
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: theme.border }} />

          {/* New branch */}
          {showNewInput ? (
            <div style={{ padding: '8px 10px', display: 'flex', gap: 6 }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.branchNamePh}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${theme.accent}`,
                  background: theme.inputBg,
                  color: theme.text,
                  fontSize: 11,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: newName.trim() ? theme.accent : theme.border,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: newName.trim() ? 'pointer' : 'default',
                }}
              >
                {labels.create}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewInput(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                background: 'transparent',
                color: theme.accentBright,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              + {labels.newBranch}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
