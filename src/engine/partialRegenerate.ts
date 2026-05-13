import {
  BoundaryShape,
  GenerationParams,
  Waypoint,
  GridPoint,
  PathStructure,
  WalkDirection,
  DirectionGuide,
} from '../types';
import { OccupancyGrid } from './occupancyGrid';
import { createSeededRandom, SeededRandom } from './random';
import {
  buildPathStructure,
  DELTAS,
  oppositeDir,
  getLateralDirs,
  isVerticalDir,
  dirFromDelta,
  computeSegmentLength,
  trySerpentineStep,
  createDirectionBiasMap,
  DirectionBiasMap,
} from './serpentineGenerator';

interface FrozenRun {
  startIdx: number;
  endIdx: number;
}

interface GapDescriptor {
  startAnchorIdx: number | null;
  endAnchorIdx: number | null;
}

function identifyFrozenRunsAndGaps(
  waypointCount: number,
  frozenIndices: Set<number>
): { runs: FrozenRun[]; gaps: GapDescriptor[] } {
  const runs: FrozenRun[] = [];
  let i = 0;
  while (i < waypointCount) {
    if (frozenIndices.has(i)) {
      const start = i;
      while (i < waypointCount && frozenIndices.has(i)) i++;
      runs.push({ startIdx: start, endIdx: i - 1 });
    } else {
      i++;
    }
  }

  const gaps: GapDescriptor[] = [];
  if (runs.length === 0) {
    gaps.push({ startAnchorIdx: null, endAnchorIdx: null });
    return { runs, gaps };
  }

  if (runs[0].startIdx > 0) {
    gaps.push({ startAnchorIdx: null, endAnchorIdx: runs[0].startIdx });
  }

  for (let r = 0; r < runs.length - 1; r++) {
    const gapStart = runs[r].endIdx + 1;
    const gapEnd = runs[r + 1].startIdx - 1;
    if (gapStart <= gapEnd) {
      gaps.push({ startAnchorIdx: runs[r].endIdx, endAnchorIdx: runs[r + 1].startIdx });
    }
  }

  const lastRun = runs[runs.length - 1];
  if (lastRun.endIdx < waypointCount - 1) {
    gaps.push({ startAnchorIdx: lastRun.endIdx, endAnchorIdx: null });
  }

  return { runs, gaps };
}

function interpolateSegmentCells(
  from: Waypoint,
  to: Waypoint,
  grid: OccupancyGrid
): GridPoint[] {
  const startCell = grid.worldToCell(from.x, from.y);
  const endCell = grid.worldToCell(to.x, to.y);
  const cells: GridPoint[] = [];
  const dc = endCell.col - startCell.col;
  const dr = endCell.row - startCell.row;
  const steps = Math.max(Math.abs(dc), Math.abs(dr));

  if (steps === 0) {
    cells.push(startCell);
    return cells;
  }

  for (let s = 0; s <= steps; s++) {
    const col = Math.round(startCell.col + (dc * s) / steps);
    const row = Math.round(startCell.row + (dr * s) / steps);
    if (cells.length === 0 || cells[cells.length - 1].col !== col || cells[cells.length - 1].row !== row) {
      cells.push({ col, row });
    }
  }

  return cells;
}

function occupyFrozenCells(
  grid: OccupancyGrid,
  waypoints: Waypoint[],
  runs: FrozenRun[]
): void {
  for (const run of runs) {
    for (let i = run.startIdx; i <= run.endIdx; i++) {
      const cell = grid.worldToCell(waypoints[i].x, waypoints[i].y);
      grid.occupy(cell.col, cell.row);
      if (i < run.endIdx) {
        const cells = interpolateSegmentCells(waypoints[i], waypoints[i + 1], grid);
        for (const c of cells) {
          grid.occupy(c.col, c.row);
        }
      }
    }
  }
}

function inferHeadingFromFrozen(
  grid: OccupancyGrid,
  waypoints: Waypoint[],
  anchorIdx: number | null
): WalkDirection | null {
  if (anchorIdx === null || anchorIdx < 1) return null;

  const anchor = grid.worldToCell(waypoints[anchorIdx].x, waypoints[anchorIdx].y);
  const prev = grid.worldToCell(waypoints[anchorIdx - 1].x, waypoints[anchorIdx - 1].y);
  const dc = Math.sign(anchor.col - prev.col);
  const dr = Math.sign(anchor.row - prev.row);
  if (dc === 0 && dr === 0) return null;
  return dirFromDelta(dc, dr);
}

