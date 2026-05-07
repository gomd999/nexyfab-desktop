'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000';

type Lang = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, Record<string, string>> = {
    en: {
        title: 'Create Account',
        subtitle: 'One account for all Nexysys services',
        name: 'Full Name',
        email: 'Email',
        password: 'Password',
        confirm: 'Confirm Password',
        submit: 'Create Account',
        submitting: 'Creating account...',
        haveAccount: 'Already have an account?',
        signIn: 'Sign in',
        pwMismatch: 'Passwords do not match.',
        pwWeak: 'Password must be at least 8 characters.',
        success: 'Account created! Redirecting...',
        failed: 'Registration failed.',
        agreeRequired: 'Please agree to the terms before continuing.',
        agreeTerms: 'I agree to the',
        termsLink: 'Terms of Service',
        and: 'and',
        privacyLink: 'Privacy Policy',
        agreeMarketing: 'I agree to receive marketing communications (optional)',
    },
    ko: {
        title: '회원가입',
        subtitle: '하나의 계정으로 모든 Nexysys 서비스를 이용하세요',
        name: '이름',
        email: '이메일',
        password: '비밀번호',
        confirm: '비밀번호 확인',
        submit: '계정 만들기',
        submitting: '가입 중...',
        haveAccount: '이미 계정이 있으신가요?',
        signIn: '로그인',
        pwMismatch: '비밀번호가 일치하지 않습니다.',
        pwWeak: '비밀번호는 8자 이상이어야 합니다.',
        success: '가입 완료! 이동 중...',
        failed: '가입에 실패했습니다.',
        agreeRequired: '약관에 동의해 주세요.',
        agreeTerms: '본인은',
        termsLink: '이용약관',
        and: '및',
        privacyLink: '개인정보 처리방침',
        agreeMarketing: '마케팅 정보 수신에 동의합니다 (선택)',
    },
    ja: {
        title: 'アカウント作成',
        subtitle: '1つのアカウントですべてのNexysysサービスをご利用いただけます',
        name: '氏名',
        email: 'メールアドレス',
        password: 'パスワード',
        confirm: 'パスワード確認',
        submit: 'アカウント作成',
        submitting: '登録中...',
        haveAccount: 'すでにアカウントをお持ちですか？',
        signIn: 'ログイン',
        pwMismatch: 'パスワードが一致しません。',
        pwWeak: 'パスワードは8文字以上必要です。',
        success: '登録完了！移動中...',
        failed: '登録に失敗しました。',
        agreeRequired: '利用規約に同意してください。',
        agreeTerms: '私は',
        termsLink: '利用規約',
        and: 'および',
        privacyLink: 'プライバシーポリシー',
        agreeMarketing: 'マーケティング情報の受信に同意します (任意)',
    },
    zh: {
        title: '创建账户',
        subtitle: '一个账户畅享所有Nexysys服务',
        name: '姓名',
        email: '电子邮箱',
        password: '密码',
        confirm: '确认密码',
        submit: '创建账户',
        submitting: '注册中...',
        haveAccount: '已有账户？',
        signIn: '登录',
        pwMismatch: '密码不匹配。',
        pwWeak: '密码至少需要8个字符。',
        success: '注册成功！跳转中...',
        failed: '注册失败。',
        agreeRequired: '请先同意条款。',
        agreeTerms: '我同意',
        termsLink: '服务条款',
        and: '和',
        privacyLink: '隐私政策',
        agreeMarketing: '同意接收营销信息 (可选)',
    },
    es: {
        title: 'Crear cuenta',
        subtitle: 'Una cuenta para todos los servicios de Nexysys',
        name: 'Nombre completo',
        email: 'Correo electrónico',
        password: 'Contraseña',
        confirm: 'Confirmar contraseña',
        submit: 'Crear cuenta',
        submitting: 'Creando cuenta...',
        haveAccount: '¿Ya tienes una cuenta?',
        signIn: 'Iniciar sesión',
        pwMismatch: 'Las contraseñas no coinciden.',
        pwWeak: 'La contraseña debe tener al menos 8 caracteres.',
        success: '¡Cuenta creada! Redirigiendo...',
        failed: 'Error en el registro.',
        agreeRequired: 'Por favor acepta los términos antes de continuar.',
        agreeTerms: 'Acepto los',
        termsLink: 'Términos del Servicio',
        and: 'y la',
        privacyLink: 'Política de Privacidad',
        agreeMarketing: 'Acepto recibir comunicaciones de marketing (opcional)',
    },
    ar: {
        title: 'إنشاء حساب',
        subtitle: 'حساب واحد لجميع خدمات Nexysys',
        name: 'الاسم الكامل',
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        confirm: 'تأكيد كلمة المرور',
        submit: 'إنشاء الحساب',
        submitting: '...جارٍ الإنشاء',
        haveAccount: 'هل لديك حساب بالفعل؟',
        signIn: 'تسجيل الدخول',
        pwMismatch: 'كلمتا المرور غير متطابقتين.',
        pwWeak: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.',
        success: '!تم إنشاء الحساب',
        failed: 'فشل التسجيل.',
        agreeRequired: 'يرجى الموافقة على الشروط قبل المتابعة.',
        agreeTerms: 'أوافق على',
        termsLink: 'شروط الخدمة',
        and: 'و',
        privacyLink: 'سياسة الخصوصية',
        agreeMarketing: 'أوافق على استلام رسائل تسويقية (اختياري)',
    },
};

