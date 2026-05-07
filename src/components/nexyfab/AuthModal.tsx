'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { isKorean, toRouteLang } from '@/lib/i18n/normalize';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'signup';
  redirectMessage?: string;
  lang?: string;
}

type Dict = {
  loginTitle: string;
  signupTitle: string;
  name: string;
  namePlaceholder: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  passwordHintSignup: string;
  passwordPlaceholder: string;
  show: string;
  hide: string;
  submitLogin: string;
  submitSignup: string;
  submitting: string;
  noAccount: string;
  hasAccount: string;
  signupCta: string;
  loginCta: string;
  planSummaryHeader: string;
  planItems: string[];
  errEmail: string;
  errPasswordShort: string;
  close: string;
};

const DICT: Record<'ko' | 'en', Dict> = {
  ko: {
    loginTitle: '로그인하여 계속하기',
    signupTitle: '무료로 시작하기',
    name: '이름',
    namePlaceholder: '홍길동',
    email: '이메일',
    emailPlaceholder: 'you@company.com',
    password: '비밀번호',
    passwordHintSignup: '8자 이상',
    passwordPlaceholder: '••••••••',
    show: '표시',
    hide: '숨김',
    submitLogin: '로그인',
    submitSignup: '무료로 시작',
    submitting: '처리 중...',
    noAccount: '계정이 없으신가요?',
    hasAccount: '이미 계정이 있으신가요?',
    signupCta: '무료 가입',
    loginCta: '로그인',
    planSummaryHeader: 'Free 플랜 포함:',
    planItems: ['프로젝트 3개', '기본 형상 + 스케치', 'STL 내보내기'],
    errEmail: '올바른 이메일 주소를 입력하세요.',
    errPasswordShort: '비밀번호는 8자 이상이어야 합니다.',
    close: '닫기',
  },
  en: {
    loginTitle: 'Log in to continue',
    signupTitle: 'Get started for free',
    name: 'Name',
    namePlaceholder: 'Jane Doe',
    email: 'Email',
    emailPlaceholder: 'you@company.com',
    password: 'Password',
    passwordHintSignup: 'At least 8 characters',
    passwordPlaceholder: '••••••••',
    show: 'Show',
    hide: 'Hide',
    submitLogin: 'Log in',
    submitSignup: 'Start free',
    submitting: 'Processing...',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    signupCta: 'Sign up free',
    loginCta: 'Log in',
    planSummaryHeader: 'Free plan includes:',
    planItems: ['3 projects', 'Basic shapes + sketch', 'STL export'],
    errEmail: 'Enter a valid email address.',
    errPasswordShort: 'Password must be at least 8 characters.',
    close: 'Close',
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthModal({
  open, onClose, defaultMode = 'login', redirectMessage, lang,
}: AuthModalProps) {
  const pathname = usePathname();
  const resolvedLang = useMemo(() => {
    if (lang) return lang;
    const seg = pathname?.split('/').filter(Boolean)[0] ?? '';
    return toRouteLang(seg);
  }, [lang, pathname]);
  const t = isKorean(resolvedLang) ? DICT.ko : DICT.en;

  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const { login, signup, isLoading, error, clearError } = useAuthStore();
  useEscapeKey(onClose, open);

  const emailError = email && !EMAIL_RE.test(email) ? t.errEmail : '';
  const passwordError =
    mode === 'signup' && password && password.length < 8 ? t.errPasswordShort : '';
  const formInvalid =
    !email || !password || !!emailError || !!passwordError || (mode === 'signup' && !name);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    setPasswordTouched(true);
    if (formInvalid) return;
    clearError();
    let ok = false;
    if (mode === 'login') {
      ok = await login(email, password);
    } else {
      ok = await signup(email, password, name);
    }
    if (ok) onClose();
  };

  const switchMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login');
    clearError();
  };

  const fieldBase = {
    width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box' as const,
    background: '#0d1117', border: '1px solid #30363d',
    color: '#e6edf3', fontSize: 13, outline: 'none',
  };
  const fieldErrorStyle = { borderColor: '#f85149' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        position: 'relative',
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 16, padding: '32px 28px', width: 400, maxWidth: 'calc(100vw - 32px)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
      }} onClick={e => e.stopPropagation()}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e6edf3', marginBottom: 4 }}>
            <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
          </div>
          <p style={{ fontSize: 13, color: '#6e7681', margin: 0 }}>
            {mode === 'login' ? t.loginTitle : t.signupTitle}
          </p>
        </div>

        {/* Redirect message */}
        {redirectMessage && (
          <div style={{
            background: 'rgba(56,139,253,0.1)', border: '1px solid rgba(56,139,253,0.3)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#58a6ff',
          }}>
            {redirectMessage}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#f85149',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <div>
              <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>{t.name}</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder={t.namePlaceholder} required={mode === 'signup'}
                style={fieldBase}
                onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>{t.email}</label>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder={t.emailPlaceholder} required
              aria-invalid={!!emailError && emailTouched}
              aria-describedby={emailError && emailTouched ? 'auth-email-error' : undefined}
              style={{ ...fieldBase, ...(emailError && emailTouched ? fieldErrorStyle : null) }}
              onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
            />
            {emailError && emailTouched && (
              <p id="auth-email-error" style={{ margin: '4px 2px 0', fontSize: 11, color: '#f85149' }}>
                {emailError}
              </p>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>{t.password}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                onBlur={() => setPasswordTouched(true)}
                placeholder={mode === 'signup' ? t.passwordHintSignup : t.passwordPlaceholder} required
                aria-invalid={!!passwordError && passwordTouched}
                aria-describedby={passwordError && passwordTouched ? 'auth-pw-error' : undefined}
                style={{
                  ...fieldBase,
                  padding: '10px 36px 10px 12px',
                  ...(passwordError && passwordTouched ? fieldErrorStyle : null),
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 12,
              }}>
                {showPw ? t.hide : t.show}
              </button>
            </div>
            {passwordError && passwordTouched && (
              <p id="auth-pw-error" style={{ margin: '4px 2px 0', fontSize: 11, color: '#f85149' }}>
                {passwordError}
              </p>
            )}
          </div>

          <button
            type="submit" disabled={isLoading}
            style={{
              padding: '11px 0', borderRadius: 8, border: 'none',
              background: isLoading ? '#21262d' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: 'opacity 0.15s', marginTop: 4,
            }}
          >
            {isLoading ? t.submitting : mode === 'login' ? t.submitLogin : t.submitSignup}
          </button>
        </form>

        {/* Plan summary for signup */}
        {mode === 'signup' && (
          <div style={{
            marginTop: 16, padding: '10px 12px',
            background: '#0d1117', borderRadius: 8, border: '1px solid #21262d',
          }}>
            <p style={{ fontSize: 11, color: '#6e7681', margin: '0 0 6px', fontWeight: 700 }}>
              {t.planSummaryHeader}
            </p>
            {t.planItems.map(item => (
              <p key={item} style={{ fontSize: 11, color: '#8b949e', margin: '2px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: '#3fb950' }}>✓</span> {item}
              </p>
            ))}
          </div>
        )}

        {/* Mode switch */}
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#6e7681' }}>
          {mode === 'login' ? t.noAccount : t.hasAccount}
          {' '}
          <button onClick={switchMode} style={{
            background: 'none', border: 'none', color: '#388bfd',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
          }}>
            {mode === 'login' ? t.signupCta : t.loginCta}
          </button>
        </p>

        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 14,
          background: 'none', border: 'none', color: '#6e7681',
          fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }} aria-label={t.close}>✕</button>
      </div>
    </div>
  );
}
