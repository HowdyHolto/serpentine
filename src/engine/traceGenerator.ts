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
 *  - direction guides make edges along their axis cheap within their radius.
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
} from '../types';
import { OccupancyGrid } from './occupancyGrid';
import { createSeededRandom, SeededRandom } from './random';
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
   * Distance of each active node from the mask edge, in coarse steps
   * (4-neighbour BFS): 1 on the outermost ring, growing inward. 0 for
   * inactive nodes. This is what a contour-parallel weight reads.
   */
  distance: Int32Array;
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

  // Distance transform: multi-source BFS from the ring of nodes that touch
  // the grid border or an inactive node.
  const distance = new Int32Array(n);
  const queue: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    const C = k % cols;
    const R = (k - C) / cols;
    let onEdge = false;
    for (const d of COARSE_DIRS) {
      const nc = C + d.dc;
      const nr = R + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || !active[nr * cols + nc]) {
        onEdge = true;
        break;
      }
    }
    if (onEdge) {
      distance[k] = 1;
      queue.push(k);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const C = k % cols;
    const R = (k - C) / cols;
    for (const d of COARSE_DIRS) {
      const nc = C + d.dc;
      const nr = R + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nk = nr * cols + nc;
      if (!active[nk] || distance[nk] !== 0) continue;
      distance[nk] = distance[k] + 1;
      queue.push(nk);
    }
  }

  return { cols, rows, present, active, edges: new Uint8Array(n), distance };
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
  /** Distance from the mask edge in coarse steps (see CoarseGrid.distance). */
  fromDistance: number;
  toDistance: number;
  /** Axis a direction guide asks for at `from`: true vertical, false horizontal. */
  guideAxis: boolean | undefined;
  rng: SeededRandom;
}

export type EdgeWeightFn = (ctx: EdgeContext) => number;

/**
 * The default weights: straight-within-target < turn < overshoot, tilted by
 * the horizontal/vertical bias and pulled along direction guides. A
 * contour-parallel ("concentric") mode would wrap this and add a term that
 * compares the edge direction with the gradient of `fromDistance`.
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
  weight: EdgeWeightFn = createDefaultEdgeWeight(params)
): void {
  const { cols, rows, active, edges, distance } = coarse;
  const n = cols * rows;
  const inTree = new Uint8Array(n);
  const nodeDir = new Int8Array(n).fill(-1);
  const nodeRun = new Int32Array(n);
  const nodeTarget = new Int32Array(n);

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
  weight?: EdgeWeightFn
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
  growSpanningTree(coarse, grid, params, rng, biasMap, weight ?? createDefaultEdgeWeight(params));

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
  weight?: EdgeWeightFn
): { waypoints: Waypoint[]; structure: PathStructure; fillRatio: number } {
  const cellSize = params.strokeWidth + params.minGap;
  const empty = {
    waypoints: [] as Waypoint[],
    structure: { endCapPairs: [], segments: [], cellSize } as PathStructure,
    fillRatio: 0,
  };

  const traced = traceCycle(boundary, params, guides, weight);
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
