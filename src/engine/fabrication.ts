import ClipperLib from 'clipper-lib';
import type { Path as IntPath, Paths as IntPaths } from 'clipper-lib';
import { BoundaryShape, GenerationParams, Point, RenderedMarker, RenderedPath } from '../types';
import { pxToMm } from './units';
import { boundaryShapeElement } from './geometry';
import {
  ParsedPath,
  Primitive,
  applyPathStyle,
  gradientSpans,
  markerGeometry,
  markerTransform,
  parsePathD,
  slicePath,
  strokesVisible,
} from './pathStyle';

// ---------------------------------------------------------------------------
// Fabrication export: the same design as geometry a cutter, plotter or
// Illustrator can use directly.
//
//  - Centerline: one path per continuous run, true lines and arcs, no fill.
//  - Outline: the stroke expanded into one filled compound shape (what
//    "Outline Stroke" + "Unite" gives), clipped to the boundary like the
//    screen is, with circular arcs fitted back so corners are real arcs.
//  - Colour: the length gradient as flat-colour bands that tile the outline
//    exactly, one compound path per colour. No vector format can fill one
//    shape with a gradient that follows a path, so colour lives in bands.
//
// The outline is computed by flattening the centerline to a fine polyline,
// offsetting and uniting with Clipper (integer coordinates, 1/1000 px), then
// fitting arcs to the resulting polygons.
// ---------------------------------------------------------------------------

/** Clipper works in integers: 1000 units per px. */
const SCALE = 1000;
/** Max distance between the true centerline arc and its polyline, px. */
const FLATTEN_TOL = 0.01;
/** Max distance between an offset polygon and the arc fitted to it, px. */
const FIT_TOL = 0.04;
/** Arcs flatter than this radius are written as straight lines. */
const MAX_ARC_RADIUS = 5000;

const fmt = (n: number) => Number(n.toFixed(3)).toString();

// ------------------------------- flattening --------------------------------

function arcSegments(r: number, da: number, tol: number): number {
  if (r <= tol) return 1;
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  return Math.max(1, Math.ceil(Math.abs(da) / step));
}

/** Polyline through a run of primitives, within `tol` of the true curve. */
export function flattenPrimitives(prims: Primitive[], tol = FLATTEN_TOL): Point[] {
  const pts: Point[] = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - x) > 1e-9 || Math.abs(last.y - y) > 1e-9) pts.push({ x, y });
  };
  for (const p of prims) {
    if (p.kind === 'line') {
      push(p.x0, p.y0);
      push(p.x1, p.y1);
    } else {
      const n = arcSegments(p.r, p.da, tol);
      for (let i = 0; i <= n; i++) {
        const a = p.a0 + (p.da * i) / n;
        push(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a));
      }
    }
  }
  return pts;
}

function toInt(points: Point[]): IntPath {
  const out: IntPath = [];
  for (const p of points) {
    const X = Math.round(p.x * SCALE), Y = Math.round(p.y * SCALE);
    const last = out[out.length - 1];
    if (!last || last.X !== X || last.Y !== Y) out.push({ X, Y });
  }
  return out;
}

