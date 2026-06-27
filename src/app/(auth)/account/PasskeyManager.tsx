'use client';

import { useState } from 'react';

/**
 * Register a passkey for the signed-in user. Uses the native WebAuthn API
 * (navigator.credentials.create) against NexyFab's own
 * /api/auth/webauthn/register/* endpoints. Once registered, the /login page's
 * "패스키로 로그인" button works for this account.
 */
export default function PasskeyManager() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const b64urlToBuf = (s: string): ArrayBuffer => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
  };
  const bufToB64url = (buf: ArrayBuffer): string =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  async function register() {
    if (typeof navigator === 'undefined' || !navigator.credentials) {
      setMsg({ type: 'err', text: '이 브라우저는 패스키를 지원하지 않습니다.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const optRes = await fetch('/api/auth/webauthn/register/options', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const opts = await optRes.json();
      if (!optRes.ok) throw new Error(opts.error || '패스키 옵션 조회 실패');

      const publicKey: PublicKeyCredentialCreationOptions = {
        ...opts,
        challenge: b64urlToBuf(opts.challenge),
        user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials || []).map((c: { id: string }) => ({ ...c, id: b64urlToBuf(c.id) })),
      };

      const cred = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
      const resp = cred.response as AuthenticatorAttestationResponse;

      const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(resp.clientDataJSON),
              attestationObject: bufToB64url(resp.attestationObject),
              transports: resp.getTransports ? resp.getTransports() : [],
            },
            clientExtensionResults: {},
          },
        }),
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error || '패스키 등록 실패');
      setMsg({ type: 'ok', text: '✓ 패스키가 등록되었습니다. 이제 로그인 화면에서 "패스키로 로그인"을 쓸 수 있어요.' });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name !== 'NotAllowedError') setMsg({ type: 'err', text: err.message ?? '패스키 등록 실패' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #f0f0f0', marginTop: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111827', margin: '0 0 6px' }}>패스키 (Passkey)</h3>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
        지문·얼굴·기기 PIN으로 비밀번호 없이 로그인하세요. 이 기기/계정에 패스키를 추가합니다.
      </p>
      <button
        onClick={() => void register()}
        disabled={busy}
        style={{ padding: '11px 18px', borderRadius: 10, background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? '등록 중…' : '🔑 패스키 등록'}
      </button>
      {msg && (
        <div style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: msg.type === 'ok' ? '#059669' : '#dc2626' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
