import { Waypoint, GenerationParams, RenderedPath } from '../types';
import { createSeededRandom } from './random';

function splitAtSegmentBoundaries(waypoints: Waypoint[]): Waypoint[][] {
  const subPaths: Waypoint[][] = [];
  let current: Waypoint[] = [];

  for (const wp of waypoints) {
    if (wp.type === 'segment-start' && current.length > 0) {
      subPaths.push(current);
      current = [wp];
    } else {
      current.push(wp);
    }
  }

  if (current.length >= 2) {
    subPaths.push(current);
  }

  return subPaths;
}

function isClosedRun(waypoints: Waypoint[]): boolean {
  if (waypoints.length < 4) return false;
  const a = waypoints[0];
  const b = waypoints[waypoints.length - 1];
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function waypointsToSvgPath(
  waypoints: Waypoint[],
  cornerRadius: number,
  isRounded: boolean,
  radiusFor: (wp: Waypoint) => number | undefined,
  closed: boolean
): string {
  if (waypoints.length < 2) return '';
  // A closed loop (Trace "Closed Loop") arrives with first == last mid-run.
  // Emit it with Z so flat caps show no seam at the joint.
  const tail = closed ? ' Z' : '';

  if (!isRounded) {
    let d = `M ${waypoints[0].x} ${waypoints[0].y}`;
    for (let i = 1; i < waypoints.length; i++) {
      d += ` L ${waypoints[i].x} ${waypoints[i].y}`;
    }
    return d + tail;
  }

  let d = `M ${waypoints[0].x} ${waypoints[0].y}`;

  for (let i = 1; i < waypoints.length; i++) {
    if (i < waypoints.length - 1) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const next = waypoints[i + 1];

      const d1x = curr.x - prev.x;
      const d1y = curr.y - prev.y;
      const d2x = next.x - curr.x;
      const d2y = next.y - curr.y;

      const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y);

      if (len1 === 0 || len2 === 0) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }

      const n1x = d1x / len1;
      const n1y = d1y / len1;
      const n2x = d2x / len2;
      const n2y = d2y / len2;

      // Deflection angle between the incoming and outgoing legs.
      const dot = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y));
      const theta = Math.acos(dot);
      if (theta < 1e-6) {
        // Collinear: no corner to round.
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }
      const tanHalf = Math.tan(theta / 2);

      // Per-corner radius from the clearance/concentric solver, falling back
      // to the user's radius.
      const maxLeg = Math.min(len1 / 2, len2 / 2);
      const targetR = radiusFor(curr) ?? cornerRadius;

      // Tangent length along each leg for a circular arc of radius R meeting
      // both legs tangentially is R * tan(theta / 2). Clamp it to half a leg
      // and derive the radius that actually fits.
      const t = Math.min(targetR * tanHalf, maxLeg);
      const r = t / tanHalf;

      if (t <= 1e-6) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }

      const ax = curr.x - n1x * t;
      const ay = curr.y - n1y * t;
      const bx = curr.x + n2x * t;
      const by = curr.y + n2y * t;

      const cross = n1x * n2y - n1y * n2x;
      const sweep = cross > 0 ? 1 : 0;

      d += ` L ${ax} ${ay}`;
      d += ` A ${r} ${r} 0 0 ${sweep} ${bx} ${by}`;
    } else {
      d += ` L ${waypoints[i].x} ${waypoints[i].y}`;
    }
  }

  return d + tail;
}


// ---------------------------------------------------------------------------
// Corner radius solver
//
// The user's "Corner Radius" is the minimum centerline radius. "Ring Harmony"
// (0..1) lets corners grow into whatever room they have:
//   - a corner with empty space inside grows until its arc would come within
//     one cell (stroke + gap) of any other stroke, up to a 2-cell cap;
//   - a corner nested directly inside a matching corner gets that corner's
//     radius plus one cell, so stacked turns render as concentric rings;
//   - a hairpin cannot grow: its legs are one cell apart, so its inner edge
//     radius is physically capped at half the gap.
// ---------------------------------------------------------------------------

interface Corner {
  wp: Waypoint;
  subIdx: number;
  idx: number;
  n1x: number; n1y: number;
  n2x: number; n2y: number;
  maxLeg: number;
  is90: boolean;
}

/** |cos| below which a corner still counts as a right angle (jitter tilts corners a few degrees). */
const NEAR_90_DOT = 0.3;
/** cos above which two directions count as the same (nested corners with jitter). */
const SAME_DIR_DOT = 0.9;

