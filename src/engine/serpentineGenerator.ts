import {
  BoundaryShape,
  GenerationParams,
  Waypoint,
  GridPoint,
  WalkDirection,
  PathStructure,
  EndCapPair,
  SegmentDescriptor,
  DirectionGuide,
} from '../types';
import { OccupancyGrid } from './occupancyGrid';
import { createSeededRandom, SeededRandom } from './random';
import { wickedWiseContinuous } from './wickedWiseWalker';

export type DirectionBiasMap = Map<number, WalkDirection>;

export function createDirectionBiasMap(
  guides: DirectionGuide[],
  grid: OccupancyGrid,
  influenceRadius: number = 6
): DirectionBiasMap {
  const map: DirectionBiasMap = new Map();
  for (const guide of guides) {
    const center = grid.worldToCell(guide.x, guide.y);
    for (let dr = -influenceRadius; dr <= influenceRadius; dr++) {
      for (let dc = -influenceRadius; dc <= influenceRadius; dc++) {
        const dist = Math.abs(dc) + Math.abs(dr);
        if (dist > influenceRadius) continue;
        const c = center.col + dc;
        const r = center.row + dr;
        if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows) {
          const key = r * grid.cols + c;
          if (!map.has(key)) {
            map.set(key, guide.direction);
          }
        }
      }
    }
  }
  return map;
}

export const DELTAS: Record<WalkDirection, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
  'up-right': { dc: 1, dr: -1 },
  'up-left': { dc: -1, dr: -1 },
  'down-right': { dc: 1, dr: 1 },
  'down-left': { dc: -1, dr: 1 },
};

export const CARDINAL_DIRS: WalkDirection[] = ['up', 'right', 'down', 'left'];
export const DIAGONAL_DIRS: WalkDirection[] = ['up-right', 'down-right', 'down-left', 'up-left'];
export const ALL_DIRS_8: WalkDirection[] = [...CARDINAL_DIRS, ...DIAGONAL_DIRS];

export function oppositeDir(dir: WalkDirection): WalkDirection {
  const map: Record<WalkDirection, WalkDirection> = {
    up: 'down',
    down: 'up',
    left: 'right',
    right: 'left',
    'up-right': 'down-left',
    'up-left': 'down-right',
    'down-right': 'up-left',
    'down-left': 'up-right',
  };
  return map[dir];
}

export function getLateralDirs(heading: WalkDirection): [WalkDirection, WalkDirection] {
  if (heading === 'up' || heading === 'down') return ['right', 'left'];
  if (heading === 'left' || heading === 'right') return ['down', 'up'];
  if (heading === 'up-right' || heading === 'down-left') return ['down-right', 'up-left'];
  return ['up-right', 'down-left'];
}

export function isVerticalDir(dir: WalkDirection): boolean {
  return dir === 'up' || dir === 'down';
}

export function dirFromDelta(dc: number, dr: number): WalkDirection {
  if (dc === 0) return dr < 0 ? 'up' : 'down';
  if (dr === 0) return dc < 0 ? 'left' : 'right';
  if (dc > 0 && dr < 0) return 'up-right';
  if (dc < 0 && dr < 0) return 'up-left';
  if (dc > 0 && dr > 0) return 'down-right';
  return 'down-left';
}

export function computeSegmentLength(
  params: GenerationParams,
  cellSize: number,
  rng: SeededRandom
): number {
  if (params.segmentMode === 'fixed') {
    return Math.max(1, Math.round(params.fixedSegmentLength / cellSize));
  }
  const minC = Math.max(1, Math.round(params.minSegmentLength / cellSize));
  const maxC = Math.max(minC, Math.round(params.maxSegmentLength / cellSize));
  return rng.nextInt(minC, maxC);
}

function getAvailableDirs(grid: OccupancyGrid, col: number, row: number, use8: boolean): WalkDirection[] {
  const dirs = use8 ? ALL_DIRS_8 : CARDINAL_DIRS;
  const result: WalkDirection[] = [];
  for (const dir of dirs) {
    const d = DELTAS[dir];
    if (grid.isAvailable(col + d.dc, row + d.dr)) {
      result.push(dir);
    }
  }
  return result;
}

