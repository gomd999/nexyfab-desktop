'use client';

/**
 * AccountSecuritySection — **만든 API 를 사용자가 닿게 한다** (260802).
 *
 * ## 왜 필요했나
 * 회원 보안 API 4종(복구 코드·비밀번호 변경·세션 목록·세션 해제)을 만들었는데
 * **부르는 화면이 0곳**이었다. 이 세션 내내 잡아 온 「있는 것이 안 닿음」을
 * 내가 그대로 만든 것이라 바로 배선한다.
 *
 * ## 화면이 지켜야 할 것
 *  · **복구 코드는 한 번만 보인다** — 그 사실을 크게 말하고, 복사 수단을 준다
 *  · **2FA 를 켰는데 복구 코드가 0개면 경고**한다. 조용히 두면 잠기는 날이 온다
 *  · 세션 목록의 기기 정보는 **자기신고**다 — 「확실한 식별」로 보이게 쓰지 않는다
 *  · 「끊었다」의 한계(액세스 토큰 15분 잔여)를 숨기지 않는다
 */
import { useCallback, useEffect, useState } from 'react';
import { loc } from '@/lib/i18n/loc';

type SessionRow = {
  id: string; current: boolean; createdAt: number; lastUsedAt: number | null;
  userAgent: string | null; ip: string | null;
};

const CARD: React.CSSProperties = {
  background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.04)', marginTop: 24,
};
const BTN: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 8, border: 0, background: '#0b5cff', color: '#fff',
  fontWeight: 700, cursor: 'pointer', fontSize: 14,
};
const BTN_GHOST: React.CSSProperties = { ...BTN, background: '#fff', color: '#334155', border: '1px solid #cbd5e1' };
const INPUT: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, marginBottom: 10,
};

