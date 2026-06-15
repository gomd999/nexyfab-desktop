'use client';

/**
 * PermissionsPanel.tsx — Wave 2 Phase 3 Week 8 Track Z8.
 *
 * "Manage people" panel for a cloud document. Backs
 * `/api/documents/[id]/permissions` (GET/POST) and
 * `/api/documents/[id]/permissions/[userId]` (DELETE).
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ People with access                                 │
 *   │ ──────────────────────────────────────────────────│
 *   │ alice@x.com         Owner               (locked)   │
 *   │ bob@x.com           [Editor ▾]          Remove     │
 *   │ carol@x.com         [Viewer ▾]          Remove     │
 *   │ ──────────────────────────────────────────────────│
 *   │ + Add person                                       │
 *   │   email…                  [Editor ▾] [Add]         │
 *   └────────────────────────────────────────────────────┘
 *
 * Role precedence: owner > editor > commenter > viewer (mirrors
 * `src/lib/cloudDoc/access.ts` and `src/lib/document-permissions.ts`).
 *
 * Anti-enumeration: a 404 from the API collapses to "Not available"
 * without distinguishing "doc gone" from "you lost access" — the
 * server-side resolver already collapses both to 404.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types (mirror server shape) ───────────────────────────────────────────

export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer';

interface PermissionRow {
  documentId: string;
  userId: string;
  role: DocRole;
  grantedBy: string | null;
  grantedAt: number;
  expiresAt: number | null;
}

interface PermissionApiResponse {
  ok: boolean;
  permissions: PermissionRow[];
}

interface PermissionUpsertResponse {
  ok: boolean;
  permission: PermissionRow;
}

// ─── i18n ──────────────────────────────────────────────────────────────────

export type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface Dict {
  readonly title: string;
  readonly subtitle: string;
  readonly loading: string;
  readonly empty: string;
  readonly notAvailable: string;
  readonly roleOwner: string;
  readonly roleEditor: string;
  readonly roleCommenter: string;
  readonly roleViewer: string;
  readonly ownerLocked: string;
  readonly remove: string;
  readonly confirmRemove: string;
  readonly addPersonHeader: string;
  readonly userIdPlaceholder: string;
  readonly add: string;
  readonly adding: string;
  readonly removing: string;
  readonly close: string;
  readonly errorUserNotFound: string;
  readonly errorMultiOwner: string;
  readonly errorSelf: string;
  readonly errorGeneric: string;
}

const DICTS: Record<Lang, Dict> = {
  ko: {
    title: '문서 접근 권한',
    subtitle: '이 문서에 접근할 수 있는 사용자',
    loading: '불러오는 중…',
    empty: '소유자만 접근 가능',
    notAvailable: '권한을 불러올 수 없습니다',
    roleOwner: '소유자',
    roleEditor: '편집자',
    roleCommenter: '댓글 작성자',
    roleViewer: '뷰어',
    ownerLocked: '잠금',
    remove: '제거',
    confirmRemove: '이 사용자의 접근을 제거하시겠습니까?',
    addPersonHeader: '사용자 추가',
    userIdPlaceholder: '사용자 ID',
    add: '추가',
    adding: '추가 중…',
    removing: '제거 중…',
    close: '닫기',
    errorUserNotFound: '사용자를 찾을 수 없습니다',
    errorMultiOwner: '소유권 이전을 사용하세요 (소유자는 한 명만)',
    errorSelf: '자기 자신의 권한은 변경할 수 없습니다',
    errorGeneric: '오류가 발생했습니다',
  },
  en: {
    title: 'Document access',
    subtitle: 'People who can open this document',
    loading: 'Loading…',
    empty: 'Only the owner has access',
    notAvailable: 'Permissions are not available',
    roleOwner: 'Owner',
    roleEditor: 'Editor',
    roleCommenter: 'Commenter',
    roleViewer: 'Viewer',
    ownerLocked: 'locked',
    remove: 'Remove',
    confirmRemove: 'Remove this person’s access?',
    addPersonHeader: 'Add person',
    userIdPlaceholder: 'user id',
    add: 'Add',
    adding: 'Adding…',
    removing: 'Removing…',
    close: 'Close',
    errorUserNotFound: 'User not found',
    errorMultiOwner: 'Use ownership transfer (only one owner)',
    errorSelf: 'You can’t change your own role here',
    errorGeneric: 'Something went wrong',
  },
  ja: {
    title: 'ドキュメントアクセス',
    subtitle: 'このドキュメントを開けるユーザー',
    loading: '読み込み中…',
    empty: '所有者のみアクセス可能',
    notAvailable: '権限を取得できません',
    roleOwner: '所有者',
    roleEditor: '編集者',
    roleCommenter: 'コメント作成者',
    roleViewer: '閲覧者',
    ownerLocked: 'ロック',
    remove: '削除',
    confirmRemove: 'このユーザーのアクセスを削除しますか?',
    addPersonHeader: 'ユーザーを追加',
    userIdPlaceholder: 'ユーザーID',
    add: '追加',
    adding: '追加中…',
    removing: '削除中…',
    close: '閉じる',
    errorUserNotFound: 'ユーザーが見つかりません',
    errorMultiOwner: '所有権の移転を使用してください (所有者は1人)',
    errorSelf: '自分の権限はここで変更できません',
    errorGeneric: 'エラーが発生しました',
  },
  zh: {
    title: '文档访问权限',
    subtitle: '可以打开此文档的用户',
    loading: '加载中…',
    empty: '仅所有者可访问',
    notAvailable: '无法获取权限',
    roleOwner: '所有者',
    roleEditor: '编辑者',
    roleCommenter: '评论者',
    roleViewer: '查看者',
    ownerLocked: '锁定',
    remove: '移除',
    confirmRemove: '移除此用户的访问权限?',
    addPersonHeader: '添加用户',
    userIdPlaceholder: '用户 ID',
    add: '添加',
    adding: '添加中…',
    removing: '移除中…',
    close: '关闭',
    errorUserNotFound: '未找到用户',
    errorMultiOwner: '请使用所有权转移 (仅一位所有者)',
    errorSelf: '不能在此更改自己的角色',
    errorGeneric: '发生错误',
  },
  es: {
    title: 'Acceso al documento',
    subtitle: 'Personas que pueden abrir este documento',
    loading: 'Cargando…',
    empty: 'Solo el propietario tiene acceso',
    notAvailable: 'Los permisos no están disponibles',
    roleOwner: 'Propietario',
    roleEditor: 'Editor',
    roleCommenter: 'Comentarista',
    roleViewer: 'Lector',
    ownerLocked: 'bloqueado',
    remove: 'Quitar',
    confirmRemove: '¿Quitar el acceso de esta persona?',
    addPersonHeader: 'Añadir persona',
    userIdPlaceholder: 'id de usuario',
    add: 'Añadir',
    adding: 'Añadiendo…',
    removing: 'Quitando…',
    close: 'Cerrar',
    errorUserNotFound: 'Usuario no encontrado',
    errorMultiOwner: 'Usa la transferencia de propiedad (solo un propietario)',
    errorSelf: 'No puedes cambiar tu propio rol aquí',
    errorGeneric: 'Ocurrió un error',
  },
  ar: {
    title: 'الوصول إلى المستند',
    subtitle: 'الأشخاص الذين يمكنهم فتح هذا المستند',
    loading: 'جارٍ التحميل…',
    empty: 'المالك فقط لديه حق الوصول',
    notAvailable: 'الأذونات غير متوفرة',
    roleOwner: 'المالك',
    roleEditor: 'محرر',
    roleCommenter: 'معلق',
    roleViewer: 'عارض',
    ownerLocked: 'مقفل',
    remove: 'إزالة',
    confirmRemove: 'إزالة وصول هذا الشخص؟',
    addPersonHeader: 'إضافة شخص',
    userIdPlaceholder: 'معرف المستخدم',
    add: 'إضافة',
    adding: 'جارٍ الإضافة…',
    removing: 'جارٍ الإزالة…',
    close: 'إغلاق',
    errorUserNotFound: 'لم يتم العثور على المستخدم',
    errorMultiOwner: 'استخدم نقل الملكية (مالك واحد فقط)',
    errorSelf: 'لا يمكنك تغيير دورك هنا',
    errorGeneric: 'حدث خطأ',
  },
};

export function pickPermDict(lang: string | undefined | null): Dict {
  if (!lang) return DICTS.en;
  const lower = lang.toLowerCase();
  if (lower in DICTS) return DICTS[lower as Lang];
  return DICTS.en;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9100,
  } as React.CSSProperties,
  panel: {
    background: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 12,
    width: 520,
    maxWidth: '92vw',
    boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
    overflow: 'hidden',
    display: 'flex' as const,
    flexDirection: 'column' as const,
  } as React.CSSProperties,
  header: {
    padding: '14px 18px',
    borderBottom: '1px solid var(--nx-border)',
  } as React.CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--nx-text)',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: 11,
    color: 'var(--nx-text-3)',
    margin: '4px 0 0',
  } as React.CSSProperties,
  body: {
    padding: '6px 0',
    maxHeight: '50vh',
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  emptyState: {
    padding: '20px 18px',
    fontSize: 12,
    color: 'var(--nx-text-3)',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 18px',
    fontSize: 12,
    color: 'var(--nx-text)',
  } as React.CSSProperties,
  rowName: {
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  roleSelect: {
    padding: '4px 8px',
    fontSize: 12,
    border: '1px solid var(--nx-border)',
    borderRadius: 4,
    background: 'var(--nx-bg)',
    color: 'var(--nx-text)',
  } as React.CSSProperties,
  ownerBadge: {
    display: 'inline-flex',
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--nx-accent)',
  } as React.CSSProperties,
  ownerLockedNote: {
    fontSize: 10,
    color: 'var(--nx-text-3)',
    fontStyle: 'italic' as const,
    width: 64,
    textAlign: 'right' as const,
  } as React.CSSProperties,
  removeBtn: (busy: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    border: '1px solid var(--nx-border)',
    background: 'transparent',
    color: busy ? 'var(--nx-text-3)' : '#ff6b6b',
    borderRadius: 4,
    padding: '4px 10px',
    cursor: busy ? 'wait' : 'pointer',
    width: 64,
  }),
  addBlock: {
    padding: '12px 18px 16px',
    borderTop: '1px solid var(--nx-border)',
  } as React.CSSProperties,
  addHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--nx-text-2)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 8,
  } as React.CSSProperties,
  addRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  } as React.CSSProperties,
  addInput: {
    flex: 1,
    padding: '6px 8px',
    fontSize: 12,
    border: '1px solid var(--nx-border)',
    borderRadius: 4,
    background: 'var(--nx-bg)',
    color: 'var(--nx-text)',
    minWidth: 0,
  } as React.CSSProperties,
  addBtn: (disabled: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderRadius: 6,
    background: disabled ? 'var(--nx-panel-2)' : 'var(--nx-accent)',
    color: disabled ? 'var(--nx-text-3)' : 'var(--nx-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
  errorText: {
    fontSize: 11,
    color: '#ff6b6b',
    margin: '8px 0 0',
  } as React.CSSProperties,
  footer: {
    display: 'flex',
    justifyContent: 'flex-end' as const,
    padding: '10px 18px',
    borderTop: '1px solid var(--nx-border)',
  } as React.CSSProperties,
  closeBtn: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid var(--nx-border)',
    background: 'transparent',
    color: 'var(--nx-text-2)',
    borderRadius: 6,
    cursor: 'pointer',
  } as React.CSSProperties,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function roleLabel(role: DocRole, dict: Dict): string {
  switch (role) {
    case 'owner':     return dict.roleOwner;
    case 'editor':    return dict.roleEditor;
    case 'commenter': return dict.roleCommenter;
    case 'viewer':    return dict.roleViewer;
  }
}

const EDITABLE_ROLES: readonly DocRole[] = ['editor', 'commenter', 'viewer'];

function mapServerErrorToDictKey(code: string | undefined): keyof Dict | null {
  if (code === 'user.not_found') return 'errorUserNotFound';
  if (code === 'permission.multi_owner') return 'errorMultiOwner';
  if (code === 'permission.self') return 'errorSelf';
  return null;
}

// ─── Component ─────────────────────────────────────────────────────────────

export interface PermissionsPanelProps {
  readonly documentId: string;
  readonly currentUserId: string;
  readonly lang: string;
  readonly canManage: boolean;
  readonly onClose: () => void;
  /** Test-only override for fetch (defaults to global). */
  readonly fetchImpl?: typeof fetch;
  /** Test-only override for window.confirm. */
  readonly confirmImpl?: (msg: string) => boolean;
  readonly testId?: string;
}

