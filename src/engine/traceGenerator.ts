/**
 * Trace fill mode: a spanning-tree Hamiltonian cycle.
 *
 * The occupancy grid is split into 2x2 blocks ("coarse nodes"). A random
 * spanning tree is grown over the coarse nodes with a weighted Prim's
 * algorithm, then the fine-grid loop that hugs the tree at a distance of half
 * a block is traced. That loop is a Hamiltonian cycle: it visits every fine
 * cell of every block in the tree exactly once, never crosses itself and
 * never traps, so fill is 100% for every seed in O(cells) time.
 *
 * Character comes entirely from the edge weights:
 *  - a straight continuation of a tree branch is cheap until the branch has
 *    run for the target segment length (min/max/fixed segment length), which
 *    gives long runs and hairpins;
 *  - horizontal vs vertical edges are weighted by `fillDirectionBias`;
 *  - direction guides make edges along their axis cheap within their radius;
 *  - Concentric adds a contour term over a scalar field (the distance
 *    transform): an edge along an iso-line is cheap and one across the
 *    gradient is expensive, scaled by a per-node conformity (a gradient over
 *    depth). The field and conformity are pluggable (createFieldEdgeWeight),
 *    so a heightmap or an image can drive the same rule.
 *
 * Masks: a coarse node exists only where all four of its fine cells are inside
 * the mask, so on an ellipse the ring of partial blocks along the edge is left
 * unfilled. The grid is built with an even number of rows and columns (odd
 * leftovers are trimmed and the grid re-centered). Only the largest connected
 * component of coarse nodes is traced.
 *
 * 45 degree mode is a post-process chamfer of the 90 degree corners; pieces
 * (the Multi-Pass equivalent) cut the loop into N open paths; `closedLoop`
 * keeps it closed.
 */
import {
  BoundaryShape,
  GenerationParams,
  Waypoint,
  GridPoint,
  DirectionGuide,
  PathStructure,
  Rock,
} from '../types';
import { OccupancyGrid } from './occupancyGrid';
import { createSeededRandom, SeededRandom } from './random';
import { createValueNoise } from './noise';
import {
  buildPathStructure,
  computeSegmentLength,
  createDirectionBiasMap,
  DirectionBiasMap,
  extractWaypointsFromGrid,
  extractWaypointsFromSegments,
  isVerticalDir,
} from './serpentineGenerator';

// Coarse edge directions. Bit values double as a mask per node.
const UP = 1;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 8;
const COARSE_DIRS = [
  { bit: UP, dc: 0, dr: -1, opposite: DOWN, vertical: true },
  { bit: RIGHT, dc: 1, dr: 0, opposite: LEFT, vertical: false },
  { bit: DOWN, dc: 0, dr: 1, opposite: UP, vertical: true },
  { bit: LEFT, dc: -1, dr: 0, opposite: RIGHT, vertical: false },
];

// Weight tuning. Prim always takes the globally cheapest frontier edge, so
// what matters is the ordering: straight-within-target < turn < overshoot.
const JITTER = 0.3;
const OVERSHOOT_COST = 1.2;
const BIAS_COST = 0.8;
const GUIDE_COST = 0.7;
// Full-strength contour term: crossing minus along must beat turn + overshoot
// + jitter (2.1) so a faithful ring is never left for a straighter run.
const CONTOUR_COST = 2.5;

interface HeapEdge {
  w: number;
  from: number;
  to: number;
  dirIdx: number;
}

/** Minimal binary min-heap keyed on `w`. */
class EdgeHeap {
  private items: HeapEdge[] = [];

  get size(): number {
    return this.items.length;
  }

  push(e: HeapEdge): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].w <= a[i].w) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): HeapEdge | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].w < a[m].w) m = l;
        if (r < a.length && a[r].w < a[m].w) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface CoarseGrid {
  cols: number;
  rows: number;
  /** 1 where all four fine cells of the block are available. */
  present: Uint8Array;
  /** 1 for nodes in the largest connected component (the ones we trace). */
  active: Uint8Array;
  /** Tree edge bitmask (UP|RIGHT|DOWN|LEFT) per node, filled by growSpanningTree. */
  edges: Uint8Array;
  /**
   * Distance of each active node from the mask edge in coarse steps: 1 on
   * the outer ring (nodes that touch the grid border or an inactive node),
   * then 1 + the Euclidean distance to the nearest outer-ring node, so the
   * iso-distance contours are smooth offsets of a curved boundary. On a
   * rectangle this equals the 4-neighbour BFS step count. 0 for inactive
   * nodes. This is what the concentric weight reads.
   */
  distance: Float64Array;
}