export function walkSegment(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  rng: SeededRandom,
  params: GenerationParams,
  cellSize: number,
  gridPath: GridPoint[],
  biasMap?: DirectionBiasMap
) {
  const use8 = params.angleMode === 45;
  let col = startCol;
  let row = startRow;

  grid.occupy(col, row);
  gridPath.push({ col, row });

  let isVerticalMode = rng.next() > params.fillDirectionBias;
  let heading: WalkDirection = isVerticalMode ? 'up' : 'right';
  let lateralPref: WalkDirection = isVerticalMode ? 'right' : 'down';

  if (biasMap) {
    const key = startRow * grid.cols + startCol;
    const bias = biasMap.get(key);
    if (bias) {
      heading = bias;
      isVerticalMode = isVerticalDir(bias);
      lateralPref = getLateralDirs(bias)[rng.next() < 0.5 ? 0 : 1];
    }
  }

  let failedAttempts = 0;
  const maxFails = 8;
  let segmentsSinceSwitch = 0;
  const maxIterations = grid.cols * grid.rows * 3;
  let iterations = 0;

  while (failedAttempts < maxFails && iterations < maxIterations) {
    iterations++;

    const targetCells = computeSegmentLength(params, cellSize, rng);
    const delta = DELTAS[heading];

    for (let i = 0; i < targetCells; i++) {
      const nc = col + delta.dc;
      const nr = row + delta.dr;
      if (!grid.isAvailable(nc, nr)) break;
      col = nc;
      row = nr;
      grid.occupy(col, row);
      gridPath.push({ col, row });
    }

    segmentsSinceSwitch++;

    const shouldTrySwitch =
      segmentsSinceSwitch > 2 && rng.next() < params.directionSwitchFrequency;

    if (shouldTrySwitch) {
      const switchDirs: WalkDirection[] = isVerticalMode
        ? ['left', 'right']
        : ['up', 'down'];
      if (rng.next() < 0.5) switchDirs.reverse();

      let switched = false;
      for (const dir of switchDirs) {
        const d = DELTAS[dir];
        if (grid.isAvailable(col + d.dc, row + d.dr)) {
          heading = dir;
          isVerticalMode = isVerticalDir(dir);
          lateralPref = getLateralDirs(heading)[rng.next() < 0.5 ? 0 : 1];
          segmentsSinceSwitch = 0;
          failedAttempts = 0;
          switched = true;
          break;
        }
      }
      if (switched) continue;
    }

    const laterals = getLateralDirs(heading);
    const orderedLaterals =
      lateralPref === laterals[0]
        ? laterals
        : ([laterals[1], laterals[0]] as [WalkDirection, WalkDirection]);

    let uTurned = false;
    for (const lat of orderedLaterals) {
      const ld = DELTAS[lat];
      const sideCol = col + ld.dc;
      const sideRow = row + ld.dr;

      if (grid.isAvailable(sideCol, sideRow)) {
        col = sideCol;
        row = sideRow;
        grid.occupy(col, row);
        gridPath.push({ col, row });
        heading = oppositeDir(heading);
        lateralPref = lat;
        failedAttempts = 0;
        uTurned = true;
        break;
      }
    }

    if (uTurned) continue;

    if (use8) {
      const diagDirs = DIAGONAL_DIRS.filter(d => {
        const dd = DELTAS[d];
        return grid.isAvailable(col + dd.dc, row + dd.dr);
      });
      if (diagDirs.length > 0) {
        const pick = diagDirs[rng.nextInt(0, diagDirs.length - 1)];
        const dd = DELTAS[pick];
        col = col + dd.dc;
        row = row + dd.dr;
        grid.occupy(col, row);
        gridPath.push({ col, row });
        heading = pick;
        isVerticalMode = false;
        lateralPref = getLateralDirs(heading)[0];
        failedAttempts = 0;
        continue;
      }
    }

    const perpDirs: WalkDirection[] = isVerticalMode
      ? ['left', 'right']
      : ['up', 'down'];
    if (rng.next() < 0.5) perpDirs.reverse();

    let axisSwitched = false;
    for (const dir of perpDirs) {
      const d = DELTAS[dir];
      if (grid.isAvailable(col + d.dc, row + d.dr)) {
        heading = dir;
        isVerticalMode = isVerticalDir(dir);
        lateralPref = getLateralDirs(heading)[rng.next() < 0.5 ? 0 : 1];
        segmentsSinceSwitch = 0;
        failedAttempts = 0;
        axisSwitched = true;
        break;
      }
    }

    if (!axisSwitched) {
      const available = getAvailableDirs(grid, col, row, use8);
      if (available.length > 0) {
        heading = available[0];
        isVerticalMode = isVerticalDir(heading);
        lateralPref = getLateralDirs(heading)[0];
        failedAttempts = 0;
      } else {
        failedAttempts++;
      }
    }
  }

  return { col, row };
}