function solveCornerRadii(subPaths: Waypoint[][], params: GenerationParams): Map<Waypoint, number> {
  const out = new Map<Waypoint, number>();
  const cell = params.strokeWidth + params.minGap;
  const base = params.cornerRadius;
  const growth = params.ringHarmony;
  if (cell <= 0 || subPaths.length === 0) return out;

  const x0 = subPaths[0][0].x;
  const y0 = subPaths[0][0].y;
  const toCell = (x: number, y: number) => ({
    c: Math.round((x - x0) / cell),
    r: Math.round((y - y0) / cell),
  });
  const key = (c: number, r: number) => `${c},${r}`;

  // Rasterise every sub-path into cells so we know what sits where.
  // occupied: cell -> list of (subIdx, path position in cells)
  const occupied = new Map<string, Array<{ sub: number; pos: number }>>();
  const cornerAt = new Map<string, Corner>();
  const corners: Corner[] = [];

  subPaths.forEach((sp, subIdx) => {
    let pos = 0;
    for (let i = 0; i < sp.length; i++) {
      const a = toCell(sp[i].x, sp[i].y);
      if (i === 0) {
        const k = key(a.c, a.r);
        if (!occupied.has(k)) occupied.set(k, []);
        occupied.get(k)!.push({ sub: subIdx, pos });
      }
      if (i < sp.length - 1) {
        const b = toCell(sp[i + 1].x, sp[i + 1].y);
        const steps = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
        for (let s = 1; s <= steps; s++) {
          const c = Math.round(a.c + ((b.c - a.c) * s) / steps);
          const r = Math.round(a.r + ((b.r - a.r) * s) / steps);
          pos++;
          const k = key(c, r);
          if (!occupied.has(k)) occupied.set(k, []);
          occupied.get(k)!.push({ sub: subIdx, pos });
        }
      }
    }
  });

  subPaths.forEach((sp, subIdx) => {
    let pos = 0;
    for (let i = 0; i < sp.length; i++) {
      if (i > 0) {
        const a = toCell(sp[i - 1].x, sp[i - 1].y);
        const b = toCell(sp[i].x, sp[i].y);
        pos += Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
      }
      if (i === 0 || i === sp.length - 1) continue;
      const prev = sp[i - 1], curr = sp[i], next = sp[i + 1];
      const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
      const d2x = next.x - curr.x, d2y = next.y - curr.y;
      const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
      if (len1 === 0 || len2 === 0) continue;
      const n1x = d1x / len1, n1y = d1y / len1, n2x = d2x / len2, n2y = d2y / len2;
      const dot = n1x * n2x + n1y * n2y;
      if (dot > 0.9999) continue; // collinear
      const corner: Corner = {
        wp: curr, subIdx, idx: pos,
        n1x, n1y, n2x, n2y,
        maxLeg: Math.min(len1 / 2, len2 / 2),
        is90: Math.abs(dot) < NEAR_90_DOT,
      };
      corners.push(corner);
      const cc = toCell(curr.x, curr.y);
      cornerAt.set(key(cc.c, cc.r), corner);
    }
  });

  const memo = new Map<Corner, number>();
  const visiting = new Set<Corner>();

  const clearanceRadius = (k: Corner): number => {
    // Largest radius in [base, cap] whose arc keeps one cell of clearance
    // from every stroke that is not this corner's own neighbourhood.
    const cap = Math.min(k.maxLeg, base + (2 * cell - base) * growth);
    if (cap <= base) return Math.min(base, k.maxLeg);
    const cosT = Math.max(-1, Math.min(1, k.n1x * k.n2x + k.n1y * k.n2y));
    const theta = Math.acos(cosT);
    const tanHalf = Math.tan(theta / 2);
    const step = cell / 8;
    const minDist = cell * 0.97;
    for (let R = cap; R >= base; R -= step) {
      const t = Math.min(R * tanHalf, k.maxLeg);
      const r = t / tanHalf;
      // Arc centre: offset from the corner along the bisector of (-n1, n2).
      const bx = -k.n1x + k.n2x, by = -k.n1y + k.n2y;
      const bl = Math.hypot(bx, by);
      // Centre sits on the bisector at r / cos(theta/2) from the corner.
      const dist = r / Math.cos(theta / 2);
      const ox = k.wp.x + (bx / bl) * dist, oy = k.wp.y + (by / bl) * dist;
      const ax = k.wp.x - k.n1x * t, ay = k.wp.y - k.n1y * t;
      const exx = k.wp.x + k.n2x * t, exy = k.wp.y + k.n2y * t;
      const a0 = Math.atan2(ay - oy, ax - ox);
      const a1 = Math.atan2(exy - oy, exx - ox);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const reach = Math.ceil(t / cell) + 2;
      let ok = true;
      for (let si = 1; si < 6 && ok; si++) {
        const ang = a0 + (da * si) / 6;
        const px = ox + r * Math.cos(ang), py = oy + r * Math.sin(ang);
        const pc = toCell(px, py);
        for (let dc = -2; dc <= 2 && ok; dc++) {
          for (let dr = -2; dr <= 2 && ok; dr++) {
            const occ = occupied.get(key(pc.c + dc, pc.r + dr));
            if (!occ) continue;
            const cx = x0 + (pc.c + dc) * cell, cy = y0 + (pc.r + dr) * cell;
            const d = Math.hypot(px - cx, py - cy);
            if (d >= minDist) continue;
            // Too close: fine only if every occupant is this corner's own run.
            for (const o of occ) {
              if (o.sub === k.subIdx && Math.abs(o.pos - k.idx) <= reach) continue;
              ok = false; break;
            }
          }
        }
      }
      if (ok) return R;
    }
    return Math.min(base, k.maxLeg);
  };

  const solve = (k: Corner): number => {
    const m = memo.get(k);
    if (m !== undefined) return m;
    if (visiting.has(k)) return base;
    visiting.add(k);
    let r: number;
    if (k.is90 && growth > 0) {
      // Cell diagonally inside the turn.
      const cc = toCell(k.wp.x, k.wp.y);
      const inner = cornerAt.get(key(cc.c + Math.round(-k.n1x + k.n2x), cc.r + Math.round(-k.n1y + k.n2y)));
      const sameTurn = inner && inner.is90 &&
        inner.n1x * k.n1x + inner.n1y * k.n1y > SAME_DIR_DOT &&
        inner.n2x * k.n2x + inner.n2y * k.n2y > SAME_DIR_DOT;
      if (sameTurn && inner) {
        // Concentric with the nested corner; shrink only if our legs are short.
        r = Math.min(solve(inner) + cell, k.maxLeg);
        r = Math.max(r, Math.min(base, k.maxLeg));
      } else {
        r = clearanceRadius(k);
      }
    } else {
      r = growth > 0 ? clearanceRadius(k) : Math.min(base, k.maxLeg);
    }
    visiting.delete(k);
    memo.set(k, r);
    return r;
  };

  for (const k of corners) out.set(k.wp, solve(k));
  return out;
}

