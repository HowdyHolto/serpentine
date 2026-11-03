import { BoundaryShape, GenerationParams, PathStructure, Point, Rock, Waypoint } from '../types';
import { pointInPolygon } from './geometry';
import { createValueNoise } from './noise';

/**
 * Rake: iso-lines of a terrain drawn as separate lines, like a raked zen
 * garden or a topographic map, instead of one serpentine line. Lines never
 * cross (they are level sets of one continuous field); their spacing is the
 * terrain's: exactly one cell apart over a distance field (Garden), denser
 * on steep ground over a height field (Pond, Noise).
 */
export interface RakeLine {
  points: Point[];
  closed: boolean;
  /** The field value this line follows. */
  level: number;
  /** 0 at the lowest level, 1 at the highest. */
  t: number;
}

export type Sampler = (x: number, y: number) => number;

/**
 * Drawn width of a rake line at level `t` (0 lowest, 1 highest): Width
 * Variation thins one end down to a fifth of the stroke, never above the
 * stroke width so the gap holds. The renderer and the crowding pass share
 * it, so a thin line is only cut where a thin line would not fit.
 */
export function rakeLineWidth(params: GenerationParams, t: number): number {
  const v = Math.max(-1, Math.min(1, params.rakeWidthVariation));
  const thin = v > 0 ? 1 - t : t;
  return params.strokeWidth * (1 - Math.abs(v) * thin * 0.8);
}

/** Distance from (x, y) to the boundary's edge in px, negative outside. */
export function edgeDistance(boundary: BoundaryShape, x: number, y: number): number {
  if (boundary.type === 'ellipse') {
    const rx = boundary.width / 2, ry = boundary.height / 2;
    const dx = (x - boundary.x - rx) / rx, dy = (y - boundary.y - ry) / ry;
    return (1 - Math.hypot(dx, dy)) * Math.min(rx, ry);
  }
  if (boundary.type === 'path' && boundary.points && boundary.points.length >= 3) {
    const pts = boundary.points;
    let min = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j].x, ay = pts[j].y, bx = pts[i].x, by = pts[i].y;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2)) : 0;
      const d = Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
      if (d < min) min = d;
    }
    return pointInPolygon(x, y, pts) ? min : -min;
  }
  return Math.min(x - boundary.x, boundary.x + boundary.width - x, y - boundary.y, boundary.y + boundary.height - y);
}

/** The Contour terrain as a function of world position (px). */
export function terrainSampler(boundary: BoundaryShape, params: GenerationParams, rocks: Rock[]): Sampler {
  const noise = createValueNoise(params.seed, Math.max(1, params.contourScale));
  const source = params.contourSource;
  if (source === 'garden') {
    const edgeWeight = Math.min(1, Math.max(0, params.rockEdge));
    // A lower edge influence pushes the edge's rings back (an offset, not a
    // scale, so they stay one cell apart) and the rocks claim more ground.
    const edgeOffset = (1 - edgeWeight) * Math.max(boundary.width, boundary.height) * 0.5;
    return (x, y) => {
      let v = Infinity;
      for (const r of rocks) {
        const d = Math.hypot(x - r.x, y - r.y) / Math.pow(2, r.elevation);
        if (d < v) v = d;
      }
      if (edgeWeight > 0) {
        const d = Math.max(0, edgeDistance(boundary, x, y)) + edgeOffset;
        if (d < v) v = d;
      }
      return v === Infinity ? 0 : v;
    };
  }
  if (source === 'pond' && (rocks.length > 0 || params.contourNoiseMix > 0)) {
    const spread = Math.max(1, params.rockSpread);
    const mix = Math.min(1, Math.max(0, params.contourNoiseMix));
    return (x, y) => {
      let v = 0;
      for (const r of rocks) {
        const d2 = (x - r.x) * (x - r.x) + (y - r.y) * (y - r.y);
        v += r.elevation * Math.exp(-d2 / (spread * spread));
      }
      if (mix > 0) v += mix * (noise(x, y) - 0.5) * 2;
      return v;
    };
  }
  return (x, y) => noise(x, y);
}

function isInside(boundary: BoundaryShape, x: number, y: number): boolean {
  return edgeDistance(boundary, x, y) >= 0;
}

