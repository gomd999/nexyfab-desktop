import type { AssemblyAnimation } from './assemblyAnimation';
import type { AssemblyState } from './assemblyState';

export type AnimationCommandResult = {
  animation: AssemblyAnimation;
  message: string;
};

/**
 * Deterministic, fail-closed command adapter shared by Web/API/CLI/MCP.
 * It intentionally supports a narrow contract instead of guessing CAD intent.
 */
export function applyAssemblyAnimationCommand(
  state: AssemblyState,
  animation: AssemblyAnimation,
  text: string,
): AnimationCommandResult {
  const normalized = text.trim();
  const range = normalized.match(/(-?\d+)\s*(?:~|to|부터)\s*(-?\d+)\s*(?:frames?|프레임)?/i);
  const axis = normalized.match(/(?:^|\s)([xyz])\s*(?:축)?(?=\s|\d|-|$)/i);
  const distance = normalized.match(/(-?\d+(?:\.\d+)?)\s*mm\b/i);

  if (!range || !axis || !distance) {
    throw new Error('Command requires frame range, X/Y/Z axis, and distance in mm.');
  }

  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start < animation.startFrame || end > animation.endFrame || end <= start) {
    throw new Error('Command frame range is outside the animation.');
  }

  const lower = normalized.toLocaleLowerCase();
  const candidates = state.parts.filter(
    part => lower.includes(part.id.toLocaleLowerCase()) || lower.includes(part.name.toLocaleLowerCase()),
  );
  if (candidates.length !== 1) {
    throw new Error(candidates.length ? 'Command matches multiple parts.' : 'Command does not identify one part.');
  }

  const part = candidates[0]!;
  const key = axis[1]!.toLowerCase() as 'x' | 'y' | 'z';
  const amount = Number(distance[1]);
  const destination = { ...part.position, [key]: part.position[key] + amount };
  const trackId = `command:${part.id}:position`;
  const newKeys = [
    { frame: start, position: { ...part.position }, interpolation: 's_curve' as const },
    { frame: end, position: destination, interpolation: 's_curve' as const },
  ];
  const existing = animation.tracks.find(track => track.id === trackId);
  const tracks = existing
    ? animation.tracks.map(track => track.id === trackId
      ? {
          ...track,
          keyframes: [
            ...track.keyframes.filter(frame => frame.frame < start || frame.frame > end),
            ...newKeys,
          ].sort((a, b) => a.frame - b.frame),
        }
      : track)
    : [...animation.tracks, { id: trackId, targetPartId: part.id, keyframes: newKeys }];

  return {
    animation: { ...animation, tracks },
    message: `${part.name}: ${start}-${end} frames, ${key.toUpperCase()} ${amount} mm`,
  };
}
