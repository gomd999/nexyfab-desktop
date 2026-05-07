'use client';

/**
 * useProactiveAdvisor — 디자인 변경 감지 후 idle debounce(2s)로 DFM/FEA 이슈를 proactive 알림
 *
 * - DFM 점수가 임계치 미만이거나 새 error/warning이 등장하면 toast 알림
 * - FEA safetyFactor < 2 이면 구조 경고 toast
 * - 일일 알림 한도 5회 (localStorage 기반) — freemium 과부하 방지
 */

import { useEffect, useRef, useCallback } from 'react';
import type { DFMResult } from './analysis/dfmAnalysis';
import type { Toast } from './useToast';

const DAILY_LIMIT = 5;
const DEBOUNCE_MS = 2000;
const DFM_WARN_THRESHOLD = 70; // score below this triggers warning
const FEA_SF_THRESHOLD = 2.0;  // safety factor below this triggers warning
const STORAGE_KEY = 'nexyfab_proactive_advisor';

interface AdvisorState {
  count: number;   // alerts shown today
  date: string;    // YYYY-MM-DD
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getAdvisorState(): AdvisorState {
  if (typeof localStorage === 'undefined') return { count: 0, date: getTodayKey() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, date: getTodayKey() };
    const parsed = JSON.parse(raw) as AdvisorState;
    if (parsed.date !== getTodayKey()) return { count: 0, date: getTodayKey() };
    return parsed;
  } catch {
    return { count: 0, date: getTodayKey() };
  }
}

function incrementAdvisorState(): boolean {
  const state = getAdvisorState();
  if (state.count >= DAILY_LIMIT) return false;
  const next: AdvisorState = { count: state.count + 1, date: getTodayKey() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return true;
}

interface UseProactiveAdvisorOptions {
  params: Record<string, number>;
  dfmResults: DFMResult[] | null | undefined;
  feaSafetyFactor: number | null;
  dfmScore: number | null;
  shapeId: string | null;
  lang: string;
  addToast: (type: Toast['type'], message: string, duration?: number, action?: Toast['action']) => void;
  onOpenAdvisor?: () => void;
}

export function useProactiveAdvisor({
  params,
  dfmResults,
  feaSafetyFactor,
  dfmScore,
  shapeId,
  lang,
  addToast,
  onOpenAdvisor,
}: UseProactiveAdvisorOptions) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDfmScoreRef = useRef<number | null>(null);
  const prevFeasfRef = useRef<number | null>(null);
  const prevShapeRef = useRef<string | null>(null);
  const isKo = lang === 'ko';

  const checkAndAlert = useCallback(() => {
    if (!shapeId) return;

    let triggered = false;

    // ── DFM degradation alert ──
    if (dfmScore !== null && dfmScore < DFM_WARN_THRESHOLD) {
      const prev = prevDfmScoreRef.current;
      // Alert if: first time below threshold, or score dropped by ≥5 points
      const isNewIssue = prev === null || prev >= DFM_WARN_THRESHOLD || dfmScore <= prev - 5;
      if (isNewIssue && incrementAdvisorState()) {
        const topIssue = dfmResults?.flatMap(r => r.issues)
          .sort((a, b) => {
            const rank = { error: 3, warning: 2, info: 1 };
            return (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0);
          })[0];
        const hint = topIssue
          ? (isKo ? `주요 문제: ${topIssue.description}` : `Top issue: ${topIssue.description}`)
          : '';
        addToast(
          dfmScore < 50 ? 'error' : 'warning',
          isKo
            ? `DFM 경고: 제조성 점수 ${dfmScore}점. ${hint}`
            : `DFM Warning: manufacturability score ${dfmScore}. ${hint}`,
          8000,
          onOpenAdvisor
            ? { label: isKo ? 'AI에게 물어보기' : 'Ask AI', onClick: onOpenAdvisor }
            : undefined,
        );
        triggered = true;
      }
    }

    // ── FEA safety factor alert ──
    if (!triggered && feaSafetyFactor !== null && feaSafetyFactor < FEA_SF_THRESHOLD) {
      const prev = prevFeasfRef.current;
      const isNewIssue = prev === null || prev >= FEA_SF_THRESHOLD;
      if (isNewIssue && incrementAdvisorState()) {
        addToast(
          feaSafetyFactor < 1.0 ? 'error' : 'warning',
          isKo
            ? `구조 경고: 안전계수 ${feaSafetyFactor.toFixed(2)} (권장 ≥2.0). 두께/소재 변경을 검토하세요.`
            : `Structural warning: safety factor ${feaSafetyFactor.toFixed(2)} (recommended ≥2.0).`,
          8000,
          onOpenAdvisor
            ? { label: isKo ? 'AI에게 물어보기' : 'Ask AI', onClick: onOpenAdvisor }
            : undefined,
        );
      }
    }

    prevDfmScoreRef.current = dfmScore;
    prevFeasfRef.current = feaSafetyFactor;
  }, [dfmScore, dfmResults, feaSafetyFactor, shapeId, isKo, addToast, onOpenAdvisor]);

  // Reset refs when shape changes
  useEffect(() => {
    if (shapeId !== prevShapeRef.current) {
      prevDfmScoreRef.current = null;
      prevFeasfRef.current = null;
      prevShapeRef.current = shapeId;
    }
  }, [shapeId]);

  // Debounced trigger on params change
  useEffect(() => {
    if (!shapeId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(checkAndAlert, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, dfmResults, feaSafetyFactor]);
}
