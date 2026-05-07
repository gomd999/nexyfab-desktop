import type { PostProcessor, PostContext } from './types';

const cmt = (ctx: PostContext, s: string) => (ctx.comments ? `( ${s} )` : null);
const keep = (xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);

// Haas NGC / Classic control. Convention: O##### program numbers, G103 P1
// lookahead limit for safer dry-runs, tool change via Txx M06, spindle warm-up
// often at lower RPM then ramp — we skip the ramp here but emit a brief dwell.
export const haasPost: PostProcessor = {
  id: 'haas',
  label: 'Haas NGC / Classic',
  fileExtension: 'nc',

  formatProgramNumber(ctx) {
    const num = Math.max(1, Math.min(99999, ctx.programNumber));
    return keep([
      '%',
      `O${String(num).padStart(5, '0')} (${ctx.programName.slice(0, 24).toUpperCase()})`,
      cmt(ctx, `NEXYFAB CAM / HAAS`),
      cmt(ctx, `OPERATION ${ctx.operationType.toUpperCase()}`),
      cmt(ctx, `TOOL D${ctx.toolDiameter.toFixed(2)}`),
      cmt(ctx, `FEED ${ctx.feedRate} SP ${ctx.spindleSpeed}`),
      ...ctx.warnings.map(w => cmt(ctx, `WARN ${w.toUpperCase()}`)),
    ]);
  },

  modalSetup(ctx) {
    return [
      'G00 G17 G40 G49 G80 G90',
      ctx.units === 'inch' ? 'G20' : 'G21',
      'G94',
      'G54',
      'G103 P1',
    ];
  },

  toolChange(ctx) {
    return [
      'G91 G28 Z0.',
      'G90',
      `T${String(ctx.toolNumber).padStart(2, '0')} M06`,
    ];
  },

  spindleStart(ctx) {
    const out = [`S${Math.round(ctx.spindleSpeed)} M03`];
    out.push('G04 P500');
    if (ctx.coolant) out.push('M08');
    return out;
  },

  approachStart(ctx) {
    return [`G00 Z${ctx.safeZ.toFixed(3)}`, 'G00 X0. Y0.'];
  },

  programEnd(ctx) {
    const out: string[] = [];
    if (ctx.coolant) out.push('M09');
    out.push('M05');
    out.push('G91 G28 Z0.');
    out.push('G91 G28 X0. Y0.');
    out.push('G90');
    out.push('G103 P0');
    out.push('M30');
    out.push('%');
    return out;
  },
};
