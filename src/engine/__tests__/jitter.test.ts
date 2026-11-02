import { describe, it, expect } from 'vitest';
import { BoundaryShape, GenerationParams, DEFAULT_PARAMS, Waypoint } from '../../types';
import { generateSerpentine } from '../serpentineGenerator';
import { applyJitter, jitterLimit, JITTER_MAX_GAP_FRACTION } from '../jitter';
import { renderPaths } from '../pathRenderer';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 400, height: 420 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 360, height: 360 };

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'serpentine', fillMode: 'trace', seed: 3, ...over };
}

/** Shortest distance between two segments (p1-p2, q1-q2). */
function segDist(p1: Waypoint, p2: Waypoint, q1: Waypoint, q2: Waypoint): number {
  const ptSeg = (p: Waypoint, a: Waypoint, b: Waypoint) => {
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  };
  const orient = (a: Waypoint, b: Waypoint, c: Waypoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(ptSeg(q1, p1, p2), ptSeg(q2, p1, p2), ptSeg(p1, q1, q2), ptSeg(p2, q1, q2));
}

/** Smallest centerline distance between non-adjacent segments of one open run. */
function minNonAdjacentDistance(wps: Waypoint[]): number {
  let min = Infinity;
  for (let i = 0; i + 1 < wps.length; i++) {
    for (let j = i + 2; j + 1 < wps.length; j++) {
      const d = segDist(wps[i], wps[i + 1], wps[j], wps[j + 1]);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('jitter', () => {
  it('is a no-op at 0 and bounded by the gap fraction otherwise', () => {
    const base = generateSerpentine(RECT, params({ jitter: 0 })).waypoints;
    expect(applyJitter(base, params({ jitter: 0 }))).toBe(base);
    for (const jitter of [0.25, 0.5, 1]) {
      const p = params({ jitter });
      const moved = applyJitter(base, p);
      const limit = jitterLimit(p);
      expect(limit).toBeCloseTo(jitter * JITTER_MAX_GAP_FRACTION * p.minGap);
      let maxShift = 0;
      for (let i = 0; i < base.length; i++) {
        maxShift = Math.max(maxShift, Math.hypot(moved[i].x - base[i].x, moved[i].y - base[i].y));
        expect(moved[i].type).toBe(base[i].type);
      }
      expect(maxShift).toBeLessThanOrEqual(limit + 1e-9);
      expect(maxShift).toBeGreaterThan(limit * 0.5);
    }
  });

  it('is deterministic and position-keyed, so coincident anchors stay coincident', () => {
    const p = params({ jitter: 1, closedLoop: true });
    const a = generateSerpentine(RECT, p).waypoints;
    const b = generateSerpentine(RECT, p).waypoints;
    expect(b).toEqual(a);
    const first = a[0], last = a[a.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1e-9);
  });

  it.each([1, 2, 42])('never lets non-adjacent lines touch at full jitter (seed %i)', (seed) => {
    for (const shape of [RECT, ELLIPSE]) {
      const p = params({ seed, jitter: 1 });
      const wps = generateSerpentine(shape, p).waypoints;
      const clean = generateSerpentine(shape, params({ seed, jitter: 0 })).waypoints;
      // Centerlines of the clean layout are one cell apart; edges one gap apart.
      const cleanMin = minNonAdjacentDistance(clean);
      expect(cleanMin).toBeGreaterThanOrEqual(p.strokeWidth + p.minGap - 1e-6);
      const jitterMin = minNonAdjacentDistance(wps);
      // Edges must keep (1 - 2 * fraction) of the gap between them.
      expect(jitterMin).toBeGreaterThanOrEqual(p.strokeWidth + (1 - 2 * JITTER_MAX_GAP_FRACTION) * p.minGap - 1e-6);
    }
  });

  it('renders rounded corners on a jittered path', () => {
    const p = params({ seed: 7, jitter: 1 });
    const result = generateSerpentine(RECT, p);
    const paths = renderPaths(result.waypoints, p);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].d).toContain(' A ');
    expect(paths[0].d).not.toContain('NaN');
  });
});
