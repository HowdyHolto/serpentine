import { describe, it, expect } from 'vitest';
import { BoundaryShape, GenerationParams, DEFAULT_PARAMS } from '../../types';
import {
  traceCycle,
  generateTrace,
  concentricConformity,
  buildCoarseGrid,
  createConcentricEdgeWeight,
  createFieldEdgeWeight,
  distanceField,
  makeScalarField,
} from '../traceGenerator';
import { OccupancyGrid } from '../occupancyGrid';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 512, height: 538 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 400, height: 400 };
const SEEDS = [1, 2, 3, 42, 999, 12345, 777777];

function params(over: Partial<GenerationParams>): GenerationParams {
  return { ...DEFAULT_PARAMS, fillMode: 'trace', seed: 1, ...over };
}

function concentric(over: Partial<GenerationParams>): GenerationParams {
  return params({ patternMode: 'concentric', concentricStrength: 1, concentricFalloff: 0, concentricInvert: false, ...over });
}

/**
 * How closely the cycle follows the iso-distance contours of the coarse grid
 * (the contours the weight sees): the mean over steps between coarse blocks
 * of 1 - |change in distance|, so 1 for a step along a contour and 0 for one
 * straight across. Steps inside a block never change distance and are left
 * out. Restricted to a depth band: `band` 0 = outer third, 1 = middle third,
 * 2 = inner third.
 */
function alongFraction(shape: BoundaryShape, p: GenerationParams, band: 0 | 1 | 2): number {
  const traced = traceCycle(shape, p);
  expect(traced).not.toBeNull();
  const { coarse, cycle } = traced!;
  const dist = coarse.distance;
  let max = 1;
  for (let k = 0; k < dist.length; k++) if (dist[k] > max) max = dist[k];
  const lo = 1 + (band * (max - 1)) / 3;
  const hi = 1 + ((band + 1) * (max - 1)) / 3;
  let along = 0;
  let total = 0;
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i];
    const b = cycle[(i + 1) % cycle.length];
    const ka = (a.row >> 1) * coarse.cols + (a.col >> 1);
    const kb = (b.row >> 1) * coarse.cols + (b.col >> 1);
    if (ka === kb) continue;
    const d = (dist[ka] + dist[kb]) / 2;
    if (d < lo || d > hi) continue;
    total++;
    along += 1 - Math.min(1, Math.abs(dist[ka] - dist[kb]));
  }
  expect(total).toBeGreaterThan(20);
  return along / total;
}

/**
 * A rectangle's contours are axis-aligned, so a faithful path scores near 1.
 * A circle's are curved: a 4-connected path can at best alternate axis
 * steps at ~45 degrees, which caps the score around 0.65, so its margins
 * over the default (~0.42) are smaller.
 */
const SHAPES: Array<[string, BoundaryShape, { margin: number; floor: number }]> = [
  ['rect', RECT, { margin: 0.3, floor: 0.9 }],
  ['ellipse', ELLIPSE, { margin: 0.15, floor: 0.6 }],
];

describe('concentric conformity', () => {
  it('falloff 0 is uniform, falloff 1 is linear to zero, invert mirrors it', () => {
    expect(concentricConformity(0, 0, false)).toBe(1);
    expect(concentricConformity(1, 0, false)).toBe(1);
    expect(concentricConformity(0, 1, false)).toBe(1);
    expect(concentricConformity(0.5, 1, false)).toBeCloseTo(0.5);
    expect(concentricConformity(1, 1, false)).toBe(0);
    expect(concentricConformity(0, 1, true)).toBe(0);
    expect(concentricConformity(1, 1, true)).toBe(1);
    expect(concentricConformity(1, 0.5, false)).toBeCloseTo(0.5);
  });
});