/**
 * Marching squares over a sample grid of spacing `step`, for each level in
 * `levels`. Segments are chained into polylines. Cells with any corner
 * outside the boundary are skipped, so lines end at the edge.
 */
export function isoLines(
  boundary: BoundaryShape,
  sample: Sampler,
  step: number,
  levels: number[]
): RakeLine[] {
  const nx = Math.max(2, Math.ceil(boundary.width / step) + 1);
  const ny = Math.max(2, Math.ceil(boundary.height / step) + 1);
  const x0 = boundary.x, y0 = boundary.y;
  const v = new Float64Array(nx * ny);
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, y = y0 + j * step;
      const k = j * nx + i;
      inside[k] = isInside(boundary, x, y) ? 1 : 0;
      v[k] = inside[k] ? sample(x, y) : 0;
    }
  }
  const lo = levels.length ? Math.min(...levels) : 0;
  const hi = levels.length ? Math.max(...levels) : 1;
  const out: RakeLine[] = [];
  for (const L of levels) {
    const segs: Array<[number, number, number, number]> = [];
    const lerp = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): [number, number] => {
      const t = vb === va ? 0.5 : (L - va) / (vb - va);
      return [xa + (xb - xa) * t, ya + (yb - ya) * t];
    };
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const k = j * nx + i;
        if (!inside[k] || !inside[k + 1] || !inside[k + nx] || !inside[k + nx + 1]) continue;
        const a = v[k], b = v[k + 1], c = v[k + nx + 1], d = v[k + nx];
        const idx = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const xa = x0 + i * step, ya = y0 + j * step, xb = xa + step, yb = ya + step;
        const top = () => lerp(xa, ya, a, xb, ya, b);
        const right = () => lerp(xb, ya, b, xb, yb, c);
        const bottom = () => lerp(xa, yb, d, xb, yb, c);
        const left = () => lerp(xa, ya, a, xa, yb, d);
        const push = (p: [number, number], q: [number, number]) => {
          // A contour through a grid vertex yields a zero-length segment; skip it.
          if (Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9) segs.push([p[0], p[1], q[0], q[1]]);
        };
        switch (idx) {
          case 1: case 14: push(left(), bottom()); break;
          case 2: case 13: push(bottom(), right()); break;
          case 3: case 12: push(left(), right()); break;
          case 4: case 11: push(top(), right()); break;
          case 5: push(left(), top()); push(bottom(), right()); break;
          case 6: case 9: push(top(), bottom()); break;
          case 7: case 8: push(left(), top()); break;
          case 10: push(top(), right()); push(left(), bottom()); break;
        }
      }
    }
    for (const line of chain(segs)) {
      out.push({ points: line.points, closed: line.closed, level: L, t: hi > lo ? (L - lo) / (hi - lo) : 0 });
    }
  }
  return out;
}

function chain(segs: Array<[number, number, number, number]>): Array<{ points: Point[]; closed: boolean }> {
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines: Array<{ points: Point[]; closed: boolean }> = [];
  const extend = (pts: Point[], atFront: boolean) => {
    for (;;) {
      const p = atFront ? pts[0] : pts[pts.length - 1];
      const cands = ends.get(key(p.x, p.y)) ?? [];
      let next = -1;
      for (const c of cands) if (!used[c]) { next = c; break; }
      if (next < 0) return;
      used[next] = 1;
      const s = segs[next];
      const atStart = key(s[0], s[1]) === key(p.x, p.y);
      const q = atStart ? { x: s[2], y: s[3] } : { x: s[0], y: s[1] };
      if (atFront) pts.unshift(q);
      else pts.push(q);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i];
    const pts: Point[] = [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }];
    extend(pts, false);
    extend(pts, true);
    const first = pts[0], last = pts[pts.length - 1];
    const closed = pts.length > 3 && key(first.x, first.y) === key(last.x, last.y);
    if (closed) pts.pop();
    lines.push({ points: pts, closed });
  }
  return lines;
}

