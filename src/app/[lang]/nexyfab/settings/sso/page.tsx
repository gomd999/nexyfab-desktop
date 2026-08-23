'use client';
// ─── SSO Settings Page ────────────────────────────────────────────────────────
// Enterprise-only metadata staging. SAML / OIDC activation is fail-closed.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { getSsoCommercialCopy } from '@/lib/i18n/ssoCommercialStatus';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SSOConfig {
  provider: 'saml' | 'oidc' | null;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  enabled: boolean;
  _certMasked?: boolean; // server sets this when cert is stored
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
  const copy = getSsoCommercialCopy(lang);
  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...S.card, textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          {copy.unavailableTitle}
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
          {copy.unavailableDescription}
        </div>
        <div style={{ fontSize: 13, color: '#4b5563', marginTop: 12 }}>
          <a href="mailto:enterprise@nexyfab.com" style={{ color: '#3B82F6' }}>{copy.contactEnterprise} →</a>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SSOSettingsPage() {
  const { lang } = useParams<{ lang: string }>();
  const { user } = useAuthStore();
  const L = createCommercialLocalizer(lang);
  const ssoCopy = getSsoCommercialCopy(lang);

  const [config, setConfig] = useState<SSOConfig>({ provider: null, enabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        setConfig({ ...data.config, enabled: false });
      }
    } catch {
      setError(L('설정을 불러오지 못했습니다', 'Failed to load config'));
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
        body: JSON.stringify({ ...config, enabled: false }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Save failed');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        // Mask cert/secret display after successful save
        setConfig(c => ({
          ...c,
          _certMasked: c.provider === 'saml' && !!c.certificate ? true : c._certMasked,
          certificate: c.provider === 'saml' && !!c.certificate ? '' : c.certificate,
          clientSecret: undefined,
        }));
      }
    } catch {
      setError(L('네트워크 오류', 'Network error'));
    } finally {
      setSaving(false);
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
            {ssoCopy.settingsTitle}
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            {ssoCopy.settingsSubtitle}
          </p>
        </div>

        {loading && (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>
            {L('불러오는 중…', 'Loading…')}
          </div>
        )}

        {!loading && (
          <>
            <div style={{ ...S.card, background: '#2b2112', borderColor: '#8a5b16' }} role="status">
              <div style={{ color: '#f0b34c', fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                {ssoCopy.metadataBannerTitle}
              </div>
              <div style={{ color: '#d6b77a', fontSize: 13, lineHeight: 1.6 }}>
                {ssoCopy.metadataBannerDescription}
              </div>
            </div>

            {/* 1. SSO 상태 토글 */}
            <div style={S.card}>
              <div style={S.sectionTitle}>{L('SSO 상태', 'Status')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{ ...S.toggle(false), cursor: 'not-allowed', opacity: 0.6 }}
                  role="switch"
                  aria-checked={false}
                  aria-disabled="true"
                >
                  <div style={S.toggleKnob(false)} />
                </div>
                <span style={{ fontSize: 14, color: '#d6b77a' }}>
                  {ssoCopy.statusLabel}
                </span>
              </div>
            </div>

            {/* 2. Provider 선택 */}
            <div style={S.card}>
              <div style={S.sectionTitle}>{ssoCopy.metadataSectionTitle}</div>
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
                    {p === null ? L('없음', 'None') : p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. SAML 설정 */}
            {config.provider === 'saml' && (
              <div style={S.card}>
                <div style={S.sectionTitle}>{L('SAML 설정', 'SAML Configuration')}</div>

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
                  {L('IdP Certificate (Base64 PEM) — 인증서 업로드', 'IdP Certificate (Base64 PEM) — Upload certificate')}
                </label>
                {config._certMasked ? (
                  <div style={{
                    background: '#0f1117', border: '1px solid #374151', borderRadius: 8,
                    padding: '9px 12px', fontSize: 12, fontFamily: 'monospace',
                    color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span>★★★★ {L('인증서 저장됨', 'Certificate stored')} ★★★★</span>
                    <button
                      onClick={() => setConfig(c => ({ ...c, certificate: '', _certMasked: false }))}
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >
                      {L('교체', 'Replace')}
                    </button>
                  </div>
                ) : (
                  <textarea
                    style={S.textarea}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    value={config.certificate ?? ''}
                    onChange={e => setConfig(c => ({ ...c, certificate: e.target.value }))}
                  />
                )}
                {!config._certMasked && (
                  <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>
                    {L('저장 후 인증서는 마스킹되어 표시됩니다', 'Certificate will be masked after save.')}
                  </div>
                )}
              </div>
            )}

            {/* 4. OIDC 설정 */}
            {config.provider === 'oidc' && (
              <div style={S.card}>
                <div style={S.sectionTitle}>{L('OIDC 설정', 'OIDC Configuration')}</div>

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
                  placeholder={config.clientSecret ? '••••••••' : L('새 시크릿 입력', 'Enter secret')}
                  onChange={e => setConfig(c => ({ ...c, clientSecret: e.target.value }))}
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
                {L('설정이 저장되었습니다', 'Configuration saved.')}
              </div>
            )}

            {/* 5. Action buttons */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                style={S.btn('primary')}
                onClick={save}
                disabled={saving}
              >
                {saving ? L('저장 중…', 'Saving…') : ssoCopy.saveMetadata}
              </button>
            </div>

            {/* 6. Audit log link */}
            <div style={{ marginTop: 32, padding: '14px 20px', background: '#1a1d27', border: '1px solid #2d3748', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{L('감사 로그', 'Audit Logs')}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {ssoCopy.auditDescription}
                </div>
              </div>
              <a
                href={`/${lang}/nexyfab/settings/audit`}
                style={{ color: '#3B82F6', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                {L('감사 로그 보기', 'View Audit Logs')} →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
