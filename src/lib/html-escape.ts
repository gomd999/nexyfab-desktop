/**
 * HTML escape helpers for outbound email content.
 *
 * User-controlled strings (company names, project names, partner emails,
 * notes) get interpolated into email HTML templates. Without escaping, a
 * malicious user could include `<script>` or HTML attributes that some
 * email clients will render — pre-launch the dispute reason, partner
 * company name, and project name fields are all attacker-reachable.
 *
 * Use:
 *   import { esc } from '@/lib/html-escape';
 *   `<p>Hello ${esc(name)}!</p>`
 *
 * Don't escape strings you fully control (status labels, IDs we generated).
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s.replace(/[&<>"'/]/g, ch => HTML_ESCAPE_MAP[ch] ?? ch);
}

/**
 * Escape a URL for use in an `href` attribute. Strips obviously dangerous
 * schemes (javascript:, data:) and HTML-escapes the result.
 */
export function escUrl(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '#';
  }
  return esc(s);
}
