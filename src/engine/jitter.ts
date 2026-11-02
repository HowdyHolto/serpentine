import { GenerationParams, Waypoint } from '../types';
import { createValueNoise } from './noise';

/**
 * The largest nudge an anchor may take, as a fraction of the line gap. Two
 * neighbouring strokes are one gap apart edge to edge; if each anchor moves
 * at most JITTER_MAX_GAP_FRACTION of the gap, even opposite nudges leave
 * (1 - 2 * fraction) of the gap between them, so lines never touch or cross.
 * Every segment is straight between anchors, so a segment never strays
 * further from its original line than its anchors do.
 */
export const JITTER_MAX_GAP_FRACTION = 0.45;

/** Feature size of the jitter noise in cells: nearby anchors move together, so long runs lean instead of zigzagging. */
const JITTER_NOISE_CELLS = 4;

/** Largest anchor displacement in px for a parameter set. */
export function jitterLimit(params: GenerationParams): number {
  const amount = Math.min(1, Math.max(0, params.jitter));
  return amount * JITTER_MAX_GAP_FRACTION * params.minGap;
}

/**
 * Nudge every anchor by a smooth, seeded noise field of position, with the
 * displacement magnitude capped at jitterLimit(params). Deterministic for a
 * given seed and position, so coincident anchors (a closed loop's first and
 * last point) stay coincident. Returns the input untouched when jitter is 0.
 */
export function applyJitter(waypoints: Waypoint[], params: GenerationParams): Waypoint[] {
  const limit = jitterLimit(params);
  if (limit <= 0 || waypoints.length === 0) return waypoints;
  const cell = params.strokeWidth + params.minGap;
  const scale = JITTER_NOISE_CELLS * cell;
  const nx = createValueNoise(params.seed * 31 + 7, scale);
  const ny = createValueNoise(params.seed * 31 + 11, scale);
  return waypoints.map((wp) => {
    // Value noise sits mostly within 0.2..0.8; stretch it so the budget is used, then cap the magnitude.
    let dx = (nx(wp.x, wp.y) - 0.5) * 3;
    let dy = (ny(wp.x, wp.y) - 0.5) * 3;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    return { ...wp, x: wp.x + dx * limit, y: wp.y + dy * limit };
  });
}
