/**
 * Post-processor plugin interface. Each concrete implementation captures the
 * dialect-specific quirks of a CNC control (header, modal setup, tool-change
 * ceremony, program numbering, end-of-program). The emitter walks the plugin
 * while iterating toolpaths so controller differences stay out of the core
 * tool-path logic.
 */

export interface PostContext {
  programNumber: number;
  programName: string;
  units: 'mm' | 'inch';
  safeZ: number;
  coolant: boolean;
  toolNumber: number;
  toolDiameter: number;
  spindleSpeed: number;
  feedRate: number;
  operationType: string;
  totalLengthMm: number;
  estimatedTimeMin: number;
  warnings: string[];
  comments: boolean;
}

export interface PostProcessor {
  id: string;
  label: string;
  /** File extension for saved programs (no dot). */
  fileExtension: string;
  /** Leading program-number / name block. */
  formatProgramNumber(ctx: PostContext): string[];
  /** Modal setup (units, plane, distance, feed mode, WCS, comp off). */
  modalSetup(ctx: PostContext): string[];
  /** Tool-change ceremony before spindle start. */
  toolChange(ctx: PostContext): string[];
  /** Spindle + coolant start. */
  spindleStart(ctx: PostContext): string[];
  /** Move-to-safe-position block before cutting. */
  approachStart(ctx: PostContext): string[];
  /** End-of-program block (retract, coolant off, spindle off, M30). */
  programEnd(ctx: PostContext): string[];
}
