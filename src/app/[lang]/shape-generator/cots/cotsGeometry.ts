// Geometry adapter: COTS catalog part → OpenSCAD source, so standard parts
// (bolts/nuts/bearings/collars/washers/clips) can be INSERTED into the 3D
// assembly with real (simplified) geometry. Feeds the existing
// nexyfab:insert-standard-part pipeline, which only needs a `scad` string.
//
// Geometry is intentionally simplified (no threads, no hex sockets, bearings
// as annular rings) — same fidelity convention as library/standardPartsIso.ts.
// (2026-06-09 P3)

import type { COTSPart } from './cotsData';

const n = (v: number | undefined, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function cotsToScad(part: COTSPart): string {
  const p = part.params;
  const FN = 48;

  switch (part.category) {
    case 'bolt': {
      // Socket-head cap screw: head cylinder + shaft. (No threads/socket.)
      const M = n(p.M, 5), length = n(p.length, 20), headDia = n(p.headDia, M * 1.5), headH = n(p.headH, M);
      return `$fn=${FN};
union() {
  cylinder(h=${headH}, d=${headDia});
  translate([0,0,${headH}]) cylinder(h=${length}, d=${M});
}`;
    }
    case 'nut': {
      // Hex prism (across-flats → circumscribed dia) minus the bore.
      const M = n(p.M, 5), width = n(p.width, M * 1.8), height = n(p.height, M * 0.8);
      const circ = (width / Math.cos(Math.PI / 6)).toFixed(3);
      return `$fn=${FN};
difference() {
  cylinder(h=${height}, d=${circ}, $fn=6);
  translate([0,0,-0.5]) cylinder(h=${height + 1}, d=${M});
}`;
    }
    case 'bearing': {
      const bore = n(p.bore, 8), od = n(p.OD ?? p.od, bore * 2.5);
      // Thrust bearing (51100 family) has `height` but no `width` → model as
      // two flat race washers with a central cage gap, which reads distinctly
      // from a deep-groove ball bearing. DGBB → single annular ring.
      if (p.height && !p.width) {
        const h = n(p.height, 5);
        const race = (h * 0.4).toFixed(3);
        return `$fn=${FN * 2};
union() {
  difference() { cylinder(h=${race}, d=${od}); translate([0,0,-0.5]) cylinder(h=${h + 1}, d=${bore}); }
  translate([0,0,${(h * 0.6).toFixed(3)}]) difference() { cylinder(h=${race}, d=${od}); translate([0,0,-0.5]) cylinder(h=${h + 1}, d=${bore}); }
}`;
      }
      const w = n(p.width, Math.max(2, bore * 0.7));
      return `$fn=${FN * 2};
difference() {
  cylinder(h=${w}, d=${od});
  translate([0,0,-0.5]) cylinder(h=${w + 1}, d=${bore});
}`;
    }
    case 'collar': {
      // Shaft collar → annular ring (set-screw hole omitted for simplicity).
      const bore = n(p.bore, 8), od = n(p.OD ?? p.od, bore * 2), w = n(p.width, Math.max(2, bore * 0.7));
      return `$fn=${FN * 2};
difference() {
  cylinder(h=${w}, d=${od});
  translate([0,0,-0.5]) cylinder(h=${w + 1}, d=${bore});
}`;
    }
    case 'washer': {
      const inner = n(p.innerDia, n(p.M, 5) + 0.3), outer = n(p.outerDia, inner * 2), th = n(p.thickness, 1);
      return `$fn=${FN * 2};
difference() {
  cylinder(h=${th}, d=${outer});
  translate([0,0,-0.5]) cylinder(h=${th + 1}, d=${inner});
}`;
    }
    case 'clip': {
      // DIN 471 external retaining ring — split C-ring with two lug bosses
      // flanking the gap, each with a plier pin-hole.
      const d = n(p.d, 6), th = n(p.thickness, 0.8), b = n(p.b, 1.5);
      const innerD = n(p.d1, d - 0.4), outerD = d + 2 * b, gap = Math.max(1, b * 1.2);
      const lugX = (outerD / 2 - b * 0.5).toFixed(3);
      const lugY = (gap * 0.9).toFixed(3);
      const lugD = (b * 1.4).toFixed(3);
      const pinD = (b * 0.5).toFixed(3);
      const slot = (outerD / 2 + b).toFixed(3);
      return `$fn=${FN * 2};
difference() {
  union() {
    difference() {
      cylinder(h=${th}, d=${outerD});
      translate([0,0,-0.5]) cylinder(h=${th + 1}, d=${innerD});
    }
    translate([${lugX}, ${lugY}, 0]) cylinder(h=${th}, d=${lugD});
    translate([${lugX}, -${lugY}, 0]) cylinder(h=${th}, d=${lugD});
  }
  translate([0, ${(-gap / 2).toFixed(3)}, -0.5]) cube([${slot}, ${gap}, ${th + 1}]);
  translate([${lugX}, ${lugY}, -0.5]) cylinder(h=${th + 1}, d=${pinD});
  translate([${lugX}, -${lugY}, -0.5]) cylinder(h=${th + 1}, d=${pinD});
}`;
    }
    default:
      return `$fn=${FN}; cylinder(h=5, d=10);`;
  }
}
