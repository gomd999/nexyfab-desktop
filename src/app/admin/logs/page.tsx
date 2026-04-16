'use client';

import { useState, useEffect, useCallback } from 'react';

interface ErrorLog {
  id: string;
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  url?: string;
  userId?: string;
  [key: string]: unknown;
}

const LEVEL_COLORS: Record<string, string> = {
  error: '#dc2626',
  warn: '#d97706',
  info: '#2563eb',
};

const LEVEL_ICONS: Record<string, string> = {
  error: '🔴',
  warn: '🟡',
  info: '🔵',
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs((data.logs || []).slice().reverse()); // 최신순
      }
    } catch {
      // 에러 무시
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const handleClear = async () => {
    if (!confirm('모든 로그를 삭제하시겠습니까?')) return;
    await fetch('/api/admin/logs', { method: 'DELETE' });
    setLogs([]);
  };

  const handleExportCSV = () => {
    const header = 'id,timestamp,level,message,url,userId\n';
    const rows = filtered.map(l =>
      [l.id, l.timestamp, l.level, `"${(l.message || '').replace(/"/g, '""')}"`, l.url || '', l.userId || ''].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = {
    all: logs.length,
    error: logs.filter(l => l.level === 'error').length,
    warn: logs.filter(l => l.level === 'warn').length,
    info: logs.filter(l => l.level === 'info').length,
  };

  return (
    <div style={{ maxWidth: '1000px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111' }}>에러 로그</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={fetchLogs}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            새로고침
          </button>
          <button
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: filtered.length === 0 ? 0.5 : 1 }}
          >
            CSV 내보내기
          </button>
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: logs.length === 0 ? 0.5 : 1 }}
          >
            로그 지우기
          </button>
        </div>
      </div>

      {/* 필터 탭 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['all', 'error', 'warn', 'info'] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            style={{
              padding: '5px 14px',
              borderRadius: '20px',
              border: '1px solid',
              borderColor: filter === level ? '#1d4ed8' : '#d1d5db',
              background: filter === level ? '#1d4ed8' : '#fff',
              color: filter === level ? '#fff' : '#374151',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            {level === 'all' ? '전체' : level} ({counts[level]})
          </button>
        ))}
      </div>

      {/* 로그 목록 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280', border: '1px dashed #d1d5db', borderRadius: '8px' }}>
          로그가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(log => (
            <div
              key={log.id}
              style={{
                border: '1px solid',
                borderColor: LEVEL_COLORS[log.level] + '40',
                borderRadius: '8px',
                padding: '12px 16px',
                background: '#fff',
                cursor: log.stack ? 'pointer' : 'default',
              }}
              onClick={() => log.stack && setExpandedId(expandedId === log.id ? null : log.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                  <span>{LEVEL_ICONS[log.level]}</span>
                  <span style={{ fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toLocaleString('ko-KR')}
                  </span>
                  {log.url && (
                    <span style={{ fontSize: '11px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.url}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '11px', color: LEVEL_COLORS[log.level], fontWeight: 700, background: LEVEL_COLORS[log.level] + '18', padding: '2px 8px', borderRadius: '10px' }}>
                  {log.level.toUpperCase()}
                </span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '14px', color: '#111', fontWeight: 600 }}>{log.message}</div>
              {log.userId && (
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#6b7280' }}>사용자: {log.userId}</div>
              )}
              {expandedId === log.id && log.stack && (
                <pre style={{
                  marginTop: '10px', padding: '10px', background: '#1f2937', color: '#f9fafb',
                  borderRadius: '6px', fontSize: '11px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {log.stack}
                </pre>
              )}
              {log.stack && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#9ca3af' }}>
                  {expandedId === log.id ? '▲ 스택 트레이스 접기' : '▼ 스택 트레이스 펼치기'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
