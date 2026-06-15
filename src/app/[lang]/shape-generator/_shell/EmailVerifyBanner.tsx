'use client';

// Email verification banner — non-blocking notice with inline 6-digit code
// entry. Shown when the authenticated user has emailVerified === false.
// Hidden once verified or if the user dismisses it for the current session.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { loc } from '../lib/loc';

const DISMISS_KEY = 'nexyfab.verify-banner-dismissed.v1';

export interface EmailVerifyBannerProps {
  isKo: boolean;
  lang: string;
}

export function EmailVerifyBanner({ isKo, lang }: EmailVerifyBannerProps) {
  const user = useAuthStore(s => s.user);
  const refreshUser = useAuthStore(s => s.refreshPlan);
  // Optimistic UI fallback — mark user verified locally on success so the
  // banner hides instantly without waiting for refreshPlan.
  const setUser = useAuthStore.setState;
  const [dismissed, setDismissed] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
  }, []);

  if (!user || user.emailVerified || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    }
    setDismissed(true);
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setInfo(loc(lang, {
          ko: '인증 코드를 재발송했습니다 — 메일함 확인하세요.',
          en: 'Verification code resent — check your inbox.',
          ja: '認証コードを再送信しました — メールをご確認ください。',
          zh: '验证码已重新发送 — 请查收邮箱。',
          es: 'Código de verificación reenviado — revisa tu bandeja de entrada.',
          ar: 'تمت إعادة إرسال رمز التحقق — تحقق من بريدك الوارد.',
        }));
        setShowInput(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? loc(lang, {
          ko: '재발송 실패',
          en: 'Resend failed',
          ja: '再送信に失敗しました',
          zh: '重新发送失败',
          es: 'Error al reenviar',
          ar: 'فشلت إعادة الإرسال',
        }));
      }
    } catch {
      setError(loc(lang, {
        ko: '네트워크 오류',
        en: 'Network error',
        ja: 'ネットワークエラー',
        zh: '网络错误',
        es: 'Error de red',
        ar: 'خطأ في الشبكة',
      }));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError(loc(lang, {
        ko: '6자리 숫자 코드를 입력하세요.',
        en: 'Enter the 6-digit code.',
        ja: '6桁の数字コードを入力してください。',
        zh: '请输入6位数字验证码。',
        es: 'Introduce el código de 6 dígitos.',
        ar: 'أدخل الرمز المكوّن من 6 أرقام.',
      }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId: user.id }),
      });
      if (res.ok) {
        setInfo(loc(lang, {
          ko: '✓ 이메일 인증 완료',
          en: '✓ Email verified',
          ja: '✓ メール認証完了',
          zh: '✓ 邮箱验证完成',
          es: '✓ Correo verificado',
          ar: '✓ تم التحقق من البريد الإلكتروني',
        }));
        // Optimistic local update — emailVerified true so the banner hides
        // immediately. refreshPlan also runs to sync the token claim.
        setUser((s) => ({ ...s, user: s.user ? { ...s.user, emailVerified: true } : null }));
        setTimeout(() => { void refreshUser?.(); }, 200);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? loc(lang, {
          ko: '인증 실패',
          en: 'Verification failed',
          ja: '認証に失敗しました',
          zh: '验证失败',
          es: 'Error de verificación',
          ar: 'فشل التحقق',
        }));
      }
    } catch {
      setError(loc(lang, {
        ko: '네트워크 오류',
        en: 'Network error',
        ja: 'ネットワークエラー',
        zh: '网络错误',
        es: 'Error de red',
        ar: 'خطأ في الشبكة',
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label={loc(lang, {
        ko: '이메일 인증 안내',
        en: 'Email verification notice',
        ja: 'メール認証のお知らせ',
        zh: '邮箱验证提示',
        es: 'Aviso de verificación de correo',
        ar: 'إشعار التحقق من البريد الإلكتروني',
      })}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 8500,
        background: 'linear-gradient(90deg, rgba(255, 168, 0, 0.95), rgba(255, 200, 60, 0.95))',
        color: '#0f0f0f',
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 13, fontWeight: 600,
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16 }}>✉</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {isKo
          ? <>이메일 인증이 필요합니다 — <strong>{user.email}</strong> 로 발송된 6자리 코드를 입력해주세요.</>
          : <>Email verification needed — enter the 6-digit code sent to <strong>{user.email}</strong>.</>}
        {info && <span role="status" aria-live="polite" style={{ marginLeft: 10, color: '#0a4f1f', fontWeight: 700 }}>{info}</span>}
        {error && <span role="alert" aria-live="assertive" style={{ marginLeft: 10, color: '#7a2222', fontWeight: 700 }}>{error}</span>}
      </span>
      {showInput && (
        <>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter') verify(); }}
            disabled={busy}
            aria-label={loc(lang, {
              ko: '6자리 인증 코드',
              en: '6-digit verification code',
              ja: '6桁の認証コード',
              zh: '6位验证码',
              es: 'Código de verificación de 6 dígitos',
              ar: 'رمز التحقق المكوّن من 6 أرقام',
            })}
            autoComplete="one-time-code"
            style={{
              height: 28, padding: '0 10px',
              border: '1px solid rgba(0, 0, 0, 0.3)', borderRadius: 4,
              background: '#fff', color: '#0f0f0f',
              fontSize: 14, fontFamily: 'ui-monospace, monospace',
              letterSpacing: '4px', width: 90, textAlign: 'center',
              fontWeight: 700,
            }}
          />
          <button
            onClick={verify}
            disabled={busy || code.length !== 6}
            style={{
              padding: '0 12px', height: 28, border: 0, borderRadius: 4,
              background: '#0f0f0f', color: '#fff',
              fontSize: 12, fontWeight: 700,
              cursor: busy || code.length !== 6 ? 'not-allowed' : 'pointer',
              opacity: code.length !== 6 ? 0.5 : 1,
            }}
          >
            {loc(lang, { ko: '인증', en: 'Verify', ja: '認証', zh: '验证', es: 'Verificar', ar: 'تحقّق' })}
          </button>
        </>
      )}
      {!showInput && (
        <button
          onClick={() => setShowInput(true)}
          style={{
            padding: '0 12px', height: 28, border: 0, borderRadius: 4,
            background: '#0f0f0f', color: '#fff',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {loc(lang, {
            ko: '코드 입력',
            en: 'Enter code',
            ja: 'コード入力',
            zh: '输入验证码',
            es: 'Introducir código',
            ar: 'أدخل الرمز',
          })}
        </button>
      )}
      <button
        onClick={resend}
        disabled={busy}
        style={{
          padding: '0 10px', height: 28, border: '1px solid rgba(0, 0, 0, 0.3)', borderRadius: 4,
          background: 'transparent', color: '#0f0f0f',
          fontSize: 11, fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {loc(lang, {
          ko: '재발송',
          en: 'Resend',
          ja: '再送信',
          zh: '重新发送',
          es: 'Reenviar',
          ar: 'إعادة الإرسال',
        })}
      </button>
      <button
        onClick={dismiss}
        aria-label={loc(lang, {
          ko: '인증 안내 닫기',
          en: 'Dismiss verification notice',
          ja: '認証のお知らせを閉じる',
          zh: '关闭验证提示',
          es: 'Descartar aviso de verificación',
          ar: 'إغلاق إشعار التحقق',
        })}
        style={{
          width: 24, height: 24, padding: 0, border: 0, background: 'transparent',
          color: '#0f0f0f', fontSize: 18, cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
