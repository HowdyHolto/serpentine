import {
  GenerationParams,
  GridPoint,
  WalkDirection,
} from '../types';
import { OccupancyGrid } from './occupancyGrid';
import { SeededRandom } from './random';
import {
  DELTAS,
  CARDINAL_DIRS,
  ALL_DIRS_8,
  dirFromDelta,
  oppositeDir,
  getLateralDirs,
  isVerticalDir,
  computeSegmentLength,
  buildCandidateOrder,
  diagonalCornerOpen,
  DirectionBiasMap,
} from './serpentineGenerator';

function evaluateFreedom(
  grid: OccupancyGrid,
  col: number,
  row: number,
  use8: boolean
): number {
  grid.occupy(col, row);
  const dirs = use8 ? [...CARDINAL_DIRS, ...['up-right', 'down-right', 'down-left', 'up-left'] as WalkDirection[]] : CARDINAL_DIRS;
  let startC = -1;
  let startR = -1;
  for (const dir of dirs) {
    const d = DELTAS[dir];
    const nc = col + d.dc;
    const nr = row + d.dr;
    if (grid.isAvailable(nc, nr)) {
      startC = nc;
      startR = nr;
      break;
    }
  }
  if (startC === -1) {
    grid.unoccupy(col, row);
    return 0;
  }
  const reachable = grid.floodFillCount(startC, startR, use8);
  grid.unoccupy(col, row);
  return reachable;
}

function astarConnect(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  goalCol: number,
  goalRow: number,
  use8: boolean
): GridPoint[] | null {
  const key = (c: number, r: number) => r * grid.cols + c;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const openSet = new Map<number, number>();

  const startKey = key(startCol, startRow);
  gScore.set(startKey, 0);
  const h0 = Math.abs(startCol - goalCol) + Math.abs(startRow - goalRow);
  openSet.set(startKey, h0);

  const dirs = use8 ? ALL_DIRS_8 : CARDINAL_DIRS;
  const maxIter = grid.cols * grid.rows;
  let iter = 0;

  while (openSet.size > 0 && iter < maxIter) {
    iter++;

    let bestKey = -1;
    let bestF = Infinity;
    for (const [k, f] of openSet) {
      if (f < bestF) {
        bestF = f;
        bestKey = k;
      }
    }

    openSet.delete(bestKey);

    const curCol = bestKey % grid.cols;
    const curRow = Math.floor(bestKey / grid.cols);

    if (curCol === goalCol && curRow === goalRow) {
      const path: GridPoint[] = [];
      let current = bestKey;
      while (current !== undefined) {
        const c = current % grid.cols;
        const r = Math.floor(current / grid.cols);
        path.unshift({ col: c, row: r });
        const prev = cameFrom.get(current);
        if (prev === undefined) break;
        current = prev;
      }
      return path;
    }

    const curG = gScore.get(bestKey) ?? Infinity;

    for (const dir of dirs) {
      const d = DELTAS[dir];
      const nc = curCol + d.dc;
      const nr = curRow + d.dr;

      if (nc === goalCol && nr === goalRow) {
        const nk = key(nc, nr);
        const tentG = curG + 1;
        const prevG = gScore.get(nk) ?? Infinity;
        if (tentG < prevG) {
          gScore.set(nk, tentG);
          cameFrom.set(nk, bestKey);
          openSet.set(nk, tentG);
        }
        continue;
      }

      if (!grid.isAvailable(nc, nr)) continue;
      if (!diagonalCornerOpen(grid, curCol, curRow, d.dc, d.dr)) continue;

      const nk = key(nc, nr);
      const tentG = curG + 1;
      const prevG = gScore.get(nk) ?? Infinity;
      if (tentG < prevG) {
        gScore.set(nk, tentG);
        cameFrom.set(nk, bestKey);
        const h = Math.abs(nc - goalCol) + Math.abs(nr - goalRow);
        openSet.set(nk, tentG + h);
      }
    }
  }

  return null;
}

