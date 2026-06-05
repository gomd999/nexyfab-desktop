/**
 * refrigeration.ts — vapour-cycle refrigerator and heat-pump performance, with the Carnot
 * (reversible) ceiling.
 *
 *   energy balance:   Q_h = Q_c + W
 *   refrigerator COP: COP_R  = Q_c/W
 *   heat-pump COP:    COP_HP = Q_h/W = COP_R + 1
 *   Carnot limits:    COP_R  = T_c/(T_h − T_c),   COP_HP = T_h/(T_h − T_c)   (T in kelvin)
 *
 * Verified against the energy balance Q_h=Q_c+W, the COP_HP=COP_R+1 identity, the Carnot
 * temperature limits, and COP→∞ as T_h→T_c.
 */

/** Carnot refrigerator COP COP_R = T_c/(T_h − T_c). */
export function carnotCOPRefrigerator(Tc: number, Th: number): number { return Tc / (Th - Tc); }
/** Carnot heat-pump COP COP_HP = T_h/(T_h − T_c). */
export function carnotCOPHeatPump(Tc: number, Th: number): number { return Th / (Th - Tc); }
/** Refrigerator coefficient of performance COP_R = Q_c/W. */
export function copRefrigerator(Qc: number, W: number): number { return Qc / W; }
/** Heat-pump coefficient of performance COP_HP = Q_h/W. */
export function copHeatPump(Qh: number, W: number): number { return Qh / W; }
/** Work input from the heat flows W = Q_h − Q_c. */
export function workInput(Qc: number, Qh: number): number { return Qh - Qc; }