/** Chaikin corner cutting, keeping the ends of open lines. */
export function smooth(points: Point[], closed: boolean, iterations: number): Point[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out: Point[] = [];
    const n = pts.length;
    const count = closed ? n : n - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < count; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/** Drop points that barely bend the line (Ramer-Douglas-Peucker). */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a].x, ay = points[a].y, bx = points[b].x, by = points[b].y;
    const len = Math.hypot(bx - ax, by - ay);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const d = len > 0 ? Math.abs((bx - ax) * (ay - p.y) - (ax - p.x) * (by - ay)) / len : Math.hypot(p.x - ax, p.y - ay);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Rake lines for a boundary, terrain and spacing. Over a distance field the
 * levels are one cell apart, so lines are exactly a gap apart; over a height
 * field the levels are spaced so the mean spacing is one cell, and lines
 * bunch on steep ground. Lines closer than the stroke width would overlap,
 * so levels never go denser than `minSpacingFraction` of a cell on average.
 */
export function generateRakeLines(boundary: BoundaryShape, params: GenerationParams, rocks: Rock[]): RakeLine[] {
  const cell = params.strokeWidth + params.minGap;
  const sample = terrainSampler(boundary, params, rocks);
  const step = Math.max(1, cell / 3);
  // Range and mean gradient of the field over the boundary.
  let min = Infinity, max = -Infinity, gradSum = 0, gradN = 0;
  for (let y = boundary.y; y <= boundary.y + boundary.height; y += step * 2) {
    for (let x = boundary.x; x <= boundary.x + boundary.width; x += step * 2) {
      if (!isInside(boundary, x, y)) continue;
      const v = sample(x, y);
      if (v < min) min = v;
      if (v > max) max = v;
      const gx = (sample(x + step, y) - sample(x - step, y)) / (2 * step);
      const gy = (sample(x, y + step) - sample(x, y - step)) / (2 * step);
      gradSum += Math.hypot(gx, gy);
      gradN++;
    }
  }
  if (!(max > min)) return [];
  const meanGrad = gradN > 0 ? gradSum / gradN : 1;
  const spacing = params.contourSource === 'garden' ? cell : Math.max(1e-9, meanGrad * cell);
  const levels: number[] = [];
  for (let L = min + spacing / 2; L < max; L += spacing) levels.push(L);
  let lines = isoLines(boundary, sample, step, levels).map((l) => ({ ...l, points: smooth(l.points, l.closed, 2) }));
  if (params.contourSource !== 'garden') {
    // Height-field lines bunch on steep ground; cut them where they would overlap.
    lines = pruneCrowded(lines, params.minGap * 0.5, cell * 1.5, 0, (l) => rakeLineWidth(params, l.t));
  }
  return lines.map((l) => ({ ...l, points: simplify(l.points, 0.25) }));
}

/**
 * Keep lines at least `minDist` from each other, in level order: a line is
 * cut wherever it comes within minDist of a line already kept, and pieces
 * shorter than `bridge` are dropped. Topographic maps do the same where
 * contours crowd.
 *
 * With hysteresis, so a line hovering at the threshold does not flicker
 * into dashes: a line crowded over more than half its length is dropped
 * whole (it is the next ring in, a hair too close everywhere), and a
 * crowded stretch shorter than `bridge` (a grazing contact, or sampling
 * wobble) is bridged rather than cut, unless it comes within `touch` of
 * the other line (the strokes would overlap), which always cuts.
 *
 * With `width`, distances are between stroke edges rather than centres:
 * `minDist` and `touch` are then the clear gap to keep, and a line that
 * is drawn thin is cut only where a thin line would not fit.
 */