export function buildCoarseGrid(grid: OccupancyGrid): CoarseGrid {
  const cols = Math.floor(grid.cols / 2);
  const rows = Math.floor(grid.rows / 2);
  const n = cols * rows;
  const present = new Uint8Array(n);
  for (let R = 0; R < rows; R++) {
    for (let C = 0; C < cols; C++) {
      const x = 2 * C;
      const y = 2 * R;
      if (
        grid.isAvailable(x, y) &&
        grid.isAvailable(x + 1, y) &&
        grid.isAvailable(x, y + 1) &&
        grid.isAvailable(x + 1, y + 1)
      ) {
        present[R * cols + C] = 1;
      }
    }
  }

  // Largest connected component.
  const label = new Int32Array(n).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!present[s] || label[s] !== -1) continue;
    let size = 0;
    label[s] = nextLabel;
    stack.push(s);
    while (stack.length > 0) {
      const k = stack.pop()!;
      size++;
      const C = k % cols;
      const R = (k - C) / cols;
      for (const d of COARSE_DIRS) {
        const nc = C + d.dc;
        const nr = R + d.dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nk = nr * cols + nc;
        if (!present[nk] || label[nk] !== -1) continue;
        label[nk] = nextLabel;
        stack.push(nk);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = nextLabel;
    }
    nextLabel++;
  }

  const active = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (label[k] === bestLabel) active[k] = 1;
  }

  // Distance transform: exact Euclidean distance to the ring of nodes that
  // touch the grid border or an inactive node, plus 1 so the ring itself is 1.
  const sq = new Float64Array(n).fill(DT_INF);
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    const C = k % cols;
    const R = (k - C) / cols;
    for (const d of COARSE_DIRS) {
      const nc = C + d.dc;
      const nr = R + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || !active[nr * cols + nc]) {
        sq[k] = 0;
        break;
      }
    }
  }
  squaredDistanceTransform(sq, cols, rows);
  const distance = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (active[k]) distance[k] = 1 + Math.sqrt(sq[k]);
  }

  return { cols, rows, present, active, edges: new Uint8Array(n), distance };
}

const DT_INF = 1e20;

/**
 * One-dimensional squared Euclidean distance transform (Felzenszwalb and
 * Huttenlocher): d[q] = min over p of (q - p)^2 + f[p], computed in place
 * on a strided view of `f`. `v`, `z` and `tmp` are scratch of length n, n + 1
 * and n.
 */
function dt1d(
  f: Float64Array,
  offset: number,
  stride: number,
  n: number,
  v: Int32Array,
  z: Float64Array,
  tmp: Float64Array
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[offset + q * stride];
    for (;;) {
      const p = v[k];
      const fp = f[offset + p * stride];
      const s = (fq + q * q - (fp + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) {
        if (k > 0) {
          k--;
          continue;
        }
        // The new parabola dominates everything so far.
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
      } else {
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }
      break;
    }
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    tmp[q] = (q - p) * (q - p) + f[offset + p * stride];
  }
  for (let q = 0; q < n; q++) f[offset + q * stride] = tmp[q];
}

/** Two-pass exact squared Euclidean distance transform of a cols x rows field, in place. */
function squaredDistanceTransform(f: Float64Array, cols: number, rows: number): void {
  const m = Math.max(cols, rows);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  const tmp = new Float64Array(m);
  for (let C = 0; C < cols; C++) dt1d(f, C, cols, rows, v, z, tmp);
  for (let R = 0; R < rows; R++) dt1d(f, R * cols, 1, cols, v, z, tmp);
}

/** Coarse node nearest the bottom-left corner, matching today's start corner. */
function bottomLeftNode(coarse: CoarseGrid): number {
  let best = -1;
  let bestScore = Infinity;
  for (let R = 0; R < coarse.rows; R++) {
    for (let C = 0; C < coarse.cols; C++) {
      const k = R * coarse.cols + C;
      if (!coarse.active[k]) continue;
      const score = C + (coarse.rows - 1 - R);
      if (score < bestScore || (score === bestScore && C < best % coarse.cols)) {
        bestScore = score;
        best = k;
      }
    }
  }
  return best;
}

