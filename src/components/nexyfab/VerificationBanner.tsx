'use client';

import { useRef, useState, KeyboardEvent, ClipboardEvent } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

interface Props {
  lang?: string;
}

const COPY: Record<IsoLang, {
  warning: string; instruction: string; demo: string; sent: string; sendFailed: string; network: string;
  verified: string; verifyFailed: string; verifying: string; verify: string; sending: string; resend: string; aria: string;
}> = {
  ko: { warning: '이메일 인증이 필요합니다.', instruction: '을 확인하세요.', demo: '데모 모드: 서버 콘솔에서 코드를 확인하세요.', sent: '인증 코드가 발송되었습니다.', sendFailed: '발송에 실패했습니다.', network: '네트워크 오류가 발생했습니다.', verified: '이메일 인증이 완료되었습니다!', verifyFailed: '인증에 실패했습니다.', verifying: '확인 중...', verify: '확인', sending: '발송 중...', resend: '인증 코드 재발송', aria: '인증 코드 자리' },
  en: { warning: 'Email verification is required.', instruction: 'Please check your inbox.', demo: 'Demo mode: check the code in the server console.', sent: 'Verification code sent.', sendFailed: 'Could not send the code.', network: 'A network error occurred.', verified: 'Email verified!', verifyFailed: 'Verification failed.', verifying: 'Verifying...', verify: 'Verify', sending: 'Sending...', resend: 'Resend code', aria: 'Verification code digit' },
  ja: { warning: 'メール認証が必要です。', instruction: '受信トレイを確認してください。', demo: 'デモモード: サーバーコンソールでコードを確認してください。', sent: '認証コードを送信しました。', sendFailed: 'コードを送信できませんでした。', network: 'ネットワークエラーが発生しました。', verified: 'メール認証が完了しました！', verifyFailed: '認証に失敗しました。', verifying: '確認中...', verify: '確認', sending: '送信中...', resend: 'コードを再送信', aria: '認証コードの桁' },
  zh: { warning: '需要验证电子邮件。', instruction: '请检查您的收件箱。', demo: '演示模式：请在服务器控制台查看验证码。', sent: '验证码已发送。', sendFailed: '验证码发送失败。', network: '发生网络错误。', verified: '电子邮件验证完成！', verifyFailed: '验证失败。', verifying: '验证中...', verify: '验证', sending: '发送中...', resend: '重新发送验证码', aria: '验证码位数' },
  es: { warning: 'Se requiere verificar el correo electrónico.', instruction: 'Revisa tu bandeja de entrada.', demo: 'Modo demo: consulta el código en la consola del servidor.', sent: 'Código de verificación enviado.', sendFailed: 'No se pudo enviar el código.', network: 'Se produjo un error de red.', verified: '¡Correo electrónico verificado!', verifyFailed: 'La verificación falló.', verifying: 'Verificando...', verify: 'Verificar', sending: 'Enviando...', resend: 'Reenviar código', aria: 'Dígito del código de verificación' },
  ar: { warning: 'يلزم التحقق من البريد الإلكتروني.', instruction: 'تحقق من صندوق الوارد.', demo: 'الوضع التجريبي: تحقق من الرمز في وحدة تحكم الخادم.', sent: 'تم إرسال رمز التحقق.', sendFailed: 'تعذر إرسال الرمز.', network: 'حدث خطأ في الشبكة.', verified: 'تم التحقق من البريد الإلكتروني!', verifyFailed: 'فشل التحقق.', verifying: 'جارٍ التحقق...', verify: 'تحقق', sending: 'جارٍ الإرسال...', resend: 'إعادة إرسال الرمز', aria: 'رقم رمز التحقق' },
};

export default function VerificationBanner({ lang = 'ko' }: Props) {
  const locale = toIsoLang(lang);
  const copy = COPY[locale];
  const { user, setUser } = useAuthStore();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  if (!user || user.emailVerified !== false) return null;

  const fullCode = digits.join('');

  const handleSend = async () => {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({ email: user.email, userId: user.id, lang: locale }),
      });
      const data = await res.json() as { sent?: boolean; demo?: boolean; error?: string };
      if (res.ok && data.sent) {
        setMessage({ text: data.demo ? copy.demo : copy.sent, ok: true });
        setDigits(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      } else {
        setMessage({ text: data.error ?? copy.sendFailed, ok: false });
      }
    } catch {
      setMessage({ text: copy.network, ok: false });
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (fullCode.length !== 6) return;
    setVerifying(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({ code: fullCode, userId: user.id, lang: locale }),
      });
      const data = await res.json() as { verified?: boolean; error?: string };
      if (res.ok && data.verified) {
        setUser({ ...user, emailVerified: true }, useAuthStore.getState().token);
        setMessage({ text: copy.verified, ok: true });
      } else {
        setMessage({ text: data.error ?? copy.verifyFailed, ok: false });
      }
    } catch {
      setMessage({ text: copy.network, ok: false });
    } finally {
      setVerifying(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter' && fullCode.length === 6) {
      handleVerify();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = Array(6).fill('');
    pasted.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #451a03, #78350f)',
        borderBottom: '1px solid #92400e',
        padding: '12px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      {/* Warning icon + text */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 200px' }}>
        <span style={{ fontSize: '18px' }}>⚠️</span>
        <span style={{ color: '#fde68a', fontSize: '14px', fontWeight: 500 }}>
          {copy.warning}&nbsp;
          <span style={{ color: '#fbbf24', fontWeight: 400 }}>{user.email}</span>
          {copy.instruction}
        </span>
      </div>

      {/* OTP inputs */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {Array(6).fill(null).map((_, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digits[i]}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            style={{
              width: '36px',
              height: '40px',
              textAlign: 'center',
              fontSize: '18px',
              fontWeight: 700,
              background: '#1c1917',
              border: `1px solid ${digits[i] ? '#f59e0b' : '#44403c'}`,
              borderRadius: '6px',
              color: '#fbbf24',
              outline: 'none',
              caretColor: '#f59e0b',
            }}
            aria-label={`${copy.aria} ${i + 1}`}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={handleVerify}
          disabled={verifying || fullCode.length !== 6}
          style={{
            background: fullCode.length === 6 ? '#f59e0b' : '#44403c',
            color: fullCode.length === 6 ? '#1c1917' : '#78716c',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: fullCode.length === 6 ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {verifying ? copy.verifying : copy.verify}
        </button>

        <button
          onClick={handleSend}
          disabled={sending}
          style={{
            background: 'transparent',
            color: '#fbbf24',
            border: '1px solid #92400e',
            borderRadius: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: sending ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {sending ? copy.sending : copy.resend}
        </button>
      </div>

      {/* Feedback message */}
      {message && (
        <div
          style={{
            width: '100%',
            fontSize: '13px',
            color: message.ok ? '#86efac' : '#fca5a5',
            paddingLeft: '26px',
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
