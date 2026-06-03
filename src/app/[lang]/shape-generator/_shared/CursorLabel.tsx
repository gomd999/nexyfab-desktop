/**
 * CursorLabel — small name pill rendered next to a remote peer's cursor.
 *
 * Standalone primitive for the shape-generator collab UI (Phase 1 follow-up
 * to ADR-013). The sibling `CursorOverlay` already renders an inline SVG
 * label inside its <svg> marker — `CursorLabel` is the *DOM* alternative,
 * for callers that want HTML positioning (sub-pixel transform, CSS
 * transitions, native text selection / hover affordances) instead of an
 * SVG-only marker.
 *
 * Layout: `position: absolute` with `transform: translate(x, y)`. The host
 * is responsible for placing the label inside a `position: relative` (or
 * absolute) container whose top-left is the same origin as `position`. We
 * do NOT subtract a label offset — the caller controls where the label
 * sits relative to the cursor hot-spot.
 *
 * Accessibility: `pointer-events: none` so the label never swallows clicks
 * on the underlying viewport. `aria-hidden="true"` because the screen
 * reader announcement should come from the awareness panel, not from a
 * dozen floating labels.
 *
 * testid contract: `cursor-label-{userId}`.
 */

'use client';

import React from 'react';

export interface CursorLabelProps {
  /** Remote peer's stable id. Surfaces as the visible label text by default
   *  unless `name` is provided. */
  userId: string;
  /** Optional display name. If omitted, `userId` is used. */
  name?: string;
  /** Background color of the pill. Should match the cursor marker color so
   *  the user visually associates pill ↔ cursor at a glance. */
  color: string;
  /** Viewport-local CSS pixel coordinates. Same coordinate space as
   *  `CursorOverlay`'s awareness cursor field. */
  position: { x: number; y: number };
  /** Optional className escape hatch. */
  className?: string;
}

export function CursorLabel({
  userId,
  name,
  color,
  position,
  className,
}: CursorLabelProps): React.ReactElement {
  const text = name ?? userId;
  return (
    <span
      data-testid={`cursor-label-${userId}`}
      data-user-id={userId}
      data-color={color}
      className={className}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translate(${position.x}px, ${position.y}px)`,
        background: color,
        color: 'white',
        padding: '1px 6px',
        borderRadius: 3,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        userSelect: 'none',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
      }}
    >
      {text}
    </span>
  );
}

export default CursorLabel;
