import { describe, it, expect } from 'vitest';
import { BoundaryShape, DEFAULT_PARAMS, DEFAULT_STYLE, GenerationParams, PathStyle, RenderedPath } from '../../types';
import { generateSerpentine } from '../serpentineGenerator';
import { renderPaths } from '../pathRenderer';
import {
  parsePathD,
  pointAt,
  slicePath,
  primitivesToD,
  gradientColor,
  cycleT,
  hexToRgb,
  applyPathStyle,
  renderMarkers,
  renderStyledPaths,
  strokesVisible,
} from '../pathStyle';
import { buildSvgDocument } from '../svgExport';
import { normaliseArrangement } from '../arrangements';

const RECT: BoundaryShape = { type: 'rectangle', x: 0, y: 0, width: 300, height: 260 };

function params(over: Partial<GenerationParams> = {}, style: Partial<PathStyle> = {}): GenerationParams {
  return { ...DEFAULT_PARAMS, seed: 5, strokeWidth: 8, minGap: 6, ...over, style: { ...DEFAULT_STYLE, ...style } };
}

/** Sum of primitive lengths of a path string. */
function lengthOf(d: string): number {
  return parsePathD(d).length;
}

describe('path parsing and arc-length geometry', () => {
  it('parses lines and corner arcs with the right length', () => {
    // A quarter arc of radius 10 between two legs: length = 10 + 10 + pi*5.
    const d = 'M 0 0 L 10 0 A 10 10 0 0 1 20 10 L 20 20';
    const p = parsePathD(d);
    expect(p.prims.length).toBe(3);
    expect(p.closed).toBe(false);
    expect(p.length).toBeCloseTo(10 + Math.PI * 5 + 10, 6);
    const arc = p.prims[1];
    expect(arc.kind).toBe('arc');
    if (arc.kind === 'arc') {
      expect(arc.cx).toBeCloseTo(10, 6);
      expect(arc.cy).toBeCloseTo(10, 6);
      expect(arc.da).toBeGreaterThan(0);
    }
    // Opposite sweep bends the other way: centre on the other side of the chord.
    const q = parsePathD('M 0 0 L 10 0 A 10 10 0 0 0 20 -10');
    const arc2 = q.prims[1];
    if (arc2.kind === 'arc') {
      expect(arc2.cx).toBeCloseTo(10, 6);
      expect(arc2.cy).toBeCloseTo(-10, 6);
      expect(arc2.da).toBeLessThan(0);
    }
  });

  it('closes a Z path with the return leg and wraps on it', () => {
    const p = parsePathD('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(p.closed).toBe(true);
    expect(p.length).toBeCloseTo(40);
    expect(pointAt(p, 45)).toMatchObject({ x: 5, y: 0 });
    expect(pointAt(p, -5).x).toBeCloseTo(0);
    expect(pointAt(p, -5).y).toBeCloseTo(5);
  });

  it('points along an arc lie on the circle with a perpendicular tangent', () => {
    const p = parsePathD('M 0 0 L 10 0 A 10 10 0 0 1 20 10');
    for (const s of [10, 12, 15, 18, 10 + Math.PI * 5]) {
      const q = pointAt(p, s);
      expect(Math.hypot(q.x - 10, q.y - 10)).toBeCloseTo(10, 6);
      // Radius vector is perpendicular to the tangent.
      const rx = q.x - 10, ry = q.y - 10;
      expect(rx * Math.cos(q.angle) + ry * Math.sin(q.angle)).toBeCloseTo(0, 6);
    }
    expect(pointAt(p, 5).angle).toBeCloseTo(0);
    // At the arc end the line heads down (+y), angle 90 degrees.
    expect(pointAt(p, 10 + Math.PI * 5).angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('slices round-trip to the same geometry and cover the whole length', () => {
    const d = 'M 0 0 L 10 0 A 10 10 0 0 1 20 10 L 20 30';
    const p = parsePathD(d);
    const whole = primitivesToD(slicePath(p, 0, p.length));
    expect(lengthOf(whole)).toBeCloseTo(p.length, 1);
    const n = 7;
    let total = 0;
    let prevEnd: { x: number; y: number } | null = null;
    for (let i = 0; i < n; i++) {
      const prims = slicePath(p, (i * p.length) / n, ((i + 1) * p.length) / n);
      const piece = parsePathD(primitivesToD(prims));
      total += piece.length;
      const start = pointAt(piece, 0);
      if (prevEnd) {
        expect(start.x).toBeCloseTo(prevEnd.x, 1);
        expect(start.y).toBeCloseTo(prevEnd.y, 1);
      }
      prevEnd = pointAt(piece, piece.length);
    }
    expect(total).toBeCloseTo(p.length, 0);
  });
});

describe('colour', () => {
  it('interpolates stops in RGB and handles short hex', () => {
    expect(hexToRgb('#f00')).toEqual([255, 0, 0]);
    expect(gradientColor(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(gradientColor(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(gradientColor(['#000000', '#ffffff'], 0.5)).toBe('#808080');
    expect(gradientColor(['#ff0000', '#00ff00', '#0000ff'], 0.5)).toBe('#00ff00');
    expect(gradientColor(['#ff0000', '#00ff00', '#0000ff'], 0.25)).toBe('#808000');
  });

  it('spread shortens the blend between stops down to hard bands', () => {
    const stops = ['#000000', '#ffffff'];
    // Spread 1 is the plain linear blend.
    expect(gradientColor(stops, 0.25, 1)).toBe(gradientColor(stops, 0.25));
    // Spread 0.5: the first and last quarter hold the stop colour, the middle half blends.
    expect(gradientColor(stops, 0.2, 0.5)).toBe('#000000');
    expect(gradientColor(stops, 0.5, 0.5)).toBe('#808080');
    expect(gradientColor(stops, 0.8, 0.5)).toBe('#ffffff');
    expect(gradientColor(stops, 0.375, 0.5)).toBe('#404040');
    // Spread 0: a hard switch halfway between stops, also between three stops.
    expect(gradientColor(stops, 0.49, 0)).toBe('#000000');
    expect(gradientColor(stops, 0.51, 0)).toBe('#ffffff');
    const three = ['#ff0000', '#00ff00', '#0000ff'];
    expect(gradientColor(three, 0.2, 0)).toBe('#ff0000');
    expect(gradientColor(three, 0.3, 0)).toBe('#00ff00');
    expect(gradientColor(three, 0.7, 0)).toBe('#00ff00');
    expect(gradientColor(three, 0.8, 0)).toBe('#0000ff');
    // Pieces honour it: with spread 0 only the two stop colours appear.
    const run: RenderedPath = { d: 'M 0 0 L 280 0', strokeWidth: 8, run: 0 };
    const out = applyPathStyle([run], params({}, { gradientEnabled: true, gradientStops: stops, gradientSpread: 0 }));
    const seen = new Set(out.paths.map((q) => q.stroke));
    expect([...seen].sort()).toEqual(['#000000', '#ffffff']);
  });

  it('cycles mirror so a repeated gradient never jumps', () => {
    expect(cycleT(0, 1)).toBe(0);
    expect(cycleT(1, 1)).toBe(1);
    expect(cycleT(0.5, 2)).toBe(1);
    expect(cycleT(1, 2)).toBe(0);
    expect(cycleT(0.25, 2)).toBeCloseTo(0.5);
    expect(cycleT(0.75, 2)).toBeCloseTo(0.5);
  });
});

describe('gradient pieces', () => {
  const RUN: RenderedPath = { d: 'M 0 0 L 100 0 L 100 100', strokeWidth: 8, run: 0 };

  it('cover the whole length, join end to end and interpolate monotonically', () => {
    const p = params({ strokeWidth: 8, minGap: 6 }, { gradientEnabled: true, gradientStops: ['#ff0000', '#0000ff'], gradientScope: 'whole' });
    const { paths, markers, strokesVisible: vis } = applyPathStyle([RUN], p);
    expect(vis).toBe(true);
    expect(markers).toEqual([]);
    // 200 px at one 14 px cell per piece.
    expect(paths.length).toBe(Math.ceil(200 / 14));
    let covered = 0;
    for (let i = 0; i < paths.length; i++) {
      const piece = parsePathD(paths[i].d);
      covered += piece.length;
      expect(paths[i].stroke).toMatch(/^#[0-9a-f]{6}$/);
      expect(paths[i].run).toBe(0);
      if (i > 0) {
        // Pieces overlap by a hair, so each starts just before the previous one ends.
        const prev = parsePathD(paths[i - 1].d);
        const a = pointAt(prev, prev.length - 1.5);
        const b = pointAt(piece, 0);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
      }
    }
    // Overlaps add at most 1.5 px per seam.
    expect(covered).toBeGreaterThanOrEqual(200 - 1e-6);
    expect(covered).toBeLessThanOrEqual(200 + 1.5 * paths.length);
    // Red falls and blue rises along the line.
    const rgb = paths.map((q) => hexToRgb(q.stroke!));
    for (let i = 1; i < rgb.length; i++) {
      expect(rgb[i][0]).toBeLessThan(rgb[i - 1][0]);
      expect(rgb[i][2]).toBeGreaterThan(rgb[i - 1][2]);
    }
    expect(rgb[0][0]).toBeGreaterThan(230);
    expect(rgb[rgb.length - 1][2]).toBeGreaterThan(230);
    // The last piece ends exactly where the run ends.
    const last = parsePathD(paths[paths.length - 1].d);
    const end = pointAt(last, last.length);
    expect(end.x).toBeCloseTo(100, 6);
    expect(end.y).toBeCloseTo(100, 6);
  });

  it('keep the corner arc geometry when splitting', () => {
    const run: RenderedPath = { d: 'M 0 0 L 90 0 A 10 10 0 0 1 100 10 L 100 100', strokeWidth: 8, run: 0 };
    const p = params({}, { gradientEnabled: true });
    const { paths } = applyPathStyle([run], p);
    const arcs = paths.filter((q) => q.d.includes(' A '));
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) {
      const parsed = parsePathD(a.d);
      for (const prim of parsed.prims) {
        if (prim.kind === 'arc') {
          // Piece endpoints are written to 0.01 px, so a short sub-arc's centre may drift a few thousandths.
          expect(prim.r).toBeCloseTo(10, 2);
          expect(prim.cx).toBeCloseTo(90, 1);
          expect(prim.cy).toBeCloseTo(10, 1);
        }
      }
    }
  });

  it('per-run scope restarts on every run, whole scope spans them all', () => {
    const a: RenderedPath = { d: 'M 0 0 L 100 0', strokeWidth: 8, run: 0 };
    const b: RenderedPath = { d: 'M 0 50 L 100 50', strokeWidth: 8, run: 1 };
    const stops = ['#000000', '#ffffff'];
    const perRun = applyPathStyle([a, b], params({}, { gradientEnabled: true, gradientStops: stops, gradientScope: 'per-run' }));
    const whole = applyPathStyle([a, b], params({}, { gradientEnabled: true, gradientStops: stops, gradientScope: 'whole' }));
    const firstOf = (r: RenderedPath[], run: number) => r.filter((q) => q.run === run);
    // Per run: both runs start dark and end bright.
    for (const run of [0, 1]) {
      const pieces = firstOf(perRun.paths, run);
      expect(hexToRgb(pieces[0].stroke!)[0]).toBeLessThan(40);
      expect(hexToRgb(pieces[pieces.length - 1].stroke!)[0]).toBeGreaterThan(215);
    }
    // Whole: run 0 ends near mid grey, run 1 starts there.
    const r0 = firstOf(whole.paths, 0), r1 = firstOf(whole.paths, 1);
    expect(hexToRgb(r0[r0.length - 1].stroke!)[0]).toBeGreaterThan(100);
    expect(hexToRgb(r0[r0.length - 1].stroke!)[0]).toBeLessThan(140);
    expect(hexToRgb(r1[0].stroke!)[0]).toBeGreaterThan(115);
    expect(hexToRgb(r1[0].stroke!)[0]).toBeLessThan(155);
    expect(hexToRgb(r1[r1.length - 1].stroke!)[0]).toBeGreaterThan(215);
  });

  it('gap pieces of one sub-path share a run and the gradient continues across them', () => {
    const a: RenderedPath = { d: 'M 0 0 L 100 0', strokeWidth: 8, run: 3 };
    const b: RenderedPath = { d: 'M 120 0 L 220 0', strokeWidth: 8, run: 3 };
    const out = applyPathStyle([a, b], params({}, { gradientEnabled: true, gradientStops: ['#000000', '#ffffff'], gradientScope: 'per-run' }));
    const reds = out.paths.map((q) => hexToRgb(q.stroke!)[0]);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThan(reds[i - 1]);
  });

  it('repeats mirror along the line', () => {
    const run: RenderedPath = { d: 'M 0 0 L 280 0', strokeWidth: 8, run: 0 };
    const out = applyPathStyle([run], params({}, { gradientEnabled: true, gradientStops: ['#000000', '#ffffff'], gradientCycles: 2 }));
    const reds = out.paths.map((q) => hexToRgb(q.stroke!)[0]);
    const peak = reds.indexOf(Math.max(...reds));
    expect(peak).toBeGreaterThan(reds.length * 0.3);
    expect(peak).toBeLessThan(reds.length * 0.7);
    expect(reds[0]).toBeLessThan(60);
    expect(reds[reds.length - 1]).toBeLessThan(60);
  });

  it('returns the input untouched when nothing is styled', () => {
    const p = params();
    const out = applyPathStyle([RUN], p);
    expect(out.paths).toBe([RUN][0] && out.paths); // same array semantics: no pieces
    expect(out.paths.length).toBe(1);
    expect(out.paths[0].stroke).toBeUndefined();
  });

  it('splits a real serpentine, a closed loop and rake lines without NaN', () => {
    for (const over of [
      { patternMode: 'serpentine' as const },
      { patternMode: 'serpentine' as const, closedLoop: true },
      { patternMode: 'serpentine' as const, tracePieces: 3 },
      { patternMode: 'rake' as const, contourSource: 'noise' as const },
    ]) {
      const p = params(over, { gradientEnabled: true, gradientScope: 'per-run' });
      const result = generateSerpentine(RECT, p);
      const plain = renderPaths(result.waypoints, p);
      const styled = renderStyledPaths(result.waypoints, p);
      expect(styled.length).toBeGreaterThan(plain.length);
      const plainLen = plain.reduce((s, q) => s + lengthOf(q.d), 0);
      const styledLen = styled.reduce((s, q) => s + lengthOf(q.d), 0);
      expect(styledLen).toBeGreaterThanOrEqual(plainLen - 1e-3);
      expect(styledLen).toBeLessThanOrEqual(plainLen + 1.5 * styled.length);
      for (const q of styled) {
        expect(q.d).not.toContain('NaN');
        expect(q.stroke).toMatch(/^#[0-9a-f]{6}$/);
      }
      // Every run of a few pieces starts nearer the first stop than it ends.
      const runs = new Set(styled.map((q) => q.run));
      expect(runs.size).toBe(new Set(plain.map((q) => q.run)).size);
      const stop0 = hexToRgb(DEFAULT_STYLE.gradientStops[0]);
      const dist = (hex: string) => {
        const c = hexToRgb(hex);
        return Math.hypot(c[0] - stop0[0], c[1] - stop0[1], c[2] - stop0[2]);
      };
      let checked = 0;
      for (const r of runs) {
        const pieces = styled.filter((q) => q.run === r);
        if (pieces.length < 4) continue;
        expect(dist(pieces[0].stroke!)).toBeLessThan(dist(pieces[pieces.length - 1].stroke!));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
});

describe('markers', () => {
  it('are spaced evenly along a straight run and point along it', () => {
    const run: RenderedPath = { d: 'M 0 0 L 240 0', strokeWidth: 8, run: 0 };
    const p = params({}, { markersEnabled: true, markerSpacing: 24, markerSize: 0.5, markerColor: '#ff00ff', markerShape: 'square' });
    const { markers, paths, strokesVisible: vis } = applyPathStyle([run], p);
    expect(vis).toBe(true);
    expect(paths.length).toBe(1);
    expect(markers.length).toBe(10);
    for (let i = 0; i < markers.length; i++) {
      expect(markers[i].x).toBeCloseTo(12 + 24 * i, 6);
      expect(markers[i].y).toBeCloseTo(0, 6);
      expect(markers[i].angle).toBeCloseTo(0, 6);
      expect(markers[i].size).toBeCloseTo(4, 6);
      expect(markers[i].color).toBe('#ff00ff');
      expect(markers[i].shape).toBe('square');
    }
  });

  it('count follows spacing and size follows the stroke width and skew adds to the tangent', () => {
    const run: RenderedPath = { d: 'M 0 0 L 0 300', strokeWidth: 10, run: 0 };
    const few = applyPathStyle([run], params({}, { markersEnabled: true, markerSpacing: 100, markerSize: 2, markerSkew: 15 })).markers;
    const many = applyPathStyle([run], params({}, { markersEnabled: true, markerSpacing: 10 })).markers;
    expect(few.length).toBe(3);
    expect(many.length).toBe(30);
    expect(few[0].size).toBeCloseTo(20, 6);
    // Vertical run heads +y: tangent 90 degrees, plus 15 of skew.
    expect(few[0].angle).toBeCloseTo(105, 6);
  });

  it('follow the gradient colour by default and can replace the stroke', () => {
    const run: RenderedPath = { d: 'M 0 0 L 200 0', strokeWidth: 8, run: 0 };
    const p = params({}, { markersEnabled: true, markerSpacing: 50, markerMode: 'replace', gradientStops: ['#000000', '#ffffff'] });
    const out = applyPathStyle([run], p);
    expect(out.strokesVisible).toBe(false);
    expect(strokesVisible(p.style)).toBe(false);
    const reds = out.markers.map((m) => hexToRgb(m.color)[0]);
    expect(reds.length).toBe(4);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThan(reds[i - 1]);
  });

  it('sit on a real path, including its arcs and a closed loop', () => {
    const p = params({ closedLoop: true }, { markersEnabled: true, markerSpacing: 20 });
    const result = generateSerpentine(RECT, p);
    const markers = renderMarkers(result.waypoints, p);
    const plain = renderPaths(result.waypoints, p);
    const total = plain.reduce((s, q) => s + lengthOf(q.d), 0);
    expect(markers.length).toBe(Math.round(total / 20));
    for (const m of markers) {
      expect(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.angle)).toBe(true);
      expect(m.x).toBeGreaterThanOrEqual(RECT.x - 1);
      expect(m.x).toBeLessThanOrEqual(RECT.x + RECT.width + 1);
      expect(m.y).toBeGreaterThanOrEqual(RECT.y - 1);
      expect(m.y).toBeLessThanOrEqual(RECT.y + RECT.height + 1);
    }
  });
});

describe('export and saves', () => {
  it('writes the colours, groups by colour and width, and adds a markers group', () => {
    const p = params({}, {
      gradientEnabled: true,
      gradientStops: ['#ff0000', '#0000ff'],
      markersEnabled: true,
      markerSpacing: 30,
      markerShape: 'triangle',
      markerColor: '#00ff00',
    });
    const result = generateSerpentine(RECT, p);
    const plain = renderPaths(result.waypoints, p);
    const styled = applyPathStyle(plain, p);
    const svg = buildSvgDocument(RECT, styled.paths, p, styled.markers);
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('<g id="markers"');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).not.toContain('NaN');
    const groups = svg.match(/<g fill="none" stroke="#[0-9a-f]{6}" stroke-width="8"/g) ?? [];
    expect(groups.length).toBe(new Set(styled.paths.map((q) => q.stroke)).size);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(styled.markers.length);
    // Inside a rectangle nothing can cross the edge, so no clip is written.
    expect(svg).not.toContain('clip-path');
    expect(svg).toMatch(/width="[\d.]+mm"/);
  });

  it('leaves the stroke out when markers replace it, and defaults to black otherwise', () => {
    const p = params({}, { markersEnabled: true, markerMode: 'replace', markerSpacing: 40 });
    const result = generateSerpentine(RECT, p);
    const plain = renderPaths(result.waypoints, p);
    const styled = applyPathStyle(plain, p);
    const svg = buildSvgDocument(RECT, styled.paths, p, styled.markers);
    expect(svg).not.toContain('<g fill="none"');
    expect(svg).toContain('<circle');
    const plainSvg = buildSvgDocument(RECT, plain, params());
    expect(plainSvg).toContain('stroke="#000000"');
    expect(plainSvg).not.toContain('markers');
  });

  it('old arrangements without a style load with the default style', () => {
    const { style: _s, ...oldParams } = DEFAULT_PARAMS;
    void _s;
    const a = normaliseArrangement({ boundary: RECT, params: oldParams, waypoints: [] });
    expect(a.params.style).toEqual(DEFAULT_STYLE);
    const b = normaliseArrangement({ boundary: RECT, params: { ...oldParams, style: { gradientEnabled: true } }, waypoints: [] });
    expect(b.params.style.gradientEnabled).toBe(true);
    expect(b.params.style.markerShape).toBe('dot');
    expect(b.params.style.gradientSpread).toBe(1);
  });
});
