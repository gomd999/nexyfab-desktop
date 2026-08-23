'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';

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
  or: string;
  continueGoogle: string;
  continueKakao: string;
  continueNaver: string;
};

const DICT: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', Dict> = {
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
    or: '또는', continueGoogle: 'Google로 계속하기', continueKakao: '카카오로 계속하기', continueNaver: '네이버로 계속하기',
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
    or: 'or', continueGoogle: 'Continue with Google', continueKakao: 'Continue with Kakao', continueNaver: 'Continue with Naver',
  },
  ja: {
    loginTitle: 'ログインして続行', signupTitle: '無料で始める', name: '名前', namePlaceholder: '山田 太郎',
    email: 'メールアドレス', emailPlaceholder: 'you@company.com', password: 'パスワード',
    passwordHintSignup: '8文字以上', passwordPlaceholder: '••••••••', show: '表示', hide: '隠す',
    submitLogin: 'ログイン', submitSignup: '無料で始める', submitting: '処理中…',
    noAccount: 'アカウントをお持ちでないですか？', hasAccount: 'すでにアカウントをお持ちですか？',
    signupCta: '無料登録', loginCta: 'ログイン', planSummaryHeader: '無料プランに含まれるもの：',
    planItems: ['3件のプロジェクト', '基本形状＋スケッチ', 'STLエクスポート'],
    errEmail: '有効なメールアドレスを入力してください。', errPasswordShort: 'パスワードは8文字以上必要です。', close: '閉じる',
    or: 'または', continueGoogle: 'Googleで続行', continueKakao: 'Kakaoで続行', continueNaver: 'Naverで続行',
  },
  zh: {
    loginTitle: '登录后继续', signupTitle: '免费开始', name: '姓名', namePlaceholder: '张三',
    email: '电子邮箱', emailPlaceholder: 'you@company.com', password: '密码', passwordHintSignup: '至少8个字符',
    passwordPlaceholder: '••••••••', show: '显示', hide: '隐藏', submitLogin: '登录', submitSignup: '免费开始',
    submitting: '处理中…', noAccount: '还没有账户？', hasAccount: '已有账户？', signupCta: '免费注册',
    loginCta: '登录', planSummaryHeader: '免费方案包含：', planItems: ['3个项目', '基本形状和草图', 'STL 导出'],
    errEmail: '请输入有效的电子邮箱地址。', errPasswordShort: '密码至少需要8个字符。', close: '关闭',
    or: '或', continueGoogle: '使用 Google 继续', continueKakao: '使用 Kakao 继续', continueNaver: '使用 Naver 继续',
  },
  es: {
    loginTitle: 'Inicia sesión para continuar', signupTitle: 'Empieza gratis', name: 'Nombre', namePlaceholder: 'Ana García',
    email: 'Correo electrónico', emailPlaceholder: 'you@company.com', password: 'Contraseña',
    passwordHintSignup: 'Al menos 8 caracteres', passwordPlaceholder: '••••••••', show: 'Mostrar', hide: 'Ocultar',
    submitLogin: 'Iniciar sesión', submitSignup: 'Empezar gratis', submitting: 'Procesando…',
    noAccount: '¿No tienes una cuenta?', hasAccount: '¿Ya tienes una cuenta?', signupCta: 'Registro gratuito',
    loginCta: 'Iniciar sesión', planSummaryHeader: 'El plan gratuito incluye:',
    planItems: ['3 proyectos', 'Formas básicas y bocetos', 'Exportación STL'],
    errEmail: 'Introduce una dirección de correo válida.', errPasswordShort: 'La contraseña debe tener al menos 8 caracteres.', close: 'Cerrar',
    or: 'o', continueGoogle: 'Continuar con Google', continueKakao: 'Continuar con Kakao', continueNaver: 'Continuar con Naver',
  },
  ar: {
    loginTitle: 'سجّل الدخول للمتابعة', signupTitle: 'ابدأ مجانًا', name: 'الاسم', namePlaceholder: 'أحمد علي',
    email: 'البريد الإلكتروني', emailPlaceholder: 'you@company.com', password: 'كلمة المرور',
    passwordHintSignup: '8 أحرف على الأقل', passwordPlaceholder: '••••••••', show: 'إظهار', hide: 'إخفاء',
    submitLogin: 'تسجيل الدخول', submitSignup: 'ابدأ مجانًا', submitting: 'جارٍ المعالجة…',
    noAccount: 'ليس لديك حساب؟', hasAccount: 'لديك حساب بالفعل؟', signupCta: 'تسجيل مجاني',
    loginCta: 'تسجيل الدخول', planSummaryHeader: 'تتضمن الخطة المجانية:',
    planItems: ['3 مشاريع', 'أشكال أساسية ورسم تخطيطي', 'تصدير STL'],
    errEmail: 'أدخل عنوان بريد إلكتروني صالحًا.', errPasswordShort: 'يجب ألا تقل كلمة المرور عن 8 أحرف.', close: 'إغلاق',
    or: 'أو', continueGoogle: 'المتابعة باستخدام Google', continueKakao: 'المتابعة باستخدام Kakao', continueNaver: 'المتابعة باستخدام Naver',
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
  const t = DICT[toIsoLang(resolvedLang)] ?? DICT.en;

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
    background: 'var(--nx-bg)', border: '1px solid var(--nx-border)',
    color: 'var(--nx-text)', fontSize: 13, outline: 'none',
  };
  const fieldErrorStyle = { borderColor: '#f85149' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        style={{
          position: 'relative',
          background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
          borderRadius: 16, padding: '32px 28px', width: 400, maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          fontFamily: 'system-ui, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--nx-text)', marginBottom: 4 }}>
            <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
          </div>
          <p id="auth-modal-title" style={{ fontSize: 13, color: 'var(--nx-text-3)', margin: 0 }}>
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
              <label style={{ fontSize: 12, color: 'var(--nx-text-2)', display: 'block', marginBottom: 4 }}>{t.name}</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder={t.namePlaceholder} required={mode === 'signup'}
                style={fieldBase}
                onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--nx-border)'; }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: 'var(--nx-text-2)', display: 'block', marginBottom: 4 }}>{t.email}</label>
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
            <label style={{ fontSize: 12, color: 'var(--nx-text-2)', display: 'block', marginBottom: 4 }}>{t.password}</label>
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
                background: 'none', border: 'none', color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
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
              background: isLoading ? 'var(--nx-panel-2)' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: 'opacity 0.15s', marginTop: 4,
            }}
          >
            {isLoading ? t.submitting : mode === 'login' ? t.submitLogin : t.submitSignup}
          </button>
        </form>

        {/* Social login — Google works now; Kakao/Naver appear when their
            NEXT_PUBLIC_*_CLIENT_ID is set (same gating as the /login page). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 12px' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--nx-panel-2)' }} />
          <span style={{ fontSize: 12, color: 'var(--nx-text-3)', whiteSpace: 'nowrap' }}>{t.or}</span>
          <div style={{ flex: 1, height: 1, background: 'var(--nx-panel-2)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="/api/auth/oauth/google" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#374151', textDecoration: 'none', boxSizing: 'border-box' }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            {t.continueGoogle}
          </a>
          {process.env.NEXT_PUBLIC_KAKAO_CLIENT_ID && (
            <a href="/api/auth/oauth/kakao" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 12, background: '#FEE500', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#191919', textDecoration: 'none', boxSizing: 'border-box' }}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.36 2 10.5c0 2.63 1.74 4.95 4.38 6.3l-1.12 4.1c-.1.35.31.63.6.42l4.82-3.2c.43.04.87.06 1.32.06 5.52 0 10-3.36 10-7.5S17.52 3 12 3z" fill="#191919"/></svg>
              {t.continueKakao}
            </a>
          )}
          {process.env.NEXT_PUBLIC_NAVER_CLIENT_ID && (
            <a href="/api/auth/oauth/naver" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 12, background: '#03C75A', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#fff', textDecoration: 'none', boxSizing: 'border-box' }}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M16.27 3v8.46L7.73 3H3v18h4.73v-8.46L16.27 21H21V3h-4.73z" fill="#fff"/></svg>
              {t.continueNaver}
            </a>
          )}
        </div>

        {/* Plan summary for signup */}
        {mode === 'signup' && (
          <div style={{
            marginTop: 16, padding: '10px 12px',
            background: 'var(--nx-bg)', borderRadius: 8, border: '1px solid var(--nx-panel-2)',
          }}>
            <p style={{ fontSize: 11, color: 'var(--nx-text-3)', margin: '0 0 6px', fontWeight: 700 }}>
              {t.planSummaryHeader}
            </p>
            {t.planItems.map(item => (
              <p key={item} style={{ fontSize: 11, color: 'var(--nx-text-2)', margin: '2px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: '#3fb950' }}>✓</span> {item}
              </p>
            ))}
          </div>
        )}

        {/* Mode switch */}
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: 'var(--nx-text-3)' }}>
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
          background: 'none', border: 'none', color: 'var(--nx-text-3)',
          fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }} aria-label={t.close}>✕</button>
      </div>
    </div>
  );
}
