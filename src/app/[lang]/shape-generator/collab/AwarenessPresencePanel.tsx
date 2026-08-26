'use client';

import { useMemo } from 'react';
import type { PresenceState } from './yjsDoc';
import { useNowMs } from './useNowMs';
import { useLang } from '../hooks/useLang';
import { loc } from '@/lib/i18n/loc';

/**
 * Presence sidebar — small floating list of who's currently in the room.
 * Reads from the awareness map; complementary to AwarenessCursors which
 * shows the same data as 3D markers.
 *
 * Shows:
 *   - color swatch
 *   - name (or "User <clientId>" fallback)
 *   - "editing <featureId>" when set
 *   - last-seen relative time when stale
 *
 * Hidden entirely when only the local user is present (nothing useful to show).
 */

interface Props {
  presences: Map<number, PresenceState>;
  localClientId: number;
  /** Optional: pass to display "this is you" subtle hint. */
  localName?: string;
}

const STALE_AFTER_MS = 10_000;

function fallbackColor(clientId: number): string {
  const hue = (clientId * 137) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function relativeAge(ts: number | undefined, now: number): string {
  if (typeof ts !== 'number') return '';
  const ms = now - ts;
  if (ms < 5_000) return '';                  // fresh — no badge
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export default function AwarenessPresencePanel({ presences, localClientId, localName }: Props) {
  const lang = useLang();
  const now = useNowMs(500);
  const entries = useMemo(() => {
    const list: Array<{
      id: number;
      name: string;
      color: string;
      editingNodeId: string | undefined;
      selectedFeatureId: string | undefined;
      viewportMode: PresenceState['viewportMode'];
      activity: PresenceState['activity'];
      ts: number | undefined;
      isLocal: boolean;
    }> = [];
    presences.forEach((s, clientId) => {
      list.push({
        id: clientId,
        name: s.name ?? (clientId === localClientId ? (localName ?? loc(lang, { ko: '나', en: 'You', ja: '自分', zh: '你', es: 'Tú', ar: 'أنت' })) : `${loc(lang, { ko: '사용자', en: 'User', ja: 'ユーザー', zh: '用户', es: 'Usuario', ar: 'مستخدم' })} ${clientId}`),
        color: s.color ?? fallbackColor(clientId),
        editingNodeId: s.editingNodeId,
        selectedFeatureId: s.selectedFeatureId,
        viewportMode: s.viewportMode,
        activity: s.activity,
        ts: s.ts,
        isLocal: clientId === localClientId,
      });
    });
    // Local user pinned to the top.
    list.sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name));
    return list;
  }, [presences, localClientId, localName, lang]);

  // Hide when there's nobody to show beyond yourself.
  if (entries.filter(e => !e.isLocal).length === 0) return null;

  return (
    <div
      className="absolute top-3 right-3 bg-gray-950/85 backdrop-blur border border-gray-800 rounded-lg p-2 shadow-lg pointer-events-auto"
      style={{ minWidth: 180, maxWidth: 240, zIndex: 30 }}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pb-1 select-none">
        {loc(lang, { ko: '이 룸의 사용자', en: 'In this room', ja: 'このルーム', zh: '此房间', es: 'En esta sala', ar: 'في هذه الغرفة' })} ({entries.length})
      </div>
      <ul className="space-y-1">
        {entries.map(e => {
          const stale = e.ts !== undefined && now - e.ts > STALE_AFTER_MS;
          const ageLabel = stale ? relativeAge(e.ts, now) : '';
          return (
            <li key={e.id} className={`flex items-center gap-2 px-1 py-0.5 rounded ${stale ? 'opacity-50' : ''}`}>
              <span
                className="inline-block rounded-full relative"
                style={{ width: 8, height: 8, background: e.color, flexShrink: 0 }}
                aria-hidden
                title={e.activity === 'idle' ? loc(lang, { ko: '대기', en: 'idle', ja: '待機', zh: '空闲', es: 'inactivo', ar: 'خامل' }) : loc(lang, { ko: '활동 중', en: 'active', ja: 'アクティブ', zh: '活动中', es: 'activo', ar: 'نشط' })}
              >
                {e.activity === 'idle' && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 inline-block rounded-full bg-gray-600 border border-gray-950"
                    style={{ width: 4, height: 4 }}
                  />
                )}
              </span>
              <span className="text-xs text-gray-100 truncate flex-1">
                {e.name}
                {e.isLocal && <span className="text-gray-500 text-[10px] ml-1">· {loc(lang, { ko: '나', en: 'you', ja: '自分', zh: '你', es: 'tú', ar: 'أنت' })}</span>}
                {e.viewportMode && e.viewportMode !== '3d' && (
                  <span
                    className="text-[10px] ml-1 px-1 rounded bg-indigo-500/20 text-indigo-200 font-mono"
                    title={`viewport: ${e.viewportMode}`}
                  >{e.viewportMode}</span>
                )}
                {e.activity === 'idle' && (
                  <span className="text-[10px] ml-1 text-gray-500">{loc(lang, { ko: '대기', en: 'idle', ja: '待機', zh: '空闲', es: 'inactivo', ar: 'خامل' })}</span>
                )}
              </span>
              {e.editingNodeId ? (
                <span
                  className="text-[10px] text-amber-300/80 font-mono truncate"
                  title={`editing ${e.editingNodeId}`}
                  style={{ maxWidth: 60 }}
                >
                  ✎ {e.editingNodeId.slice(0, 6)}
                </span>
              ) : e.selectedFeatureId && (
                <span
                  className="text-[10px] text-sky-300/70 font-mono truncate"
                  title={`viewing ${e.selectedFeatureId}`}
                  style={{ maxWidth: 60 }}
                >
                  👁 {e.selectedFeatureId.slice(0, 6)}
                </span>
              )}
              {ageLabel ? (
                <span className="text-[10px] text-gray-500 ml-auto">{ageLabel}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
