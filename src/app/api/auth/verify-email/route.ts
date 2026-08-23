import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimitAsync } from '@/lib/rate-limit';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { getTrustedClientIp } from '@/lib/client-ip';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_VERIFY_EMAIL_BODY_BYTES = 16 * 1024;

const schema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
  userId: z.string().min(1).max(128),
  lang: z.string().max(20).optional(),
});

const VERIFY_MESSAGES = {
  kr: { invalid: '올바른 6자리 코드를 입력하세요.', rate: '시도 횟수 초과. 15분 후 다시 시도하세요.', missing: '인증 코드를 찾을 수 없습니다. 재발송해 주세요.', expired: '인증 코드가 만료되었습니다. 재발송해 주세요.', mismatch: '인증 코드가 올바르지 않습니다.' },
  en: { invalid: 'Enter a valid 6-digit code.', rate: 'Too many attempts. Try again in 15 minutes.', missing: 'Verification code not found. Please request a new one.', expired: 'Verification code expired. Please request a new one.', mismatch: 'Incorrect verification code.' },
  ja: { invalid: '正しい6桁のコードを入力してください。', rate: '試行回数が多すぎます。15分後に再試行してください。', missing: '認証コードが見つかりません。再送信してください。', expired: '認証コードの有効期限が切れています。再送信してください。', mismatch: '認証コードが正しくありません。' },
  cn: { invalid: '请输入有效的 6 位验证码。', rate: '尝试次数过多，请在 15 分钟后重试。', missing: '找不到验证码，请重新发送。', expired: '验证码已过期，请重新发送。', mismatch: '验证码不正确。' },
  es: { invalid: 'Introduce un código válido de 6 dígitos.', rate: 'Demasiados intentos. Inténtalo de nuevo en 15 minutos.', missing: 'No se encontró el código. Solicita uno nuevo.', expired: 'El código ha caducado. Solicita uno nuevo.', mismatch: 'El código de verificación no es correcto.' },
  ar: { invalid: 'أدخل رمزاً صالحاً من 6 أرقام.', rate: 'محاولات كثيرة جداً. حاول مجدداً بعد 15 دقيقة.', missing: 'لم يتم العثور على الرمز. اطلب رمزاً جديداً.', expired: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.', mismatch: 'رمز التحقق غير صحيح.' },
} as const;

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);

  let body: unknown = {};
  try { body = await readBoundedJson(req, MAX_VERIFY_EMAIL_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
  const locale = resolveServerLocale(req, (body as { lang?: string }).lang);
  const messages = VERIFY_MESSAGES[locale.route];
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: messages.invalid }, { status: 400 });
  }
  const { code, userId } = parsed.data;

  // Rate limit: IP × userId 조합으로 브루트포스 차단 (5회/15분)
  if (!(await rateLimitAsync(`verify-email:${ip}:${userId}`, 5, 15 * 60_000)).allowed) {
    return NextResponse.json({ error: messages.rate }, { status: 429 });
  }

  const db = getDbAdapter();
  const entry = await db.queryOne<{ code: string; user_id: string; email: string; expires_at: number }>(
    'SELECT * FROM nf_verification_codes WHERE user_id = ?',
    userId,
  );

  if (!entry) {
    return NextResponse.json({ error: messages.missing }, { status: 404 });
  }

  if (Date.now() > entry.expires_at) {
    await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);
    return NextResponse.json({ error: messages.expired }, { status: 410 });
  }

  if (!timingSafeEqual(Buffer.from(entry.code), Buffer.from(code))) {
    return NextResponse.json({ error: messages.mismatch }, { status: 400 });
  }

  await db.execute('UPDATE nf_users SET email_verified = TRUE WHERE id = ?', userId);
  await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);

  try {
    await db.execute('DELETE FROM nf_verification_codes WHERE expires_at < ?', Date.now());
  } catch { /* 정리 실패는 무시 */ }

  return NextResponse.json({ verified: true });
}
