interface RecaptchaResponse {
  success?: boolean;
  score?: number;
  action?: string;
  hostname?: string;
}

export async function verifyRecaptchaV3(
  token: string,
  options: { action: string; remoteIp?: string },
): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
  if (!secret || !token || token.length > 4096) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (options.remoteIp) params.set('remoteip', options.remoteIp);
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const result = await response.json() as RecaptchaResponse;
    if (!result.success || result.action !== options.action) return false;

    const minScore = Number(process.env.RECAPTCHA_MIN_SCORE ?? '0.5');
    if (typeof result.score === 'number' && result.score < (Number.isFinite(minScore) ? minScore : 0.5)) {
      return false;
    }
    const allowedHosts = (process.env.RECAPTCHA_ALLOWED_HOSTNAMES ?? '')
      .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    return allowedHosts.length === 0 || (!!result.hostname && allowedHosts.includes(result.hostname.toLowerCase()));
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
