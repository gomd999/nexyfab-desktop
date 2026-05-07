'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Session timelapse recorder — captures a viewport thumbnail on a fixed interval
 * (or on demand) and plays them back as a scrubbable slideshow.
 *
 * The recorder does not persist across reloads by design — it's a lightweight
 * session-level feature. To persist, the caller can download the frames as
 * a ZIP / GIF-like sequence.
 */

export interface TimelapseFrame {
  id: string;
  dataUrl: string;       // PNG data URL
  ts: number;
  label?: string;
}

export interface SessionTimelapseProps {
  lang: string;
  /** Capture a still of the current viewport. Returns a data URL or null. */
  captureFrame: () => string | null;
  onClose: () => void;
}

const T: Record<string, Record<string, string>> = {
  ko: {
    title: '세션 타임랩스', start: '녹화 시작', stop: '중지', capture: '수동 캡처',
    play: '재생', pause: '일시정지', clear: '초기화', exportZip: '모든 프레임 저장',
    empty: '프레임이 없습니다. "녹화 시작" 또는 "수동 캡처"를 누르세요.',
    interval: '간격 (초)', frame: '프레임',
  },
  en: {
    title: 'Session Timelapse', start: 'Start Recording', stop: 'Stop', capture: 'Capture Now',
    play: 'Play', pause: 'Pause', clear: 'Clear', exportZip: 'Download All Frames',
    empty: 'No frames yet. Click "Start Recording" or "Capture Now".',
    interval: 'Interval (s)', frame: 'Frame',
  },
  ja: {
    title: 'セッションタイムラプス', start: '録画開始', stop: '停止', capture: '今すぐキャプチャ',
    play: '再生', pause: '一時停止', clear: 'クリア', exportZip: '全フレームをダウンロード',
    empty: 'フレームがありません。"録画開始" または "今すぐキャプチャ" をクリックしてください。',
    interval: '間隔 (秒)', frame: 'フレーム',
  },
  cn: {
    title: '会话延时录像', start: '开始录制', stop: '停止', capture: '立即捕获',
    play: '播放', pause: '暂停', clear: '清空', exportZip: '下载所有帧',
    empty: '暂无帧。点击"开始录制"或"立即捕获"。',
    interval: '间隔 (秒)', frame: '帧',
  },
  es: {
    title: 'Timelapse de Sesión', start: 'Iniciar Grabación', stop: 'Detener', capture: 'Capturar Ahora',
    play: 'Reproducir', pause: 'Pausar', clear: 'Limpiar', exportZip: 'Descargar Todos los Frames',
    empty: 'Sin frames aún. Haz clic en "Iniciar Grabación" o "Capturar Ahora".',
    interval: 'Intervalo (s)', frame: 'Frame',
  },
  ar: {
    title: 'تسجيل الجلسة بالفاصل الزمني', start: 'بدء التسجيل', stop: 'إيقاف', capture: 'التقط الآن',
    play: 'تشغيل', pause: 'إيقاف مؤقت', clear: 'مسح', exportZip: 'تنزيل جميع الإطارات',
    empty: 'لا توجد إطارات. انقر على "بدء التسجيل" أو "التقط الآن".',
    interval: 'الفاصل (ث)', frame: 'إطار',
  },
};

export default function SessionTimelapse({ lang, captureFrame, onClose }: SessionTimelapseProps) {
  const t = T[lang] ?? T.en;
  const [frames, setFrames] = useState<TimelapseFrame[]>([]);
  const [recording, setRecording] = useState(false);
  const [interval, setIntervalSec] = useState(15);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addFrame = useCallback((label?: string) => {
    const data = captureFrame();
    if (!data) return;
    setFrames(prev => [...prev, {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      dataUrl: data,
      ts: Date.now(),
      label,
    }]);
  }, [captureFrame]);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => addFrame(), Math.max(3, interval) * 1000);
      // capture an immediate baseline
      addFrame('start');
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording, interval, addFrame]);

  useEffect(() => {
    if (playing && frames.length > 1) {
      playTimerRef.current = setInterval(() => {
        setCurrentIndex(i => (i + 1) % frames.length);
      }, 400);
    } else if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [playing, frames.length]);

  const handleClear = useCallback(() => {
    setFrames([]);
    setCurrentIndex(0);
    setPlaying(false);
  }, []);

  const handleExport = useCallback(() => {
    if (frames.length === 0) return;
    // Simple download: one PNG per frame
    frames.forEach((f, i) => {
      const a = document.createElement('a');
      a.href = f.dataUrl;
      a.download = `timelapse-${String(i + 1).padStart(3, '0')}.png`;
      a.click();
    });
  }, [frames]);

  const currentFrame = frames[currentIndex];

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: 20, width: 460, maxHeight: '80vh',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex',
      flexDirection: 'column', color: '#c9d1d9', fontSize: 13,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>🎬 {t.title} ({frames.length})</strong>
        <button onClick={onClose} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: 10, borderBottom: '1px solid #30363d', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setRecording(v => !v)}
          style={{ background: recording ? '#da3633' : '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
          {recording ? `⏹ ${t.stop}` : `⏺ ${t.start}`}
        </button>
        <button onClick={() => addFrame('manual')}
          style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
          📸 {t.capture}
        </button>
        <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {t.interval}:
          <input type="number" min={3} max={120} value={interval} onChange={e => setIntervalSec(parseInt(e.target.value) || 15)}
            style={{ width: 48, background: '#161b22', border: '1px solid #30363d', borderRadius: 3, padding: '2px 4px', color: '#c9d1d9', fontSize: 11 }} />
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {frames.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6e7681', fontSize: 12 }}>{t.empty}</div>
        ) : (
          <>
            {currentFrame && (
              <div style={{ marginBottom: 8 }}>
                <img src={currentFrame.dataUrl} alt={`Frame ${currentIndex + 1}`}
                  style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 4, background: '#000' }} />
                <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t.frame} {currentIndex + 1} / {frames.length}</span>
                  <span>{new Date(currentFrame.ts).toLocaleTimeString()}</span>
                </div>
              </div>
            )}

            <input type="range" min={0} max={frames.length - 1} value={currentIndex}
              onChange={e => setCurrentIndex(parseInt(e.target.value))}
              style={{ width: '100%', marginBottom: 8 }} />

            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button onClick={() => setPlaying(v => !v)} disabled={frames.length < 2}
                style={{ background: playing ? '#da3633' : '#1f6feb', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12, opacity: frames.length < 2 ? 0.5 : 1 }}>
                {playing ? `⏸ ${t.pause}` : `▶ ${t.play}`}
              </button>
              <button onClick={handleExport}
                style={{ background: 'transparent', color: '#58a6ff', border: '1px solid #30363d', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                📥 {t.exportZip}
              </button>
              <button onClick={handleClear}
                style={{ background: 'transparent', color: '#f85149', border: '1px solid #f85149', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
                🗑 {t.clear}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
              {frames.map((f, i) => (
                <img key={f.id} src={f.dataUrl} alt={`F${i + 1}`}
                  onClick={() => setCurrentIndex(i)}
                  style={{
                    width: 56, height: 40, objectFit: 'cover', borderRadius: 2, cursor: 'pointer',
                    border: i === currentIndex ? '2px solid #58a6ff' : '1px solid #30363d',
                    flexShrink: 0, background: '#000',
                  }} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
