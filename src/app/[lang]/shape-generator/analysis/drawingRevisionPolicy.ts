/**
 * 도면 표제란 리비전 — 상용 관례에 가깝게 단순 증가(A→B, AA→AB, 9→10).
 */
export function bumpDrawingRevision(current: string): string {
  const t = current.trim();
  if (!t) return 'A';
  if (/^\d+$/.test(t)) {
    return String(Number(t) + 1);
  }
  if (/^[a-zA-Z]$/.test(t)) {
    const c = t.toUpperCase();
    if (c === 'Z') return 'AA';
    return String.fromCharCode(c.charCodeAt(0) + 1);
  }
  const u = t.toUpperCase();
  if (/^[A-Z]+$/.test(u) && u.length >= 2) {
    const chars = [...u];
    let i = chars.length - 1;
    while (i >= 0) {
      const c = chars[i]!;
      if (c < 'Z') {
        chars[i] = String.fromCharCode(c.charCodeAt(0) + 1);
        return chars.join('');
      }
      chars[i] = 'A';
      i--;
    }
    return `A${chars.join('')}`;
  }
  return `${t}+`;
}
