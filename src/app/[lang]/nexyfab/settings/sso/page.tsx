'use client';
// ─── SSO Settings Page ────────────────────────────────────────────────────────
// Enterprise-only. Configure SAML / OIDC single sign-on.
// Inline styles, dark theme, bilingual ko/en.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SSOConfig {
  provider: 'saml' | 'oidc' | null;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  clientId?: string;
  issuer?: string;
  enabled: boolean;
}

// ─── Style tokens ─────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: '#0f1117',
    color: '#e5e7eb',
    fontFamily: "'Inter', 'Noto Sans KR', sans-serif",
    padding: '40px 24px',
  } as React.CSSProperties,
  card: {
    background: '#1a1d27',
    border: '1px solid #2d3748',
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#f3f4f6',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 6,
    marginTop: 12,
  } as React.CSSProperties,
  input: {
    width: '100%',
    background: '#0f1117',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#e5e7eb',
    fontSize: 14,
    padding: '9px 12px',
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    background: '#0f1117',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#e5e7eb',
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '9px 12px',
    minHeight: 90,
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  btn: (variant: 'primary' | 'danger' | 'ghost') => ({
    padding: '9px 18px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    border: 'none',
    background:
      variant === 'primary' ? '#3B82F6'
      : variant === 'danger' ? '#EF4444'
      : 'transparent',
    color: variant === 'ghost' ? '#9ca3af' : '#fff',
    outline: variant === 'ghost' ? '1px solid #374151' : 'none',
  } as React.CSSProperties),
  toggle: (enabled: boolean) => ({
    width: 44,
    height: 24,
    borderRadius: 12,
    background: enabled ? '#3B82F6' : '#374151',
    position: 'relative',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.2s',
  } as React.CSSProperties),
  toggleKnob: (enabled: boolean) => ({
    position: 'absolute',
    top: 3,
    left: enabled ? 23 : 3,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s',
  } as React.CSSProperties),
};

// ─── Non-enterprise gate ──────────────────────────────────────────────────────