/** Everything an edge weight may look at. Weights are compared, not summed, so scale is free. */
export interface EdgeContext {
  /** Coarse node indices (row * cols + col). */
  from: number;
  to: number;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  /** Index into COARSE_DIRS: 0 up, 1 right, 2 down, 3 left. */
  dirIdx: number;
  vertical: boolean;
  /** True when this edge continues the straight run that reached `from`. */
  straight: boolean;
  /** Length so far and target length (coarse steps) of the run ending at `from`. */
  runLength: number;
  runTarget: number;
  /**
   * Distance from the mask edge in coarse steps (see CoarseGrid.distance; 1 on
   * the outer ring). Kept for weights that want it directly; the field
   * weights read their own ScalarField instead.
   */
  fromDistance: number;
  toDistance: number;
  /** Largest distance of any active node (the deepest ring); at least 1. */
  maxDistance: number;
  /** Axis a direction guide asks for at `from`: true vertical, false horizontal. */
  guideAxis: boolean | undefined;
  rng: SeededRandom;
}

export type EdgeWeightFn = (ctx: EdgeContext) => number;

/**
 * The default weights: straight-within-target < turn < overshoot, tilted by
 * the horizontal/vertical bias and pulled along direction guides. Field
 * weights (createFieldEdgeWeight, concentric) wrap this.
 */
export function createDefaultEdgeWeight(params: GenerationParams): EdgeWeightFn {
  const horizontalBias = Math.min(1, Math.max(0, params.fillDirectionBias));
  const verticalPenalty = Math.max(0, horizontalBias - 0.5) * 2 * BIAS_COST;
  const horizontalPenalty = Math.max(0, 0.5 - horizontalBias) * 2 * BIAS_COST;
  const turnCost = 0.6 - Math.min(0.5, Math.max(0, params.directionSwitchFrequency));

  return (ctx) => {
    let w = ctx.rng.next() * JITTER;
    if (ctx.straight) {
      if (ctx.runLength >= ctx.runTarget) w += OVERSHOOT_COST;
    } else {
      w += turnCost;
    }
    w += ctx.vertical ? verticalPenalty : horizontalPenalty;
    if (ctx.guideAxis !== undefined) {
      w += ctx.guideAxis === ctx.vertical ? -GUIDE_COST : GUIDE_COST;
    }
    return w;
  };
}

/** The weight a pattern mode asks for: Concentric and Contour wrap the default, Serpentine is the default. */
export function createEdgeWeight(
  params: GenerationParams,
  coarse: CoarseGrid,
  grid?: OccupancyGrid,
  rocks?: Rock[]
): EdgeWeightFn {
  switch (params.patternMode) {
    case 'concentric':
      return createConcentricEdgeWeight(params, coarse);
    case 'contour':
      return createContourEdgeWeight(params, coarse, grid, rocks);
    default:
      return createDefaultEdgeWeight(params);
  }
}

/**
 * A scalar field over the coarse nodes: whatever a contour-following weight
 * traces the iso-lines of. Concentric uses the distance transform; a terrain
 * mode would use a heightmap and a photo mode a blurred image's luminance,
 * each as another producer of this shape.
 */
export interface ScalarField {
  /** Value per coarse node, indexed like CoarseGrid nodes; meaningless where inactive. */
  value: Float64Array;
  /** Central-difference gradient per node, in value per coarse step (0 where no active neighbour). */
  gx: Float64Array;
  gy: Float64Array;
  /** Value range over active nodes. */
  min: number;
  max: number;
  /** Change in value over one coarse step that counts as fully across the iso-lines. */
  unit: number;
}

/** Build a ScalarField from a value per node: gradient by central differences over active nodes. */
export function makeScalarField(coarse: CoarseGrid, value: Float64Array, unit: number): ScalarField {
  const { cols, rows, active } = coarse;
  const n = cols * rows;
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  const diff = (k: number, kPrev: number, kNext: number, hasPrev: boolean, hasNext: boolean): number => {
    if (hasPrev && hasNext) return (value[kNext] - value[kPrev]) / 2;
    if (hasNext) return value[kNext] - value[k];
    if (hasPrev) return value[k] - value[kPrev];
    return 0;
  };
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    const C = k % cols;
    const R = (k - C) / cols;
    const l = C > 0 && active[k - 1] === 1;
    const r = C < cols - 1 && active[k + 1] === 1;
    const u = R > 0 && active[k - cols] === 1;
    const d = R < rows - 1 && active[k + cols] === 1;
    gx[k] = diff(k, k - 1, k + 1, l, r);
    gy[k] = diff(k, k - cols, k + cols, u, d);
    if (value[k] < min) min = value[k];
    if (value[k] > max) max = value[k];
  }
  if (min === Infinity) {
    min = 0;
    max = 0;
  }
  return { value, gx, gy, min, max, unit: Math.max(1e-9, unit) };
}