export function walkContinuous(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  rng: SeededRandom,
  params: GenerationParams,
  cellSize: number,
  gridPath: GridPoint[],
  biasMap?: DirectionBiasMap
) {
  const use8 = params.angleMode === 45;
  let col = startCol;
  let row = startRow;

  grid.occupy(col, row);
  gridPath.push({ col, row });

  let isVertical = rng.next() > params.fillDirectionBias;
  let heading: WalkDirection = isVertical ? 'up' : 'right';
  let lateralPref: WalkDirection = isVertical ? 'right' : 'down';

  if (biasMap) {
    const key = startRow * grid.cols + startCol;
    const bias = biasMap.get(key);
    if (bias) {
      heading = bias;
      isVertical = isVerticalDir(bias);
      lateralPref = getLateralDirs(bias)[rng.next() < 0.5 ? 0 : 1];
    }
  }

  let stepsInHeading = 0;
  let targetLen = computeSegmentLength(params, cellSize, rng);

  const maxIterations = grid.cols * grid.rows + 100;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (grid.countAvailable() === 0) break;

    const preferredDir = biasMap?.get(row * grid.cols + col);
    const moved = trySerpentineStep(
      grid, col, row, heading, lateralPref, isVertical,
      stepsInHeading, targetLen, rng, params, cellSize, gridPath, use8, preferredDir
    );

    if (moved) {
      const last = gridPath[gridPath.length - 1];
      const dc = last.col - col;
      const dr = last.row - row;
      const newDir = dirFromDelta(dc, dr);

      if (newDir === heading) {
        stepsInHeading++;
      } else {
        if (newDir === oppositeDir(heading)) {
          const laterals = getLateralDirs(heading);
          if (gridPath.length >= 2) {
            const prev = gridPath[gridPath.length - 2];
            const latDc = last.col - prev.col;
            const latDr = last.row - prev.row;
            const latDir = dirFromDelta(latDc, latDr);
            if (laterals.includes(latDir)) {
              lateralPref = latDir;
            }
          }
        }
        heading = newDir;
        isVertical = isVerticalDir(newDir);
        stepsInHeading = 1;
        targetLen = computeSegmentLength(params, cellSize, rng);
      }

      col = last.col;
      row = last.row;
      continue;
    }

    break;
  }

  return { col, row };
}

export function trySerpentineStep(
  grid: OccupancyGrid,
  col: number,
  row: number,
  heading: WalkDirection,
  lateralPref: WalkDirection,
  isVertical: boolean,
  stepsInHeading: number,
  targetLen: number,
  rng: SeededRandom,
  params: GenerationParams,
  _cellSize: number,
  gridPath: GridPoint[],
  use8: boolean,
  preferredDir?: WalkDirection
): boolean {
  const candidateOrders = buildCandidateOrder(
    heading, lateralPref, isVertical, stepsInHeading, targetLen, rng, params, use8, preferredDir
  );

  for (const dir of candidateOrders) {
    const d = DELTAS[dir];
    const nc = col + d.dc;
    const nr = row + d.dr;
    if (!grid.isAvailable(nc, nr)) continue;
    if (!grid.isMoveSafe(nc, nr, use8)) continue;

    grid.occupy(nc, nr);
    gridPath.push({ col: nc, row: nr });
    return true;
  }

  const fallbackDirs = use8 ? ALL_DIRS_8 : CARDINAL_DIRS;
  for (const dir of fallbackDirs) {
    const d = DELTAS[dir];
    const nc = col + d.dc;
    const nr = row + d.dr;
    if (!grid.isAvailable(nc, nr)) continue;

    grid.occupy(nc, nr);
    gridPath.push({ col: nc, row: nr });
    return true;
  }

  return false;
}

