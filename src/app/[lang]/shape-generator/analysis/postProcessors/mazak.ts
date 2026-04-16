import type { PostProcessor, PostContext } from './types';

const cmt = (ctx: PostContext, s: string) => (ctx.comments ? `( ${s} )` : null);
const keep = (xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);

// Mazak Matrix / Smooth control, EIA/ISO mode. Largely Fanuc-compatible but
// prefers G53.1 tool-length reference, uses M00/M01 blocks before tool change
// as a soft safety stop, and closes with M02 rather than M30 in many shops.
export const mazakPost: PostProcessor = {
  id: 'mazak',
  label: 'Mazak Matrix / Smooth',
  fileExtension: 'eia',

  formatProgramNumber(ctx) {
    const num = Math.max(1, Math.min(99999999, ctx.programNumber));
    return keep([
      `O${String(num).padStart(8, '0')}(${ctx.programName.replace(/[()]/g, '').slice(0, 32)})`,
      cmt(ctx, `NEXYFAB MAZATROL-COMPAT`),
      cmt(ctx, `OPERATION ${ctx.operationType}`),
      cmt(ctx, `TOOL DIA ${ctx.toolDiameter.toFixed(2)} MM`),
      cmt(ctx, `FEED ${ctx.feedRate} MMPM SP ${ctx.spindleSpeed} RPM`),
      ...ctx.warnings.map(w => cmt(ctx, `WARNING ${w}`)),
    ]);
  },

  modalSetup(ctx) {
    return [
      'G00 G17 G40 G49 G80 G90',
      ctx.units === 'inch' ? 'G20' : 'G21',
      'G94 G98',
      'G54',
    ];
  },

  toolChange(ctx) {
    return [
      'M01',
      'G91 G28 Z0.',
      'G90',
      `T${String(ctx.toolNumber).padStart(2, '0')}`,
      'M06',
    ];
  },

  spindleStart(ctx) {
    const out = [`S${Math.round(ctx.spindleSpeed)} M03`];
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
    out.push('M30');
    out.push('%');
    return out;
  },
};