/** The distance transform as a field: 1 on the outer ring, one unit per coarse step inward. */
export function distanceField(coarse: CoarseGrid): ScalarField {
  return makeScalarField(coarse, coarse.distance, 1);
}

/** Depth of a node in its field, 0 at the minimum and 1 at the maximum. */
export function normalizedValue(field: ScalarField, node: number): number {
  const span = field.max - field.min;
  return span > 0 ? (field.value[node] - field.min) / span : 0;
}

export interface FieldWeightOptions {
  /** 0..1: overall weight of the contour term (0 leaves the default weight untouched). */
  strength: number;
  /**
   * 0..1 per node: how strongly the contour term applies around it. Concentric
   * uses depth; terrain could use slope, a photo mode the distance to a band edge.
   */
  conformity: (node: number, field: ScalarField) => number;
  /**
   * How "across" an edge is measured. 'value' (default): the change in field
   * value over the edge in units, so flat ground barely steers. 'direction':
   * the cosine between the edge and the gradient, so even gentle slopes steer
   * fully; what a terrain wants.
   */
  measure?: 'value' | 'direction';
}

/**
 * Contour-following weights over any scalar field: the default weight plus a
 * term that makes an edge along an iso-line (little change in value) cheaper
 * and one across the gradient dearer, in proportion to the change in value
 * over the edge measured in field units. The term is scaled by `strength`
 * and by the mean conformity of the edge's two nodes, so straightness, bias
 * and guides still shape the tree wherever conformity is low.
 */
export function createFieldEdgeWeight(
  params: GenerationParams,
  field: ScalarField,
  opts: FieldWeightOptions
): EdgeWeightFn {
  const base = createDefaultEdgeWeight(params);
  const strength = Math.min(1, Math.max(0, opts.strength));
  const { conformity } = opts;
  const measure = opts.measure ?? 'value';

  return (ctx) => {
    let w = base(ctx);
    if (strength <= 0) return w;
    const c = (strength * (conformity(ctx.from, field) + conformity(ctx.to, field))) / 2;
    if (c <= 0) return w;
    // 0 for an edge along an iso-line, 1 for one straight across; on a curved
    // contour the axis edge closest to the tangent scores lowest.
    let crossing: number;
    if (measure === 'direction') {
      const gx = field.gx[ctx.from] + field.gx[ctx.to];
      const gy = field.gy[ctx.from] + field.gy[ctx.to];
      const g = Math.hypot(gx, gy);
      crossing = g > 1e-12 ? Math.abs(ctx.vertical ? gy : gx) / g : 0.5;
    } else {
      crossing = Math.min(1, Math.abs(field.value[ctx.to] - field.value[ctx.from]) / field.unit);
    }
    w += CONTOUR_COST * c * (crossing - 0.5);
    return w;
  };
}

/**
 * Conformity at normalized depth `t` (0 on the outer ring, 1 at the deepest
 * node): 1 everywhere for falloff 0, falling linearly to 0 at the center for
 * falloff 1. Invert measures depth from the center instead.
 */
export function concentricConformity(t: number, falloff: number, invert: boolean): number {
  const depth = invert ? 1 - t : t;
  return Math.max(0, 1 - Math.min(1, Math.max(0, falloff)) * depth);
}

/**
 * Contour-parallel ("concentric") weights: the field weight over the
 * distance transform, with conformity a gradient over depth set by
 * `concentricStrength`, `concentricFalloff` and `concentricInvert`.
 */
export function createConcentricEdgeWeight(params: GenerationParams, coarse: CoarseGrid): EdgeWeightFn {
  const falloff = params.concentricFalloff;
  const invert = params.concentricInvert;
  return createFieldEdgeWeight(params, distanceField(coarse), {
    strength: params.concentricStrength,
    conformity: (node, field) => concentricConformity(normalizedValue(field, node), falloff, invert),
  });
}

/**
 * A height field sampled over the coarse nodes: `sample(x, y)` is called with
 * coarse coordinates (one unit per coarse step). The unit is the mean
 * gradient magnitude over active nodes, so a step straight up a typical
 * slope counts as fully across and a step along a contour as not at all.
 */
export function heightField(coarse: CoarseGrid, sample: (x: number, y: number) => number): ScalarField {
  const { cols, rows, active } = coarse;
  const n = cols * rows;
  const value = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    const C = k % cols;
    const R = (k - C) / cols;
    value[k] = sample(C, R);
  }
  const field = makeScalarField(coarse, value, 1);
  let sum = 0;
  let count = 0;
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    sum += Math.hypot(field.gx[k], field.gy[k]);
    count++;
  }
  field.unit = Math.max(1e-9, count > 0 ? sum / count : 1);
  return field;
}

