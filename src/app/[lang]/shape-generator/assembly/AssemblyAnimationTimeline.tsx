"use client";
import React, { useEffect, useRef } from "react";
import type { AssemblyAnimation } from "@/lib/assembly/assemblyAnimation";
import type { AssemblyAnimationVerification } from "@/lib/assembly/assemblyAnimationVerification";
import type { PreciseCollisionTimeEvidence } from "@/lib/assembly/featureTreePreciseInterference";
export interface AssemblyAnimationTimelineProps {
  animation: AssemblyAnimation;
  frame: number;
  playing: boolean;
  onFrameChange: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  verification?: AssemblyAnimationVerification | null;
  timeOfImpact?: PreciseCollisionTimeEvidence[] | null;
}
export default function AssemblyAnimationTimeline({
  animation,
  frame,
  playing,
  onFrameChange,
  onPlayingChange,
  verification,
  timeOfImpact,
}: AssemblyAnimationTimelineProps) {
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
    ? `First collision ${firstToi.partA}/${firstToi.partB}: frames ${firstToi.firstPossibleFrame?.toFixed(3)}–${firstToi.confirmedCollisionFrame?.toFixed(3)}`
    : unresolvedToi
      ? `${unresolvedToi} unresolved collision-time interval(s)`
      : failedFrames
    ? `${failedFrames} collision frame(s)`
    : continuousHits
      ? `${continuousHits} continuous collision candidate(s)`
      : unresolved
        ? `${unresolved} unresolved rotational interval(s)`
        : unknownFrames
          ? `${unknownFrames} unverified frame(s)`
          : verification
            ? "All sampled and continuous intervals clear"
            : "Verification not run";
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
        aria-label={playing ? "Pause" : "Play"}
        style={{ minWidth: 42, minHeight: 42 }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div>
        <input
          name="assembly-animation-frame-slider"
          aria-label="Animation frame"
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
          {firstToi?.firstPossibleFrame != null && <button type="button" data-testid="assembly-animation-jump-to-toi" onClick={() => onFrameChange(firstToi.firstPossibleFrame!)} style={{ marginLeft: 6, fontSize: 11, minHeight: 32 }}>Jump</button>}
        </div>
      </div>
      <label style={{ fontFamily: "monospace", fontSize: 12 }}>
        <input
          name="assembly-animation-current-frame"
          aria-label="Current frame"
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
