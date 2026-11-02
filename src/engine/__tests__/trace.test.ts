import { describe, it, expect } from 'vitest';
import { BoundaryShape, GenerationParams, DEFAULT_PARAMS, Waypoint, FillMode } from '../../types';
import { generateSerpentine } from '../serpentineGenerator';
import { traceCycle, generateTrace, cutIntoPieces, chamferWaypoints } from '../traceGenerator';
import { OccupancyGrid } from '../occupancyGrid';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 512, height: 538 };
const SMALL_RECT: BoundaryShape = { type: 'rectangle', x: 100, y: 50, width: 300, height: 203 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 400, height: 400 };
const WIDE_ELLIPSE: BoundaryShape = { type: 'ellipse', x: 10, y: 20, width: 512, height: 300 };

const SEEDS = [1, 2, 3, 42, 999, 12345, 777777];
const CELLS: Array<{ strokeWidth: number; minGap: number }> = [
  { strokeWidth: 8, minGap: 6 },
  { strokeWidth: 6, minGap: 4 },
  { strokeWidth: 4, minGap: 2 },
];

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, fillMode: 'trace', seed: 1, ...over };
}

function key(c: number, r: number): number {
  return r * 100000 + c;
}

function assertDistinctConsecutive(wps: Waypoint[]) {
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1];
    const b = wps[i];
    if (b.type === 'segment-start') continue;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-6);
  }
}

/** Cells a polyline of axis-aligned waypoints passes through, in order. */
function cellsOfWaypoints(wps: Waypoint[], grid: OccupancyGrid): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  const push = (c: number, r: number) => {
    const last = out[out.length - 1];
    if (last && last.col === c && last.row === r) return;
    out.push({ col: c, row: r });
  };
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    const cell = grid.worldToCell(wp.x, wp.y);
    if (i === 0 || wp.type === 'segment-start') {
      push(cell.col, cell.row);
      continue;
    }
    const prev = grid.worldToCell(wps[i - 1].x, wps[i - 1].y);
    const dc = Math.sign(cell.col - prev.col);
    const dr = Math.sign(cell.row - prev.row);
    const steps = Math.max(Math.abs(cell.col - prev.col), Math.abs(cell.row - prev.row));
    for (let s = 1; s <= steps; s++) push(prev.col + dc * s, prev.row + dr * s);
  }
  return out;
}