export default function AccountSecuritySection({ lang = 'ko' }: { lang?: string }) {
  const T = {
    title: loc(lang, { ko: '보안', en: 'Security', ja: 'セキュリティ', zh: '安全', es: 'Seguridad', ar: 'الأمان' }),
    pwTitle: loc(lang, { ko: '비밀번호 변경', en: 'Change password', ja: 'パスワード変更', zh: '修改密码', es: 'Cambiar contraseña', ar: 'تغيير كلمة المرور' }),
    pwCurrent: loc(lang, { ko: '현재 비밀번호', en: 'Current password', ja: '現在のパスワード', zh: '当前密码', es: 'Contraseña actual', ar: 'كلمة المرور الحالية' }),
    pwNew: loc(lang, { ko: '새 비밀번호 (8자 이상)', en: 'New password (8+ chars)', ja: '新しいパスワード(8文字以上)', zh: '新密码（至少 8 位）', es: 'Nueva contraseña (mín. 8)', ar: 'كلمة مرور جديدة (٨ أحرف فأكثر)' }),
    pwSubmit: loc(lang, { ko: '변경', en: 'Change', ja: '変更', zh: '修改', es: 'Cambiar', ar: 'تغيير' }),
    pwNote: loc(lang, {
      ko: '변경하면 다른 기기의 로그인이 모두 해제됩니다(현재 기기는 유지).',
      en: 'Changing it signs out every other device (this one stays).',
      ja: '変更すると他の端末のログインはすべて解除されます(この端末は維持)。',
      zh: '修改后将退出所有其他设备（当前设备保留）。',
      es: 'Al cambiarla se cierran las sesiones de los demás dispositivos (este se mantiene).',
      ar: 'عند التغيير تُنهى الجلسات على الأجهزة الأخرى (يبقى هذا الجهاز).',
    }),
    rcTitle: loc(lang, { ko: '2단계 인증 복구 코드', en: '2FA recovery codes', ja: '2段階認証の復旧コード', zh: '两步验证恢复码', es: 'Códigos de recuperación 2FA', ar: 'رموز استرداد المصادقة الثنائية' }),
    rcIssue: loc(lang, { ko: '복구 코드 발급', en: 'Generate codes', ja: '復旧コードを発行', zh: '生成恢复码', es: 'Generar códigos', ar: 'إصدار الرموز' }),
    rcOnce: loc(lang, {
      ko: '이 코드는 지금만 표시됩니다. 안전한 곳에 보관하세요. 각 코드는 한 번만 쓸 수 있습니다.',
      en: 'Shown only once. Store them safely — each code works one time.',
      ja: '今だけ表示されます。安全な場所に保管してください。各コードは1回のみ有効です。',
      zh: '仅此一次显示，请妥善保管。每个恢复码只能使用一次。',
      es: 'Solo se muestran ahora. Guárdelos en un lugar seguro: cada código sirve una vez.',
      ar: 'تظهر الآن فقط. احفظها في مكان آمن — كل رمز يُستخدم مرة واحدة.',
    }),
    rcCopy: loc(lang, { ko: '복사', en: 'Copy', ja: 'コピー', zh: '复制', es: 'Copiar', ar: 'نسخ' }),
    rcRemaining: (n: number) => loc(lang, {
      ko: `남은 코드 ${n}개`, en: `${n} codes left`, ja: `残り ${n} 個`,
      zh: `剩余 ${n} 个`, es: `Quedan ${n} códigos`, ar: `المتبقي ${n} رموز`,
    }),
    sessTitle: loc(lang, { ko: '로그인 세션', en: 'Sessions', ja: 'ログインセッション', zh: '登录会话', es: 'Sesiones', ar: 'الجلسات' }),
    sessRevoke: loc(lang, { ko: '해제', en: 'Revoke', ja: '解除', zh: '解除', es: 'Cerrar', ar: 'إنهاء' }),
    sessRevokeOthers: loc(lang, { ko: '다른 기기 모두 해제', en: 'Sign out all other devices', ja: '他の端末をすべて解除', zh: '退出所有其他设备', es: 'Cerrar los demás dispositivos', ar: 'إنهاء جلسات الأجهزة الأخرى' }),
    sessCurrent: loc(lang, { ko: '현재 기기', en: 'This device', ja: 'この端末', zh: '当前设备', es: 'Este dispositivo', ar: 'هذا الجهاز' }),
    sessSelfReported: loc(lang, {
      ko: '기기 정보는 브라우저가 스스로 알린 값이라 정확하지 않을 수 있습니다.',
      en: 'Device info is self-reported by the browser and may be inaccurate.',
      ja: '端末情報はブラウザの自己申告のため正確でない場合があります。',
      zh: '设备信息由浏览器自行上报，可能不准确。',
      es: 'La información del dispositivo la declara el propio navegador y puede no ser exacta.',
      ar: 'معلومات الجهاز يصرّح بها المتصفح نفسه وقد لا تكون دقيقة.',
    }),
    residual: loc(lang, {
      ko: '해제는 최대 15분 뒤부터 확실합니다(이미 발급된 접근 토큰의 잔여 수명).',
      en: 'Revocation is guaranteed after up to 15 minutes (residual access-token lifetime).',
      ja: '解除は最大15分後から確実です(発行済みアクセストークンの残存時間)。',
      zh: '解除最长在 15 分钟后完全生效（已签发访问令牌的剩余有效期）。',
      es: 'La revocación es efectiva como máximo en 15 minutos (vida residual del token de acceso).',
      ar: 'يصبح الإنهاء مؤكداً خلال 15 دقيقة كحد أقصى (العمر المتبقي لرمز الوصول).',
    }),
  };

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // ── 비밀번호 변경 ────────────────────────────────────────────────────────
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');

  const changePassword = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; note?: string };
      if (!r.ok || !j.ok) { setMsg({ kind: 'err', text: j.error ?? '변경에 실패했습니다.' }); return; }
      setCur(''); setNext('');
      setMsg({ kind: 'ok', text: j.note ?? '변경되었습니다.' });
      void loadSessions();
    } finally { setBusy(false); }
  };

  // ── 복구 코드 ────────────────────────────────────────────────────────────
  const [rc, setRc] = useState<{ twoFactorEnabled: boolean; remaining: number; warning?: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [rcPw, setRcPw] = useState('');

  const loadRecovery = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/recovery-codes', { credentials: 'include' });
      if (r.ok) setRc((await r.json()) as typeof rc);
    } catch { /* 조회 실패는 화면만 비운다 */ }
  }, []);

  const issueCodes = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/auth/recovery-codes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: rcPw }),
      });
      const j = (await r.json()) as { codes?: string[]; error?: string };
      if (!r.ok || !j.codes) { setMsg({ kind: 'err', text: j.error ?? '발급에 실패했습니다.' }); return; }
      setCodes(j.codes); setRcPw('');
      void loadRecovery();
    } finally { setBusy(false); }
  };

  // ── 세션 ────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/sessions', { credentials: 'include' });
      if (r.ok) setSessions(((await r.json()) as { sessions: SessionRow[] }).sessions);
    } catch { /* 조회 실패는 화면만 비운다 */ }
  }, []);

  const revoke = async (query: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/auth/sessions?${query}`, { method: 'DELETE', credentials: 'include' });
      const j = (await r.json()) as { ok?: boolean; error?: string; note?: string };
      if (!r.ok || !j.ok) { setMsg({ kind: 'err', text: j.error ?? '해제에 실패했습니다.' }); return; }
      setMsg({ kind: 'ok', text: j.note ?? T.residual });
      void loadSessions();
    } finally { setBusy(false); }
  };

  useEffect(() => { void loadRecovery(); void loadSessions(); }, [loadRecovery, loadSessions]);

  const fmt = (ts: number | null) => {
    if (!ts) return '—';
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts); }
    catch { return String(ts); }
  };

  return (
    <div style={CARD}>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 20px' }}>{T.title}</h2>

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14,
          background: msg.kind === 'ok' ? '#ecfdf5' : '#fef2f2',
          color: msg.kind === 'ok' ? '#065f46' : '#b91c1c',
        }}>{msg.text}</div>
      )}

      {/* 비밀번호 변경 */}
      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>{T.pwTitle}</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>{T.pwNote}</p>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={T.pwCurrent} style={INPUT} autoComplete="current-password" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={T.pwNew} style={INPUT} autoComplete="new-password" />
        <button onClick={changePassword} disabled={busy || !cur || next.length < 8} style={{ ...BTN, opacity: busy || !cur || next.length < 8 ? 0.5 : 1 }}>
          {T.pwSubmit}
        </button>
      </section>

      {/* 복구 코드 */}
      <section style={{ marginBottom: 28, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>{T.rcTitle}</h3>
        {rc && (
          <p style={{ fontSize: 13, color: rc.warning ? '#b45309' : '#64748b', margin: '0 0 12px' }}>
            {/* ⚠ 2FA 를 켰는데 코드가 0개면 **잠길 수 있는 상태**다 — 조용히 두지 않는다. */}
            {rc.warning ?? T.rcRemaining(rc.remaining)}
          </p>
        )}
        {codes ? (
          <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, padding: 16 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#b45309', fontWeight: 700 }}>{T.rcOnce}</p>
            <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {codes.join('\n')}
            </pre>
            <button
              onClick={() => { void navigator.clipboard?.writeText(codes.join('\n')); }}
              style={{ ...BTN_GHOST, marginTop: 12 }}
            >{T.rcCopy}</button>
          </div>
        ) : (
          <>
            <input type="password" value={rcPw} onChange={(e) => setRcPw(e.target.value)} placeholder={T.pwCurrent} style={INPUT} autoComplete="current-password" />
            <button onClick={issueCodes} disabled={busy || !rcPw} style={{ ...BTN, opacity: busy || !rcPw ? 0.5 : 1 }}>{T.rcIssue}</button>
          </>
        )}
      </section>

      {/* 세션 */}
      <section style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>{T.sessTitle}</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>{T.sessSelfReported}</p>
        {sessions?.map((s) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: s.current ? 700 : 500 }}>
                {s.current ? `✓ ${T.sessCurrent}` : (s.ip ?? '—')}
              </div>
              <div style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(s.userAgent ?? '—').slice(0, 80)} · {fmt(s.lastUsedAt ?? s.createdAt)}
              </div>
            </div>
            {!s.current && (
              <button onClick={() => revoke(`id=${encodeURIComponent(s.id)}`)} disabled={busy} style={BTN_GHOST}>{T.sessRevoke}</button>
            )}
          </div>
        ))}
        <button onClick={() => revoke('all=1')} disabled={busy} style={{ ...BTN_GHOST, marginTop: 14 }}>
          {T.sessRevokeOthers}
        </button>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>{T.residual}</p>
      </section>
    </div>
  );
}
