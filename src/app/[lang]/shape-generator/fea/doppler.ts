/**
 * doppler.ts — the acoustic Doppler effect: the frequency shift heard when source and/or
 * observer move through the medium, plus the Mach number.
 *
 *   general shift:   f' = f·(c + v_o)/(c − v_s)         (v positive = toward the other party)
 *   source toward:   f' = f·c/(c − v_s)   (> f, blue-shift)
 *   source away:     f' = f·c/(c + v_s)   (< f, red-shift)
 *   Mach number:     M = v/c               (≥ 1 ⇒ supersonic / shock)
 *
 * The classical effect is asymmetric: a moving source and a moving observer at the same
 * speed give slightly different shifts. Verified against the stationary f'=f, the
 * blue/red shifts of an approaching/receding source, the source–observer asymmetry, and
 * the Mach number.
 */

/** General Doppler-shifted frequency f' = f·(c + v_o)/(c − v_s). */
export function dopplerFrequency(f: number, c: number, vObserver: number, vSource: number): number {
  return (f * (c + vObserver)) / (c - vSource);
}
/** Source moving toward (approaching=true) or away from a still observer. */
export function dopplerSourceMoving(f: number, c: number, vs: number, approaching: boolean): number {
  return approaching ? (f * c) / (c - vs) : (f * c) / (c + vs);
}
/** Observer moving toward (approaching=true) or away from a still source. */
export function dopplerObserverMoving(f: number, c: number, vo: number, approaching: boolean): number {
  return approaching ? (f * (c + vo)) / c : (f * (c - vo)) / c;
}
/** Mach number M = v/c. */
export function machNumber(v: number, c: number): number { return v / c; }
