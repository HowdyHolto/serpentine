import { describe, it, expect } from 'vitest';
import { BoundaryShape, DEFAULT_PARAMS, GenerationParams, Point, Rock } from '../../types';
import { generateSerpentine } from '../serpentineGenerator';
import { renderPaths } from '../pathRenderer';
import { parsePathD, gradientSpans } from '../pathStyle';
import {
  buildFabricationGeometry,
  buildFabricationSvg,
  flattenPrimitives,
  ringToPathData,
} from '../fabrication';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 300, height: 320 };
const ELLIPSE: BoundaryShape = { type: 'ellipse', x: 0, y: 0, width: 300, height: 300 };

function params(over: Partial<GenerationParams> = {}): GenerationParams {
  return { ...DEFAULT_PARAMS, patternMode: 'serpentine', fillMode: 'trace', seed: 4, ...over };
}

function withGradient(p: GenerationParams, over: Partial<GenerationParams['style']> = {}): GenerationParams {
  return { ...p, style: { ...p.style, gradientEnabled: true, ...over } };
}

function render(boundary: BoundaryShape, p: GenerationParams, rocks?: Rock[]) {
  const r = generateSerpentine(boundary, p, undefined, rocks);
  return renderPaths(r.waypoints, r.params);
}

/** Rings of a compound path, each flattened to a polygon. */
function ringsOf(d: string): Point[][] {
  return d
    .split(/(?=M )/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => flattenPrimitives(parsePathD(s).prims, 0.002));
}

function signedArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return a / 2;
}

/** Area of a compound path under the even-odd rule (holes wind the other way). */
function areaOfPath(d: string): number {
  return Math.abs(ringsOf(d).reduce((s, r) => s + signedArea(r), 0));
}

function lengthOf(paths: { d: string }[]): number {
  return paths.reduce((s, p) => s + parsePathD(p.d).length, 0);
}