function splitWithGaps(
  waypoints: Waypoint[],
  params: GenerationParams
): Waypoint[][] {
  if (!params.gapsEnabled || waypoints.length < 3) return [waypoints];

  const rng = createSeededRandom(params.seed + 7919);

  const segLengths: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    segLengths.push(Math.sqrt(dx * dx + dy * dy));
  }

  const runs: Waypoint[][] = [];
  let currentRun: Waypoint[] = [waypoints[0]];
  let distAccum = 0;
  let nextGapAt = rng.nextFloat(params.gapFrequencyMin, params.gapFrequencyMax);
  let inGap = false;
  let gapRemaining = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];

    if (inGap) {
      gapRemaining -= segLen;
      if (gapRemaining <= 0) {
        inGap = false;
        distAccum = 0;
        nextGapAt = rng.nextFloat(params.gapFrequencyMin, params.gapFrequencyMax);
        currentRun = [waypoints[i + 1]];
      }
      continue;
    }

    distAccum += segLen;
    currentRun.push(waypoints[i + 1]);

    if (distAccum >= nextGapAt && currentRun.length >= 2 && i < segLengths.length - 1) {
      runs.push(currentRun);
      inGap = true;
      gapRemaining = rng.nextFloat(params.minGapLength, params.maxGapLength);
      currentRun = [];
    }
  }

  if (currentRun.length >= 2) {
    runs.push(currentRun);
  }

  return runs.length > 0 ? runs : [waypoints];
}

/**
 * Rake lines are smooth polylines already, one run per 'start'; a run whose
 * ends coincide is closed with Z. Width follows the line's level by
 * `rakeWidthVariation`, never above strokeWidth so the gap holds.
 */
function renderRakePaths(waypoints: Waypoint[], params: GenerationParams): RenderedPath[] {
  const results: RenderedPath[] = [];
  const v = Math.max(-1, Math.min(1, params.rakeWidthVariation));
  const fmt = (n: number) => Number(n.toFixed(2));
  let run: Waypoint[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const first = run[0], last = run[run.length - 1];
      const closed = run.length >= 4 && Math.hypot(first.x - last.x, first.y - last.y) < 0.5;
      const pts = closed ? run.slice(0, -1) : run;
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ') + (closed ? ' Z' : '');
      const t = first.level ?? 0.5;
      const thin = v > 0 ? 1 - t : t;
      const factor = 1 - Math.abs(v) * thin * 0.8;
      results.push({ d, strokeWidth: fmt(params.strokeWidth * factor) });
    }
    run = [];
  };
  for (const wp of waypoints) {
    if (wp.type === 'start' && run.length > 0) flush();
    run.push(wp);
  }
  flush();
  return results;
}

export function renderPaths(
  waypoints: Waypoint[],
  params: GenerationParams
): RenderedPath[] {
  if (waypoints.length < 2) return [];
  if (params.patternMode === 'rake') return renderRakePaths(waypoints, params);

  const isRounded = params.turnStyle === 'rounded';
  const subPaths = splitAtSegmentBoundaries(waypoints);
  const results: RenderedPath[] = [];
  const radii = isRounded ? solveCornerRadii(subPaths, params) : new Map<Waypoint, number>();
  const radiusFor = (wp: Waypoint) => radii.get(wp);

  for (const subPath of subPaths) {
    const runs = splitWithGaps(subPath, params);

    for (const run of runs) {
      const closed = !params.gapsEnabled && runs.length === 1 && isClosedRun(run);
      const path = waypointsToSvgPath(run, params.cornerRadius, isRounded, radiusFor, closed);
      if (path) {
        results.push({ d: path, strokeWidth: params.strokeWidth });
      }
    }
  }

  return results;
}
