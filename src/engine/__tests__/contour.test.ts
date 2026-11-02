import { describe, it, expect } from 'vitest';
import { BoundaryShape, GenerationParams, DEFAULT_PARAMS } from '../../types';
import {
  traceCycle,
  generateTrace,
  heightField,
  contourConformity,
  createContourEdgeWeight,
  createDefaultEdgeWeight,
  buildCoarseGrid,
} from '../traceGenerator';
import { createValueNoise } from '../noise';
import { OccupancyGrid } from '../occupancyGrid';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 512, height: 538 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 400, height: 400 };
const SEEDS = [1, 2, 3, 42, 999];

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'serpentine', fillMode: 'trace', seed: 1, ...over };
}

function contour(over: Partial<GenerationParams>): GenerationParams {
  return params({ patternMode: 'contour', contourStrength: 1, contourSlope: 0, contourInvert: false, ...over });
}

/**
 * How closely the cycle follows the iso-lines of the terrain the weight saw:
 * the mean over steps between coarse blocks of 1 - |cos| between the step
 * and the gradient (the 'direction' measure the contour weight uses), so 1
 * for a step along a contour and 0 for one straight up the slope.
 */
function alongFraction(shape: BoundaryShape, p: GenerationParams): number {
  const traced = traceCycle(shape, p);
  expect(traced).not.toBeNull();
  const { coarse, cycle } = traced!;
  const cell = p.strokeWidth + p.minGap;
  const field = heightField(coarse, createValueNoise(p.seed, Math.max(1, p.contourScale / (2 * cell))));
  let along = 0;
  let total = 0;
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i];
    const b = cycle[(i + 1) % cycle.length];
    const ka = (a.row >> 1) * coarse.cols + (a.col >> 1);
    const kb = (b.row >> 1) * coarse.cols + (b.col >> 1);
    if (ka === kb) continue;
    const gx = field.gx[ka] + field.gx[kb];
    const gy = field.gy[ka] + field.gy[kb];
    const g = Math.hypot(gx, gy);
    if (g < 1e-12) continue;
    total++;
    along += 1 - Math.abs(a.col === b.col ? gy : gx) / g;
  }
  expect(total).toBeGreaterThan(20);
  return along / total;
}

describe('value noise', () => {
  it('is deterministic per seed, in 0..1, and differs between seeds', () => {
    const a = createValueNoise(7, 10);
    const b = createValueNoise(7, 10);
    const c = createValueNoise(8, 10);
    let differs = 0;
    for (let i = 0; i < 50; i++) {
      const x = i * 1.37;
      const y = i * 0.61;
      expect(a(x, y)).toBe(b(x, y));
      expect(a(x, y)).toBeGreaterThanOrEqual(0);
      expect(a(x, y)).toBeLessThanOrEqual(1);
      if (Math.abs(a(x, y) - c(x, y)) > 1e-6) differs++;
    }
    expect(differs).toBeGreaterThan(40);
  });

  it('is smooth: neighbouring samples change little relative to the scale', () => {
    const n = createValueNoise(3, 20);
    let maxStep = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.5;
      maxStep = Math.max(maxStep, Math.abs(n(x + 0.5, 1.5) - n(x, 1.5)));
    }
    expect(maxStep).toBeLessThan(0.15);
  });
});

describe('contour conformity', () => {
  it('is uniform at response 0 and follows slope at response 1', () => {
    expect(contourConformity(0, 0, false)).toBe(1);
    expect(contourConformity(1, 0, false)).toBe(1);
    expect(contourConformity(0, 1, false)).toBe(0);
    expect(contourConformity(1, 1, false)).toBe(1);
    expect(contourConformity(0.25, 1, false)).toBeCloseTo(0.25);
    expect(contourConformity(0.25, 1, true)).toBeCloseTo(0.75);
    expect(contourConformity(0.5, 0.5, false)).toBeCloseTo(0.75);
  });
});

describe('contour pattern', () => {
  it.each(SEEDS)('follows the terrain more closely than serpentine on the rect (seed %i)', (seed) => {
    const off = alongFraction(RECT, params({ seed, contourStrength: 1 }));
    const on = alongFraction(RECT, contour({ seed }));
    expect(on).toBeGreaterThan(off + 0.15);
    expect(on).toBeGreaterThan(0.55);
  });

  it.each([1, 42])('follows the terrain on the ellipse (seed %i)', (seed) => {
    const off = alongFraction(ELLIPSE, params({ seed, contourStrength: 1 }));
    const on = alongFraction(ELLIPSE, contour({ seed }));
    expect(on).toBeGreaterThan(off + 0.1);
  });

  it('strength 0 reproduces the serpentine trace exactly', () => {
    const a = generateTrace(RECT, params({ seed: 5 }));
    const b = generateTrace(RECT, contour({ seed: 5, contourStrength: 0 }));
    expect(b.waypoints).toEqual(a.waypoints);
  });

  it('the pattern-mode dispatch picks the contour weight', () => {
    const p = contour({ seed: 9 });
    const grid = new OccupancyGrid(RECT, p.strokeWidth + p.minGap, { evenDimensions: true });
    const coarse = buildCoarseGrid(grid);
    const w = createContourEdgeWeight(p, coarse);
    const d = createDefaultEdgeWeight(p);
    expect(typeof w).toBe('function');
    expect(w).not.toBe(d);
    const byMode = generateTrace(RECT, p);
    const explicit = generateTrace(RECT, p, undefined, createContourEdgeWeight(p, coarse));
    expect(byMode.waypoints).toEqual(explicit.waypoints);
  });

  it.each([
    ['default', contour({ contourStrength: 0.8, contourSlope: 0.6 })],
    ['steep-only', contour({ contourSlope: 1 })],
    ['invert', contour({ contourSlope: 1, contourInvert: true })],
    ['small features', contour({ contourScale: 60 })],
  ])('keeps the Trace invariants (%s)', (_name, base) => {
    for (const seed of SEEDS) {
      for (const shape of [RECT, ELLIPSE]) {
        const p = { ...base, seed };
        const traced = traceCycle(shape, p);
        expect(traced).not.toBeNull();
        const { cycle, coverable } = traced!;
        expect(cycle.length).toBe(coverable);
        const seen = new Set<string>();
        for (const c of cycle) seen.add(`${c.col},${c.row}`);
        expect(seen.size).toBe(cycle.length);
        for (let i = 0; i < cycle.length; i++) {
          const a = cycle[i];
          const b = cycle[(i + 1) % cycle.length];
          expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
        }
        if (shape === RECT) expect(generateTrace(shape, p).fillRatio).toBe(1);
      }
    }
  });
});
