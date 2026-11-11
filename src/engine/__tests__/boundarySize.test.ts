import { describe, it, expect } from 'vitest';
import { BoundaryShape, DEFAULT_PARAMS } from '../../types';
import { parseLength, mmToPx } from '../units';
import { resizeBoundary, makePolygonBoundary, dragRect } from '../geometry';
import { buildSvgDocument, needsBoundaryClip } from '../svgExport';
import { buildFabricationSvg } from '../fabrication';
import { generateSerpentine } from '../serpentineGenerator';
import { renderPaths } from '../pathRenderer';

describe('typed lengths', () => {
  it('reads mm by default and cm, in and px with a suffix', () => {
    expect(parseLength('120')).toBeCloseTo(mmToPx(120));
    expect(parseLength(' 120.5 mm ')).toBeCloseTo(mmToPx(120.5));
    expect(parseLength('12,5')).toBeCloseTo(mmToPx(12.5));
    expect(parseLength('12cm')).toBeCloseTo(mmToPx(120));
    expect(parseLength('4 in')).toBeCloseTo(384);
    expect(parseLength('4"')).toBeCloseTo(384);
    expect(parseLength('300px')).toBe(300);
    expect(parseLength('.5')).toBeCloseTo(mmToPx(0.5));
  });

  it('rejects anything that is not a positive length', () => {
    for (const bad of ['', 'abc', '-5', '0', '12 parsecs', '1.2.3', 'mm']) expect(parseLength(bad)).toBeNull();
  });
});

describe('resizing a boundary to a typed size', () => {
  it('keeps the centre of a rectangle and an ellipse', () => {
    const rect: BoundaryShape = { type: 'rectangle', x: 100, y: 50, width: 200, height: 100 };
    const wider = resizeBoundary(rect, { width: 300 });
    expect(wider).toEqual({ type: 'rectangle', x: 50, y: 50, width: 300, height: 100 });
    const taller = resizeBoundary({ ...rect, type: 'ellipse' }, { height: 40 });
    expect(taller).toEqual({ type: 'ellipse', x: 100, y: 80, width: 200, height: 40 });
  });

  it('scales a polygon about its centre and rebuilds its path', () => {
    const tri = makePolygonBoundary([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 200 }]);
    const out = resizeBoundary(tri, { width: 50 });
    expect(out.type).toBe('path');
    expect([out.x, out.y, out.width, out.height]).toEqual([25, 0, 50, 200]);
    expect(out.points).toEqual([{ x: 25, y: 0 }, { x: 75, y: 0 }, { x: 25, y: 200 }]);
    expect(out.pathData).toBe('M 25 0 L 75 0 L 25 200 Z');
    const both = resizeBoundary(tri, { width: 200, height: 100 });
    expect([both.width, both.height]).toEqual([200, 100]);
  });
});

describe('boundary outline in exports', () => {
  const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 200, height: 200 };
  const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 200, height: 200 };
  const p = { ...DEFAULT_PARAMS, patternMode: 'serpentine' as const, fillMode: 'trace' as const, seed: 2 };
  const paths = (b: BoundaryShape) => {
    const r = generateSerpentine(b, p);
    return renderPaths(r.waypoints, r.params);
  };

  it('artwork writes the boundary group only when asked, and no rectangle at all otherwise', () => {
    const on = buildSvgDocument(RECT, paths(RECT), p);
    expect(on).toContain('<g id="boundary">');
    expect(on).toContain('<rect');
    const off = buildSvgDocument(RECT, paths(RECT), p, [], { includeBoundary: false });
    expect(off).not.toContain('id="boundary"');
    expect(off).not.toContain('<rect');
    expect(off).not.toContain('clipPath');
    expect(off).toContain('<path d="M ');
  });

  it('keeps the clip where lines can cross the edge', () => {
    expect(needsBoundaryClip(RECT, p)).toBe(false);
    expect(needsBoundaryClip(ELLIPSE, p)).toBe(true);
    expect(needsBoundaryClip(RECT, { ...p, patternMode: 'rake' })).toBe(true);
    const off = buildSvgDocument(ELLIPSE, paths(ELLIPSE), p, [], { includeBoundary: false });
    expect(off).not.toContain('id="boundary"');
    expect(off).toContain('<clipPath id="boundary-clip">');
  });

  it('fabrication writes the Boundary layer only when asked', () => {
    const base = paths(RECT);
    expect(buildFabricationSvg(RECT, base, p)).toContain('<g id="Boundary"');
    const off = buildFabricationSvg(RECT, base, p, { includeBoundary: false });
    expect(off).not.toContain('id="Boundary"');
    expect(off).not.toContain('<rect');
    expect(off).toContain('<g id="Outline"');
    expect(off).toContain('<g id="Centerline"');
  });
});

describe('drawing a boundary with modifiers', () => {
  const start = { x: 100, y: 100 };
  const plain = { square: false, fromCenter: false };

  it('plain drag spans the two points in any direction', () => {
    expect(dragRect(start, { x: 160, y: 130 }, plain)).toEqual({ x: 100, y: 100, width: 60, height: 30 });
    expect(dragRect(start, { x: 40, y: 70 }, plain)).toEqual({ x: 40, y: 70, width: 60, height: 30 });
  });

  it('constrain makes a square on the larger drag distance, toward the cursor', () => {
    const sq = { square: true, fromCenter: false };
    expect(dragRect(start, { x: 160, y: 130 }, sq)).toEqual({ x: 100, y: 100, width: 60, height: 60 });
    expect(dragRect(start, { x: 120, y: 190 }, sq)).toEqual({ x: 100, y: 100, width: 90, height: 90 });
    expect(dragRect(start, { x: 40, y: 130 }, sq)).toEqual({ x: 40, y: 100, width: 60, height: 60 });
    expect(dragRect(start, { x: 70, y: 20 }, sq)).toEqual({ x: 20, y: 20, width: 80, height: 80 });
  });

  it('from centre keeps the press point in the middle', () => {
    const c = { square: false, fromCenter: true };
    expect(dragRect(start, { x: 160, y: 130 }, c)).toEqual({ x: 40, y: 70, width: 120, height: 60 });
    expect(dragRect(start, { x: 40, y: 70 }, c)).toEqual({ x: 40, y: 70, width: 120, height: 60 });
  });

  it('both give a centred square', () => {
    const both = { square: true, fromCenter: true };
    const r = dragRect(start, { x: 130, y: 180 }, both);
    expect(r).toEqual({ x: 20, y: 20, width: 160, height: 160 });
    expect(r.x + r.width / 2).toBe(start.x);
    expect(r.y + r.height / 2).toBe(start.y);
  });
});