export function PermissionsPanel(props: PermissionsPanelProps): React.ReactElement {
  const {
    documentId,
    currentUserId,
    lang,
    canManage,
    onClose,
    fetchImpl,
    confirmImpl,
    testId = 'permissions-panel',
  } = props;

  const dict = useMemo(() => pickPermDict(lang), [lang]);
  const isRtl = lang.toLowerCase().startsWith('ar');
  const fetcher = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  const confirmer = confirmImpl ?? ((msg) => (typeof window !== 'undefined' ? window.confirm(msg) : true));

  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<DocRole>('editor');
  const [addError, setAddError] = useState<string | null>(null);

  // Initial fetch.
  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetcher(`/api/documents/${encodeURIComponent(documentId)}/permissions`, {
          credentials: 'same-origin',
        });
        if (cancelled) return;
        if (res.status === 404) {
          setLoadError(dict.notAvailable);
          return;
        }
        if (!res.ok) {
          setLoadError(dict.errorGeneric);
          return;
        }
        const body = (await res.json()) as PermissionApiResponse;
        setRows(body.permissions ?? []);
      } catch {
        if (!cancelled) setLoadError(dict.errorGeneric);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId, fetcher, dict.notAvailable, dict.errorGeneric]);

  const handleRoleChange = useCallback(async (userId: string, nextRole: DocRole) => {
    if (!fetcher) return;
    setBusyKey(userId);
    setAddError(null);
    try {
      const res = await fetcher(`/api/documents/${encodeURIComponent(documentId)}/permissions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, role: nextRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { code?: string }));
        const key = mapServerErrorToDictKey(body?.code);
        setAddError(key ? dict[key] as string : dict.errorGeneric);
        return;
      }
      const body = (await res.json()) as PermissionUpsertResponse;
      setRows((prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((r) => r.userId === userId);
        if (idx === -1) return [...prev, body.permission];
        const next = [...prev];
        next[idx] = body.permission;
        return next;
      });
    } catch {
      setAddError(dict.errorGeneric);
    } finally {
      setBusyKey(null);
    }
  }, [documentId, fetcher, dict]);

  const handleRemove = useCallback(async (userId: string) => {
    if (!fetcher) return;
    if (!confirmer(dict.confirmRemove)) return;
    setBusyKey(userId);
    setAddError(null);
    try {
      const res = await fetcher(
        `/api/documents/${encodeURIComponent(documentId)}/permissions/${encodeURIComponent(userId)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      );
      if (!res.ok) {
        setAddError(dict.errorGeneric);
        return;
      }
      setRows((prev) => prev ? prev.filter((r) => r.userId !== userId) : prev);
    } catch {
      setAddError(dict.errorGeneric);
    } finally {
      setBusyKey(null);
    }
  }, [documentId, fetcher, confirmer, dict]);

  const handleAdd = useCallback(async () => {
    if (!fetcher) return;
    const trimmed = addUserId.trim();
    if (!trimmed) return;
    setBusyKey('__add__');
    setAddError(null);
    try {
      const res = await fetcher(`/api/documents/${encodeURIComponent(documentId)}/permissions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: trimmed, role: addRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { code?: string }));
        const key = mapServerErrorToDictKey(body?.code);
        setAddError(key ? dict[key] as string : dict.errorGeneric);
        return;
      }
      const body = (await res.json()) as PermissionUpsertResponse;
      setRows((prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((r) => r.userId === trimmed);
        if (idx === -1) return [...list, body.permission];
        const next = [...list];
        next[idx] = body.permission;
        return next;
      });
      setAddUserId('');
    } catch {
      setAddError(dict.errorGeneric);
    } finally {
      setBusyKey(null);
    }
  }, [documentId, fetcher, addUserId, addRole, dict]);

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    // Owners first, then alphabetical by userId.
    return [...rows].sort((a, b) => {
      if (a.role === 'owner' && b.role !== 'owner') return -1;
      if (a.role !== 'owner' && b.role === 'owner') return 1;
      return a.userId.localeCompare(b.userId);
    });
  }, [rows]);

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      dir={isRtl ? 'rtl' : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 id={`${testId}-title`} style={styles.title}>{dict.title}</h2>
          <p style={styles.subtitle}>{dict.subtitle}</p>
        </div>

        <div style={styles.body}>
          {loadError && (
            <div style={styles.emptyState} data-testid={`${testId}-error`}>{loadError}</div>
          )}
          {!loadError && sortedRows === null && (
            <div style={styles.emptyState}>{dict.loading}</div>
          )}
          {!loadError && sortedRows && sortedRows.length === 0 && (
            <div style={styles.emptyState}>{dict.empty}</div>
          )}
          {!loadError && sortedRows && sortedRows.map((row) => {
            const isOwner = row.role === 'owner';
            const isSelf = row.userId === currentUserId;
            const editable = canManage && !isOwner && !isSelf;
            const busy = busyKey === row.userId;
            return (
              <div key={row.userId} style={styles.row} data-testid={`${testId}-row-${row.userId}`}>
                <div style={styles.rowName}>{row.userId}</div>
                {isOwner ? (
                  <>
                    <span style={styles.ownerBadge}>{dict.roleOwner}</span>
                    <span style={styles.ownerLockedNote}>({dict.ownerLocked})</span>
                  </>
                ) : (
                  <>
                    {editable ? (
                      <select
                        style={styles.roleSelect}
                        value={row.role}
                        disabled={busy}
                        onChange={(e) => handleRoleChange(row.userId, e.target.value as DocRole)}
                        data-testid={`${testId}-role-${row.userId}`}
                      >
                        {EDITABLE_ROLES.map((r) => (
                          <option key={r} value={r}>{roleLabel(r, dict)}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={styles.ownerLockedNote}>{roleLabel(row.role, dict)}</span>
                    )}
                    {editable ? (
                      <button
                        type="button"
                        style={styles.removeBtn(busy)}
                        disabled={busy}
                        onClick={() => handleRemove(row.userId)}
                        data-testid={`${testId}-remove-${row.userId}`}
                      >
                        {busy ? dict.removing : dict.remove}
                      </button>
                    ) : (
                      <span style={styles.ownerLockedNote} />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {canManage && !loadError && (
          <div style={styles.addBlock}>
            <div style={styles.addHeader}>{dict.addPersonHeader}</div>
            <div style={styles.addRow}>
              <input
                type="text"
                style={styles.addInput}
                placeholder={dict.userIdPlaceholder}
                value={addUserId}
                disabled={busyKey === '__add__'}
                onChange={(e) => setAddUserId(e.target.value)}
                data-testid={`${testId}-add-input`}
              />
              <select
                style={styles.roleSelect}
                value={addRole}
                disabled={busyKey === '__add__'}
                onChange={(e) => setAddRole(e.target.value as DocRole)}
                data-testid={`${testId}-add-role`}
              >
                {EDITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{roleLabel(r, dict)}</option>
                ))}
              </select>
              <button
                type="button"
                style={styles.addBtn(addUserId.trim().length === 0 || busyKey === '__add__')}
                disabled={addUserId.trim().length === 0 || busyKey === '__add__'}
                onClick={handleAdd}
                data-testid={`${testId}-add-submit`}
              >
                {busyKey === '__add__' ? dict.adding : dict.add}
              </button>
            </div>
            {addError && <p style={styles.errorText} data-testid={`${testId}-add-error`}>{addError}</p>}
          </div>
        )}

        <div style={styles.footer}>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            data-testid={`${testId}-close`}
          >
            {dict.close}
          </button>
        </div>
      </div>
    </div>
  );
}