/** Slope of a node, 0 on the flattest active node and 1 on the steepest. */
export function normalizedSlope(field: ScalarField, coarse: CoarseGrid): (node: number) => number {
  let max = 0;
  for (let k = 0; k < field.value.length; k++) {
    if (!coarse.active[k]) continue;
    const g = Math.hypot(field.gx[k], field.gy[k]);
    if (g > max) max = g;
  }
  return (node) => (max > 0 ? Math.hypot(field.gx[node], field.gy[node]) / max : 0);
}

/**
 * Conformity at normalized slope `t`: 1 everywhere for slopeResponse 0, equal
 * to the slope for slopeResponse 1 (faithful on steep ground, random on
 * flat). Invert is faithful on flat ground instead.
 */
export function contourConformity(t: number, slopeResponse: number, invert: boolean): number {
  const r = Math.min(1, Math.max(0, slopeResponse));
  const s = invert ? 1 - t : t;
  return 1 - r + r * s;
}

/** World position of a coarse node's centre; without a grid, coarse units from the origin. */
function coarseNodeWorld(coarse: CoarseGrid, grid: OccupancyGrid | undefined): (node: number) => { x: number; y: number } {
  const { cols } = coarse;
  return (k) => {
    const C = k % cols;
    const R = (k - C) / cols;
    if (!grid) return { x: C, y: R };
    return { x: grid.originX + (2 * C + 1) * grid.cellSize, y: grid.originY + (2 * R + 1) * grid.cellSize };
  };
}

/**
 * The Contour terrain for a parameter set, as a scalar field over the coarse
 * nodes. 'noise' is seeded value noise with hills `contourScale` px apart.
 * 'pond' sums a bump per rock (height = elevation, fading over `rockSpread`
 * px) over `contourNoiseMix` of that noise, so rings spread from each rock
 * and merge where bumps overlap. 'garden' is the distance to the nearest
 * rock, each rock's distance scaled by 2^-elevation, with the boundary edge
 * counting as a rake centre weighted by `rockEdge`, so rings radiate from
 * every rock until they collide along ridges.
 */
export function contourField(
  params: GenerationParams,
  coarse: CoarseGrid,
  grid?: OccupancyGrid,
  rocks: Rock[] = []
): ScalarField {
  const cellSize = params.strokeWidth + params.minGap;
  const scaleInCoarseSteps = Math.max(1, params.contourScale / (2 * cellSize));
  const noise = createValueNoise(params.seed, scaleInCoarseSteps);
  const source = params.contourSource;
  if (source === 'noise' || (source === 'pond' && rocks.length === 0 && params.contourNoiseMix <= 0)) {
    return heightField(coarse, noise);
  }
  const world = coarseNodeWorld(coarse, grid);
  const { cols } = coarse;
  if (source === 'pond') {
    const spread = Math.max(1, params.rockSpread);
    const mix = Math.min(1, Math.max(0, params.contourNoiseMix));
    return heightField(coarse, (cx, cy) => {
      const k = cy * cols + cx;
      const { x, y } = world(k);
      let v = 0;
      for (const r of rocks) {
        const d2 = (x - r.x) * (x - r.x) + (y - r.y) * (y - r.y);
        v += r.elevation * Math.exp(-d2 / (spread * spread));
      }
      if (mix > 0) v += mix * (noise(cx, cy) - 0.5) * 2;
      return v;
    });
  }
  // garden
  const blockPx = 2 * cellSize;
  const edgeWeight = Math.min(1, Math.max(0, params.rockEdge));
  return heightField(coarse, (cx, cy) => {
    const k = cy * cols + cx;
    const { x, y } = world(k);
    let v = Infinity;
    for (const r of rocks) {
      const d = Math.hypot(x - r.x, y - r.y) / Math.pow(2, r.elevation);
      if (d < v) v = d;
    }
    if (edgeWeight > 0) {
      const dEdge = (coarse.distance[k] * blockPx) / edgeWeight;
      if (dEdge < v) v = dEdge;
    }
    return v === Infinity ? 0 : v;
  });
}

/**
 * Terrain ("contour") weights: the field weight over the Contour terrain
 * (see contourField), with conformity a function of slope set by
 * `contourSlope` and `contourInvert`. The result reads like contour lines on
 * a topographic map, or rake lines around rocks.
 */
