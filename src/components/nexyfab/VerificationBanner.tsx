'use client';

import { useRef, useState, KeyboardEvent, ClipboardEvent } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

interface Props {
  lang?: string;
}

export default function VerificationBanner({ lang = 'ko' }: Props) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, userId: user.id }),
      });
      const data = await res.json() as { sent?: boolean; demo?: boolean; error?: string };
      if (res.ok && data.sent) {
        setMessage({ text: data.demo ? '데모 모드: 서버 콘솔에서 코드를 확인하세요.' : '인증 코드가 발송되었습니다.', ok: true });
        setDigits(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      } else {
        setMessage({ text: data.error ?? '발송에 실패했습니다.', ok: false });
      }
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', ok: false });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fullCode, userId: user.id }),
      });
      const data = await res.json() as { verified?: boolean; error?: string };
      if (res.ok && data.verified) {
        setUser({ ...user, emailVerified: true }, useAuthStore.getState().token);
        setMessage({ text: '이메일 인증이 완료되었습니다!', ok: true });
      } else {
        setMessage({ text: data.error ?? '인증에 실패했습니다.', ok: false });
      }
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', ok: false });
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
          이메일 인증이 필요합니다.&nbsp;
          <span style={{ color: '#fbbf24', fontWeight: 400 }}>{user.email}</span>
          을 확인하세요.
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
            aria-label={`인증 코드 ${i + 1}번째 자리`}
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
          {verifying ? '확인 중...' : '확인'}
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
          {sending ? '발송 중...' : '인증 코드 재발송'}
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
