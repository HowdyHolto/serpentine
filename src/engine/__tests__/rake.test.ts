import { describe, it, expect } from 'vitest';
import { BoundaryShape, DEFAULT_PARAMS, GenerationParams, Point, Rock } from '../../types';
import { generateRakeLines, generateRake, edgeDistance, smooth, simplify, isoLines, pruneCrowded, rakeLineWidth, RakeLine } from '../rake';
import { generateSerpentine } from '../serpentineGenerator';
import { renderPaths } from '../pathRenderer';
import { pointInPolygon, makePolygonBoundary } from '../geometry';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 400, height: 400 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 400, height: 300 };

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'rake', seed: 3, strokeWidth: 4, minGap: 6, ...over };
}

describe('rake', () => {
  it('edge distance is positive inside and negative outside', () => {
    expect(edgeDistance(RECT, 10, 200)).toBe(10);
    expect(edgeDistance(RECT, 200, 395)).toBe(5);
    expect(edgeDistance(ELLIPSE, 200, 150)).toBeCloseTo(150);
    expect(edgeDistance(ELLIPSE, 390, 150)).toBeGreaterThan(0);
    expect(edgeDistance(ELLIPSE, 10, 10)).toBeLessThan(0);
    const tri = makePolygonBoundary([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }]);
    expect(edgeDistance(tri, 50, 50)).toBeCloseTo(50);
    expect(edgeDistance(tri, 300, 300)).toBeLessThan(0);
  });

  it('iso-lines of a radial field are closed rings', () => {
    const lines = isoLines(RECT, (x, y) => Math.hypot(x - 200, y - 200), 4, [50, 100]);
    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(l.closed).toBe(true);
      for (const p of l.points) expect(Math.hypot(p.x - 200, p.y - 200)).toBeCloseTo(l.level, 0);
    }
  });

  it('garden rings around one rock are one cell apart', () => {
    const rocks: Rock[] = [{ x: 200, y: 200, elevation: 0 }];
    const p = params({ contourSource: 'garden', rockEdge: 0 });
    const lines = generateRakeLines(RECT, p, rocks);
    const closed = lines.filter((l) => l.closed).sort((a, b) => a.level - b.level);
    expect(closed.length).toBeGreaterThan(10);
    const radii = closed.map((l) => l.points.reduce((s, q) => s + Math.hypot(q.x - 200, q.y - 200), 0) / l.points.length);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i] - radii[i - 1]).toBeCloseTo(p.strokeWidth + p.minGap, 0);
    }
    for (const l of lines) for (const q of l.points) expect(edgeDistance(RECT, q.x, q.y)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('elevation spreads a rock\'s rings and a dip inverts a pond bump', () => {
    const p = params({ contourSource: 'garden', rockEdge: 0 });
    const flat = generateRakeLines(RECT, p, [{ x: 200, y: 200, elevation: 0 }]).filter((l) => l.closed).length;
    const high = generateRakeLines(RECT, p, [{ x: 200, y: 200, elevation: 1 }]).filter((l) => l.closed).length;
    expect(high).toBeLessThan(flat);
    const pond = params({ contourSource: 'pond', rockSpread: 120 });
    const up = generateRakeLines(RECT, pond, [{ x: 200, y: 200, elevation: 1 }]);
    const down = generateRakeLines(RECT, pond, [{ x: 200, y: 200, elevation: -1 }]);
    const upRings = up.filter((l) => l.closed).length;
    const downRings = down.filter((l) => l.closed).length;
    expect(upRings).toBeGreaterThan(3);
    expect(Math.abs(upRings - downRings)).toBeLessThanOrEqual(1);
  });

  it('lines stay inside an ellipse and a polygon', () => {
    const rocks: Rock[] = [{ x: 150, y: 150, elevation: 0.5 }, { x: 300, y: 200, elevation: 0 }];
    for (const b of [ELLIPSE, makePolygonBoundary([{ x: 0, y: 0 }, { x: 400, y: 50 }, { x: 350, y: 400 }, { x: 20, y: 300 }])]) {
      const lines = generateRakeLines(b, params({ contourSource: 'garden', rockEdge: 0.5 }), rocks);
      expect(lines.length).toBeGreaterThan(5);
      for (const l of lines) {
        for (const q of l.points) {
          if (b.type === 'path') expect(pointInPolygon(q.x, q.y, b.points!)).toBe(true);
          else expect(edgeDistance(b, q.x, q.y)).toBeGreaterThanOrEqual(-0.5);
        }
      }
    }
  });

  it('smooth keeps ends and simplify keeps shape', () => {
    const zig = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
    const sm = smooth(zig, false, 2);
    expect(sm[0]).toEqual(zig[0]);
    expect(sm[sm.length - 1]).toEqual(zig[zig.length - 1]);
    expect(sm.length).toBeGreaterThan(zig.length);
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 0.5 }));
    expect(simplify(line, 0.1).length).toBe(2);
    expect(simplify(zig, 0.1).length).toBe(4);
  });

  it('generates waypoint runs the renderer draws as separate paths, with width by level', () => {
    const rocks: Rock[] = [{ x: 200, y: 200, elevation: 0 }];
    const p = params({ contourSource: 'garden', rockEdge: 0, rakeWidthVariation: 1 });
    const result = generateSerpentine(RECT, p, undefined, rocks);
    expect(result.fillRatio).toBe(1);
    const starts = result.waypoints.filter((w) => w.type === 'start');
    expect(starts.length).toBeGreaterThan(10);
    expect(starts.every((w) => typeof w.level === 'number')).toBe(true);
    const paths = renderPaths(result.waypoints, p);
    expect(paths.length).toBe(starts.length);
    expect(paths.filter((q) => q.d.endsWith('Z')).length).toBeGreaterThan(5);
    const widths = new Set(paths.map((q) => q.strokeWidth));
    expect(widths.size).toBeGreaterThan(3);
    expect(Math.max(...widths)).toBeLessThanOrEqual(p.strokeWidth);
    const direct = generateRake(RECT, p, rocks);
    expect(direct.structure.endCapPairs).toEqual([]);
  });

  it('prunes crowded height-field lines so none come within a stroke of another', () => {
    const p = params({ contourSource: 'noise', contourScale: 120, strokeWidth: 8, minGap: 6 });
    const lines = generateRakeLines(RECT, p, []);
    expect(lines.length).toBeGreaterThan(5);
    const all: Array<{ x: number; y: number; line: number }> = [];
    lines.forEach((l, li) => l.points.forEach((q) => all.push({ x: q.x, y: q.y, line: li })));
    let closest = Infinity;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].line === all[j].line) continue;
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
        if (d < closest) closest = d;
      }
    }
    // Bridged grazing contacts may sit a little inside minDist; never near overlap.
    expect(closest).toBeGreaterThanOrEqual(p.strokeWidth);
    const ring = (r: number, level: number) => ({
      points: Array.from({ length: 64 }, (_, i) => ({ x: 200 + r * Math.cos((i / 64) * 2 * Math.PI), y: 200 + r * Math.sin((i / 64) * 2 * Math.PI) })),
      closed: true, level, t: level / 2,
    });
    const kept = pruneCrowded([ring(50, 0), ring(54, 1), ring(80, 2)], 10);
    expect(kept.map((l) => l.level)).toEqual([0, 2]);
  });

  it('measures crowding between stroke edges, so thin lines fit where full-width lines would not', () => {
    const ring = (r: number, level: number): RakeLine => {
      const points: Point[] = [];
      for (let i = 0; i < 180; i++) {
        const a = (i / 180) * Math.PI * 2;
        points.push({ x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) });
      }
      return { points, closed: true, level, t: level };
    };
    // Centres 6 apart, 3 of clear gap wanted: two 8-wide strokes overlap and the second ring goes; two 2-wide strokes leave 4 clear and both stay.
    const wide = pruneCrowded([ring(50, 0), ring(56, 1)], 3, 3, 0, () => 8);
    expect(wide).toHaveLength(1);
    const thin = pruneCrowded([ring(50, 0), ring(56, 1)], 3, 3, 0, () => 2);
    expect(thin).toHaveLength(2);
    // A thin line next to a wide one: 5 of stroke between centres 6 apart leaves 1, under the 3 wanted.
    const mixed = pruneCrowded([ring(50, 0), ring(56, 1)], 3, 3, 0, (l) => (l.level === 0 ? 8 : 2));
    expect(mixed).toHaveLength(1);
  });

  it('Width Variation keeps more of a crowded pond, with no strokes overlapping', () => {
    const rocks: Rock[] = [{ x: 180, y: 170, elevation: 1 }, { x: 455, y: 530, elevation: 1 }];
    const base = params({ strokeWidth: 8, minGap: 6, contourSource: 'pond', rockSpread: 200, contourNoiseMix: 0.25, contourScale: 510, rakeMinLength: 1 });
    const boundary: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 628, height: 724 };
    const length = (lines: RakeLine[]) => lines.reduce((sum, l) => {
      const pts = l.closed ? [...l.points, l.points[0]] : l.points;
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return sum + s;
    }, 0);
    const flat = generateRakeLines(boundary, { ...base, rakeWidthVariation: 0 }, rocks);
    const varied = generateRakeLines(boundary, { ...base, rakeWidthVariation: 1 }, rocks);
    expect(length(varied)).toBeGreaterThan(length(flat) * 1.15);
    // Strokes never overlap: every pair of lines keeps at least half of each width between centres.
    const all = varied.flatMap((l, i) => l.points.map((p) => ({ ...p, i, w: rakeLineWidth({ ...base, rakeWidthVariation: 1 }, l.t) })));
    let overlaps = 0;
    for (let a = 0; a < all.length; a += 2) {
      for (let b = a + 1; b < all.length; b += 2) {
        if (all[a].i === all[b].i) continue;
        const d = Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y);
        if (d < (all[a].w + all[b].w) / 2 - 0.5) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('keeps a ring that wobbles around the crowding distance whole instead of dashing it', () => {
    const ring = (r: number, level: number, wobble = 0): RakeLine => {
      const points: Point[] = [];
      for (let a = 0; a < 360; a += 2) {
        const rr = r + wobble * Math.sin((a * Math.PI) / 180 * 18);
        points.push({ x: 200 + rr * Math.cos((a * Math.PI) / 180), y: 200 + rr * Math.sin((a * Math.PI) / 180) });
      }
      return { points, closed: true, level, t: level };
    };
    // 10.8 ± 1.2 px from the inner ring: in and out of a 10 px threshold every few px.
    const flicker = pruneCrowded([ring(50, 0), ring(60.8, 1, 1.2)], 10, 21, 8);
    expect(flicker.length).toBe(2);
    expect(flicker[1].closed).toBe(true);
    // The same wobble 9 px out is too close over most of its length: dropped whole, not dashed.
    const tooClose = pruneCrowded([ring(50, 0), ring(59, 1, 1.2)], 10, 21, 8);
    expect(tooClose.length).toBe(1);
    // A short dip that would make the strokes overlap still cuts.
    const dip = ring(62, 1);
    for (let k = 40; k < 44; k++) dip.points[k] = { x: 200 + 56.5 * Math.cos((k * 2 * Math.PI) / 180), y: 200 + 56.5 * Math.sin((k * 2 * Math.PI) / 180) };
    const cut = pruneCrowded([ring(50, 0), dip], 10, 21, 8);
    expect(cut.length).toBe(2);
    expect(cut[1].closed).toBe(false);
  });
});