export function createContourEdgeWeight(
  params: GenerationParams,
  coarse: CoarseGrid,
  grid?: OccupancyGrid,
  rocks?: Rock[]
): EdgeWeightFn {
  const field = contourField(params, coarse, grid, rocks);
  const slope = normalizedSlope(field, coarse);
  const response = params.contourSlope;
  const invert = params.contourInvert;
  return createFieldEdgeWeight(params, field, {
    strength: params.contourStrength,
    conformity: (node) => contourConformity(slope(node), response, invert),
    measure: 'direction',
  });
}

/**
 * Weighted randomized Prim. Each node remembers the direction it was reached
 * from and how long that straight run is, so the weight of extending it can
 * depend on the target segment length. All weights come from `weight`.
 */
export function growSpanningTree(
  coarse: CoarseGrid,
  grid: OccupancyGrid,
  params: GenerationParams,
  rng: SeededRandom,
  biasMap?: DirectionBiasMap,
  weight: EdgeWeightFn = createEdgeWeight(params, coarse, grid)
): void {
  const { cols, rows, active, edges, distance } = coarse;
  const n = cols * rows;
  const inTree = new Uint8Array(n);
  const nodeDir = new Int8Array(n).fill(-1);
  const nodeRun = new Int32Array(n);
  const nodeTarget = new Int32Array(n);
  let maxDistance = 1;
  for (let k = 0; k < n; k++) if (distance[k] > maxDistance) maxDistance = distance[k];

  const cellSize = grid.cellSize;
  const coarseTarget = () =>
    Math.max(1, Math.round(computeSegmentLength(params, cellSize, rng) / 2));

  // Guide axis per coarse node: true = vertical, false = horizontal, undefined = none.
  const guideAxis = (k: number): boolean | undefined => {
    if (!biasMap) return undefined;
    const C = k % cols;
    const R = (k - C) / cols;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const dir = biasMap.get((2 * R + dy) * grid.cols + (2 * C + dx));
        if (dir) return isVerticalDir(dir);
      }
    }
    return undefined;
  };

  const heap = new EdgeHeap();

  const pushFrontier = (k: number) => {
    const C = k % cols;
    const R = (k - C) / cols;
    const axis = guideAxis(k);
    for (let i = 0; i < COARSE_DIRS.length; i++) {
      const d = COARSE_DIRS[i];
      const nc = C + d.dc;
      const nr = R + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nk = nr * cols + nc;
      if (!active[nk] || inTree[nk]) continue;

      const w = weight({
        from: k,
        to: nk,
        fromCol: C,
        fromRow: R,
        toCol: nc,
        toRow: nr,
        dirIdx: i,
        vertical: d.vertical,
        straight: nodeDir[k] === i,
        runLength: nodeRun[k],
        runTarget: nodeTarget[k],
        fromDistance: distance[k],
        toDistance: distance[nk],
        maxDistance,
        guideAxis: axis,
        rng,
      });
      heap.push({ w, from: k, to: nk, dirIdx: i });
    }
  };

  const root = bottomLeftNode(coarse);
  if (root < 0) return;
  inTree[root] = 1;
  nodeTarget[root] = coarseTarget();
  pushFrontier(root);

  while (heap.size > 0) {
    const e = heap.pop()!;
    if (inTree[e.to]) continue;
    const d = COARSE_DIRS[e.dirIdx];
    inTree[e.to] = 1;
    edges[e.from] |= d.bit;
    edges[e.to] |= d.opposite;
    nodeDir[e.to] = e.dirIdx;
    if (nodeDir[e.from] === e.dirIdx) {
      nodeRun[e.to] = nodeRun[e.from] + 1;
      nodeTarget[e.to] = nodeTarget[e.from];
    } else {
      nodeRun[e.to] = 1;
      nodeTarget[e.to] = coarseTarget();
    }
    pushFrontier(e.to);
  }
}

/**
 * The two cycle neighbours of fine cell (x, y). The loop runs at half a block
 * from the tree: two cells in the same block are joined unless a tree edge
 * leaves the block between them; two cells in adjacent blocks are joined
 * only when a tree edge connects those blocks.
 */
