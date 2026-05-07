import type { PostProcessor, PostContext } from './types';

const cmt = (ctx: PostContext, s: string) => (ctx.comments ? `( ${s} )` : null);
const keep = (xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);

// Fanuc 0i/30i: strict 4-digit O-number, G28 reference return before tool
// change, explicit coolant M-code ordering, M30 + % trailer.
export const fanucPost: PostProcessor = {
  id: 'fanuc',
  label: 'Fanuc 0i / 30i-M',
  fileExtension: 'nc',

  formatProgramNumber(ctx) {
    const num = Math.max(1, Math.min(9999, ctx.programNumber));
    return keep([
      `O${String(num).padStart(4, '0')}(${ctx.programName.replace(/[()]/g, '').slice(0, 24).toUpperCase()})`,
      cmt(ctx, `NEXYFAB CAM`),
      cmt(ctx, `OP ${ctx.operationType.toUpperCase()}`),
      cmt(ctx, `TOOL D${ctx.toolDiameter.toFixed(2)}MM`),
      cmt(ctx, `FEED ${ctx.feedRate} SPINDLE ${ctx.spindleSpeed}`),
      ...ctx.warnings.map(w => cmt(ctx, `WARN ${w.toUpperCase()}`)),
    ]);
  },

  modalSetup(ctx) {
    return [
      'G00 G17 G40 G49 G80 G90',
      ctx.units === 'inch' ? 'G20' : 'G21',
      'G94',
      'G54',
    ];
  },

  toolChange(ctx) {
    // Fanuc convention: retract to machine home before tool change.
    return [
      'G91 G28 Z0.',
      'G90',
      `T${String(ctx.toolNumber).padStart(2, '0')} M06`,
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