describe('concentric trace', () => {
  for (const [name, shape, { margin, floor }] of SHAPES) {
    it(`${name}: outer third follows contours clearly more with concentric on (strength 1, falloff 0)`, () => {
      for (const seed of SEEDS) {
        const on = alongFraction(shape, concentric({ seed }), 0);
        const off = alongFraction(shape, params({ seed }), 0);
        expect(on).toBeGreaterThan(off + margin);
        expect(on).toBeGreaterThan(floor);
      }
    });

    it(`${name}: default strength 0.7 falloff 0.5 still raises the outer third`, () => {
      for (const seed of SEEDS) {
        const on = alongFraction(shape, params({ seed, patternMode: 'concentric' }), 0);
        const off = alongFraction(shape, params({ seed }), 0);
        expect(on).toBeGreaterThan(off + margin * 0.6);
      }
    });

    it(`${name}: falloff 1 keeps the outer third faithful and lets go in the inner third`, () => {
      const drops: number[] = [];
      for (const seed of SEEDS) {
        const uniform = concentric({ seed });
        const faded = concentric({ seed, concentricFalloff: 1 });
        expect(alongFraction(shape, faded, 0)).toBeGreaterThan(alongFraction(shape, params({ seed }), 0) + margin);
        expect(Math.abs(alongFraction(shape, faded, 0) - alongFraction(shape, uniform, 0))).toBeLessThan(0.08);
        const drop = alongFraction(shape, uniform, 2) - alongFraction(shape, faded, 2);
        expect(drop).toBeGreaterThan(0.05);
        drops.push(drop);
      }
      expect(drops.reduce((a, b) => a + b, 0) / drops.length).toBeGreaterThan(0.1);
    });

    it(`${name}: invert with falloff 1 is faithful inside and lets go at the edge`, () => {
      for (const seed of SEEDS) {
        const uniform = concentric({ seed });
        const inverted = concentric({ seed, concentricFalloff: 1, concentricInvert: true });
        expect(alongFraction(shape, inverted, 2) - alongFraction(shape, inverted, 0)).toBeGreaterThan(0.1);
        expect(alongFraction(shape, uniform, 0) - alongFraction(shape, inverted, 0)).toBeGreaterThan(0.1);
      }
    });

    it(`${name}: full coverage invariants hold with concentric on`, () => {
      const variants: Array<Partial<GenerationParams>> = [
        {},
        { concentricFalloff: 1 },
        { concentricFalloff: 1, concentricInvert: true },
        { concentricStrength: 0.4, concentricFalloff: 0.5 },
      ];
      for (const seed of SEEDS) {
        for (const v of variants) {
          const p = concentric({ seed, ...v });
          const traced = traceCycle(shape, p)!;
          const { grid, coarse, cycle, coverable } = traced;
          const expected = new Set<number>();
          for (let R = 0; R < coarse.rows; R++) {
            for (let C = 0; C < coarse.cols; C++) {
              if (!coarse.active[R * coarse.cols + C]) continue;
              for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) expected.add((2 * R + dy) * 100000 + 2 * C + dx);
              }
            }
          }
          expect(cycle.length).toBe(coverable);
          expect(cycle.length).toBe(expected.size);
          const seen = new Set<number>();
          for (let i = 0; i < cycle.length; i++) {
            const c = cycle[i];
            const k = c.row * 100000 + c.col;
            expect(seen.has(k)).toBe(false);
            expect(expected.has(k)).toBe(true);
            seen.add(k);
            const n = cycle[(i + 1) % cycle.length];
            expect(Math.abs(n.col - c.col) + Math.abs(n.row - c.row)).toBe(1);
          }
          if (shape.type === 'rectangle') {
            expect(coverable).toBe(grid.countAvailable());
            expect(generateTrace(shape, p).fillRatio).toBe(1);
          }
        }
      }
    });
  }

  it('strength 0 reproduces the default trace exactly', () => {
    for (const seed of SEEDS) {
      const a = generateTrace(RECT, params({ seed }));
      const b = generateTrace(RECT, concentric({ seed, concentricStrength: 0 }));
      expect(b.waypoints).toEqual(a.waypoints);
    }
  });

  it('concentric off ignores the concentric sliders', () => {
    const a = generateTrace(RECT, params({ seed: 3 }));
    const b = generateTrace(RECT, params({ seed: 3, concentricStrength: 1, concentricFalloff: 1 }));
    expect(b.waypoints).toEqual(a.waypoints);
  });
});