function NotEnterprise({ lang }: { lang: string }) {
  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...S.card, textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Enterprise 플랜이 필요합니다
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
          Enterprise plan required to configure SSO.
        </div>
        <div style={{ fontSize: 13, color: '#4b5563', marginTop: 12 }}>
          <a href={`/${lang}/nexyfab/pricing`} style={{ color: '#3B82F6' }}>플랜 업그레이드 / Upgrade plan →</a>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SSOSettingsPage() {
  const { lang } = useParams<{ lang: string }>();
  const { user } = useAuthStore();

  const [config, setConfig] = useState<SSOConfig>({ provider: null, enabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const planHeader = { 'x-nexyfab-plan': user?.plan ?? '' };

  // ── Load config ────────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/sso', { headers: planHeader });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch {
      setError('설정을 불러오지 못했습니다 / Failed to load config');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.plan]);

  useEffect(() => {
    if (user?.plan === 'enterprise') loadConfig();
    else setLoading(false);
  }, [user?.plan, loadConfig]);

  // ── Save config ────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/nexyfab/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...planHeader },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Save failed');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setError('네트워크 오류 / Network error');
    } finally {
      setSaving(false);
    }
  };

  // ── Test connection ────────────────────────────────────────────────────────

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/nexyfab/sso/callback', {
        headers: planHeader,
      });
      const data = await res.json();
      if (data.demo) {
        setTestResult({ ok: true, message: `데모 모드: ${data.user.email} (demo@company.com)` });
      } else if (data.user) {
        setTestResult({ ok: true, message: `연결 성공: ${data.user.email}` });
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Test failed' });
      }
    } catch {
      setTestResult({ ok: false, message: '연결 테스트 실패 / Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  // ── Gate ───────────────────────────────────────────────────────────────────

  if (!loading && user?.plan !== 'enterprise') return <NotEnterprise lang={lang} />;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, marginBottom: 4 }}>
            Enterprise SSO 설정
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            Single Sign-On configuration for your organization
          </p>
        </div>

        {loading && (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>
            불러오는 중… / Loading…
          </div>
        )}

        {!loading && (
          <>
            {/* 1. SSO 상태 토글 */}
            <div style={S.card}>
              <div style={S.sectionTitle}>SSO 상태 / Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={S.toggle(config.enabled)}
                  onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                  role="switch"
                  aria-checked={config.enabled}
                >
                  <div style={S.toggleKnob(config.enabled)} />
                </div>
                <span style={{ fontSize: 14, color: config.enabled ? '#34D399' : '#6b7280' }}>
                  {config.enabled ? 'SSO 활성화됨 / SSO Enabled' : 'SSO 비활성화됨 / SSO Disabled'}
                </span>
              </div>
            </div>

            {/* 2. Provider 선택 */}
            <div style={S.card}>
              <div style={S.sectionTitle}>Provider 선택 / Select Provider</div>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['saml', 'oidc', null] as const).map(p => (
                  <button
                    key={String(p)}
                    onClick={() => setConfig(c => ({ ...c, provider: p }))}
                    style={{
                      padding: '8px 20px',
                      borderRadius: 8,
                      border: config.provider === p ? '2px solid #3B82F6' : '1px solid #374151',
                      background: config.provider === p ? '#1e3a5f' : '#0f1117',
                      color: config.provider === p ? '#60A5FA' : '#9ca3af',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {p === null ? '없음 / None' : p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. SAML 설정 */}
            {config.provider === 'saml' && (
              <div style={S.card}>
                <div style={S.sectionTitle}>SAML 설정 / SAML Configuration</div>

                <label style={S.label}>
                  Entity ID (SP Entity ID) <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  style={S.input}
                  placeholder="https://nexyfab.com/saml/sp"
                  value={config.entityId ?? ''}
                  onChange={e => setConfig(c => ({ ...c, entityId: e.target.value }))}
                />

                <label style={S.label}>
                  SSO URL (IdP Single Sign-On URL) <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  style={S.input}
                  placeholder="https://idp.company.com/saml/login"
                  value={config.ssoUrl ?? ''}
                  onChange={e => setConfig(c => ({ ...c, ssoUrl: e.target.value }))}
                />

                <label style={S.label}>
                  IdP Certificate (Base64 PEM) — 인증서 업로드
                </label>
                <textarea
                  style={S.textarea}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  value={config.certificate ?? ''}
                  onChange={e => setConfig(c => ({ ...c, certificate: e.target.value }))}
                />
                <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>
                  저장 후 인증서는 마스킹되어 표시됩니다 / Certificate will be masked after save.
                </div>
              </div>
            )}

            {/* 4. OIDC 설정 */}
            {config.provider === 'oidc' && (
              <div style={S.card}>
                <div style={S.sectionTitle}>OIDC 설정 / OIDC Configuration</div>

                <label style={S.label}>
                  Client ID <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  style={S.input}
                  placeholder="nexyfab-client-id"
                  value={config.clientId ?? ''}
                  onChange={e => setConfig(c => ({ ...c, clientId: e.target.value }))}
                />

                <label style={S.label}>
                  Client Secret <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="password"
                  style={S.input}
                  placeholder="••••••••"
                  onChange={e => setConfig(c => ({ ...c, clientSecret: e.target.value } as SSOConfig))}
                />

                <label style={S.label}>
                  Issuer URL <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  style={S.input}
                  placeholder="https://accounts.google.com"
                  value={config.issuer ?? ''}
                  onChange={e => setConfig(c => ({ ...c, issuer: e.target.value }))}
                />
              </div>
            )}

            {/* Error / Success */}
            {error && (
              <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
                {error}
              </div>
            )}
            {saved && (
              <div style={{ background: '#052e16', border: '1px solid #14532d', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#86efac', fontSize: 13 }}>
                설정이 저장되었습니다 / Configuration saved.
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div style={{
                background: testResult.ok ? '#052e16' : '#450a0a',
                border: `1px solid ${testResult.ok ? '#14532d' : '#7f1d1d'}`,
                borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                color: testResult.ok ? '#86efac' : '#fca5a5', fontSize: 13,
              }}>
                {testResult.message}
              </div>
            )}

            {/* 5. Action buttons */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                style={S.btn('primary')}
                onClick={save}
                disabled={saving}
              >
                {saving ? '저장 중… / Saving…' : '저장 / Save'}
              </button>
              <button
                style={S.btn('ghost')}
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? '테스트 중…' : '테스트 연결 / Test Connection'}
              </button>
            </div>

            {/* 6. Audit log link */}
            <div style={{ marginTop: 32, padding: '14px 20px', background: '#1a1d27', border: '1px solid #2d3748', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>감사 로그 / Audit Logs</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  SSO 로그인 이벤트 및 설정 변경 기록
                </div>
              </div>
              <a
                href={`/${lang}/nexyfab/settings/audit`}
                style={{ color: '#3B82F6', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                감사 로그 보기 / View Audit Logs →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
