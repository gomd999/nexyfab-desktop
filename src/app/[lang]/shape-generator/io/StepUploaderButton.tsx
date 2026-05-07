'use client';

import React, { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import type { StepAnalysisResult } from './StepUploader';
import { useStepWorker } from '../workers/useStepWorker';

const dict = {
  ko: {
    label: 'STEP 파일 불러오기', loading: 'STEP 파일 파싱 중…', errLabel: '오류',
    errType: '지원하지 않는 파일 형식', maxSize: '파일 크기 제한 50 MB',
    parseErr: (e: string) => `파싱 오류: ${e}`,
  },
  en: {
    label: 'Import STEP File', loading: 'Parsing STEP file…', errLabel: 'Error',
    errType: 'Unsupported file type', maxSize: 'File size limit: 50 MB',
    parseErr: (e: string) => `Parse error: ${e}`,
  },
  ja: {
    label: 'STEP ファイルを読み込む', loading: 'STEP ファイルを解析中…', errLabel: 'エラー',
    errType: 'サポートされていないファイル形式', maxSize: 'ファイルサイズ制限 50 MB',
    parseErr: (e: string) => `解析エラー: ${e}`,
  },
  zh: {
    label: '导入 STEP 文件', loading: '正在解析 STEP 文件…', errLabel: '错误',
    errType: '不支持的文件类型', maxSize: '文件大小限制 50 MB',
    parseErr: (e: string) => `解析错误: ${e}`,
  },
  es: {
    label: 'Importar Archivo STEP', loading: 'Analizando archivo STEP…', errLabel: 'Error',
    errType: 'Tipo de archivo no soportado', maxSize: 'Límite de tamaño 50 MB',
    parseErr: (e: string) => `Error de análisis: ${e}`,
  },
  ar: {
    label: 'استيراد ملف STEP', loading: 'جارٍ تحليل ملف STEP…', errLabel: 'خطأ',
    errType: 'نوع الملف غير مدعوم', maxSize: 'حد حجم الملف 50 MB',
    parseErr: (e: string) => `خطأ في التحليل: ${e}`,
  },
};

interface StepUploaderButtonProps {
  onResult: (stats: StepAnalysisResult & { geometry?: THREE.BufferGeometry }) => void;
  lang?: string;
}

export default function StepUploaderButton({ onResult, lang = 'en' }: StepUploaderButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { parseStep } = useStepWorker();

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const label = t.label;
  const loading = t.loading;
  const errLabel = t.errLabel;

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const allowed = ['.step', '.stp', '.iges', '.igs'].some(ext => name.endsWith(ext));
    if (!allowed) {
      setError(t.errType);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(t.maxSize);
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const workerResult = await parseStep(buffer, file.name);

      const stats: StepAnalysisResult & { geometry?: THREE.BufferGeometry; partsGeo?: { geometry: THREE.BufferGeometry; name: string }[] } = {
        ...workerResult.stats,
        dfmSuggestions: workerResult.dfmSuggestions,
        geometry: workerResult.geometry,
        partsGeo: workerResult.parts,
      };

      onResult(stats);
    } catch (e) {
      setError(t.parseErr(String(e)));
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

    </div>
  );
}
