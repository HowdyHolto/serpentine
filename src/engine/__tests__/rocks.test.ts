import { describe, it, expect } from 'vitest';
import { BoundaryShape, GenerationParams, DEFAULT_PARAMS, Rock } from '../../types';
import { traceCycle, generateTrace, contourField, buildCoarseGrid } from '../traceGenerator';
import { OccupancyGrid } from '../occupancyGrid';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 512, height: 538 };
const ROCKS: Rock[] = [
  { x: 150, y: 150, elevation: 1 },
  { x: 380, y: 200, elevation: 0.5 },
  { x: 260, y: 420, elevation: -1 },
];

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'contour', fillMode: 'trace', seed: 1, contourStrength: 1, contourSlope: 0, ...over };
}

/** Mean of 1 - |cos| between each cross-block step and the field gradient. */
function alongFraction(p: GenerationParams, rocks: Rock[]): number {
  const traced = traceCycle(RECT, p, undefined, undefined, rocks);
  expect(traced).not.toBeNull();
  const { coarse, cycle, grid } = traced!;
  const field = contourField(p, coarse, grid, rocks);
  let along = 0, total = 0;
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i], b = cycle[(i + 1) % cycle.length];
    const ka = (a.row >> 1) * coarse.cols + (a.col >> 1);
    const kb = (b.row >> 1) * coarse.cols + (b.col >> 1);
    if (ka === kb) continue;
    const gx = field.gx[ka] + field.gx[kb], gy = field.gy[ka] + field.gy[kb];
    const g = Math.hypot(gx, gy);
    if (g < 1e-12) continue;
    total++;
    along += 1 - Math.abs(a.col === b.col ? gy : gx) / g;
  }
  return along / total;
}

describe('contour fields from rocks', () => {
  const grid = new OccupancyGrid(RECT, 14, { evenDimensions: true });
  const coarse = buildCoarseGrid(grid);
  const nodeAt = (x: number, y: number) => {
    const C = Math.round((x - grid.originX) / (2 * grid.cellSize) - 0.5);
    const R = Math.round((y - grid.originY) / (2 * grid.cellSize) - 0.5);
    return R * coarse.cols + C;
  };

  it('pond peaks at a positive rock and dips at a negative one', () => {
    const f = contourField(params({ contourSource: 'pond', rockSpread: 100 }), coarse, grid, ROCKS);
    const top = f.value[nodeAt(150, 150)];
    const dip = f.value[nodeAt(260, 420)];
    const far = f.value[nodeAt(60, 500)];
    expect(top).toBeGreaterThan(0.8);
    expect(dip).toBeLessThan(-0.8);
    expect(Math.abs(far)).toBeLessThan(0.1);
  });

  it('pond without rocks or mix is the noise terrain', () => {
    const a = contourField(params({ contourSource: 'pond' }), coarse, grid, []);
    const b = contourField(params({ contourSource: 'noise' }), coarse, grid, []);
    expect(a.value).toEqual(b.value);
  });

  it('garden is the scaled distance to the nearest rock or edge', () => {
    const rocks: Rock[] = [{ x: 150, y: 150, elevation: 0 }, { x: 380, y: 380, elevation: 1 }];
    const f = contourField(params({ contourSource: 'garden', rockEdge: 0 }), coarse, grid, rocks);
    const k = nodeAt(150, 150);
    expect(f.value[k]).toBeLessThan(2 * grid.cellSize);
    // Half-way between the rocks, the elevated rock's distance is halved, so it wins.
    const mid = nodeAt(265, 265);
    const dA = Math.hypot(265 - 150, 265 - 150);
    const dB = Math.hypot(265 - 380, 265 - 380) / 2;
    expect(f.value[mid]).toBeCloseTo(Math.min(dA, dB), -1);
    const withEdge = contourField(params({ contourSource: 'garden', rockEdge: 1 }), coarse, grid, rocks);
    expect(withEdge.value[nodeAt(20, 270)]).toBeLessThan(f.value[nodeAt(20, 270)]);
    const noRocks = contourField(params({ contourSource: 'garden', rockEdge: 1 }), coarse, grid, []);
    expect(noRocks.value[nodeAt(256, 269)]).toBeGreaterThan(noRocks.value[nodeAt(20, 269)]);
  });

  it.each(['pond', 'garden'] as const)('%s steers the trace along its contours', (source) => {
    for (const seed of [1, 2, 42]) {
      const off = alongFraction(params({ seed, contourSource: source, contourStrength: 0 }), ROCKS);
      const on = alongFraction(params({ seed, contourSource: source }), ROCKS);
      expect(on).toBeGreaterThan(off + 0.12);
    }
  });

  it.each(['pond', 'garden'] as const)('%s keeps the Trace invariants with rocks', (source) => {
    for (const seed of [1, 7]) {
      const p = params({ seed, contourSource: source, contourSlope: 0.6 });
      const traced = traceCycle(RECT, p, undefined, undefined, ROCKS)!;
      expect(traced.cycle.length).toBe(traced.coverable);
      const seen = new Set(traced.cycle.map((c) => `${c.col},${c.row}`));
      expect(seen.size).toBe(traced.cycle.length);
      expect(generateTrace(RECT, p, undefined, undefined, ROCKS).fillRatio).toBe(1);
    }
  });
});
