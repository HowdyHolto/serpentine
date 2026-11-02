import { describe, it, expect } from 'vitest';
import { DEFAULT_PARAMS, GenerationParams, Point } from '../../types';
import { pointInPolygon, makePolygonBoundary, polygonArea } from '../geometry';
import { OccupancyGrid } from '../occupancyGrid';
import { generateSerpentine } from '../serpentineGenerator';
import { buildSvgDocument } from '../svgExport';
import { renderPaths } from '../pathRenderer';

const TRIANGLE: Point[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }];
// An L shape: 400 wide, 400 tall, with the top-right 200x200 cut away.
const L_SHAPE: Point[] = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 0, y: 400 },
];

function params(over: Partial<GenerationParams> = {}): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'serpentine', fillMode: 'trace', seed: 2, ...over };
}

describe('polygon boundaries', () => {
  it('point in polygon and bounds', () => {
    expect(pointInPolygon(50, 50, TRIANGLE)).toBe(true);
    expect(pointInPolygon(300, 300, TRIANGLE)).toBe(false);
    expect(pointInPolygon(300, 100, L_SHAPE)).toBe(false);
    expect(pointInPolygon(300, 300, L_SHAPE)).toBe(true);
    const b = makePolygonBoundary(L_SHAPE);
    expect(b.type).toBe('path');
    expect([b.x, b.y, b.width, b.height]).toEqual([0, 0, 400, 400]);
    expect(b.pathData).toMatch(/^M 0 0 L 200 0 .* Z$/);
    expect(Math.abs(polygonArea(L_SHAPE))).toBe(400 * 400 - 200 * 200);
  });

  it('masks cells outside the polygon', () => {
    const grid = new OccupancyGrid(makePolygonBoundary(L_SHAPE), 20);
    let available = 0;
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (grid.isAvailable(c, r)) available++;
    // 3/4 of a 20x20 grid.
    expect(available).toBe(300);
    expect(grid.isAvailable(15, 2)).toBe(false);
    expect(grid.isAvailable(2, 2)).toBe(true);
  });

  it('traces a full fill inside an L and a triangle and exports a path clip', () => {
    for (const pts of [L_SHAPE, TRIANGLE]) {
      const boundary = makePolygonBoundary(pts);
      const p = params();
      const result = generateSerpentine(boundary, p);
      expect(result.waypoints.length).toBeGreaterThan(50);
      for (const wp of result.waypoints) {
        expect(pointInPolygon(wp.x, wp.y, pts)).toBe(true);
      }
      const svg = buildSvgDocument(boundary, renderPaths(result.waypoints, p), p);
      expect(svg).toContain('<clipPath id="boundary-clip">');
      expect(svg).toContain(`<path d="${boundary.pathData}"`);
    }
    const lFill = generateSerpentine(makePolygonBoundary(L_SHAPE), params()).fillRatio;
    expect(lFill).toBeGreaterThan(0.95);
  });

  it('concentric follows a polygon boundary', () => {
    const boundary = makePolygonBoundary(L_SHAPE);
    const result = generateSerpentine(boundary, params({ patternMode: 'concentric', concentricStrength: 1, concentricFalloff: 0 }));
    expect(result.waypoints.length).toBeGreaterThan(50);
  });
});
