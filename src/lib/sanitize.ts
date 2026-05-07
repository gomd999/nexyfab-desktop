/**
 * XSS sanitization for user-supplied text stored in DB.
 * Uses a simple allowlist approach — no HTML allowed in structured data fields.
 */

// Characters/patterns that indicate potential XSS
const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /<iframe[\s\S]*?>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,          // onclick=, onerror=, etc.
  /<\s*\/?\s*(script|iframe|object|embed|form|input|button|link|meta|style)/gi,
  /data:text\/html/gi,
  /vbscript:/gi,
];

/**
 * Dangerous codepoints whose entity-encoded forms should be decoded before
 * XSS pattern removal.
 * Matches both named and numeric (decimal + hex, upper and lower, leading-zero) variants.
 *   < (&lt;  &#60;  &#060;  &#x3C;  &#x03c;  &#X3C; …)
 *   > (&gt;  &#62;  &#x3E; …)
 *   " (&quot; &#34; &#x22; …)
 *   ' (&apos; &#39; &#x27; …)
 */
function decodeDangerousEntities(text: string): string {
  // Named entities
  text = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");

  // Decimal numeric entities: &#60; &#62; &#34; &#39; (with optional leading zeros)
  text = text
    .replace(/&#0*60;/gi, '<')
    .replace(/&#0*62;/gi, '>')
    .replace(/&#0*34;/gi, '"')
    .replace(/&#0*39;/gi, "'");

  // Hex numeric entities: &#x3C; &#x3E; &#x22; &#x27; (upper/lowercase X, leading zeros)
  text = text
    .replace(/&#[xX]0*3[cC];/gi, '<')
    .replace(/&#[xX]0*3[eE];/gi, '>')
    .replace(/&#[xX]0*22;/gi, '"')
    .replace(/&#[xX]0*27;/gi, "'");

  return text;
}

/**
 * Strips HTML tags and XSS patterns from a string.
 * Use for: projectName, factoryName, userName, notes, etc.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';

  let text = input.trim();

  // Decode entity-encoded dangerous chars before pattern removal so that
  // "&lt;script&gt;" is treated like a real script tag.
  text = decodeDangerousEntities(text);

  // Remove XSS patterns (now operating on decoded/stripped text)
  for (const pattern of XSS_PATTERNS) {
    text = text.replace(pattern, '');
  }

  // Strip any remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  return text;
}

/**
 * Sanitize an object's string fields.
 * Only processes string values, leaves others unchanged.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      result[key] = sanitizeText(result[key] as string);
    }
  }
  return result as T;
}

/**
 * Escape HTML for safe rendering in email templates.
 * Use when embedding user data in HTML emails.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
