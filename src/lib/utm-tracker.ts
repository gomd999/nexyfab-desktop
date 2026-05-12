/**
 * UTM tracker — capture marketing source on landing, persist across the
 * session so signup_complete (and any later funnel event) can attribute
 * back to the ad/campaign that brought the user in.
 *
 * Lifecycle:
 *   1. User lands with utm_source/medium/campaign in the URL.
 *      `captureUtmFromUrl()` saves the params to sessionStorage.
 *   2. Subsequent navigations within the SPA do not overwrite — first-touch
 *      attribution.
 *   3. Signup endpoint reads `getUtm()` and embeds the parsed UTM into the
 *      signup_complete funnel metadata so /admin/funnel can split by source.
 *
 * Why first-touch and not last-touch:
 *   - Most B2B SaaS attribution treats the originating ad as the credit;
 *     subsequent direct visits are not new acquisition events.
 */

const STORAGE_KEY = 'nexyfab.utm';

export interface UtmRecord {
  source?:   string;
  medium?:   string;
  campaign?: string;
  term?:     string;
  content?:  string;
  capturedAt?: number;
}

const ALLOWED_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

// Strip ASCII control chars (0x00..0x1F + 0x7F) and pad/oversize to keep stored
// values clean. Built via codepoint loop so no literal control-char regex
// appears in source — printable file, lint-friendly.
const CONTROL_CHAR_RE = (() => {
  const escaped: string[] = [];
  for (let c = 0; c < 32; c++) escaped.push('\\u' + c.toString(16).padStart(4, '0'));
  escaped.push('\\u007f');
  return new RegExp('[' + escaped.join('') + ']', 'g');
})();

function sanitize(v: string): string {
  return v.slice(0, 200).replace(CONTROL_CHAR_RE, '');
}

export function captureUtmFromUrl(href?: string): UtmRecord | null {
  const url = href ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (!url) return null;
  let params: URLSearchParams;
  try { params = new URL(url).searchParams; }
  catch { return null; }
  const found: UtmRecord = {};
  let any = false;
  for (const k of ALLOWED_KEYS) {
    const v = params.get('utm_' + k);
    if (v) { found[k] = sanitize(v); any = true; }
  }
  if (!any) return readStored();
  // First-touch: don't clobber existing record.
  const existing = readStored();
  if (existing) return existing;
  found.capturedAt = Date.now();
  writeStored(found);
  return found;
}

export function getUtm(): UtmRecord | null {
  return readStored();
}

export function clearUtm(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function readStored(): UtmRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UtmRecord;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeStored(rec: UtmRecord): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
}