describe('scalar field hook', () => {
  it('a column ramp field pulls the tree onto vertical iso-lines', () => {
    const p = params({ seed: 11, fillDirectionBias: 0.5 });
    const cellSize = p.strokeWidth + p.minGap;
    const grid = new OccupancyGrid(RECT, cellSize, { evenDimensions: true });
    const coarse = buildCoarseGrid(grid);
    const ramp = new Float64Array(coarse.cols * coarse.rows);
    for (let k = 0; k < ramp.length; k++) ramp[k] = k % coarse.cols;
    const field = makeScalarField(coarse, ramp, 1);
    expect(field.min).toBe(0);
    expect(field.max).toBe(coarse.cols - 1);
    // Gradient is +1 in x and 0 in y everywhere inside the rect.
    const mid = Math.floor(coarse.rows / 2) * coarse.cols + Math.floor(coarse.cols / 2);
    expect(field.gx[mid]).toBeCloseTo(1);
    expect(field.gy[mid]).toBeCloseTo(0);

    const weight = createFieldEdgeWeight(p, field, { strength: 1, conformity: () => 1 });
    const r = generateTrace(RECT, p, [], weight);
    expect(r.fillRatio).toBe(1);
    let v = 0;
    let h = 0;
    for (let i = 1; i < r.waypoints.length; i++) {
      const dx = Math.abs(r.waypoints[i].x - r.waypoints[i - 1].x);
      const dy = Math.abs(r.waypoints[i].y - r.waypoints[i - 1].y);
      if (dy > dx) v += dy;
      else h += dx;
    }
    const plain = generateTrace(RECT, p, []);
    let pv = 0;
    let ph = 0;
    for (let i = 1; i < plain.waypoints.length; i++) {
      const dx = Math.abs(plain.waypoints[i].x - plain.waypoints[i - 1].x);
      const dy = Math.abs(plain.waypoints[i].y - plain.waypoints[i - 1].y);
      if (dy > dx) pv += dy;
      else ph += dx;
    }
    expect(v / (v + h)).toBeGreaterThan(pv / (pv + ph) + 0.2);
    expect(v / (v + h)).toBeGreaterThan(0.85);
  });

  it('concentric is the field weight over the distance field', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const p = concentric({ seed, concentricFalloff: 0.7 });
      const cellSize = p.strokeWidth + p.minGap;
      const grid = new OccupancyGrid(ELLIPSE, cellSize, { evenDimensions: true });
      const coarse = buildCoarseGrid(grid);
      const field = distanceField(coarse);
      expect(field.min).toBe(1);
      expect(field.unit).toBe(1);
      const viaField = createFieldEdgeWeight(p, field, {
        strength: p.concentricStrength,
        conformity: (node, f) => concentricConformity((f.value[node] - f.min) / (f.max - f.min), p.concentricFalloff, false),
      });
      const a = generateTrace(ELLIPSE, p, [], viaField);
      const b = generateTrace(ELLIPSE, p, [], createConcentricEdgeWeight(p, coarse));
      const c = generateTrace(ELLIPSE, p);
      expect(a.waypoints).toEqual(b.waypoints);
      expect(a.waypoints).toEqual(c.waypoints);
    }
  });
});

describe('concentric measurements (logs only)', () => {
  it('along-contour fraction per band', () => {
    const lines: string[] = [];
    for (const [name, shape] of SHAPES) {
      const cases: Array<[string, GenerationParams]> = [
        ['off', params({})],
        ['s1 f0', concentric({})],
        ['s1 f1', concentric({ concentricFalloff: 1 })],
        ['s1 f1 inv', concentric({ concentricFalloff: 1, concentricInvert: true })],
        ['s.7 f.5', params({ patternMode: 'concentric' })],
      ];
      for (const [label, base] of cases) {
        const bands = [0, 1, 2].map(b => {
          const vals = SEEDS.map(seed => alongFraction(shape, { ...base, seed }, b as 0 | 1 | 2));
          const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
          return `${(mean * 100).toFixed(0)}% [${(Math.min(...vals) * 100).toFixed(0)}-${(Math.max(...vals) * 100).toFixed(0)}]`;
        });
        lines.push(`${name.padEnd(8)} ${label.padEnd(10)} outer ${bands[0]}  mid ${bands[1]}  inner ${bands[2]}`);
      }
    }
    console.log('\n' + lines.join('\n') + '\n');
    expect(lines.length).toBe(10);
  });
});