export function wickedWiseContinuous(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  rng: SeededRandom,
  params: GenerationParams,
  cellSize: number,
  gridPath: GridPoint[],
  targetCol?: number | null,
  targetRow?: number | null,
  initialHeading?: WalkDirection | null,
  biasMap?: DirectionBiasMap
): { col: number; row: number; warning?: string } {
  const use8 = params.angleMode === 45;
  let col = startCol;
  let row = startRow;

  grid.occupy(col, row);
  gridPath.push({ col, row });

  let isVertical: boolean;
  let heading: WalkDirection;
  let lateralPref: WalkDirection;

  if (initialHeading) {
    heading = initialHeading;
    isVertical = isVerticalDir(heading);
    lateralPref = getLateralDirs(heading)[rng.next() < 0.5 ? 0 : 1];
  } else {
    isVertical = rng.next() > params.fillDirectionBias;
    heading = isVertical ? 'up' : 'right';
    lateralPref = isVertical ? 'right' : 'down';
  }

  if (biasMap && !initialHeading) {
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

  const maxIterations = grid.cols * grid.rows * 2;
  const backtrackMaxDepth = 3;
  let warning: string | undefined;

  const hasTarget = targetCol != null && targetRow != null;
  const connectionThreshold = 6;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (hasTarget) {
      const dist = Math.abs(col - targetCol!) + Math.abs(row - targetRow!);
      if (dist <= 1) {
        if (col !== targetCol || row !== targetRow) {
          if (grid.isAvailable(targetCol!, targetRow!)) {
            grid.occupy(targetCol!, targetRow!);
          }
          gridPath.push({ col: targetCol!, row: targetRow! });
        }
        return { col: targetCol!, row: targetRow! };
      }

      if (dist <= connectionThreshold) {
        const astarPath = astarConnect(grid, col, row, targetCol!, targetRow!, use8);
        if (astarPath && astarPath.length > 1) {
          for (let a = 1; a < astarPath.length; a++) {
            const p = astarPath[a];
            if (grid.isAvailable(p.col, p.row)) {
              grid.occupy(p.col, p.row);
            }
            gridPath.push(p);
          }
          const last = astarPath[astarPath.length - 1];
          return { col: last.col, row: last.row };
        }
      }
    }

    if (grid.countAvailable() === 0) break;

    const totalAvailable = grid.countAvailable();
    const useLookahead = totalAvailable > 20;

    const preferredDir = biasMap?.get(row * grid.cols + col);
    const candidates = buildCandidateOrder(
      heading, lateralPref, isVertical, stepsInHeading, targetLen, rng, params, use8, preferredDir
    );

    type ScoredCandidate = { dir: WalkDirection; nc: number; nr: number; score: number };
    const scored: ScoredCandidate[] = [];

    for (const dir of candidates) {
      const d = DELTAS[dir];
      const nc = col + d.dc;
      const nr = row + d.dr;
      if (!grid.isAvailable(nc, nr)) continue;
      if (!diagonalCornerOpen(grid, col, row, d.dc, d.dr)) continue;

      if (useLookahead) {
        if (!grid.isMoveSafe(nc, nr, use8)) continue;
        const freedom = evaluateFreedom(grid, nc, nr, use8);
        const prefScore = candidates.indexOf(dir);
        const normalizedPref = 1 - prefScore / Math.max(candidates.length - 1, 1);
        const normalizedFreedom = freedom / Math.max(totalAvailable - 1, 1);
        const score = normalizedPref * 0.3 + normalizedFreedom * 0.7;
        scored.push({ dir, nc, nr, score });
      } else {
        if (!grid.isMoveSafe(nc, nr, use8)) continue;
        scored.push({ dir, nc, nr, score: 1 });
      }
    }

    if (scored.length === 0) {
      const fallbackDirs = use8 ? ALL_DIRS_8 : CARDINAL_DIRS;
      for (const dir of fallbackDirs) {
        const d = DELTAS[dir];
        const nc = col + d.dc;
        const nr = row + d.dr;
        if (!grid.isAvailable(nc, nr)) continue;
        if (!diagonalCornerOpen(grid, col, row, d.dc, d.dr)) continue;
        grid.occupy(nc, nr);
        gridPath.push({ col: nc, row: nr });
        col = nc;
        row = nr;
        heading = dir;
        isVertical = isVerticalDir(dir);
        lateralPref = getLateralDirs(heading)[0];
        stepsInHeading = 1;
        targetLen = computeSegmentLength(params, cellSize, rng);
        break;
      }
      if (scored.length === 0 && gridPath[gridPath.length - 1].col === col && gridPath[gridPath.length - 1].row === row) {
        break;
      }
      continue;
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (useLookahead && best.score < 0.3 && scored.length > 1) {
      let recovered = false;
      const btDepth = Math.min(backtrackMaxDepth, gridPath.length - 1);

      for (let bt = 1; bt <= btDepth; bt++) {
        const btIdx = gridPath.length - bt;
        if (btIdx < 1) break;

        const btPoint = gridPath[btIdx];
        const btCandidates: ScoredCandidate[] = [];

        for (const dir of CARDINAL_DIRS) {
          const d = DELTAS[dir];
          const nc = btPoint.col + d.dc;
          const nr = btPoint.row + d.dr;
          if (!grid.isAvailable(nc, nr)) continue;
          const freedom = evaluateFreedom(grid, nc, nr, use8);
          if (freedom > totalAvailable * 0.5) {
            btCandidates.push({ dir, nc, nr, score: freedom });
          }
        }

        if (btCandidates.length > 0) {
          for (let r = gridPath.length - 1; r >= btIdx; r--) {
            const p = gridPath[r];
            grid.unoccupy(p.col, p.row);
          }
          gridPath.length = btIdx;
          col = gridPath[gridPath.length - 1].col;
          row = gridPath[gridPath.length - 1].row;

          btCandidates.sort((a, b) => b.score - a.score);
          const pick = btCandidates[0];
          grid.occupy(pick.nc, pick.nr);
          gridPath.push({ col: pick.nc, row: pick.nr });
          col = pick.nc;
          row = pick.nr;
          heading = pick.dir;
          isVertical = isVerticalDir(heading);
          lateralPref = getLateralDirs(heading)[0];
          stepsInHeading = 1;
          targetLen = computeSegmentLength(params, cellSize, rng);
          recovered = true;
          break;
        }
      }

      if (!recovered) {
        grid.occupy(best.nc, best.nr);
        gridPath.push({ col: best.nc, row: best.nr });
        col = best.nc;
        row = best.nr;
      }
    } else {
      grid.occupy(best.nc, best.nr);
      gridPath.push({ col: best.nc, row: best.nr });
      col = best.nc;
      row = best.nr;
    }

    const last = gridPath[gridPath.length - 1];
    const prevPoint = gridPath[gridPath.length - 2];
    const dc = last.col - prevPoint.col;
    const dr = last.row - prevPoint.row;
    const newDir = dirFromDelta(dc, dr);

    if (newDir === heading) {
      stepsInHeading++;
    } else {
      if (newDir === oppositeDir(heading)) {
        const laterals = getLateralDirs(heading);
        if (gridPath.length >= 3) {
          const prev2 = gridPath[gridPath.length - 3];
          const latDc = prevPoint.col - prev2.col;
          const latDr = prevPoint.row - prev2.row;
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
  }

  if (hasTarget) {
    const last = gridPath[gridPath.length - 1];
    const dist = Math.abs(last.col - targetCol!) + Math.abs(last.row - targetRow!);
    if (dist > 1) {
      warning = 'The path between frozen sections is blocked. Try unfreezing waypoints to open more space.';
    }
  }

  return { col, row, warning };
}

export function wickedWiseSegment(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  rng: SeededRandom,
  params: GenerationParams,
  cellSize: number,
  gridPath: GridPoint[]
): { col: number; row: number } {
  const result = wickedWiseContinuous(
    grid, startCol, startRow, rng, params, cellSize, gridPath
  );
  return { col: result.col, row: result.row };
}