function findGapStartCell(
  grid: OccupancyGrid,
  anchorWp: Waypoint | null,
  inferredHeading: WalkDirection | null
): { col: number; row: number } | null {
  if (!anchorWp) {
    for (let col = 0; col < grid.cols; col++) {
      for (let row = grid.rows - 1; row >= 0; row--) {
        if (grid.isAvailable(col, row)) return { col, row };
      }
    }
    return null;
  }

  const anchor = grid.worldToCell(anchorWp.x, anchorWp.y);

  if (inferredHeading) {
    const d = DELTAS[inferredHeading];
    const c = anchor.col + d.dc;
    const r = anchor.row + d.dr;
    if (grid.isAvailable(c, r)) return { col: c, row: r };
  }

  const allDirs = [
    { dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 },
    { dc: 1, dr: -1 }, { dc: -1, dr: -1 }, { dc: 1, dr: 1 }, { dc: -1, dr: 1 },
  ];

  for (const d of allDirs) {
    const c = anchor.col + d.dc;
    const r = anchor.row + d.dr;
    if (grid.isAvailable(c, r)) return { col: c, row: r };
  }

  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = anchor.col + dc;
      const r = anchor.row + dr;
      if (grid.isAvailable(c, r)) return { col: c, row: r };
    }
  }

  return null;
}

function walkGap(
  grid: OccupancyGrid,
  startCol: number,
  startRow: number,
  targetCol: number | null,
  targetRow: number | null,
  rng: SeededRandom,
  params: GenerationParams,
  cellSize: number,
  initialHeading: WalkDirection | null,
  biasMap?: DirectionBiasMap
): GridPoint[] {
  const gridPath: GridPoint[] = [];
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

  let stepsInHeading = 0;
  let targetLen = computeSegmentLength(params, cellSize, rng);

  const maxIterations = grid.cols * grid.rows + 100;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (targetCol !== null && targetRow !== null) {
      const dist = Math.abs(col - targetCol) + Math.abs(row - targetRow);
      if (dist <= 1) {
        if (col !== targetCol || row !== targetRow) {
          if (grid.isAvailable(targetCol, targetRow)) {
            grid.occupy(targetCol, targetRow);
          }
          gridPath.push({ col: targetCol, row: targetRow });
        }
        break;
      }
    }

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

  return gridPath;
}

function extractGapWaypoints(
  gridPath: GridPoint[],
  grid: OccupancyGrid,
  isFirstOverall: boolean,
  isLastOverall: boolean
): Waypoint[] {
  if (gridPath.length < 2) return [];

  const waypoints: Waypoint[] = [];
  const toWorld = (gp: GridPoint) => grid.cellToWorld(gp.col, gp.row);

  const first = toWorld(gridPath[0]);
  waypoints.push({ x: first.x, y: first.y, type: isFirstOverall ? 'start' : 'turn' });

  for (let i = 1; i < gridPath.length - 1; i++) {
    const prev = gridPath[i - 1];
    const curr = gridPath[i];
    const next = gridPath[i + 1];
    if (curr.col - prev.col !== next.col - curr.col || curr.row - prev.row !== next.row - curr.row) {
      const world = toWorld(curr);
      waypoints.push({ x: world.x, y: world.y, type: 'turn' });
    }
  }

  const last = toWorld(gridPath[gridPath.length - 1]);
  waypoints.push({ x: last.x, y: last.y, type: isLastOverall ? 'end' : 'turn' });

  return waypoints;
}

function isClose(a: Waypoint, b: Waypoint): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

