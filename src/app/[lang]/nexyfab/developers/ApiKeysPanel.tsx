'use client';
/**
 * API 키 자가발급 패널 (Pro 이상). 기존 /api/user/api-keys 라우트를 그대로 사용.
 * 정직/보안: 평문 키는 발급 응답에서 1회만 표시(copy) 후 다시 못 봄. 목록은 접두만 노출.
 */
import { useCallback, useEffect, useState } from 'react';

interface KeyRow {
  id: string;
  name: string;
  keyPreview: string;
  status: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

interface ListResp {
  keys: KeyRow[];
  planLimit: number; // 0 = Pro 미만, -1 = 무제한
  validScopes: string[];
  error?: string;
}

const box: React.CSSProperties = {
  marginTop: 12, padding: '16px 18px', borderRadius: 12,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-bg-1, #fbfcfe)',
};
const btn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
  cursor: 'pointer', background: 'var(--nx-accent, #2563eb)', color: '#fff',
};
const btnGhost: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 7, border: '1px solid var(--nx-border, #d3d9e0)',
  fontWeight: 600, fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--nx-text-2, #46505e)',
};

function fmt(ts: number | null): string {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().slice(0, 10); } catch { return '—'; }
}

export default function ApiKeysPanel({ ko }: { ko: boolean }) {
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<ListResp | null>(null);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/user/api-keys', { credentials: 'include' });
      if (r.status === 401) { setAuthed(false); setLoading(false); return; }
      const j = (await r.json()) as ListResp;
      setAuthed(true); setList(j);
    } catch {
      setErr(ko ? '목록을 불러오지 못했습니다.' : 'Failed to load keys.');
    } finally { setLoading(false); }
  }, [ko]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setCreating(true); setErr(null); setFreshKey(null); setCopied(false);
    try {
      const r = await fetch('/api/user/api-keys', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || (ko ? '기본 키' : 'default') }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? (ko ? '발급 실패' : 'Failed')); return; }
      setFreshKey(j.key); setName('');
      await load();
    } catch {
      setErr(ko ? '발급 중 오류가 발생했습니다.' : 'Error while issuing.');
    } finally { setCreating(false); }
  }, [name, ko, load]);

  const revoke = useCallback(async (id: string) => {
    setErr(null);
    try {
      const r = await fetch('/api/user/api-keys', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? (ko ? '취소 실패' : 'Failed')); return; }
      await load();
    } catch {
      setErr(ko ? '취소 중 오류가 발생했습니다.' : 'Error while revoking.');
    }
  }, [ko, load]);

  const copy = useCallback(() => {
    if (!freshKey) return;
    void navigator.clipboard?.writeText(freshKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }, [freshKey]);

  if (loading) return <div style={box}>{ko ? '불러오는 중…' : 'Loading…'}</div>;

  if (!authed) {
    return (
      <div style={box}>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          {ko ? 'API 키를 발급하려면 먼저 ' : 'Sign in to issue an API key — '}
          <a href="/kr/login" style={{ color: 'var(--nx-accent, #2563eb)', fontWeight: 700 }}>{ko ? '로그인' : 'log in'}</a>
          {ko ? '하세요. (Pro 플랜 이상)' : ' (Pro plan or higher).'}
        </p>
      </div>
    );
  }

  const planLimit = list?.planLimit ?? 0;
  const isPro = planLimit !== 0;

  return (
    <div style={box}>
      {!isPro && (
        <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(37,99,235,0.07)', border: '1px solid var(--nx-accent, #2563eb)', fontSize: 13 }}>
          🔒 {ko
            ? 'API 키는 Pro 플랜 이상에서 발급됩니다. Pro로 업그레이드하면 CLI·MCP·HTTP API를 바로 연결할 수 있어요. '
            : 'API keys require a Pro plan or higher. Upgrade to connect the CLI, MCP, and HTTP API. '}
          <a href="/kr/nexyfab/pricing" style={{ color: 'var(--nx-accent, #2563eb)', fontWeight: 700 }}>{ko ? '요금제 보기' : 'See pricing'}</a>
        </div>
      )}

      {isPro && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
            placeholder={ko ? '키 이름(예: ci-runner)' : 'Key name (e.g. ci-runner)'}
            style={{ flex: '1 1 200px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--nx-border, #d3d9e0)', fontSize: 13 }}
          />
          <button onClick={() => void create()} disabled={creating} style={{ ...btn, opacity: creating ? 0.6 : 1 }}>
            {creating ? (ko ? '발급 중…' : 'Issuing…') : (ko ? '새 키 발급' : 'Generate key')}
          </button>
        </div>
      )}

      {freshKey && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #16a34a', background: 'rgba(22,163,74,0.06)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#15803d', marginBottom: 6 }}>
            ⚠ {ko ? '지금 저장하세요. 이 키는 다시 표시되지 않습니다.' : 'Save this now — it will not be shown again.'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: '1 1 260px', padding: '8px 10px', borderRadius: 7, background: '#0b1020', color: '#c8d3e8', fontSize: 12.5, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{freshKey}</code>
            <button onClick={copy} style={btnGhost}>{copied ? (ko ? '복사됨 ✓' : 'Copied ✓') : (ko ? '복사' : 'Copy')}</button>
          </div>
        </div>
      )}

      {err && <div style={{ marginTop: 10, color: '#dc2626', fontSize: 12.5 }}>{err}</div>}

      {list && list.keys.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, marginTop: 14 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--nx-text-2, #46505e)' }}>
            <th style={{ padding: '4px 8px' }}>{ko ? '이름' : 'Name'}</th>
            <th style={{ padding: '4px 8px' }}>{ko ? '접두' : 'Prefix'}</th>
            <th style={{ padding: '4px 8px' }}>{ko ? '생성' : 'Created'}</th>
            <th style={{ padding: '4px 8px' }}>{ko ? '마지막 사용' : 'Last used'}</th>
            <th style={{ padding: '4px 8px' }} />
          </tr></thead>
          <tbody>
            {list.keys.map((k) => (
              <tr key={k.id} style={{ borderTop: '1px solid var(--nx-border, #eceff3)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{k.name}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{k.keyPreview}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(k.created_at)}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(k.last_used_at)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button onClick={() => void revoke(k.id)} style={{ ...btnGhost, color: '#dc2626', borderColor: 'rgba(220,38,38,0.4)' }}>
                    {ko ? '취소' : 'Revoke'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {list && list.keys.length === 0 && isPro && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--nx-text-2, #46505e)' }}>
          {ko ? '아직 발급된 키가 없습니다.' : 'No keys yet.'}
        </p>
      )}
    </div>
  );
}