export function buildCandidateOrder(
  heading: WalkDirection,
  lateralPref: WalkDirection,
  isVertical: boolean,
  stepsInHeading: number,
  targetLen: number,
  rng: SeededRandom,
  params: GenerationParams,
  use8: boolean,
  preferredDir?: WalkDirection
): WalkDirection[] {
  const order: WalkDirection[] = [];
  const used = new Set<WalkDirection>();

  if (preferredDir && preferredDir !== heading) {
    order.push(preferredDir);
    used.add(preferredDir);
  }

  const shouldSwitch =
    stepsInHeading > targetLen * 0.5 &&
    rng.next() < params.directionSwitchFrequency;

  if (stepsInHeading < targetLen && !shouldSwitch) {
    if (!used.has(heading)) { order.push(heading); used.add(heading); }
  }

  const laterals = getLateralDirs(heading);
  const orderedLaterals = lateralPref === laterals[0]
    ? laterals
    : [laterals[1], laterals[0]] as [WalkDirection, WalkDirection];

  for (const lat of orderedLaterals) {
    if (!used.has(lat)) { order.push(lat); used.add(lat); }
  }

  const rev = oppositeDir(heading);
  if (!used.has(rev)) { order.push(rev); used.add(rev); }

  if (!used.has(heading)) { order.push(heading); used.add(heading); }

  const perps: WalkDirection[] = isVertical ? ['left', 'right'] : ['up', 'down'];
  if (rng.next() < 0.5) perps.reverse();
  for (const p of perps) {
    if (!used.has(p)) { order.push(p); used.add(p); }
  }

  if (use8) {
    const diags = [...DIAGONAL_DIRS];
    for (let i = diags.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [diags[i], diags[j]] = [diags[j], diags[i]];
    }
    for (const d of diags) {
      if (!used.has(d)) { order.push(d); used.add(d); }
    }
  }

  return order;
}

function findFrontierCell(
  grid: OccupancyGrid,
  lastCol: number,
  lastRow: number
): { col: number; row: number } | null {
  let bestDist = Infinity;
  let best: { col: number; row: number } | null = null;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!grid.isAvailable(c, r)) continue;
      let hasOccupiedNeighbor = false;
      for (const dir of Object.values(DELTAS)) {
        const nc = c + dir.dc;
        const nr = r + dir.dr;
        if (
          nc >= 0 &&
          nc < grid.cols &&
          nr >= 0 &&
          nr < grid.rows &&
          !grid.isAvailable(nc, nr)
        ) {
          hasOccupiedNeighbor = true;
          break;
        }
      }
      if (hasOccupiedNeighbor) {
        const dist = Math.abs(c - lastCol) + Math.abs(r - lastRow);
        if (dist < bestDist) {
          bestDist = dist;
          best = { col: c, row: r };
        }
      }
    }
  }

  if (!best) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (grid.isAvailable(c, r)) {
          return { col: c, row: r };
        }
      }
    }
  }

  return best;
}

function extractWaypointsFromGrid(
  gridPath: GridPoint[],
  grid: OccupancyGrid
): Waypoint[] {
  if (gridPath.length < 2) return [];

  const waypoints: Waypoint[] = [];

  const getWorld = (gp: GridPoint) => grid.cellToWorld(gp.col, gp.row);

  const first = getWorld(gridPath[0]);
  waypoints.push({ x: first.x, y: first.y, type: 'start' });

  for (let i = 1; i < gridPath.length - 1; i++) {
    const prev = gridPath[i - 1];
    const curr = gridPath[i];
    const next = gridPath[i + 1];

    const prevW = getWorld(prev);
    const currW = getWorld(curr);
    const nextW = getWorld(next);

    const dxIn = currW.x - prevW.x;
    const dyIn = currW.y - prevW.y;
    const dxOut = nextW.x - currW.x;
    const dyOut = nextW.y - currW.y;

    if (dxIn !== dxOut || dyIn !== dyOut) {
      waypoints.push({ x: currW.x, y: currW.y, type: 'turn' });
    }
  }

  const last = getWorld(gridPath[gridPath.length - 1]);
  waypoints.push({ x: last.x, y: last.y, type: 'end' });

  return waypoints;
}

function extractWaypointsFromSegments(
  gridSegments: GridPoint[][],
  grid: OccupancyGrid
): Waypoint[] {
  const waypoints: Waypoint[] = [];

  for (let s = 0; s < gridSegments.length; s++) {
    const seg = gridSegments[s];
    if (seg.length < 2) continue;

    const firstType: Waypoint['type'] = s === 0 ? 'start' : 'segment-start';
    const first = grid.cellToWorld(seg[0].col, seg[0].row);
    waypoints.push({ x: first.x, y: first.y, type: firstType });

    for (let i = 1; i < seg.length - 1; i++) {
      const prev = seg[i - 1];
      const curr = seg[i];
      const next = seg[i + 1];

      const dxIn = curr.col - prev.col;
      const dyIn = curr.row - prev.row;
      const dxOut = next.col - curr.col;
      const dyOut = next.row - curr.row;

      if (dxIn !== dxOut || dyIn !== dyOut) {
        const world = grid.cellToWorld(curr.col, curr.row);
        waypoints.push({ x: world.x, y: world.y, type: 'turn' });
      }
    }

    const last = grid.cellToWorld(
      seg[seg.length - 1].col,
      seg[seg.length - 1].row
    );
    waypoints.push({ x: last.x, y: last.y, type: 'end' });
  }

  return waypoints;
}

