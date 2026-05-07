/**
 * Re-exports from the canonical sanitize module.
 * The maxLength param is preserved for call-site compatibility.
 */
export { sanitizeObject, escapeHtml } from '@/lib/sanitize';
export { sanitizeText as sanitizeTextBase } from '@/lib/sanitize';
import { sanitizeText as _sanitizeText } from '@/lib/sanitize';

export function sanitizeText(input: string, maxLength = 1000): string {
  return _sanitizeText(input).substring(0, maxLength);
}