function fromInt(path: IntPath): Point[] {
  return path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

// ------------------------------- offsetting --------------------------------

export interface StrokeInput {
  points: Point[];
  closed: boolean;
  width: number;
  cap: 'round' | 'butt';
}

function union(paths: IntPaths): IntPaths {
  if (paths.length === 0) return [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out: IntPaths = [];
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

function intersect(paths: IntPaths, clip: IntPath): IntPaths {
  if (paths.length === 0) return [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  const out: IntPaths = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

function areaOf(paths: IntPaths): number {
  let a = 0;
  for (const p of paths) a += ClipperLib.Clipper.Area(p);
  return Math.abs(a) / (SCALE * SCALE);
}

/** Expand strokes into filled polygons (outer rings and holes), united. */
function offsetStrokes(strokes: StrokeInput[]): IntPaths {
  // One offsetter per width and end type; Clipper unites everything added to one.
  const groups = new Map<string, { width: number; end: number; paths: IntPaths }>();
  for (const s of strokes) {
    const ip = toInt(s.points);
    if (ip.length < 2) continue;
    if (s.closed && ip.length > 2) {
      const a = ip[0], b = ip[ip.length - 1];
      if (a.X === b.X && a.Y === b.Y) ip.pop();
    }
    const end = s.closed
      ? ClipperLib.EndType.etClosedLine
      : s.cap === 'round' ? ClipperLib.EndType.etOpenRound : ClipperLib.EndType.etOpenButt;
    const key = `${s.width}|${end}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { width: s.width, end, paths: [] }));
    g.paths.push(ip);
  }
  const all: IntPaths = [];
  for (const g of groups.values()) {
    const co = new ClipperLib.ClipperOffset(2, FLATTEN_TOL * SCALE);
    co.AddPaths(g.paths, ClipperLib.JoinType.jtRound, g.end);
    const sol: IntPaths = [];
    co.Execute(sol, (g.width / 2) * SCALE);
    all.push(...sol);
  }
  return groups.size > 1 ? union(all) : all;
}

function disc(cx: number, cy: number, r: number): IntPath {
  const n = Math.max(12, arcSegments(r, 2 * Math.PI, FLATTEN_TOL));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return toInt(pts);
}

/** The boundary as a polygon, for clipping. */
export function boundaryPolygon(boundary: BoundaryShape): Point[] {
  if (boundary.type === 'path' && boundary.points && boundary.points.length >= 3) return boundary.points;
  if (boundary.type === 'ellipse') {
    const rx = boundary.width / 2, ry = boundary.height / 2;
    const cx = boundary.x + rx, cy = boundary.y + ry;
    const n = Math.max(64, arcSegments(Math.max(rx, ry), 2 * Math.PI, FLATTEN_TOL));
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
  }
  const { x, y, width, height } = boundary;
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

// ------------------------------- arc fitting -------------------------------

function circumcircle(a: Point, b: Point, c: Point): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

interface FittedArc { cx: number; cy: number; r: number; sweep: 0 | 1; angle: number }

/** The arc through pts[i..j] (first, middle and last exactly), if every vertex and chord stays within tol. */
function fitArc(pts: Point[], i: number, j: number, tol: number): FittedArc | null {
  const circ = circumcircle(pts[i], pts[(i + j) >> 1], pts[j]);
  if (!circ || circ.r > MAX_ARC_RADIUS) return null;
  const { cx, cy, r } = circ;
  let dir = 0;
  let angle = 0;
  for (let k = i; k <= j; k++) {
    const p = pts[k];
    if (Math.abs(Math.hypot(p.x - cx, p.y - cy) - r) > tol) return null;
    if (k === j) break;
    const q = pts[k + 1];
    // The chord's midpoint sags inside the circle; a long chord is a straight edge, not part of an arc.
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    if (r - Math.hypot(mx - cx, my - cy) > tol) return null;
    const cross = (p.x - cx) * (q.y - cy) - (p.y - cy) * (q.x - cx);
    const dot = (p.x - cx) * (q.x - cx) + (p.y - cy) * (q.y - cy);
    const step = Math.atan2(cross, dot);
    const sgn = step > 0 ? 1 : step < 0 ? -1 : 0;
    if (sgn === 0) return null;
    if (dir === 0) dir = sgn;
    else if (sgn !== dir) return null;
    angle += Math.abs(step);
  }
  if (angle > 1.9 * Math.PI) return null;
  return { cx, cy, r, sweep: dir > 0 ? 1 : 0, angle };
}

/** Drop vertices that sit on the straight line between their neighbours. */
function dropCollinear(ring: Point[], eps: number): Point[] {
  let pts = ring;
  for (let pass = 0; pass < 2; pass++) {
    const out: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = out.length > 0 ? out[out.length - 1] : pts[(i - 1 + n) % n];
      const b = pts[i], c = pts[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const d = len > 0 ? Math.abs((c.x - a.x) * (a.y - b.y) - (a.x - b.x) * (c.y - a.y)) / len : Math.hypot(b.x - a.x, b.y - a.y);
      const between = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
      if (d > eps || !between) out.push(b);
    }
    if (out.length === pts.length || out.length < 3) break;
    pts = out;
  }
  return pts;
}

/**
 * A polyline as SVG path data, with runs of vertices that lie on a circle
 * written as arcs (A) and everything else as lines (L). Arc ends are polyline
 * vertices, so a closed ring stays watertight.
 */
export function fitPathData(points: Point[], closed: boolean, tol = FIT_TOL): string {
  let pts = points;
  if (closed) {
    pts = dropCollinear(points, 0.002);
    if (pts.length < 3) return '';
    // Start after the longest edge: a straight run is a natural seam, so no arc is split by it.
    let best = 0, bestLen = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l > bestLen) { bestLen = l; best = (i + 1) % pts.length; }
    }
    pts = [...pts.slice(best), ...pts.slice(0, best)];
    pts.push(pts[0]);
  } else if (pts.length < 2) {
    return '';
  }
  const n = pts.length;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  let i = 0;
  while (i < n - 1) {
    let j = i + 3;
    let arc: FittedArc | null = j < n ? fitArc(pts, i, j, tol) : null;
    if (arc) {
      // Grow the arc while it still fits.
      while (j + 1 < n) {
        const next = fitArc(pts, i, j + 1, tol);
        if (!next) break;
        arc = next;
        j++;
      }
      // Write it in pieces under 120 degrees so the large-arc flag is never needed.
      const parts = Math.max(1, Math.ceil(arc.angle / ((2 * Math.PI) / 3)));
      for (let k = 1; k <= parts; k++) {
        const idx = k === parts ? j : i + Math.round(((j - i) * k) / parts);
        d += ` A ${fmt(arc.r)} ${fmt(arc.r)} 0 0 ${arc.sweep} ${fmt(pts[idx].x)} ${fmt(pts[idx].y)}`;
      }
      i = j;
    } else {
      i++;
      if (i < n - 1 || !closed) d += ` L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
    }
  }
  return closed ? d + ' Z' : d;
}

/** One closed ring as fitted path data. */
export function ringToPathData(ring: Point[], tol = FIT_TOL): string {
  return fitPathData(ring, true, tol);
}

/**
 * Rake lines are polylines within POLYLINE_TOL of the smooth contour they
 * trace. Fit arcs to them at that tolerance so the centerline is a compact
 * smooth curve, and the outline offset from it fits to true arcs as well.
 */
const POLYLINE_TOL = 0.25;

function refitPolyline(path: RenderedPath): RenderedPath {
  if (path.d.includes(' A ')) return path;
  const parsed = parsePathD(path.d);
  if (parsed.prims.length < 4) return path;
  const pts = flattenPrimitives(parsed.prims);
  if (parsed.closed && pts.length > 2) pts.pop();
  const d = fitPathData(pts, parsed.closed, POLYLINE_TOL);
  return d ? { ...path, d } : path;
}

function ringsToPathData(paths: IntPaths): string {
  return paths
    .map((p) => ringToPathData(fromInt(p)))
    .filter((d) => d.length > 0)
    .join(' ');
}

// -------------------------------- geometry ---------------------------------

export interface ColourBand { color: string; d: string }

export interface FabricationGeometry {
  /** One path per continuous run: true lines and arcs. */
  centerlines: string[];
  /** The stroke as one compound filled shape (even-odd), or '' when strokes do not draw. */
  outline: string;
  /** Number of separate rings (outer edges and holes) in the outline. */
  outlineRings: number;
  /** Outline area in px², before fitting. */
  outlineArea: number;
  /** One compound shape per colour, tiling the outline; empty when the gradient is off. */
  bands: ColourBand[];
  markers: RenderedMarker[];
}

export interface FabricationOptions {
  /** 0 keeps the gradient at screen resolution; 2 or more snaps it to that many flat colours. */
  colourSteps?: number;
  /** Write the Boundary layer (the boundary's own outline). Default true. */
  includeBoundary?: boolean;
}

/**
 * Build the fabrication geometry from the un-styled rendered paths (one per
 * run, as `renderPaths` returns them) and the parameters that drew them.
 */
export function buildFabricationGeometry(
  boundary: BoundaryShape,
  basePaths: RenderedPath[],
  params: GenerationParams,
  options: FabricationOptions = {}
): FabricationGeometry {
  if (params.patternMode === 'rake') basePaths = basePaths.map(refitPolyline);
  const parsed: ParsedPath[] = basePaths.map((p) => parsePathD(p.d));
  const cap = params.capStyle === 'butt' ? 'butt' : 'round';
  const drawStrokes = strokesVisible(params.style);
  const clip = toInt(boundaryPolygon(boundary));

  const strokes: StrokeInput[] = basePaths.map((p, i) => ({
    points: flattenPrimitives(parsed[i].prims),
    closed: parsed[i].closed,
    width: p.strokeWidth,
    cap,
  }));

  let outlineInt: IntPaths = [];
  let clipped = false;
  if (drawStrokes) {
    const raw = offsetStrokes(strokes);
    outlineInt = intersect(raw, clip);
    // Only clip the colour bands too when the boundary actually cut something off.
    clipped = areaOf(raw) - areaOf(outlineInt) > 1e-3;
  }

  const bands: ColourBand[] = [];
  if (drawStrokes && params.style.gradientEnabled) {
    const byColour = new Map<string, IntPaths>();
    for (const item of gradientSpans(basePaths, params, options.colourSteps ?? 0)) {
      const L = item.parsed.length;
      const r = item.path.strokeWidth / 2;
      for (const span of item.spans) {
        const pts = flattenPrimitives(slicePath(item.parsed, span.s0, span.s1));
        if (pts.length < 2) continue;
        const whole = item.parsed.closed && span.s0 <= 1e-9 && span.s1 >= L - 1e-9;
        // Butt ends where one band meets the next, so bands tile without overlap.
        let shape = offsetStrokes([{ points: pts, closed: whole, width: item.path.strokeWidth, cap: 'butt' }]);
        if (!item.parsed.closed && cap === 'round') {
          const ends: IntPath[] = [];
          if (span.s0 <= 1e-9) ends.push(disc(pts[0].x, pts[0].y, r));
          if (span.s1 >= L - 1e-9) ends.push(disc(pts[pts.length - 1].x, pts[pts.length - 1].y, r));
          if (ends.length > 0) shape = union([...shape, ...ends]);
        }
        const list = byColour.get(span.color);
        if (list) list.push(...shape);
        else byColour.set(span.color, [...shape]);
      }
    }
    for (const [color, shapes] of byColour) {
      let merged = union(shapes);
      if (clipped) merged = intersect(merged, clip);
      const d = ringsToPathData(merged);
      if (d) bands.push({ color, d });
    }
  }

  return {
    centerlines: basePaths.map((p) => p.d),
    outline: ringsToPathData(outlineInt),
    outlineRings: outlineInt.length,
    outlineArea: areaOf(outlineInt),
    bands,
    markers: applyPathStyle(basePaths, params).markers,
  };
}

// --------------------------------- document --------------------------------

/** Markers as closed shapes only: a dash becomes a rounded bar instead of a stroked line. */
function markerShapeElement(m: RenderedMarker): string {
  const g = markerGeometry(m);
  const t = markerTransform(m);
  switch (g.kind) {
    case 'circle':
      return `<circle cx="${m.x}" cy="${m.y}" r="${g.r}" fill="${m.color}" />`;
    case 'rect':
      return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" fill="${m.color}" transform="${t}" />`;
    case 'line': {
      const h = g.strokeWidth;
      const x = Math.min(g.x1, g.x2) - h / 2;
      const w = Math.abs(g.x2 - g.x1) + h;
      return `<rect x="${fmt(x)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}" fill="${m.color}" transform="${t}" />`;
    }
    case 'polygon':
      return `<polygon points="${g.points}" fill="${m.color}" transform="${t}" />`;
  }
}

const layer = (id: string, attrs: string, body: string) =>
  `  <g id="${id}" inkscape:groupmode="layer" inkscape:label="${id}"${attrs ? ' ' + attrs : ''}>\n${body}\n  </g>\n`;

/**
 * The layered fabrication SVG, in mm: Boundary, Outline, Colour, Markers and
 * Centerline as named groups (layers in Inkscape, named groups in Illustrator).
 */
export function buildFabricationSvg(
  boundary: BoundaryShape,
  basePaths: RenderedPath[],
  params: GenerationParams,
  options: FabricationOptions = {}
): string {
  const geo = buildFabricationGeometry(boundary, basePaths, params, options);
  const pad = 20;
  const vx = boundary.x - pad, vy = boundary.y - pad;
  const vw = boundary.width + pad * 2, vh = boundary.height + pad * 2;

  let body = '';
  if (options.includeBoundary ?? true) {
    body += layer('Boundary', 'fill="none" stroke="#999999" stroke-width="0.5"', `    ${boundaryShapeElement(boundary)} />`);
  }
  if (geo.outline) {
    body += layer('Outline', 'fill="#000000" fill-rule="evenodd" stroke="none"', `    <path d="${geo.outline}" />`);
  }
  if (geo.bands.length > 0) {
    body += layer(
      'Colour',
      'fill-rule="evenodd" stroke="none"',
      geo.bands.map((b) => `    <path fill="${b.color}" d="${b.d}" />`).join('\n')
    );
  }
  if (geo.markers.length > 0) {
    body += layer('Markers', '', geo.markers.map((m) => `    ${markerShapeElement(m)}`).join('\n'));
  }
  body += layer(
    'Centerline',
    'fill="none" stroke="#ff0000" stroke-width="0.25" stroke-linecap="round" stroke-linejoin="round"',
    geo.centerlines.map((d) => `    <path d="${d}" />`).join('\n')
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${vx} ${vy} ${vw} ${vh}" width="${fmt(pxToMm(vw))}mm" height="${fmt(pxToMm(vh))}mm">
  <!-- Serpentine fabrication export | Seed: ${params.seed} | 1 user unit = 1/96 in | Layers: Boundary, Outline (expanded stroke), Colour (flat bands), Markers, Centerline -->
${body}</svg>`;
}
