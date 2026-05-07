/**
 * 로그인 보안 모듈
 * - 로그인 이력 기록
 * - IP 기반 이상 탐지 (국가 변경, 빈번한 IP 변경, 동시 다지역 접속)
 * - 보안 알림 생성 + 이메일 발송
 * - 위험 수준에 따라 자동 계정 잠금
 */

import { getDbAdapter } from './db-adapter';
import { sendEmail } from './nexyfab-email';
import { escapeHtml } from './sanitize';

// ── IP → 국가 매핑 (간이 GeoIP) ──────────────────────────────────────────────
// 실제 프로덕션에서는 MaxMind GeoLite2 등으로 교체 가능
// 현재는 잘 알려진 대역으로 간이 판별 + 헤더 기반 감지

function detectCountryFromHeaders(headers: Headers): string | null {
  // Cloudflare
  const cfCountry = headers.get('cf-ipcountry');
  if (cfCountry && cfCountry !== 'XX') return cfCountry.toUpperCase();
  // Vercel
  const vercelCountry = headers.get('x-vercel-ip-country');
  if (vercelCountry) return vercelCountry.toUpperCase();
  // Railway / generic
  const geoCountry = headers.get('x-geo-country');
  if (geoCountry) return geoCountry.toUpperCase();
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'normal' | 'suspicious' | 'critical';

interface LoginRecord {
  userId: string;
  ip: string;
  country: string | null;
  userAgent: string | null;
  method: string; // email, google, kakao, naver
  success: boolean;
}

interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

// ── 보안 이메일 템플릿 ─────────────────────────────────────────────────────

function securityAlertHtml(userName: string, alertType: string, details: string, ip: string, time: string): string {
  const safeName = escapeHtml(userName);
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#161b22;">
  <div style="background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #f85149;">
    <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#f85149;letter-spacing:-0.5px;">NexyFab 보안 알림</h1>
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#e6edf3;">${escapeHtml(alertType)}</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요 <strong style="color:#e6edf3;">${safeName}</strong>님,<br>
      회원님의 계정에서 비정상적인 활동이 감지되었습니다.
    </p>
    <div style="background:#161b22;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #30363d;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">상세</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${escapeHtml(details)}</td></tr>
        <tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">IP 주소</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;font-family:monospace;">${escapeHtml(ip)}</td></tr>
        <tr><td style="padding:6px 0;color:#8b949e;font-size:13px;">시간</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#e6edf3;">${escapeHtml(time)}</td></tr>
      </table>
    </div>
    <p style="color:#f0883e;font-size:14px;font-weight:600;margin:0 0 16px;">
      본인이 아니라면 즉시 비밀번호를 변경하고 2FA를 활성화해 주세요.
    </p>
    <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com'}/ko/nexyfab/settings/security"
       style="display:inline-block;padding:12px 24px;background:#f85149;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      보안 설정 확인
    </a>
    <hr style="border:none;border-top:1px solid #21262d;margin:32px 0 16px;">
    <p style="color:#6e7681;font-size:11px;margin:0;line-height:1.6;">
      NexyFab &middot; <a href="https://nexyfab.com" style="color:#6e7681;">nexyfab.com</a>
    </p>
  </div>
</body>
</html>`;
}

function securityAlertAdminHtml(userName: string, userEmail: string, alertType: string, details: string, ip: string, severity: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:16px;background:#161b22;">
  <div style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #f85149;">
    <h1 style="margin:0 0 16px;font-size:20px;color:#f85149;">관리자 보안 알림 [${escapeHtml(severity.toUpperCase())}]</h1>
    <p style="color:#8b949e;font-size:14px;margin:0 0 16px;">
      <strong style="color:#e6edf3;">${escapeHtml(userName)}</strong> (${escapeHtml(userEmail)})
    </p>
    <p style="color:#e6edf3;font-size:14px;margin:0 0 8px;"><strong>${escapeHtml(alertType)}</strong></p>
    <p style="color:#8b949e;font-size:13px;margin:0 0 8px;">${escapeHtml(details)}</p>
    <p style="color:#8b949e;font-size:13px;margin:0;">IP: <code style="color:#e6edf3;">${escapeHtml(ip)}</code></p>
  </div>
</body>
</html>`;
}

// ── 위험 평가 ──────────────────────────────────────────────────────────────

async function assessRisk(record: LoginRecord): Promise<RiskAssessment> {
  const db = getDbAdapter();
  const reasons: string[] = [];
  let level: RiskLevel = 'normal';

  try {
    const now = Date.now();
    const ONE_HOUR = 3600_000;
    const ONE_DAY = 24 * ONE_HOUR;

    // 1. 최근 1시간 내 다른 IP에서 로그인 횟수
    const recentLogins = await db.queryAll<{ ip: string; country: string | null }>(
      `SELECT DISTINCT ip, country FROM nf_login_history
       WHERE user_id = ? AND success = 1 AND created_at > ?
       ORDER BY created_at DESC`,
      record.userId, now - ONE_HOUR,
    );
    const uniqueIPs = new Set(recentLogins.map(r => r.ip));
    if (record.ip) uniqueIPs.add(record.ip);

    if (uniqueIPs.size >= 5) {
      reasons.push(`1시간 내 ${uniqueIPs.size}개 서로 다른 IP에서 로그인`);
      level = 'critical';
    } else if (uniqueIPs.size >= 3) {
      reasons.push(`1시간 내 ${uniqueIPs.size}개 서로 다른 IP에서 로그인`);
      level = 'suspicious';
    }

    // 2. 국가 변경 감지
    if (record.country) {
      const lastLogin = await db.queryOne<{ country: string; ip: string; created_at: number }>(
        `SELECT country, ip, created_at FROM nf_login_history
         WHERE user_id = ? AND success = 1 AND country IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        record.userId,
      );
      if (lastLogin?.country && lastLogin.country !== record.country) {
        const gap = now - lastLogin.created_at;

        if (gap < ONE_HOUR) {
          // 1시간 내 다른 국가 → 물리적으로 불가능
          reasons.push(`1시간 내 국가 변경: ${lastLogin.country} → ${record.country}`);
          level = 'critical';
        } else if (gap < ONE_DAY) {
          reasons.push(`24시간 내 국가 변경: ${lastLogin.country} → ${record.country}`);
          if (level !== 'critical') level = 'suspicious';
        }
      }
    }

    // 3. 최근 24시간 실패한 로그인 시도
    const failCount = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM nf_login_history
       WHERE user_id = ? AND success = 0 AND created_at > ?`,
      record.userId, now - ONE_DAY,
    );
    if ((failCount?.cnt ?? 0) >= 10) {
      reasons.push(`24시간 내 ${failCount!.cnt}회 로그인 실패`);
      if (level !== 'critical') level = 'suspicious';
    }

    // 4. 최근 7일간 고유 IP 수 (브루트포스 감지)
    const weekIPs = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(DISTINCT ip) AS cnt FROM nf_login_history
       WHERE user_id = ? AND created_at > ?`,
      record.userId, now - 7 * ONE_DAY,
    );
    if ((weekIPs?.cnt ?? 0) >= 20) {
      reasons.push(`7일간 ${weekIPs!.cnt}개 고유 IP 사용`);
      if (level !== 'critical') level = 'suspicious';
    }
  } catch (err) {
    console.error('[login-security] assessRisk failed:', err);
    // 분석 실패 시 로그인은 허용 (보안 모듈이 로그인을 막으면 안 됨)
  }

  return { level, reasons };
}

// ── 메인 함수: 로그인 후 호출 ──────────────────────────────────────────────

export async function recordLoginAndCheck(
  record: LoginRecord,
  headers: Headers,
): Promise<{ blocked: boolean; risk: RiskAssessment }> {
  try {
    const db = getDbAdapter();
    const now = Date.now();

    // 헤더에서 국가 감지 (CDN 제공)
    if (!record.country) {
      record.country = detectCountryFromHeaders(headers);
    }

    // 1. 로그인 이력 기록
    const risk = await assessRisk(record);

    await db.execute(
      `INSERT INTO nf_login_history (id, user_id, ip, country, user_agent, method, success, risk_level, risk_reason, service, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `lh-${crypto.randomUUID()}`,
      record.userId,
      record.ip,
      record.country,
      record.userAgent?.slice(0, 500) ?? null,
      record.method,
      record.success ? 1 : 0,
      risk.level,
      risk.reasons.length > 0 ? risk.reasons.join('; ') : null,
      'nexyfab',
      now,
    );

    // 2. 위험 수준에 따른 처리
    if (risk.level === 'normal') {
      return { blocked: false, risk };
    }

    // 보안 알림 생성
    const alertType = risk.level === 'critical' ? '긴급 보안 경고' : '보안 주의';
    const details = risk.reasons.join(', ');

    await db.execute(
      `INSERT INTO nf_security_alerts (id, user_id, alert_type, severity, details, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      `sa-${crypto.randomUUID()}`,
      record.userId,
      alertType,
      risk.level,
      details,
      now,
    );

    // 사용자 이메일 조회
    const user = await db.queryOne<{ email: string; name: string }>(
      'SELECT email, name FROM nf_users WHERE id = ?',
      record.userId,
    );

    if (user) {
      const timeStr = new Date(now).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      // 사용자에게 보안 알림 이메일 (fire-and-forget, 실패해도 로그)
      sendEmail(
        user.email,
        `[NexyFab] ${alertType} — 비정상 로그인 감지`,
        securityAlertHtml(user.name, alertType, details, record.ip, timeStr),
      ).catch(err => console.error('[login-security] 보안 이메일 발송 실패:', err));

      // 관리자에게도 알림 (critical만)
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail && risk.level === 'critical') {
        sendEmail(
          adminEmail,
          `[NexyFab 관리자] 보안 경고 — ${user.email}`,
          securityAlertAdminHtml(user.name, user.email, alertType, details, record.ip, risk.level),
        ).catch(err => console.error('[login-security] 관리자 이메일 발송 실패:', err));
      }
    }

    // 3. critical이면 계정 자동 잠금 (24시간)
    if (risk.level === 'critical') {
      await db.execute(
        'UPDATE nf_users SET locked_until = ?, failed_login_attempts = 999 WHERE id = ?',
        now + 24 * 3600_000, record.userId,
      );
      return { blocked: true, risk };
    }

    return { blocked: false, risk };
  } catch (err) {
    // 보안 모듈 오류가 로그인을 차단하면 안 됨
    console.error('[login-security] recordLoginAndCheck failed:', err);
    return { blocked: false, risk: { level: 'normal', reasons: [] } };
  }
}

// ── 오래된 이력 정리 (선택: cron에서 호출) ──────────────────────────────────

export async function cleanupOldLoginHistory(retentionDays = 90): Promise<void> {
  const db = getDbAdapter();
  const cutoff = Date.now() - retentionDays * 24 * 3600_000;
  await db.execute('DELETE FROM nf_login_history WHERE created_at < ?', cutoff);
  await db.execute('DELETE FROM nf_security_alerts WHERE resolved = 1 AND created_at < ?', cutoff);
}
