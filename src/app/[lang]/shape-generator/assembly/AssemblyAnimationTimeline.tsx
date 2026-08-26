"use client";
import React, { useEffect, useRef } from "react";
import type { AssemblyAnimation } from "@/lib/assembly/assemblyAnimation";
import type { AssemblyAnimationVerification } from "@/lib/assembly/assemblyAnimationVerification";
import type { PreciseCollisionTimeEvidence } from "@/lib/assembly/featureTreePreciseInterference";
import { loc } from "@/lib/i18n/loc";
export interface AssemblyAnimationTimelineProps {
  lang?: string;
  animation: AssemblyAnimation;
  frame: number;
  playing: boolean;
  onFrameChange: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  verification?: AssemblyAnimationVerification | null;
  timeOfImpact?: PreciseCollisionTimeEvidence[] | null;
}
export default function AssemblyAnimationTimeline({
  lang,
  animation,
  frame,
  playing,
  onFrameChange,
  onPlayingChange,
  verification,
  timeOfImpact,
}: AssemblyAnimationTimelineProps) {
  const L = (copy: { ko: string; en: string; ja: string; zh: string; es: string; ar: string }) => loc(lang, copy);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    if (!playing) return;
    let id: number | undefined,
      last: number | undefined,
      carry = 0;
    const tick = (now: number) => {
      if (last !== undefined) {
        carry += ((now - last) * animation.fps) / 1000;
        const advance = Math.floor(carry);
        carry -= advance;
        if (advance) {
          let next = frameRef.current + advance;
          if (next > animation.endFrame) {
            if (animation.loop)
              next =
                animation.startFrame +
                ((next - animation.startFrame) %
                  (animation.endFrame - animation.startFrame + 1));
            else {
              next = animation.endFrame;
              onPlayingChange(false);
            }
          }
          frameRef.current = next;
          onFrameChange(next);
        }
      }
      last = now;
      if (frameRef.current < animation.endFrame || animation.loop)
        id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      if (id !== undefined) cancelAnimationFrame(id);
    };
  }, [playing, animation, onFrameChange, onPlayingChange]);
  const frameEvidence = verification?.frames ?? [],
    failedFrames = frameEvidence.filter((x) => x.status === "failed").length,
    unknownFrames = frameEvidence.filter(
      (x) => x.status === "not_run" || x.status === "warning",
    ).length;
  const unresolved = verification?.continuous.unresolved.length ?? 0,
    continuousHits =
      verification?.continuous.candidates.filter(
        (item) => item.status === "confirmed",
      ).length ?? 0;
  const failed = failedFrames + continuousHits > 0,
    unknown = unknownFrames + unresolved > 0;
  const firstToi = timeOfImpact?.find((item) => item.status === "collision_bracket");
  const unresolvedToi = timeOfImpact?.filter((item) => item.status === "unresolved" || item.status === "unavailable").length ?? 0;
  const label = firstToi
    ? L({
        ko: `첫 충돌 ${firstToi.partA}/${firstToi.partB}: 프레임 ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
        en: `First collision ${firstToi.partA}/${firstToi.partB}: frames ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
        ja: `最初の衝突 ${firstToi.partA}/${firstToi.partB}: フレーム ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
        zh: `首次碰撞 ${firstToi.partA}/${firstToi.partB}：帧 ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
        es: `Primera colisión ${firstToi.partA}/${firstToi.partB}: fotogramas ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
        ar: `أول تصادم ${firstToi.partA}/${firstToi.partB}: الإطارات ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`,
      })
    : unresolvedToi
      ? L({ ko: `미해결 충돌 시간 구간 ${unresolvedToi}개`, en: `${unresolvedToi} unresolved collision-time interval(s)`, ja: `未解決の衝突時間区間 ${unresolvedToi}件`, zh: `${unresolvedToi} 个未解决的碰撞时间区间`, es: `${unresolvedToi} intervalo(s) de tiempo de colisión sin resolver`, ar: `${unresolvedToi} فاصل زمني للتصادم غير محلول` })
      : failedFrames
    ? L({ ko: `충돌 프레임 ${failedFrames}개`, en: `${failedFrames} collision frame(s)`, ja: `衝突フレーム ${failedFrames}件`, zh: `${failedFrames} 个碰撞帧`, es: `${failedFrames} fotograma(s) con colisión`, ar: `${failedFrames} إطار تصادم` })
    : continuousHits
      ? L({ ko: `연속 충돌 후보 ${continuousHits}개`, en: `${continuousHits} continuous collision candidate(s)`, ja: `連続衝突候補 ${continuousHits}件`, zh: `${continuousHits} 个连续碰撞候选`, es: `${continuousHits} candidato(s) de colisión continua`, ar: `${continuousHits} مرشح تصادم مستمر` })
      : unresolved
        ? L({ ko: `미해결 회전 구간 ${unresolved}개`, en: `${unresolved} unresolved rotational interval(s)`, ja: `未解決の回転区間 ${unresolved}件`, zh: `${unresolved} 个未解决的旋转区间`, es: `${unresolved} intervalo(s) de rotación sin resolver`, ar: `${unresolved} فاصل دوران غير محلول` })
        : unknownFrames
          ? L({ ko: `미검증 프레임 ${unknownFrames}개`, en: `${unknownFrames} unverified frame(s)`, ja: `未検証フレーム ${unknownFrames}件`, zh: `${unknownFrames} 个未验证帧`, es: `${unknownFrames} fotograma(s) sin verificar`, ar: `${unknownFrames} إطار غير متحقق` })
          : verification
            ? L({ ko: '모든 샘플 및 연속 구간 이상 없음', en: 'All sampled and continuous intervals clear', ja: 'すべてのサンプルおよび連続区間に問題なし', zh: '所有采样和连续区间均无碰撞', es: 'Todos los intervalos muestreados y continuos están libres', ar: 'جميع الفواصل المأخوذة والمستمرة خالية' })
            : L({ ko: '검증하지 않음', en: 'Verification not run', ja: '検証未実行', zh: '尚未验证', es: 'Verificación no ejecutada', ar: 'لم يتم التحقق' });
  return (
    <div
      data-testid="assembly-animation-timeline"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        minWidth: 0,
        padding: "10px 12px",
        border: "1px solid var(--nx-border)",
        borderRadius: 7,
        background: "var(--nx-panel-2)",
      }}
    >
      <button
        type="button"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? L({ ko: '일시정지', en: 'Pause', ja: '一時停止', zh: '暂停', es: 'Pausar', ar: 'إيقاف مؤقت' }) : L({ ko: '재생', en: 'Play', ja: '再生', zh: '播放', es: 'Reproducir', ar: 'تشغيل' })}
        style={{ minWidth: 42, minHeight: 42 }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div>
        <input
          name="assembly-animation-frame-slider"
          aria-label={L({ ko: '애니메이션 프레임', en: 'Animation frame', ja: 'アニメーションフレーム', zh: '动画帧', es: 'Fotograma de animación', ar: 'إطار الحركة' })}
          type="range"
          min={animation.startFrame}
          max={animation.endFrame}
          value={frame}
          onChange={(e) => onFrameChange(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: failed ? "#dc2626" : unknown ? "#d97706" : "#16a34a",
          }}
        />
        <div
          data-testid="assembly-animation-verification"
          style={{
            marginTop: 4,
            fontSize: 11,
            color: failed ? "#fca5a5" : unknown ? "#fdba74" : "#86efac",
          }}
        >
          {label}
          {firstToi?.firstPossibleFrame != null && <button type="button" data-testid="assembly-animation-jump-to-toi" onClick={() => onFrameChange(firstToi.firstPossibleFrame!)} style={{ marginLeft: 6, fontSize: 11, minHeight: 32 }}>{L({ ko: '이동', en: 'Jump', ja: '移動', zh: '跳转', es: 'Ir', ar: 'انتقال' })}</button>}
        </div>
      </div>
      <label style={{ fontFamily: "monospace", fontSize: 12 }}>
        <input
          name="assembly-animation-current-frame"
          aria-label={L({ ko: '현재 프레임', en: 'Current frame', ja: '現在のフレーム', zh: '当前帧', es: 'Fotograma actual', ar: 'الإطار الحالي' })}
          type="number"
          min={animation.startFrame}
          max={animation.endFrame}
          value={frame}
          onChange={(e) =>
            onFrameChange(
              Math.max(
                animation.startFrame,
                Math.min(animation.endFrame, Number(e.target.value)),
              ),
            )
          }
          style={{ width: 64 }}
        />{" "}
        / {animation.endFrame} · {animation.fps}fps
      </label>
    </div>
  );
}