function cycleNeighbors(coarse: CoarseGrid, x: number, y: number): [GridPoint, GridPoint] {
  const C = x >> 1;
  const R = y >> 1;
  const qx = x & 1;
  const qy = y & 1;
  const m = coarse.edges[R * coarse.cols + C];
  const out: GridPoint[] = [];

  const topBottomBit = qy === 0 ? UP : DOWN;
  const leftRightBit = qx === 0 ? LEFT : RIGHT;

  // Horizontal: inside the block unless a vertical tree edge leaves between
  // the pair; across the block boundary when a tree edge crosses it here.
  if (!(m & topBottomBit)) out.push({ col: x ^ 1, row: y });
  if (m & leftRightBit) out.push({ col: qx === 0 ? x - 1 : x + 1, row: y });

  // Vertical: same rule rotated.
  if (!(m & leftRightBit)) out.push({ col: x, row: y ^ 1 });
  if (m & topBottomBit) out.push({ col: x, row: qy === 0 ? y - 1 : y + 1 });

  if (out.length !== 2) {
    throw new Error(`trace: cell (${x},${y}) has ${out.length} cycle neighbours`);
  }
  return [out[0], out[1]];
}

function collinear(a: GridPoint, b: GridPoint, c: GridPoint): boolean {
  return b.col - a.col === c.col - b.col && b.row - a.row === c.row - b.row;
}

export interface TraceResult {
  grid: OccupancyGrid;
  coarse: CoarseGrid;
  /** The full Hamiltonian cycle (no repeated start). */
  cycle: GridPoint[];
  /** Number of fine cells that belong to traced coarse nodes. */
  coverable: number;
  /** Number of fine cells inside the mask (before block trimming). */
  available: number;
}

/**
 * Grid-level entry point: builds the grid, grows the tree and traces the
 * cycle. The cycle starts at the fine cell nearest the bottom-left corner.
 */
export function traceCycle(
  boundary: BoundaryShape,
  params: GenerationParams,
  guides?: DirectionGuide[],
  weight?: EdgeWeightFn,
  rocks?: Rock[]
): TraceResult | null {
  const cellSize = params.strokeWidth + params.minGap;
  const grid = new OccupancyGrid(boundary, cellSize, { evenDimensions: true });
  if (grid.cols < 2 || grid.rows < 2) return null;

  const coarse = buildCoarseGrid(grid);
  let activeCount = 0;
  for (let k = 0; k < coarse.active.length; k++) activeCount += coarse.active[k];
  if (activeCount === 0) return null;

  const rng = createSeededRandom(params.seed);
  const biasMap = guides && guides.length > 0 ? createDirectionBiasMap(guides, grid) : undefined;
  growSpanningTree(coarse, grid, params, rng, biasMap, weight ?? createEdgeWeight(params, coarse, grid, rocks));

  // Start at the fine cell nearest the bottom-left corner.
  const rootK = bottomLeftNode(coarse);
  const rootC = rootK % coarse.cols;
  const rootR = (rootK - rootC) / coarse.cols;
  const start: GridPoint = { col: 2 * rootC, row: 2 * rootR + 1 };

  // Walk the cycle. First step prefers the axis the bias asks for.
  const [n0, n1] = cycleNeighbors(coarse, start.col, start.row);
  const preferVertical = params.fillDirectionBias <= 0.5;
  const n0Vertical = n0.col === start.col;
  const first = n0Vertical === preferVertical ? n0 : n1;

  const total = activeCount * 4;
  const cycle: GridPoint[] = new Array(total);
  cycle[0] = start;
  let prev = start;
  let cur = first;
  let i = 1;
  while (!(cur.col === start.col && cur.row === start.row)) {
    if (i >= total) throw new Error('trace: cycle longer than the coarse component');
    cycle[i++] = cur;
    const [a, b] = cycleNeighbors(coarse, cur.col, cur.row);
    const next = a.col === prev.col && a.row === prev.row ? b : a;
    prev = cur;
    cur = next;
  }
  if (i !== total) throw new Error(`trace: cycle visited ${i} of ${total} cells`);

  return { grid, coarse, cycle, coverable: total, available: grid.countAvailable() };
}

/** Rotate the cycle so it starts mid-run, and close it by repeating the start. */
function closeCycle(cycle: GridPoint[]): GridPoint[] {
  const n = cycle.length;
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    const a = cycle[(i - 1 + n) % n];
    const b = cycle[i];
    const c = cycle[(i + 1) % n];
    if (collinear(a, b, c)) {
      startIdx = i;
      break;
    }
  }
  const out: GridPoint[] = new Array(n + 1);
  for (let i = 0; i < n; i++) out[i] = cycle[(startIdx + i) % n];
  out[n] = cycle[startIdx];
  return out;
}

