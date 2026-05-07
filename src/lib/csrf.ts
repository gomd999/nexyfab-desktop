// SameSite cookie 기반 간단 CSRF 체크
// Next.js API routes는 기본적으로 same-origin이지만 Origin 헤더 체크 추가
//
// ALLOWED_ORIGINS 가 비어 있으면 NEXT_PUBLIC_SITE_URL 의 origin 을 허용 목록에 포함.

function loadAllowedOrigins(): string[] {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) return [];
  try {
    return [new URL(site).origin];
  } catch {
    return [];
  }
}

const ALLOWED_ORIGINS = loadAllowedOrigins();

// localhost ports always allowed for development convenience
const DEV_ALLOWED_HOSTS = ['localhost:3000', 'localhost:3001'];

export function checkOrigin(req: Request): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false;
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin) return true; // server-to-server
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return true;
    if (DEV_ALLOWED_HOSTS.includes(originHost)) return true;
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes(originHost)) return true;
    return false;
  } catch { return false; }
}
