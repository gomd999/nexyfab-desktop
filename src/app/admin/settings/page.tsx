'use client';

// /admin/settings — runtime config + API key rotation.
//
// Read-only for regular admin (sees masked values). Super admin can
// rotate values via inline form. All mutations write to nf_admin_audit
// so we can answer "who rotated this and when" for any incident.

import React, { useCallback, useEffect, useState } from 'react';

interface Setting {
  key: string;
  scope: 'api_key' | 'feature_flag' | 'budget' | 'config';
  description: string;
  maskedValue: string;
  plainValue: string | null;
  hasValue: boolean;
  source: 'db' | 'env' | 'unset';
  updatedBy: string | null;
  updatedAt: number | null;
}

interface SettingsResp {
  isSuper: boolean;
  settings: Setting[];
}

interface AuditRow {
  id: string;
  adminUserId: string;
  action: string;
  target: string | null;
  oldValueHash: string | null;
  newValueHash: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: number;
}

const SCOPE_COLOR: Record<string, string> = {
  api_key:      '#f85149',
  feature_flag: '#a371f7',
  budget:       '#d29922',
  config:       '#79c0ff',
};

const SOURCE_LABEL: Record<Setting['source'], { label: string; color: string }> = {
  db:    { label: 'DB',    color: '#3fb950' },
  env:   { label: 'ENV',   color: '#79c0ff' },
  unset: { label: 'unset', color: '#6e7681' },
};

