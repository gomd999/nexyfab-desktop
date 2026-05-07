// ─── Share Link: encode/decode shape configurations as shareable URLs ──────────

export interface SharePayload {
  shape: string;
  params: Record<string, number>;
  material: string;
  color: string;
}

/** Encodes a shape configuration into a full shareable URL. */
export function encodeShareLink(
  shape: string,
  params: Record<string, number>,
  material: string,
  color: string,
  lang: string,
): string {
  const payload = { s: shape, p: params, m: material, c: color };
  const json = JSON.stringify(payload);
  const base64 = btoa(unescape(encodeURIComponent(json)));

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://nexyfab.com';

  return `${origin}/${lang}/shape-generator?share=${base64}`;
}

/** Decodes a share URL (or raw base64) back to a SharePayload. Returns null on any error. */
export function decodeShareLink(urlOrBase64: string): SharePayload | null {
  try {
    let base64 = urlOrBase64;

    // If it looks like a full URL, extract the `share` query param
    if (urlOrBase64.includes('?') || urlOrBase64.startsWith('http')) {
      const url = new URL(urlOrBase64);
      const share = url.searchParams.get('share');
      if (!share) return null;
      base64 = share;
    }

    const json = decodeURIComponent(escape(atob(base64)));
    const raw = JSON.parse(json) as { s?: unknown; p?: unknown; m?: unknown; c?: unknown };

    if (
      typeof raw.s !== 'string' ||
      typeof raw.p !== 'object' || raw.p === null ||
      typeof raw.m !== 'string' ||
      typeof raw.c !== 'string'
    ) {
      return null;
    }

    // Validate that all param values are numbers
    const p = raw.p as Record<string, unknown>;
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== 'number') return null;
      params[k] = v;
    }

    return { shape: raw.s, params, material: raw.m, color: raw.c };
  } catch {
    return null;
  }
}

/** Copies text to the clipboard. */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for environments without Clipboard API
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}