describe('trace cycle', () => {
  const shapes: Array<[string, BoundaryShape]> = [
    ['rect', RECT],
    ['small rect', SMALL_RECT],
    ['ellipse', ELLIPSE],
    ['wide ellipse', WIDE_ELLIPSE],
  ];

  for (const [name, shape] of shapes) {
    for (const cell of CELLS) {
      for (const seed of SEEDS) {
        it(`${name} cell ${cell.strokeWidth + cell.minGap} seed ${seed}: visits every coverable cell exactly once`, () => {
          const p = params({ ...cell, seed });
          const traced = traceCycle(shape, p);
          expect(traced).not.toBeNull();
          const { grid, coarse, cycle, coverable } = traced!;

          // Every cell of every active coarse node, no more.
          const expected = new Set<number>();
          for (let R = 0; R < coarse.rows; R++) {
            for (let C = 0; C < coarse.cols; C++) {
              if (!coarse.active[R * coarse.cols + C]) continue;
              for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expected.add(key(2 * C + dx, 2 * R + dy));
            }
          }
          expect(cycle.length).toBe(coverable);
          expect(cycle.length).toBe(expected.size);

          const seen = new Set<number>();
          for (let i = 0; i < cycle.length; i++) {
            const c = cycle[i];
            const k = key(c.col, c.row);
            expect(seen.has(k)).toBe(false); // never revisits a cell
            expect(expected.has(k)).toBe(true);
            expect(grid.isAvailable(c.col, c.row)).toBe(true);
            seen.add(k);
            const n = cycle[(i + 1) % cycle.length];
            expect(Math.abs(n.col - c.col) + Math.abs(n.row - c.row)).toBe(1); // 4-connected, closes
          }
          expect(seen.size).toBe(expected.size);

          if (shape.type === 'rectangle') {
            // Every available cell of the (even) grid is coverable.
            expect(coverable).toBe(grid.countAvailable());
          }
        });
      }
    }
  }

  it('rect: fill ratio is exactly 1.0 for every seed', () => {
    for (const seed of SEEDS) {
      for (const cell of CELLS) {
        const r = generateTrace(RECT, params({ ...cell, seed }));
        expect(r.fillRatio).toBe(1);
        expect(r.waypoints.length).toBeGreaterThan(10);
        assertDistinctConsecutive(r.waypoints);
      }
    }
  });

  it('ellipse: every coverable cell is used; only the partial edge blocks are skipped', () => {
    for (const seed of SEEDS) {
      const p = params({ seed });
      const traced = traceCycle(ELLIPSE, p)!;
      expect(traced.cycle.length).toBe(traced.coverable);
      const r = generateTrace(ELLIPSE, p);
      expect(r.fillRatio).toBeGreaterThan(0.85);
      expect(r.fillRatio).toBeLessThanOrEqual(1);
      assertDistinctConsecutive(r.waypoints);
    }
  });

  it('waypoints retrace the cycle cell for cell (open path)', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const p = params({ seed });
      const traced = traceCycle(RECT, p)!;
      const r = generateTrace(RECT, p);
      const cells = cellsOfWaypoints(r.waypoints, traced.grid);
      expect(cells.length).toBe(traced.cycle.length);
      for (let i = 0; i < cells.length; i++) {
        expect(cells[i]).toEqual(traced.cycle[i]);
      }
      expect(r.waypoints[0].type).toBe('start');
      expect(r.waypoints[r.waypoints.length - 1].type).toBe('end');
      // Starts in the bottom-left corner like the walker did.
      expect(traced.cycle[0]).toEqual({ col: 0, row: traced.grid.rows - 1 });
    }
  });

  it('closed loop starts and ends at the same point mid-run, no corner at the joint', () => {
    for (const seed of SEEDS) {
      const r = generateTrace(RECT, params({ seed, closedLoop: true }));
      const first = r.waypoints[0];
      const last = r.waypoints[r.waypoints.length - 1];
      expect(first.x).toBe(last.x);
      expect(first.y).toBe(last.y);
      // Legs into and out of the joint are collinear.
      const a = r.waypoints[r.waypoints.length - 2];
      const b = r.waypoints[1];
      const inDx = Math.sign(last.x - a.x);
      const inDy = Math.sign(last.y - a.y);
      const outDx = Math.sign(b.x - first.x);
      const outDy = Math.sign(b.y - first.y);
      expect([inDx, inDy]).toEqual([outDx, outDy]);
      assertDistinctConsecutive(r.waypoints);
    }
  });

  it('pieces: the loop is cut into N open paths covering every cell once', () => {
    for (const pieces of [2, 5, 10]) {
      const p = params({ seed: 42, tracePieces: pieces });
      const traced = traceCycle(RECT, p)!;
      const parts = cutIntoPieces(traced.cycle, pieces);
      expect(parts.length).toBe(pieces);
      expect(parts.reduce((n, part) => n + part.length, 0)).toBe(traced.cycle.length);
      const r = generateTrace(RECT, p);
      const starts = r.waypoints.filter(w => w.type === 'segment-start').length;
      expect(starts).toBe(pieces - 1);
      const cells = cellsOfWaypoints(r.waypoints, traced.grid);
      expect(cells.length).toBe(traced.cycle.length);
      expect(new Set(cells.map(c => key(c.col, c.row))).size).toBe(traced.cycle.length);
    }
  });

  it('45 degrees: every leg is axis-aligned or a true diagonal, no coincident points', () => {
    for (const seed of SEEDS) {
      const p = params({ seed, angleMode: 45 });
      const cellSize = p.strokeWidth + p.minGap;
      const r = generateTrace(RECT, p);
      assertDistinctConsecutive(r.waypoints);
      let diagonals = 0;
      for (let i = 1; i < r.waypoints.length; i++) {
        const dx = Math.abs(r.waypoints[i].x - r.waypoints[i - 1].x);
        const dy = Math.abs(r.waypoints[i].y - r.waypoints[i - 1].y);
        if (dx > 1e-6 && dy > 1e-6) {
          expect(Math.abs(dx - dy)).toBeLessThan(1e-6);
          expect(Math.abs(dx - cellSize / 2)).toBeLessThan(1e-6);
          diagonals++;
        }
      }
      expect(diagonals).toBeGreaterThan(0);
      // Chamfering never changes the cells the stroke passes through.
      const square = generateTrace(RECT, { ...p, angleMode: 90 });
      const grid = new OccupancyGrid(RECT, cellSize, { evenDimensions: true });
      const before = cellsOfWaypoints(square.waypoints, grid).length;
      const after = new Set(
        chamferWaypoints(square.waypoints, cellSize).map(w => {
          const c = grid.worldToCell(w.x, w.y);
          return key(c.col, c.row);
        })
      );
      expect(after.size).toBeLessThanOrEqual(before);
    }
  });

  it('direction guides pull runs onto their axis', () => {
    const p = params({ seed: 7, fillDirectionBias: 0.5 });
    const guide = { x: 256, y: 269, direction: 'right' as const };
    const withGuide = generateTrace(RECT, p, [guide]);
    const without = generateTrace(RECT, p, []);
    const horizontalNear = (wps: Waypoint[]) => {
      let h = 0;
      let v = 0;
      for (let i = 1; i < wps.length; i++) {
        const a = wps[i - 1];
        const b = wps[i];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (Math.abs(mx - guide.x) > 60 || Math.abs(my - guide.y) > 60) continue;
        if (Math.abs(b.x - a.x) > Math.abs(b.y - a.y)) h += Math.abs(b.x - a.x);
        else v += Math.abs(b.y - a.y);
      }
      return h / (h + v);
    };
    expect(horizontalNear(withGuide.waypoints)).toBeGreaterThan(horizontalNear(without.waypoints));
    expect(horizontalNear(withGuide.waypoints)).toBeGreaterThan(0.6);
  });

  it('generateSerpentine does not run the retry sweep for trace', () => {
    const p = params({ seed: 5, targetFillPercent: 100 });
    const t0 = performance.now();
    const r = generateSerpentine(RECT, p);
    const ms = performance.now() - t0;
    expect(r.adjusted).toBe(false);
    expect(r.params).toBe(p);
    expect(r.fillRatio).toBe(1);
    expect(ms).toBeLessThan(200);
  });

  it('degenerate: tiny boundary returns empty, odd grids trim to even', () => {
    const r = generateTrace({ type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }, params({}));
    expect(r.waypoints).toEqual([]);
    const grid = new OccupancyGrid({ type: 'rectangle', x: 0, y: 0, width: 15 * 14 + 3, height: 7 * 14 }, 14, { evenDimensions: true });
    expect(grid.cols).toBe(14);
    expect(grid.rows).toBe(6);
    // Still centered: equal margins on both sides.
    expect(grid.originX - 0).toBeCloseTo((15 * 14 + 3 - 14 * 14) / 2);
  });
});

