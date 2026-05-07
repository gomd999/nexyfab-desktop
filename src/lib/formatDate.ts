/**
 * 날짜 포맷 유틸리티
 * ISO 문자열 또는 Date → 사람이 읽기 좋은 한국어 날짜 문자열
 */

type DateInput = string | number | Date | null | undefined;

function toDate(v: DateInput): Date | null {
  if (v == null) return null;
  const d = new Date(v as string | number | Date);
  return isNaN(d.getTime()) ? null : d;
}

/** 2026. 04. 16. 형식 */
export function formatDate(v?: DateInput): string {
  const d = toDate(v);
  if (!d) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 2026. 04. 16. 14:30 형식 */
export function formatDateTime(v?: DateInput): string {
  const d = toDate(v);
  if (!d) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 오늘로부터 D±N 또는 "오늘", "지남" */
export function formatDday(iso?: string | Date | null): { label: string; color: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff === 0) return { label: 'D-Day', color: '#dc2626' };
  if (diff > 0) return { label: `D-${diff}`, color: diff <= 3 ? '#dc2626' : diff <= 7 ? '#d97706' : '#6b7280' };
  return { label: `D+${Math.abs(diff)} 지남`, color: '#9ca3af' };
}