export function partialRegenerate(
  boundary: BoundaryShape,
  frozenParams: GenerationParams,
  currentWaypoints: Waypoint[],
  frozenIndices: Set<number>,
  guides?: DirectionGuide[]
): { waypoints: Waypoint[]; structure: PathStructure; newFrozenIndices: Set<number>; warning?: string } {
  const cellSize = frozenParams.strokeWidth + frozenParams.minGap;
  const grid = new OccupancyGrid(boundary, cellSize);
  const emptyStructure: PathStructure = { endCapPairs: [], segments: [], cellSize };

  if (grid.cols < 2 || grid.rows < 2) {
    return { waypoints: currentWaypoints, structure: emptyStructure, newFrozenIndices: frozenIndices };
  }

  const { runs, gaps } = identifyFrozenRunsAndGaps(currentWaypoints.length, frozenIndices);

  if (gaps.length === 0) {
    const structure = buildPathStructure(currentWaypoints, cellSize);
    return { waypoints: currentWaypoints, structure, newFrozenIndices: frozenIndices };
  }

  occupyFrozenCells(grid, currentWaypoints, runs);

  const biasMap = guides && guides.length > 0
    ? createDirectionBiasMap(guides, grid)
    : undefined;

  let warning: string | undefined;
  const gapResults: Waypoint[][] = [];
  for (let g = 0; g < gaps.length; g++) {
    const gap = gaps[g];
    const subSeed = frozenParams.seed + (g + 1) * 9973;
    const rng = createSeededRandom(subSeed);

    const anchorWp = gap.startAnchorIdx !== null ? currentWaypoints[gap.startAnchorIdx] : null;
    const inferredHeading = inferHeadingFromFrozen(grid, currentWaypoints, gap.startAnchorIdx);

    const startCell = findGapStartCell(grid, anchorWp, inferredHeading);
    if (!startCell) {
      warning = 'Could not find available space to regenerate this section. Try unfreezing some waypoints near the gap.';
      gapResults.push([]);
      continue;
    }

    let targetCol: number | null = null;
    let targetRow: number | null = null;
    if (gap.endAnchorIdx !== null) {
      const tc = grid.worldToCell(
        currentWaypoints[gap.endAnchorIdx].x,
        currentWaypoints[gap.endAnchorIdx].y
      );
      targetCol = tc.col;
      targetRow = tc.row;
    }

    const gridPath = walkGap(
      grid, startCell.col, startCell.row,
      targetCol, targetRow,
      rng, frozenParams, cellSize, inferredHeading, biasMap
    );

    if (targetCol !== null && targetRow !== null && gridPath.length > 0) {
      const last = gridPath[gridPath.length - 1];
      const dist = Math.abs(last.col - targetCol) + Math.abs(last.row - targetRow);
      if (dist > 1) {
        warning = 'The regenerated path could not reach the frozen section on the other side. The available space is too constrained.';
      }
    }

    const isFirstOverall = gap.startAnchorIdx === null;
    const isLastOverall = gap.endAnchorIdx === null;
    const wps = extractGapWaypoints(gridPath, grid, isFirstOverall, isLastOverall);
    gapResults.push(wps);
  }

  const merged: Waypoint[] = [];
  const newFrozen = new Set<number>();

  type Section = { kind: 'frozen'; runIdx: number } | { kind: 'gap'; gapIdx: number };
  const sections: Section[] = [];

  let gapIdx = 0;

  if (runs.length > 0 && runs[0].startIdx > 0 && gapIdx < gaps.length && gaps[gapIdx].startAnchorIdx === null) {
    sections.push({ kind: 'gap', gapIdx });
    gapIdx++;
  }

  for (let r = 0; r < runs.length; r++) {
    sections.push({ kind: 'frozen', runIdx: r });
    if (gapIdx < gaps.length && gaps[gapIdx].startAnchorIdx === runs[r].endIdx) {
      sections.push({ kind: 'gap', gapIdx });
      gapIdx++;
    }
  }

  for (const section of sections) {
    if (section.kind === 'frozen') {
      const run = runs[section.runIdx];
      for (let i = run.startIdx; i <= run.endIdx; i++) {
        const wp = currentWaypoints[i];
        if (merged.length > 0 && isClose(merged[merged.length - 1], wp)) {
          newFrozen.add(merged.length - 1);
          continue;
        }
        newFrozen.add(merged.length);
        merged.push(wp);
      }
    } else {
      const wps = gapResults[section.gapIdx];
      for (const wp of wps) {
        if (merged.length > 0 && isClose(merged[merged.length - 1], wp)) continue;
        merged.push(wp);
      }
    }
  }

  if (merged.length > 0) {
    merged[0] = { ...merged[0], type: 'start' };
    merged[merged.length - 1] = { ...merged[merged.length - 1], type: 'end' };
  }

  const structure = buildPathStructure(merged, cellSize);
  return { waypoints: merged, structure, newFrozenIndices: newFrozen, warning };
}
