'use client';

import { useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'signup';
  redirectMessage?: string; // e.g. "Pro 기능을 사용하려면 로그인하세요"
}

export default function AuthModal({ open, onClose, defaultMode = 'login', redirectMessage }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const { login, signup, isLoading, error, clearError } = useAuthStore();
  useEscapeKey(onClose, open);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        borderRadius: 16, padding: '32px 28px', width: 400,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
      }} onClick={e => e.stopPropagation()}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e6edf3', marginBottom: 4 }}>
            <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
          </div>
          <p style={{ fontSize: 13, color: '#6e7681', margin: 0 }}>
            {mode === 'login' ? '로그인하여 계속하기' : '무료로 시작하기'}
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <div>
              <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>이름</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="홍길동" required={mode === 'signup'}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box',
                  background: '#0d1117', border: '1px solid #30363d',
                  color: '#e6edf3', fontSize: 13, outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>이메일</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com" required
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box',
                background: '#0d1117', border: '1px solid #30363d',
                color: '#e6edf3', fontSize: 13, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>비밀번호</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? '8자 이상' : '••••••••'} required
                style={{
                  width: '100%', padding: '10px 36px 10px 12px', borderRadius: 8, boxSizing: 'border-box',
                  background: '#0d1117', border: '1px solid #30363d',
                  color: '#e6edf3', fontSize: 13, outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 12,
              }}>
                {showPw ? '숨김' : '표시'}
              </button>
            </div>
          </div>

          <button
            type="submit" disabled={isLoading}
            style={{
              padding: '11px 0', borderRadius: 8, border: 'none',
              background: isLoading ? '#21262d' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s', marginTop: 4,
            }}
          >
            {isLoading ? '처리 중...' : mode === 'login' ? '로그인' : '무료로 시작'}
          </button>
        </form>

        {/* Plan summary for signup */}
        {mode === 'signup' && (
          <div style={{
            marginTop: 16, padding: '10px 12px',
            background: '#0d1117', borderRadius: 8, border: '1px solid #21262d',
          }}>
            <p style={{ fontSize: 11, color: '#6e7681', margin: '0 0 6px', fontWeight: 700 }}>
              Free 플랜 포함:
            </p>
            {['프로젝트 3개', '기본 형상 + 스케치', 'STL 내보내기'].map(item => (
              <p key={item} style={{ fontSize: 11, color: '#8b949e', margin: '2px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: '#3fb950' }}>✓</span> {item}
              </p>
            ))}
          </div>
        )}

        {/* Mode switch */}
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#6e7681' }}>
          {mode === 'login' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}
          {' '}
          <button onClick={switchMode} style={{
            background: 'none', border: 'none', color: '#388bfd',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
          }}>
            {mode === 'login' ? '무료 가입' : '로그인'}
          </button>
        </p>

        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 14,
          background: 'none', border: 'none', color: '#6e7681',
          fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }} aria-label="Close">✕</button>
      </div>
    </div>
  );
}