export default function AdminSettingsPage() {
  const [data, setData] = useState<SettingsResp | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [filterTarget, setFilterTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sRes, aRes] = await Promise.all([
      fetch('/api/admin/settings', { credentials: 'include' }),
      fetch(`/api/admin/admin-actions?windowH=168${filterTarget ? `&target=${encodeURIComponent(filterTarget)}` : ''}`, { credentials: 'include' }),
    ]);
    if (sRes.ok) setData(await sRes.json() as SettingsResp);
    if (aRes.ok) {
      const j = await aRes.json() as { rows: AuditRow[] };
      setAuditRows(j.rows);
    }
  }, [filterTarget]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (key: string) => {
    if (submitting) return;
    if (!editValue.trim()) { setSubmitErr('값을 입력하세요'); return; }
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setEditingKey(null);
      setEditValue('');
      await load();
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>🔐 Admin Settings</h1>
      <p style={subtitleStyle}>
        런타임 설정 + API 키. {data?.isSuper ? <span style={{ color: '#3fb950' }}>● super_admin (수정 가능)</span> : <span style={{ color: '#d29922' }}>● admin (read-only)</span>}.
        모든 변경은 audit log 에 기록됩니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>

        {/* Settings table */}
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>설정 ({data?.settings.length ?? 0})</h3>
          {!data && <div style={mutedStyle}>불러오는 중…</div>}
          {data && data.settings.map(s => {
            const src = SOURCE_LABEL[s.source];
            const isEditing = editingKey === s.key;
            return (
              <div key={s.key} style={{
                ...settingRowStyle,
                borderLeft: `3px solid ${SCOPE_COLOR[s.scope] ?? '#30363d'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <code style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>{s.key}</code>
                  <span style={{
                    padding: '1px 6px', fontSize: 9, fontWeight: 700,
                    background: `${SCOPE_COLOR[s.scope] ?? '#30363d'}33`,
                    color: SCOPE_COLOR[s.scope] ?? '#9ca3af', borderRadius: 3,
                  }}>{s.scope}</span>
                  <span style={{
                    padding: '1px 6px', fontSize: 9, fontWeight: 700,
                    background: `${src.color}22`, color: src.color, borderRadius: 3,
                  }}>{src.label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#6e7681' }}>
                    {s.updatedAt ? new Date(s.updatedAt).toLocaleString('ko-KR') : '-'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{s.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isEditing ? (
                    <>
                      <input
                        type={s.scope === 'api_key' ? 'password' : 'text'}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        placeholder={s.scope === 'api_key' ? '새 키 입력' : '새 값 입력'}
                        style={inputStyle}
                        autoFocus
                      />
                      <button onClick={() => void submit(s.key)} disabled={submitting} style={confirmBtnStyle}>
                        {submitting ? '저장 중…' : '저장'}
                      </button>
                      <button onClick={() => { setEditingKey(null); setEditValue(''); setSubmitErr(null); }} style={cancelBtnStyle}>
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <code style={valueDisplayStyle}>
                        {s.scope === 'api_key' ? s.maskedValue : (s.plainValue ?? s.maskedValue)}
                      </code>
                      <span style={{ flex: 1 }} />
                      {data.isSuper && (
                        <button
                          onClick={() => { setEditingKey(s.key); setEditValue(''); setSubmitErr(null); }}
                          style={rotateBtnStyle}
                        >
                          {s.hasValue ? '🔄 회전' : '+ 설정'}
                        </button>
                      )}
                      <button
                        onClick={() => setFilterTarget(filterTarget === s.key ? null : s.key)}
                        style={historyBtnStyle}
                        title="이 설정의 변경 이력만 보기"
                      >
                        📜
                      </button>
                    </>
                  )}
                </div>
                {isEditing && submitErr && <div style={errStyle}>{submitErr}</div>}
              </div>
            );
          })}
        </div>

        {/* Audit log sidebar */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={panelTitleStyle}>
              감사 로그 (7일)
              {filterTarget && <span style={{ fontSize: 11, color: '#79c0ff', marginLeft: 6 }}>· {filterTarget}</span>}
            </h3>
            {filterTarget && (
              <button onClick={() => setFilterTarget(null)} style={{ ...cancelBtnStyle, padding: '2px 8px' }}>전체</button>
            )}
          </div>
          {auditRows.length === 0 && <div style={mutedStyle}>변경 이력 없음</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {auditRows.map(r => (
              <div key={r.id} style={auditRowStyle}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <code style={{ fontSize: 10, color: '#79c0ff', fontWeight: 700 }}>{r.action}</code>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9, color: '#6e7681' }}>{new Date(r.createdAt).toLocaleString('ko-KR')}</span>
                </div>
                {r.target && <div style={{ fontSize: 11, color: '#c9d1d9', marginBottom: 2 }}>{r.target}</div>}
                <div style={{ fontSize: 9, color: '#6e7681', fontFamily: 'monospace' }}>
                  by {r.adminUserId.slice(0, 12)}
                  {r.oldValueHash && ` · ${r.oldValueHash.slice(0, 8)} → ${r.newValueHash?.slice(0, 8) ?? 'null'}`}
                  {r.ipAddress && ` · ${r.ipAddress}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: '0 0 20px' };
const panelStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 16,
};
const panelTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 12px' };
const mutedStyle: React.CSSProperties = { color: '#8b949e', fontSize: 12, padding: 12, textAlign: 'center' };
const settingRowStyle: React.CSSProperties = {
  padding: 10, marginBottom: 8,
  background: '#0d1117', borderRadius: 6,
};
const valueDisplayStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 12, fontFamily: 'monospace',
  background: '#010409', borderRadius: 4, color: '#c9d1d9',
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace',
  background: '#010409', border: '1px solid #30363d', borderRadius: 4,
  color: '#e6edf3', outline: 'none',
};
const rotateBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  background: '#1f6feb', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const historyBtnStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 11,
  background: 'transparent', color: '#9ca3af',
  border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer',
};
const confirmBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 11, fontWeight: 700,
  background: '#3fb950', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11,
  background: 'transparent', color: '#9ca3af',
  border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer',
};
const errStyle: React.CSSProperties = {
  marginTop: 6, padding: 6, fontSize: 11,
  background: '#1c1110', color: '#f85149',
  border: '1px solid #f8514940', borderRadius: 4,
};
const auditRowStyle: React.CSSProperties = {
  padding: 8, background: '#0d1117', borderRadius: 4,
  borderLeft: '2px solid #21262d',
};
