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
 * Strips HTML tags and XSS patterns from a string.
 * Use for: projectName, factoryName, userName, notes, etc.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';

  let text = input.trim();

  // Remove XSS patterns
  for (const pattern of XSS_PATTERNS) {
    text = text.replace(pattern, '');
  }

  // Strip all HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Strip HTML entities that could encode dangerous characters (do NOT decode them)
  text = text
    .replace(/&lt;/gi, '')
    .replace(/&gt;/gi, '')
    .replace(/&#x3C;/gi, '')
    .replace(/&#60;/gi, '')
    .replace(/&#x3E;/gi, '')
    .replace(/&#62;/gi, '');

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