describe('arc fitting', () => {
  it('turns a rounded rectangle polygon back into four lines and four arcs', () => {
    const r = 10, w = 100, h = 60;
    const ring: Point[] = [];
    const corner = (cx: number, cy: number, a0: number) => {
      for (let i = 0; i <= 24; i++) {
        const a = a0 + (Math.PI / 2) * (i / 24);
        ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, 1.5 * Math.PI);
    const d = ringToPathData(ring);
    expect((d.match(/ A /g) ?? []).length).toBe(4);
    expect((d.match(/ L /g) ?? []).length).toBeLessThanOrEqual(4);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toMatch(/A 10 10 0 0 [01] /);
    const exact = w * h - (4 - Math.PI) * r * r;
    expect(areaOfPath(d)).toBeCloseTo(exact, 0);
  });

  it('writes a full circle as arcs under 180 degrees and a square as lines only', () => {
    const circle = Array.from({ length: 90 }, (_, i) => ({ x: 50 + 20 * Math.cos((i / 90) * 2 * Math.PI), y: 50 + 20 * Math.sin((i / 90) * 2 * Math.PI) }));
    const d = ringToPathData(circle);
    expect((d.match(/ A /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(d).not.toContain(' L ');
    expect(areaOfPath(d)).toBeCloseTo(Math.PI * 400, 0);
    const square = ringToPathData([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(square).not.toContain(' A ');
    expect(areaOfPath(square)).toBeCloseTo(100, 6);
  });
});

describe('fabrication geometry', () => {
  it('centerline is one true-arc path per run', () => {
    const p = withGradient(params());
    const base = render(RECT, p);
    const geo = buildFabricationGeometry(RECT, base, p);
    expect(base.length).toBe(1);
    expect(geo.centerlines).toEqual(base.map((b) => b.d));
    expect(geo.centerlines[0]).toContain(' A ');
  });

  it('outline of one open line is a single ring whose area is length x width plus the round caps', () => {
    const p = params();
    const base = render(RECT, p);
    const geo = buildFabricationGeometry(RECT, base, p);
    expect(geo.outlineRings).toBe(1);
    const expected = lengthOf(base) * p.strokeWidth + Math.PI * (p.strokeWidth / 2) ** 2;
    expect(geo.outlineArea / expected).toBeGreaterThan(0.995);
    expect(geo.outlineArea / expected).toBeLessThan(1.005);
    // The fitted path encloses the same area and is mostly arcs and long lines.
    expect(areaOfPath(geo.outline) / geo.outlineArea).toBeGreaterThan(0.999);
    expect(areaOfPath(geo.outline) / geo.outlineArea).toBeLessThan(1.001);
    expect((geo.outline.match(/ A /g) ?? []).length).toBeGreaterThan(50);
    expect(geo.bands).toEqual([]);
  });

  it('butt caps drop the cap area and a closed loop gives an outer ring and a hole', () => {
    const butt = params({ capStyle: 'butt' });
    const base = render(RECT, butt);
    const geo = buildFabricationGeometry(RECT, base, butt);
    const expected = lengthOf(base) * butt.strokeWidth;
    expect(Math.abs(geo.outlineArea / expected - 1)).toBeLessThan(0.005);

    const loop = params({ closedLoop: true });
    const loopBase = render(RECT, loop);
    const loopGeo = buildFabricationGeometry(RECT, loopBase, loop);
    expect(loopGeo.outlineRings).toBe(2);
    expect(Math.abs(loopGeo.outlineArea / (lengthOf(loopBase) * loop.strokeWidth) - 1)).toBeLessThan(0.005);
    expect(loopGeo.centerlines[0].endsWith('Z')).toBe(true);
  });

  it('handles squared turns, small radii and jitter without losing area', () => {
    for (const over of [{ turnStyle: 'squared' as const }, { cornerRadius: 1 }, { jitter: 1 }, { angleMode: 45 as const }]) {
      const p = params(over);
      const base = render(RECT, p);
      const geo = buildFabricationGeometry(RECT, base, p);
      expect(geo.outlineRings).toBe(1);
      const swept = lengthOf(base) * p.strokeWidth;
      // Sharp inner corners overlap themselves a little, so the area is at most the swept area plus caps.
      expect(geo.outlineArea).toBeLessThan(swept * 1.02 + 60);
      expect(geo.outlineArea).toBeGreaterThan(swept * 0.9);
      expect(areaOfPath(geo.outline) / geo.outlineArea).toBeGreaterThan(0.998);
    }
  });

  it('colour bands tile the outline: their areas add up to it, one shape per colour', () => {
    const p = withGradient(params());
    const base = render(RECT, p);
    const smooth = buildFabricationGeometry(RECT, base, p);
    const spans = gradientSpans(base, p).reduce((s, x) => s + x.spans.length, 0);
    expect(smooth.bands.length).toBeGreaterThan(20);
    expect(smooth.bands.length).toBeLessThanOrEqual(spans);
    const total = smooth.bands.reduce((s, b) => s + areaOfPath(b.d), 0);
    expect(Math.abs(total / smooth.outlineArea - 1)).toBeLessThan(0.01);

    const stepped = buildFabricationGeometry(RECT, base, p, { colourSteps: 5 });
    expect(stepped.bands.length).toBe(5);
    expect(new Set(stepped.bands.map((b) => b.color)).size).toBe(5);
    const steppedTotal = stepped.bands.reduce((s, b) => s + areaOfPath(b.d), 0);
    expect(Math.abs(steppedTotal / stepped.outlineArea - 1)).toBeLessThan(0.01);
    for (const b of stepped.bands) expect(b.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('stepped spans merge along the line and cover it end to end', () => {
    const p = withGradient(params());
    const base = render(RECT, p);
    const [item] = gradientSpans(base, p, 4);
    expect(item.spans.length).toBe(4);
    expect(item.spans[0].s0).toBe(0);
    expect(item.spans[item.spans.length - 1].s1).toBeCloseTo(item.parsed.length, 6);
    for (let i = 1; i < item.spans.length; i++) expect(item.spans[i].s0).toBeCloseTo(item.spans[i - 1].s1, 6);
  });

  it('clips to an ellipse like the screen does and handles rake lines of varying width', () => {
    const rocks: Rock[] = [{ x: 150, y: 150, elevation: 0 }];
    const p = withGradient(params({ patternMode: 'rake', contourSource: 'garden', rockEdge: 0, strokeWidth: 4, minGap: 6, rakeWidthVariation: 1 }));
    const base = render(ELLIPSE, p, rocks);
    expect(new Set(base.map((b) => b.strokeWidth)).size).toBeGreaterThan(2);
    const geo = buildFabricationGeometry(ELLIPSE, base, p, { colourSteps: 3 });
    expect(geo.outlineRings).toBeGreaterThan(10);
    expect(geo.centerlines.length).toBe(base.length);
    for (const ring of ringsOf(geo.outline)) {
      for (const q of ring) {
        const dx = (q.x - 150) / 150, dy = (q.y - 150) / 150;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(1.001);
      }
    }
    expect(geo.bands.length).toBeGreaterThan(0);
    expect(geo.bands.length).toBeLessThanOrEqual(3);
  });

  it('refits rake polylines to arcs without moving them', () => {
    const rocks: Rock[] = [{ x: 150, y: 160, elevation: 0 }];
    const p = params({ patternMode: 'rake', contourSource: 'garden', rockEdge: 0, strokeWidth: 4, minGap: 6 });
    const base = render(RECT, p, rocks);
    const geo = buildFabricationGeometry(RECT, base, p);
    expect(base.every((b) => !b.d.includes(' A '))).toBe(true);
    expect(geo.centerlines.filter((d) => d.includes(' A ')).length).toBeGreaterThan(5);
    const before = base.reduce((n, b) => n + (b.d.match(/ L /g) ?? []).length, 0);
    const after = geo.centerlines.reduce((n, d) => n + (d.match(/ [LA] /g) ?? []).length, 0);
    expect(after).toBeLessThan(before / 3);
    base.forEach((b, i) => {
      const a = parsePathD(b.d), f = parsePathD(geo.centerlines[i]);
      expect(f.closed).toBe(a.closed);
      expect(Math.abs(f.length / a.length - 1)).toBeLessThan(0.01);
      const orig = flattenPrimitives(a.prims);
      for (const q of flattenPrimitives(f.prims, 0.01)) {
        let min = Infinity;
        for (let k = 0; k + 1 < orig.length; k++) {
          const ax = orig[k].x, ay = orig[k].y, vx = orig[k + 1].x - ax, vy = orig[k + 1].y - ay;
          const len2 = vx * vx + vy * vy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - ax) * vx + (q.y - ay) * vy) / len2)) : 0;
          min = Math.min(min, Math.hypot(q.x - (ax + t * vx), q.y - (ay + t * vy)));
        }
        expect(min).toBeLessThan(0.3);
      }
    });
  });

  it('leaves the outline out when markers replace the stroke, and writes markers as shapes', () => {
    const p = params();
    const styled = { ...p, style: { ...p.style, markersEnabled: true, markerShape: 'dash' as const, markerMode: 'replace' as const } };
    const base = render(RECT, styled);
    const geo = buildFabricationGeometry(RECT, base, styled);
    expect(geo.outline).toBe('');
    expect(geo.markers.length).toBeGreaterThan(10);
    const svg = buildFabricationSvg(RECT, base, styled);
    expect(svg).not.toContain('id="Outline"');
    expect(svg).toContain('id="Markers"');
    expect(svg).not.toContain('<line');
    expect(svg).toContain('id="Centerline"');
  });

  it('writes a layered document in mm', () => {
    const p = withGradient(params());
    const base = render(RECT, p);
    const svg = buildFabricationSvg(RECT, base, p, { colourSteps: 6 });
    for (const id of ['Boundary', 'Outline', 'Colour', 'Centerline']) expect(svg).toContain(`<g id="${id}"`);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).not.toContain('clip-path');
    expect(svg).not.toContain('NaN');
    expect((svg.match(/<path fill="#/g) ?? []).length).toBe(6);
    expect(svg.indexOf('id="Outline"')).toBeLessThan(svg.indexOf('id="Colour"'));
    expect(svg.indexOf('id="Colour"')).toBeLessThan(svg.indexOf('id="Centerline"'));
  });
});
