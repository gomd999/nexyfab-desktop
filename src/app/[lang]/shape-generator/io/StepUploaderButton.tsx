'use client';

import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import type { StepAnalysisResult } from './StepUploader';

interface StepUploaderButtonProps {
  onResult: (stats: StepAnalysisResult & { geometry?: THREE.BufferGeometry }) => void;
  lang?: string;
}

export default function StepUploaderButton({ onResult, lang = 'en' }: StepUploaderButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isKo = lang === 'ko';
  const label    = isKo ? 'STEP 파일 불러오기' : 'Import STEP File';
  const loading  = isKo ? 'STEP 파일 파싱 중…' : 'Parsing STEP file…';
  const errLabel = isKo ? '오류' : 'Error';

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const allowed = ['.step', '.stp', '.iges', '.igs'].some(ext => name.endsWith(ext));
    if (!allowed) {
      setError(isKo ? '지원하지 않는 파일 형식' : 'Unsupported file type');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(isKo ? '파일 크기 제한 50 MB' : 'File size limit: 50 MB');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const { importStepFile } = await import('./stepImporter');
      const result = await importStepFile(buffer);

      const stats: StepAnalysisResult & { geometry?: THREE.BufferGeometry } = {
        faceCount: result.faceCount,
        edgeCount: 0,
        shellCount: result.meshCount,
        volume_cm3: 0,
        surfaceArea_cm2: 0,
        bbox: {
          w: Math.round(((result.boundingBox.max.x - result.boundingBox.min.x) / 10) * 10) / 10,
          h: Math.round(((result.boundingBox.max.y - result.boundingBox.min.y) / 10) * 10) / 10,
          d: Math.round(((result.boundingBox.max.z - result.boundingBox.min.z) / 10) * 10) / 10,
        },
        isSolid: result.faceCount > 0,
        isManifold: true,
        dfmSuggestions: [],
        geometry: result.geometry,
      };

      onResult(stats);
    } catch (e) {
      setError(isKo ? `파싱 오류: ${String(e)}` : `Parse error: ${String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button
        disabled={isLoading}
        onClick={() => { if (!isLoading) inputRef.current?.click(); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 18px',
          borderRadius: 8,
          border: '1px solid #30363d',
          background: isLoading ? '#21262d' : '#161b22',
          color: isLoading ? '#484f58' : '#e6edf3',
          fontSize: 13,
          fontWeight: 600,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
        onMouseEnter={e => {
          if (!isLoading) (e.currentTarget as HTMLButtonElement).style.borderColor = '#388bfd';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d';
        }}
      >
        {/* File icon */}
        {!isLoading ? (
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="14 2 14 8 20 8"
              stroke="#58a6ff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          /* Spinner */
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
            style={{ animation: 'spin 0.8s linear infinite' }}>
            <circle cx={12} cy={12} r={9} stroke="#484f58" strokeWidth={2} />
            <path d="M12 3a9 9 0 019 9" stroke="#388bfd" strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
        {isLoading ? loading : label}
      </button>

      {error && (
        <span style={{ fontSize: 11, color: '#f85149' }}>
          {errLabel}: {error}
        </span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".step,.stp,.iges,.igs"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