/** Cut an open path into `pieces` runs of equal length, snapping cuts to straight stretches. */
export function cutIntoPieces(path: GridPoint[], pieces: number): GridPoint[][] {
  const n = path.length;
  const count = Math.max(1, Math.min(pieces, Math.floor(n / 4)));
  if (count === 1) return [path];

  const cuts: number[] = [];
  for (let k = 1; k < count; k++) {
    const target = Math.round((k * n) / count);
    let chosen = target;
    for (let off = 0; off <= 3; off++) {
      let found = -1;
      for (const b of [target + off, target - off]) {
        if (b < 3 || b > n - 3) continue;
        if (collinear(path[b - 2], path[b - 1], path[b]) && collinear(path[b - 1], path[b], path[b + 1])) {
          found = b;
          break;
        }
      }
      if (found !== -1) {
        chosen = found;
        break;
      }
    }
    if (cuts.length === 0 || chosen > cuts[cuts.length - 1] + 1) cuts.push(chosen);
  }

  const out: GridPoint[][] = [];
  let s = 0;
  for (const b of cuts) {
    out.push(path.slice(s, b));
    s = b;
  }
  out.push(path.slice(s));
  return out.filter(p => p.length >= 2);
}

/**
 * 45 degree post-process: replace every 90 degree corner whose two legs are
 * at least one cell long with a chamfer that cuts half a cell off each leg.
 * A one-cell leg between two corners collapses to a single apex, which turns
 * hairpins into chevrons. Coverage is unchanged because the stroke still
 * passes through every cell it did before.
 */
export function chamferWaypoints(waypoints: Waypoint[], cellSize: number): Waypoint[] {
  const t = cellSize / 2;
  const eps = cellSize * 0.01;
  const minLeg = cellSize - eps;

  const subPaths: Waypoint[][] = [];
  let current: Waypoint[] = [];
  for (const wp of waypoints) {
    if (wp.type === 'segment-start' && current.length > 0) {
      subPaths.push(current);
      current = [];
    }
    current.push(wp);
  }
  if (current.length > 0) subPaths.push(current);

  const result: Waypoint[] = [];
  for (const sub of subPaths) {
    const out: Waypoint[] = [];
    const push = (wp: Waypoint) => {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - wp.x) < eps && Math.abs(last.y - wp.y) < eps) {
        // Keep the more significant marker when two points merge.
        if (wp.type !== 'turn') out[out.length - 1] = { ...last, type: wp.type };
        return;
      }
      out.push(wp);
    };

    for (let i = 0; i < sub.length; i++) {
      const wp = sub[i];
      if (i === 0 || i === sub.length - 1 || wp.type !== 'turn') {
        push(wp);
        continue;
      }
      const p = sub[i - 1];
      const q = sub[i + 1];
      const inX = wp.x - p.x;
      const inY = wp.y - p.y;
      const outX = q.x - wp.x;
      const outY = q.y - wp.y;
      const inLen = Math.hypot(inX, inY);
      const outLen = Math.hypot(outX, outY);
      if (inLen < minLeg || outLen < minLeg) {
        push(wp);
        continue;
      }
      push({ x: wp.x - (inX / inLen) * t, y: wp.y - (inY / inLen) * t, type: 'turn' });
      push({ x: wp.x + (outX / outLen) * t, y: wp.y + (outY / outLen) * t, type: 'turn' });
    }
    result.push(...out);
  }
  return result;
}

export function generateTrace(
  boundary: BoundaryShape,
  params: GenerationParams,
  guides?: DirectionGuide[],
  weight?: EdgeWeightFn,
  rocks?: Rock[]
): { waypoints: Waypoint[]; structure: PathStructure; fillRatio: number } {
  const cellSize = params.strokeWidth + params.minGap;
  const empty = {
    waypoints: [] as Waypoint[],
    structure: { endCapPairs: [], segments: [], cellSize } as PathStructure,
    fillRatio: 0,
  };

  const traced = traceCycle(boundary, params, guides, weight, rocks);
  if (!traced) return empty;
  const { grid, cycle, coverable, available } = traced;

  let waypoints: Waypoint[];
  if (params.closedLoop) {
    waypoints = extractWaypointsFromGrid(closeCycle(cycle), grid);
  } else if (params.tracePieces > 1) {
    waypoints = extractWaypointsFromSegments(cutIntoPieces(cycle, params.tracePieces), grid);
  } else {
    waypoints = extractWaypointsFromGrid(cycle, grid);
  }

  if (params.angleMode === 45) {
    waypoints = chamferWaypoints(waypoints, cellSize);
  }

  const structure = buildPathStructure(waypoints, cellSize);
  const fillRatio = available > 0 ? coverable / available : 0;
  return { waypoints, structure, fillRatio };
}