export function pruneCrowded(
  lines: RakeLine[],
  minDist: number,
  bridge: number = minDist,
  touch = 0,
  width?: (line: RakeLine) => number
): RakeLine[] {
  const widthOf = (line: RakeLine) => (width ? width(line) : 0);
  const maxWidth = lines.reduce((m, l) => Math.max(m, widthOf(l)), 0);
  // Centre distance within which two strokes can still be closer than minDist.
  const reach = minDist + maxWidth;
  const bucket = Math.max(1e-6, reach);
  const hash = new Map<string, Array<Point & { w: number }>>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / bucket)},${Math.floor(y / bucket)}`;
  /** Smallest edge-to-edge gap to a kept line within minDist, or Infinity. */
  const nearest = (p: Point, w: number): number => {
    const bx = Math.floor(p.x / bucket), by = Math.floor(p.y / bucket);
    let best = Infinity;
    for (let j = by - 1; j <= by + 1; j++) {
      for (let i = bx - 1; i <= bx + 1; i++) {
        const list = hash.get(`${i},${j}`);
        if (!list) continue;
        for (const q of list) {
          const d = Math.hypot(q.x - p.x, q.y - p.y) - (q.w + w) / 2;
          if (d < best) best = d;
        }
      }
    }
    return best < minDist ? best : Infinity;
  };
  const accept = (pts: Point[], w: number) => {
    for (const p of pts) {
      const k = keyOf(p.x, p.y);
      const list = hash.get(k);
      const entry = { x: p.x, y: p.y, w };
      if (list) list.push(entry);
      else hash.set(k, [entry]);
    }
  };
  const out: RakeLine[] = [];
  const order = [...lines].sort((a, b) => a.level - b.level);
  for (const line of order) {
    const pts = line.closed ? [...line.points, line.points[0]] : line.points;
    const w = widthOf(line);
    const dist = pts.map((p) => nearest(p, w));
    const flags = dist.map((d) => d < minDist);
    // Mostly crowded: this is the next ring in, a hair too close all round. Drop it whole.
    let total = 0, crowdedLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      total += d;
      if (flags[i] && flags[i - 1]) crowdedLen += d;
    }
    if (total > 0 && crowdedLen > total * 0.5) continue;
    // A grazing contact or sampling wobble crowds only a short stretch; bridging it beats a stray cut.
    for (let i = 0; i < pts.length; ) {
      if (!flags[i]) { i++; continue; }
      let j = i;
      let len = 0;
      while (j + 1 < pts.length && flags[j + 1]) {
        len += Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y);
        j++;
      }
      const interior = i > 0 && j < pts.length - 1;
      let touching = false;
      for (let k = i; k <= j && !touching; k++) if (dist[k] < touch) touching = true;
      if (interior && len < bridge && !touching) for (let k = i; k <= j; k++) flags[k] = false;
      i = j + 1;
    }
    let run: Point[] = [];
    const pieces: Point[][] = [];
    pts.forEach((p, i) => {
      if (flags[i]) {
        if (run.length > 1) pieces.push(run);
        run = [];
      } else {
        run.push(p);
      }
    });
    if (run.length > 1) pieces.push(run);
    const intact = pieces.length === 1 && pieces[0].length === pts.length;
    // A cut ring's first and last pieces meet at the seam point; join them.
    if (line.closed && !intact && pieces.length >= 2 && pieces[0][0] === pts[0] && pieces[pieces.length - 1][pieces[pieces.length - 1].length - 1] === pts[pts.length - 1]) {
      const last = pieces.pop()!;
      pieces[0] = [...last.slice(0, -1), ...pieces[0]];
    }
    for (const piece of pieces) {
      let len = 0;
      for (let i = 1; i < piece.length; i++) len += Math.hypot(piece[i].x - piece[i - 1].x, piece[i].y - piece[i - 1].y);
      if (len < bridge) continue;
      const closed = intact && line.closed;
      out.push({ ...line, points: closed ? piece.slice(0, -1) : piece, closed });
      accept(piece, w);
    }
  }
  return out;
}

/** Rake lines as waypoint runs: each line starts with a 'start' carrying its level and ends with an 'end'. */
export function generateRake(
  boundary: BoundaryShape,
  params: GenerationParams,
  rocks: Rock[]
): { waypoints: Waypoint[]; structure: PathStructure; fillRatio: number } {
  const cell = params.strokeWidth + params.minGap;
  const waypoints: Waypoint[] = [];
  const minLength = Math.max(1, params.rakeMinLength) * cell;
  for (const line of generateRakeLines(boundary, params, rocks)) {
    const pts = line.closed ? [...line.points, line.points[0]] : line.points;
    if (pts.length < 2) continue;
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    // Strays: fragments left where lines narrow at a junction.
    if (length < minLength) continue;
    pts.forEach((p, i) => {
      waypoints.push({
        x: p.x,
        y: p.y,
        type: i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'turn',
        ...(i === 0 ? { level: line.t } : {}),
      });
    });
  }
  return { waypoints, structure: { endCapPairs: [], segments: [], cellSize: cell }, fillRatio: 1 };
}