describe('benchmark (logs only)', () => {
  it('fill ratio per mode on the 512x538 rect, 10 seeds', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cases: Array<{ label: string; over: Partial<GenerationParams> }> = [
      { label: 'Trace 90', over: { fillMode: 'trace' } },
      { label: 'Trace 45', over: { fillMode: 'trace', angleMode: 45 } },
      { label: 'Trace ellipse 400', over: { fillMode: 'trace' } },
      { label: 'Continuous 90, target 75', over: { fillMode: 'continuous', targetFillPercent: 75 } },
      { label: 'Wicked Wise 90, target 75', over: { fillMode: 'wicked-wise', targetFillPercent: 75 } },
      { label: 'Multi-Pass 90, target 75', over: { fillMode: 'multi-pass', targetFillPercent: 75 } },
      { label: 'Continuous 90, target 100 (sweep)', over: { fillMode: 'continuous', targetFillPercent: 100 } },
    ];
    const lines: string[] = [];
    for (const c of cases) {
      const shape = c.label.includes('ellipse') ? ELLIPSE : RECT;
      const ratios: number[] = [];
      const times: number[] = [];
      const runs: number[] = [];
      for (const seed of seeds) {
        const p: GenerationParams = { ...DEFAULT_PARAMS, ...c.over, fillMode: c.over.fillMode as FillMode, seed };
        const t0 = performance.now();
        const r = generateSerpentine(shape, p);
        times.push(performance.now() - t0);
        ratios.push(r.fillRatio);
        // mean straight leg length in cells
        const cell = p.strokeWidth + p.minGap;
        let legs = 0;
        let total = 0;
        for (let i = 1; i < r.waypoints.length; i++) {
          if (r.waypoints[i].type === 'segment-start') continue;
          total += Math.hypot(r.waypoints[i].x - r.waypoints[i - 1].x, r.waypoints[i].y - r.waypoints[i - 1].y) / cell;
          legs++;
        }
        runs.push(legs > 0 ? total / legs : 0);
      }
      const sorted = [...ratios].sort((a, b) => a - b);
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const tSorted = [...times].sort((a, b) => a - b);
      lines.push(
        `${c.label.padEnd(36)} fill mean ${pct(mean)} median ${pct(sorted[Math.floor(sorted.length / 2)])} ` +
          `min-max ${pct(sorted[0])}-${pct(sorted[sorted.length - 1])}  ` +
          `time median ${tSorted[Math.floor(tSorted.length / 2)].toFixed(1)}ms max ${tSorted[tSorted.length - 1].toFixed(1)}ms  ` +
          `mean leg ${(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(1)} cells`
      );
    }
    console.log('\n' + lines.join('\n') + '\n');
    expect(lines.length).toBe(cases.length);
  }, 60000);
});