function detectLang(): Lang {
    try {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            const u = JSON.parse(stored);
            if (u.language && dict[u.language as Lang]) return u.language as Lang;
        }
        const saved = localStorage.getItem('app_language');
        if (saved && dict[saved as Lang]) return saved as Lang;
    } catch {}
    return 'ko';
}

export default function RegisterPage() {
    const router = useRouter();
    const [lang, setLang] = useState<Lang>('ko');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [agreeTerms, setAgreeTerms] = useState(false);
    const [agreeMarketing, setAgreeMarketing] = useState(false);

    useEffect(() => {
        setLang(detectLang());
        const stored = localStorage.getItem('currentUser');
        if (stored) router.replace('/account');
    }, [router]);

    const t = dict[lang];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (password.length < 8) { setError(t.pwWeak); return; }
        if (password !== confirm) { setError(t.pwMismatch); return; }
        if (!agreeTerms) { setError(t.agreeRequired); return; }

        setLoading(true);
        try {
            const res = await fetch(`${AUTH_BASE}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: name.trim(),
                    email: email.trim(),
                    password,
                    termsAcceptedAt: new Date().toISOString(),
                    marketingOptIn: agreeMarketing,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || t.failed);

            // Auto-login after signup
            if (data.user) {
                localStorage.setItem('currentUser', JSON.stringify(data.user));
                window.dispatchEvent(new Event('storage'));
            }
            setSuccess(t.success);
            setTimeout(() => router.push('/account'), 1200);
        } catch (err: unknown) {
            // Dev fallback: create a local test session if auth server is down
            if (err instanceof TypeError && (err as TypeError).message.includes('fetch')) {
                const devUser = {
                    sub: `dev-${Date.now()}`,
                    name: name.trim() || email.split('@')[0],
                    email: email.trim(),
                    role: 'customer',
                    is_dev: true,
                    services: ['nexyfab'],
                    language: lang,
                    plan: 'free',
                };
                localStorage.setItem('currentUser', JSON.stringify(devUser));
                window.dispatchEvent(new Event('storage'));
                setSuccess(t.success);
                setTimeout(() => router.push('/account'), 1200);
                return;
            }
            setError(err instanceof Error ? err.message : t.failed);
        } finally {
            setLoading(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '14px 16px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        fontSize: '15px',
        outline: 'none',
        boxSizing: 'border-box',
    };

    return (
        <div style={{ minHeight: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '40px 16px', fontFamily: 'Pretendard, sans-serif', direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ maxWidth: '420px', width: '100%', background: '#fff', padding: '40px 32px', borderRadius: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '16px' }}>
                        <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
                    </div>
                    <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#111827', margin: '0 0 8px' }}>{t.title}</h1>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>{t.subtitle}</p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <input
                        type="text"
                        placeholder={t.name}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                        autoFocus
                        style={inputStyle}
                    />
                    <input
                        type="email"
                        placeholder={t.email}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        style={inputStyle}
                    />
                    <input
                        type="password"
                        placeholder={t.password}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        style={inputStyle}
                    />
                    <input
                        type="password"
                        placeholder={t.confirm}
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        required
                        style={inputStyle}
                    />

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer', lineHeight: 1.5 }}>
                        <input
                            type="checkbox"
                            checked={agreeTerms}
                            onChange={e => setAgreeTerms(e.target.checked)}
                            required
                            style={{ marginTop: '3px', flexShrink: 0 }}
                        />
                        <span>
                            <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span> {t.agreeTerms}{' '}
                            <Link href={`/${lang}/terms-of-use/`} target="_blank" rel="noopener noreferrer" prefetch={false} style={{ color: '#0b5cff', fontWeight: 600 }}>{t.termsLink}</Link>
                            {' '}{t.and}{' '}
                            <Link href={`/${lang}/privacy-policy/`} target="_blank" rel="noopener noreferrer" prefetch={false} style={{ color: '#0b5cff', fontWeight: 600 }}>{t.privacyLink}</Link>
                        </span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#6b7280', cursor: 'pointer', lineHeight: 1.5 }}>
                        <input
                            type="checkbox"
                            checked={agreeMarketing}
                            onChange={e => setAgreeMarketing(e.target.checked)}
                            style={{ marginTop: '3px', flexShrink: 0 }}
                        />
                        <span>{t.agreeMarketing}</span>
                    </label>

                    {error && (
                        <p style={{ color: '#ef4444', fontSize: '13px', fontWeight: 600, margin: 0 }}>{error}</p>
                    )}
                    {success && (
                        <p style={{ color: '#16a34a', fontSize: '13px', fontWeight: 600, margin: 0 }}>{success}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !agreeTerms}
                        style={{ width: '100%', background: '#0b5cff', color: '#fff', fontWeight: 700, padding: '14px', borderRadius: '12px', border: 'none', cursor: (loading || !agreeTerms) ? 'not-allowed' : 'pointer', opacity: (loading || !agreeTerms) ? 0.6 : 1, fontSize: '15px', transition: '0.2s', marginTop: '4px' }}
                    >
                        {loading ? t.submitting : t.submit}
                    </button>
                </form>

                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                    <Link href="/login" prefetch={false} style={{ fontSize: '13px', color: '#0b5cff', textDecoration: 'none', fontWeight: 600 }}>
                        {t.haveAccount} {t.signIn}
                    </Link>
                </div>
            </div>
        </div>
    );
}