export function buildPathStructure(
  waypoints: Waypoint[],
  cellSize: number
): PathStructure {
  const endCapPairs: EndCapPair[] = [];
  const segments: SegmentDescriptor[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    if (waypoints[i].type !== 'turn' || waypoints[i + 1].type !== 'turn') continue;

    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < cellSize * 1.5) {
      let axis: 'horizontal' | 'vertical' = 'vertical';
      if (i > 0) {
        const prev = waypoints[i - 1];
        const dxSeg = Math.abs(a.x - prev.x);
        const dySeg = Math.abs(a.y - prev.y);
        axis = dySeg > dxSeg ? 'vertical' : 'horizontal';
      }
      endCapPairs.push({ indexA: i, indexB: i + 1, axis });
    }
  }

  let segStart = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const t = waypoints[i].type;
    if (t === 'turn' || t === 'end' || t === 'segment-start') {
      const a = waypoints[segStart];
      const b = waypoints[i];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      segments.push({
        startIndex: segStart,
        endIndex: i,
        axis: dy > dx ? 'vertical' : (dx > dy ? 'horizontal' : 'vertical'),
      });
      segStart = i;
    }
  }

  return { endCapPairs, segments, cellSize };
}

export function generateSerpentine(
  boundary: BoundaryShape,
  params: GenerationParams,
  guides?: DirectionGuide[]
): { waypoints: Waypoint[]; structure: PathStructure } {
  const rng = createSeededRandom(params.seed);
  const cellSize = params.strokeWidth + params.minGap;
  const grid = new OccupancyGrid(boundary, cellSize);

  const emptyResult = {
    waypoints: [] as Waypoint[],
    structure: { endCapPairs: [], segments: [], cellSize } as PathStructure,
  };

  if (grid.cols < 2 || grid.rows < 2) return emptyResult;

  const biasMap = guides && guides.length > 0
    ? createDirectionBiasMap(guides, grid)
    : undefined;

  const initialAvailable = grid.countAvailable();

  let startCol = -1;
  let startRow = -1;
  for (let col = 0; col < grid.cols && startCol === -1; col++) {
    for (let row = grid.rows - 1; row >= 0; row--) {
      if (grid.isAvailable(col, row)) {
        startCol = col;
        startRow = row;
        break;
      }
    }
  }

  if (startCol === -1) return emptyResult;

  if (params.fillMode === 'continuous') {
    const gridPath: GridPoint[] = [];
    walkContinuous(grid, startCol, startRow, rng, params, cellSize, gridPath, biasMap);

    const waypoints = extractWaypointsFromGrid(gridPath, grid);
    const structure = buildPathStructure(waypoints, cellSize);
    return { waypoints, structure };
  }

  if (params.fillMode === 'wicked-wise') {
    const gridPath: GridPoint[] = [];
    wickedWiseContinuous(grid, startCol, startRow, rng, params, cellSize, gridPath, undefined, undefined, undefined, biasMap);

    const waypoints = extractWaypointsFromGrid(gridPath, grid);
    const structure = buildPathStructure(waypoints, cellSize);
    return { waypoints, structure };
  }

  const gridSegments: GridPoint[][] = [];
  const firstSeg: GridPoint[] = [];
  let lastPos = walkSegment(grid, startCol, startRow, rng, params, cellSize, firstSeg, biasMap);
  gridSegments.push(firstSeg);

  const targetFill = params.targetFillPercent / 100;

  for (let pass = 0; pass < params.maxPasses; pass++) {
    const remaining = grid.countAvailable();
    const filled = initialAvailable - remaining;
    if (filled / initialAvailable >= targetFill || remaining === 0) break;

    const frontier = findFrontierCell(grid, lastPos.col, lastPos.row);
    if (!frontier) break;

    const segPath: GridPoint[] = [];
    lastPos = walkSegment(grid, frontier.col, frontier.row, rng, params, cellSize, segPath, biasMap);
    gridSegments.push(segPath);
  }

  const waypoints = extractWaypointsFromSegments(gridSegments, grid);
  const structure = buildPathStructure(waypoints, cellSize);
  return { waypoints, structure };
}
