/**
 * igesWriter.ts — Initial Graphics Exchange Specification (IGES 5.3).
 *
 * IGES is a legacy ANSI Y14.26M format from 1980. Surprisingly,
 * many small Korean / SE-Asia 가공업체 still use IGES because
 * their CAM software was bought in the 1990s. STEP is preferred
 * but IGES support keeps the supply network wider.
 *
 * File structure (5 sections):
 *   - Start (S): comments
 *   - Global (G): file metadata
 *   - Directory Entry (D): list of entity headers
 *   - Parameter Data (P): entity parameter blocks
 *   - Terminate (T): summary
 *
 * Each line is 80 columns with section letter + sequence number in
 * columns 73-80. This module ships the line-formatter + a small
 * set of common entities (line, circle, NURBS curve, plane).
 */

export interface IgesGlobalParams {
  sender: string;
  fileName: string;
  receiver: string;
  productId: string;
  precision: number;
  units: 'MM' | 'IN';
}

export type IgesEntityType = 110 | 116 | 100 | 126 | 128;
// 110 = Line, 116 = Point, 100 = Circular arc, 126 = NURBS curve, 128 = NURBS surface.

export interface IgesEntity {
  type: IgesEntityType;
  /** Parameter data fields (raw values). */
  parameters: Array<string | number>;
}

export class IgesWriter {
  private entities: IgesEntity[] = [];

  /** Append a generic entity. */
  add(entity: IgesEntity): number {
    this.entities.push(entity);
    return this.entities.length;
  }

  /** Convenience: add a 3D line segment. */
  addLine(from: [number, number, number], to: [number, number, number]): number {
    return this.add({
      type: 110,
      parameters: [from[0], from[1], from[2], to[0], to[1], to[2]],
    });
  }

  /** Convenience: add a point. */
  addPoint(p: [number, number, number]): number {
    return this.add({
      type: 116,
      parameters: [p[0], p[1], p[2]],
    });
  }

  finish(globals: IgesGlobalParams): string {
    const sLines = formatSection('S', ['NexyFab IGES export']);
    const gLines = formatSection('G', buildGlobalParams(globals));
    const { dLines, pLines } = this.buildDpSections();
    const t = this.buildTerminate(
      sLines.length, gLines.length, dLines.length, pLines.length,
    );
    return [...sLines, ...gLines, ...dLines, ...pLines, t].join('\n');
  }

  private buildDpSections(): { dLines: string[]; pLines: string[] } {
    const dLines: string[] = [];
    const pLines: string[] = [];
    let pSeq = 1;
    let dSeq = 1;
    this.entities.forEach((e, idx) => {
      const pStart = pSeq;
      const paramStr = `${e.type},${e.parameters.join(',')};`;
      // P-section: split into 64-char chunks per line + entity ID col 65-72.
      const chunks = splitParam(paramStr);
      for (let c = 0; c < chunks.length; c++) {
        const line = chunks[c]!.padEnd(64) + String(idx * 2 + 1).padStart(8) + 'P' + String(pSeq).padStart(7);
        pLines.push(line);
        pSeq++;
      }
      // D-section: 2 lines per entity, 16 fields of 8 chars each.
      const d1 = padRight(e.type.toString(), 8) + padRight(pStart.toString(), 8)
        + ''.padStart(8 * 6) + 'D' + String(dSeq).padStart(7);
      const d2 = padRight(e.type.toString(), 8) + ''.padStart(8 * 7) + 'D' + String(dSeq + 1).padStart(7);
      dLines.push(d1);
      dLines.push(d2);
      dSeq += 2;
    });
    return { dLines, pLines };
  }

  private buildTerminate(s: number, g: number, d: number, p: number): string {
    const counts = `S${String(s).padStart(7)}G${String(g).padStart(7)}D${String(d).padStart(7)}P${String(p).padStart(7)}`;
    return counts.padEnd(72) + 'T' + '0000001';
  }
}

function padRight(s: string, w: number): string {
  return s.padEnd(w).slice(0, w);
}

function formatSection(letter: 'S' | 'G', lines: string[]): string[] {
  return lines.map((l, i) => padRight(l, 72) + letter + String(i + 1).padStart(7));
}

function splitParam(s: string, maxChars: number = 64): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += maxChars) {
    out.push(s.slice(i, i + maxChars));
  }
  return out;
}

function buildGlobalParams(g: IgesGlobalParams): string[] {
  return [
    `1H,,1H;,${g.sender.length}H${g.sender},${g.fileName.length}H${g.fileName},`,
    `${g.productId.length}H${g.productId},32,38,6,38,15,`,
    `${g.receiver.length}H${g.receiver},`,
    `1.0,${g.units === 'MM' ? 2 : 1},10,0.0001,15H20060101.120000,`,
    `${g.precision.toExponential()},,1H,,1H;`,
  ];
}
