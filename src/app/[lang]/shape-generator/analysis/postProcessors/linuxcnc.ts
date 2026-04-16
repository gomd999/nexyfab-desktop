import type { PostProcessor, PostContext } from './types';

const cmt = (ctx: PostContext, s: string) => (ctx.comments ? `( ${s} )` : null);
const keep = (xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);

export const linuxcncPost: PostProcessor = {
  id: 'linuxcnc',
  label: 'LinuxCNC / Generic RS-274D',
  fileExtension: 'ngc',

  formatProgramNumber(ctx) {
    return keep([
      `O${String(ctx.programNumber).padStart(4, '0')}`,
      cmt(ctx, `NexyFab CAM — ${ctx.programName}`),
      cmt(ctx, `Operation: ${ctx.operationType}`),
      cmt(ctx, `Tool: Ø${ctx.toolDiameter.toFixed(2)} mm`),
      cmt(ctx, `Feed ${ctx.feedRate} mm/min  Spindle ${ctx.spindleSpeed} RPM`),
      cmt(ctx, `Cut length ${ctx.totalLengthMm.toFixed(1)} mm  Est ${ctx.estimatedTimeMin.toFixed(1)} min`),
      ...ctx.warnings.map(w => cmt(ctx, `WARNING: ${w}`)),
    ]);
  },

  modalSetup(ctx) {
    return [
      ctx.units === 'inch' ? 'G20' : 'G21',
      'G17 G90 G94 G54 G40 G49 G80',
    ];
  },

  toolChange(ctx) {
    return [`T${String(ctx.toolNumber).padStart(2, '0')} M06 (Ø${ctx.toolDiameter.toFixed(2)})`];
  },

  spindleStart(ctx) {
    const out = [`S${Math.round(ctx.spindleSpeed)} M03`];
    if (ctx.coolant) out.push('M08');
    return out;
  },

  approachStart(ctx) {
    return [`G00 Z${ctx.safeZ.toFixed(3)}`, 'G00 X0 Y0'];
  },

  programEnd(ctx) {
    const out = [`G00 Z${ctx.safeZ.toFixed(3)}`, 'G00 X0 Y0'];
    if (ctx.coolant) out.push('M09');
    out.push('M05', 'M30', '%');
    return out;
  },
};
