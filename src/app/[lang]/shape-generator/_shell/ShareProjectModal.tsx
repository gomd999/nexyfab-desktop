'use client';

// Share / Team modal — add members to the current cloud project by email,
// list them, and remove them. Backed by the existing owner-only
// /api/nexyfab/projects/[id]/members endpoints + nf_project_members ACL.
// The shared member then sees the project under "Shared with me" and the
// modeler enforces viewer/editor read-only on open. (2026-06-09 P2)

import { useCallback, useEffect, useState } from 'react';
import { PREF_KEYS, prefGetString } from '@/lib/platform';
import { pickShellDict } from './shellDict';

interface Member {
  userId: string;
  email: string;
  role: 'editor' | 'viewer';
  createdAt: number;
}

export interface ShareProjectModalProps {
  lang: string;
  onClose: () => void;
}

export function ShareProjectModal({ lang, onClose }: ShareProjectModalProps) {
  const [projectId] = useState<string | null>(() => prefGetString(PREF_KEYS.cloudProjectId));
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const d = pickShellDict(lang);
  const t = {
    title: d.shareTitle, noProject: d.shareNoProject,
    placeholder: d.emailAddress, viewer: d.roleViewer, editor: d.roleEditor,
    add: d.add, members: d.members, empty: d.shareEmpty,
    remove: d.remove, owner: d.ownerYou, notFound: d.shareNotFound,
    hint: d.shareHint,
    invited: d.shareInvited,
    close: d.close,
  };

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/nexyfab/projects/${projectId}/members`);
      if (r.ok) {
        const data = await r.json() as { members?: Member[] };
        setMembers(data.members ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!projectId || !email.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const r = await fetch(`/api/nexyfab/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await r.json().catch(() => ({})) as { member?: Member; code?: string; error?: string };
      if (!r.ok) {
        // Not a registered user → send an email invite instead. (follow-up #2)
        if (data.code === 'USER_NOT_FOUND') {
          const ir = await fetch(`/api/nexyfab/projects/${projectId}/invites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), role }),
          });
          if (ir.ok) { setEmail(''); setInfo(t.invited); return; }
          const idata = await ir.json().catch(() => ({})) as { error?: string };
          setErr(idata.error ?? t.notFound);
          return;
        }
        setErr(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setEmail('');
      if (data.member) {
        setMembers(prev => [...prev.filter(m => m.userId !== data.member!.userId), data.member!]);
      } else {
        void load();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/nexyfab/projects/${projectId}/members?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      if (r.ok) setMembers(prev => prev.filter(m => m.userId !== userId));
    } catch { /* ignore */ }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(440px, 92vw)', background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: 22, color: 'var(--nx-text)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 700 }}>{t.title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 0, background: 'transparent', color: 'var(--nx-text-3)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {!projectId ? (
          <p style={{ fontSize: 13, color: 'var(--nx-text-2)', lineHeight: 1.6 }}>{t.noProject}</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void add(); }}
                placeholder={t.placeholder}
                style={{
                  flex: 1, minWidth: 0, height: 34, padding: '0 10px', borderRadius: 8,
                  border: '1px solid var(--nx-border)', background: 'var(--nx-glass-input)',
                  color: 'var(--nx-text)', fontSize: 13, outline: 'none',
                }}
              />
              <select
                value={role}
                onChange={e => setRole(e.target.value as 'editor' | 'viewer')}
                style={{ height: 34, borderRadius: 8, border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 12, padding: '0 6px' }}
              >
                <option value="viewer">{t.viewer}</option>
                <option value="editor">{t.editor}</option>
              </select>
              <button
                onClick={() => void add()}
                disabled={busy || !email.trim()}
                style={{
                  height: 34, padding: '0 14px', border: 0, borderRadius: 8,
                  background: 'var(--nx-accent)', color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer', opacity: busy || !email.trim() ? 0.6 : 1,
                }}
              >
                {t.add}
              </button>
            </div>
            {err && <div style={{ fontSize: 11, color: 'var(--nx-error)', marginBottom: 8 }}>{err}</div>}
            {info && <div style={{ fontSize: 11, color: 'var(--nx-ok)', marginBottom: 8 }}>{info}</div>}
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 14, lineHeight: 1.5 }}>{t.hint}</div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t.members}</div>
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, color: 'var(--nx-text-2)' }}>
                <span style={{ flex: 1 }}>{t.owner}</span>
              </div>
              {loading && <div style={{ fontSize: 12, color: 'var(--nx-text-3)', padding: '6px 0' }}>…</div>}
              {!loading && members.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--nx-text-3)', padding: '6px 0' }}>{t.empty}</div>
              )}
              {members.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--nx-border)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{m.email}</span>
                  <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{m.role === 'editor' ? t.editor : t.viewer}</span>
                  <button onClick={() => void remove(m.userId)} title={t.remove} style={{ border: 0, background: 'transparent', color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
