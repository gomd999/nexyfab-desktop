'use client';

import React, { useCallback, useRef, useState } from 'react';
import type { StepAnalysisStats } from '@/app/api/nexyfab/analyze-step/analyze-step-types';

// Re-export for consumers
export type { StepAnalysisStats };
export interface StepAnalysisResult extends StepAnalysisStats {
  dfmSuggestions: string[];
}

interface StepUploaderProps {
  onAnalysisComplete: (stats: StepAnalysisResult) => void;
  lang?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2) {
  return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
}

function isStepFile(file: File) {
  const name = file.name.toLowerCase();
  return ['.step', '.stp', '.iges', '.igs'].some(ext => name.endsWith(ext));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #21262d' }}>
      <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StepUploader({ onAnalysisComplete, lang = 'en' }: StepUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<StepAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const isKo = lang === 'ko';

  const T = {
    dropZone:    isKo ? 'STEP / STP / IGES 파일을 드래그하거나 클릭하여 선택' : 'Drag & drop a STEP / STP / IGES file, or click to browse',
    uploading:   isKo ? '분석 중...' : 'Analyzing...',
    cancel:      isKo ? '취소' : 'Cancel',
    applyDesign: isKo ? '설계에 적용' : 'Apply to Design',
    retry:       isKo ? '다시 시도' : 'Try Again',
    stats:       isKo ? '형상 분석 결과' : 'Shape Analysis',
    dfm:         isKo ? 'DFM 제안' : 'DFM Suggestions',
    faces:       isKo ? '면(삼각형) 수' : 'Faces (triangles)',
    edges:       isKo ? '엣지 수 (추정)' : 'Edges (est.)',
    shells:      isKo ? '셸 수' : 'Shell count',
    volume:      isKo ? '부피 (cm³)' : 'Volume (cm³)',
    surface:     isKo ? '표면적 (cm²)' : 'Surface area (cm²)',
    bbox:        isKo ? '경계 박스 (cm)' : 'Bounding box (cm)',
    solid:       isKo ? '솔리드' : 'Solid',
    manifold:    isKo ? '매니폴드' : 'Manifold',
    yes:         isKo ? '예' : 'Yes',
    no:          isKo ? '아니오' : 'No',
    errType:     isKo ? '지원하지 않는 파일 형식입니다 (.step .stp .iges .igs 허용)' : 'Unsupported file type (.step .stp .iges .igs allowed)',
    maxSize:     isKo ? '파일 크기 제한: 50 MB' : 'File size limit: 50 MB',
  };

  const analyze = useCallback((file: File) => {
    if (!isStepFile(file)) { setError(T.errType); return; }
    if (file.size > 50 * 1024 * 1024) { setError(T.maxSize); return; }

    setError(null);
    setResult(null);
    setFileName(file.name);
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 90));
      }
    };

    xhr.onload = () => {
      setUploadProgress(100);
      setIsUploading(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          const res: StepAnalysisResult = { ...data.stats, dfmSuggestions: data.dfmSuggestions ?? [] };
          setResult(res);
        } else {
          setError(data.error ?? 'Analysis failed');
        }
      } catch {
        setError('Invalid server response');
      }
    };

    xhr.onerror = () => { setIsUploading(false); setError('Network error'); };
    xhr.onabort = () => { setIsUploading(false); setUploadProgress(0); };

    xhr.open('POST', '/api/nexyfab/analyze-step');
    xhr.send(formData);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKo]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) analyze(file);
  }, [analyze]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyze(file);
    e.target.value = '';
  }, [analyze]);

  const handleCancel = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setFileName(null);
    setUploadProgress(0);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #21262d',
      borderRadius: 12,
      padding: 20,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#e6edf3',
      maxWidth: 480,
    }}>

      {/* Drop zone */}
      {!isUploading && !result && (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? '#388bfd' : '#30363d'}`,
            borderRadius: 10,
            padding: '36px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: isDragging ? 'rgba(56,139,253,0.06)' : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          {/* Icon */}
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none"
            style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="14 2 14 8 20 8"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="18" x2="12" y2="12"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" />
            <polyline points="9 15 12 12 15 15"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p style={{ fontSize: 13, color: '#8b949e', margin: 0, lineHeight: 1.6 }}>{T.dropZone}</p>
          {fileName && (
            <p style={{ fontSize: 11, color: '#484f58', marginTop: 8 }}>{fileName}</p>
          )}
          <input ref={inputRef} type="file" accept=".step,.stp,.iges,.igs"
            style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      )}

      {/* Progress bar */}
      {isUploading && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: '#8b949e' }}>{T.uploading}</span>
            <span style={{ fontSize: 12, color: '#484f58', fontVariantNumeric: 'tabular-nums' }}>{uploadProgress}%</span>
          </div>
          <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${uploadProgress}%`,
              background: 'linear-gradient(90deg, #388bfd, #58a6ff)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {fileName && (
            <p style={{ fontSize: 11, color: '#484f58', marginTop: 8 }}>{fileName}</p>
          )}
          <button onClick={handleCancel} style={{
            marginTop: 12, padding: '5px 14px', borderRadius: 6,
            border: '1px solid #30363d', background: 'transparent',
            color: '#8b949e', fontSize: 12, cursor: 'pointer',
          }}>
            {T.cancel}
          </button>
        </div>
      )}

      {/* Error */}
      {error && !isUploading && (
        <div>
          <div style={{
            background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: '#f85149' }}>{error}</span>
          </div>
          <button onClick={handleReset} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid #30363d',
            background: '#21262d', color: '#c9d1d9', fontSize: 12, cursor: 'pointer',
          }}>
            {T.retry}
          </button>
        </div>
      )}

      {/* Results */}
      {result && !isUploading && (
        <div>
          {/* Stats header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#58a6ff' }}>{T.stats}</h4>
            <button onClick={handleReset} style={{
              padding: '3px 10px', borderRadius: 5, border: '1px solid #30363d',
              background: 'transparent', color: '#8b949e', fontSize: 11, cursor: 'pointer',
            }}>
              {T.retry}
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <StatRow label={T.faces}    value={result.faceCount.toLocaleString()} />
            <StatRow label={T.edges}    value={result.edgeCount.toLocaleString()} />
            <StatRow label={T.shells}   value={result.shellCount.toString()} />
            <StatRow label={T.volume}   value={fmt(result.volume_cm3)} />
            <StatRow label={T.surface}  value={fmt(result.surfaceArea_cm2)} />
            <StatRow label={T.bbox}     value={`${fmt(result.bbox.w, 1)} × ${fmt(result.bbox.h, 1)} × ${fmt(result.bbox.d, 1)}`} />
            <StatRow label={T.solid}    value={result.isSolid   ? T.yes : T.no} />
            <StatRow label={T.manifold} value={result.isManifold ? T.yes : T.no} />
          </div>

          {/* DFM suggestions */}
          {result.dfmSuggestions.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#e3b341', marginBottom: 6 }}>{T.dfm}</p>
              <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                {result.dfmSuggestions.map((s, i) => (
                  <li key={i} style={{
                    fontSize: 11, color: '#8b949e', lineHeight: 1.6,
                    marginBottom: 4, listStyle: 'disc',
                  }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={() => onAnalysisComplete(result)}
            style={{
              marginTop: 18, width: '100%',
              padding: '9px 0', borderRadius: 8,
              border: 'none', background: '#388bfd',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#58a6ff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#388bfd'; }}
          >
            {T.applyDesign}
          </button>
        </div>
      )}
    </div>
  );
}
