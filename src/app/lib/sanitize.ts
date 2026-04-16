/**
 * 텍스트 입력 sanitization — XSS 방지
 */
export function sanitizeText(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')  // script 태그 제거
    .replace(/<[^>]+>/g, '')                       // 나머지 HTML 태그 제거
    .trim()
    .substring(0, maxLength);
}
