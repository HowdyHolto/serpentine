import { GenerationParams, PathStyle, RenderedMarker, RenderedPath, Waypoint } from '../types';
import { renderPaths } from './pathRenderer';

// ---------------------------------------------------------------------------
// Style layer: colour gradients along the length of the rendered lines and
// markers placed along them.
//
// SVG has no gradient-along-a-path primitive, so a gradient is drawn by
// cutting each rendered run into short pieces by arc length and giving each
// its own stroke colour. The pieces are cut from the renderer's own geometry
// (lines and tangent corner arcs), parsed back from the M / L / A / Z syntax
// `pathRenderer.ts` emits, so nothing is regenerated and corners stay exact.
// Adjacent pieces overlap by a hair so no seam shows with either cap style.
// ---------------------------------------------------------------------------

interface Line { kind: 'line'; x0: number; y0: number; x1: number; y1: number; len: number }
interface Arc { kind: 'arc'; cx: number; cy: number; r: number; a0: number; da: number; x1: number; y1: number; len: number }
export type Primitive = Line | Arc;

export interface ParsedPath {
  prims: Primitive[];
  /** Total arc length in px. */
  length: number;
  closed: boolean;
}

/** Target piece length: one cell. Longer when the design is so long that the piece count would exceed MAX_PIECES. */
const MAX_PIECES = 6000;
const MIN_PIECE_LEN = 4;
/** Pieces overlap by this much along the path so anti-aliased seams never show. */
const OVERLAP = 0.75;

const fmt = (n: number) => Number(n.toFixed(2));

function makeLine(x0: number, y0: number, x1: number, y1: number): Line {
  return { kind: 'line', x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) };
}

/** Build the circular arc from `p0` to `p1` of radius `r` for an SVG `A r r 0 0 sweep` command. */
function makeArc(x0: number, y0: number, r: number, sweep: number, x1: number, y1: number): Arc {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const cx0 = x1 - x0, cy0 = y1 - y0;
  const chord = Math.hypot(cx0, cy0);
  if (chord === 0) return { kind: 'arc', cx: x0, cy: y0, r, a0: 0, da: 0, x1, y1, len: 0 };
  // SVG scales the radius up when the endpoints are too far apart for it.
  const rr = Math.max(r, chord / 2);
  const h = Math.sqrt(Math.max(0, rr * rr - (chord / 2) * (chord / 2)));
  const nx = -cy0 / chord, ny = cx0 / chord;
  // Two candidate centres; pick the one whose short arc runs in the sweep direction.
  for (const sign of [1, -1]) {
    const cx = mx + nx * h * sign, cy = my + ny * h * sign;
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da <= -Math.PI) da += 2 * Math.PI;
    if (h < 1e-9) da = sweep ? Math.PI : -Math.PI;
    if ((sweep === 1 && da > 0) || (sweep === 0 && da < 0)) {
      return { kind: 'arc', cx, cy, r: rr, a0, da, x1, y1, len: Math.abs(da) * rr };
    }
  }
  // Degenerate: fall back to a straight line.
  const l = makeLine(x0, y0, x1, y1);
  return { kind: 'arc', cx: mx, cy: my, r: rr, a0: 0, da: 0, x1, y1, len: l.len };
}

/** Parse a path produced by `renderPaths` (M, L, A with equal radii and no large arc, optional Z). */
export function parsePathD(d: string): ParsedPath {
  const tok = d.trim().split(/[\s,]+/).filter((t) => t.length > 0);
  const prims: Primitive[] = [];
  let i = 0;
  let sx = 0, sy = 0, x = 0, y = 0;
  let closed = false;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    const cmd = tok[i++];
    if (cmd === 'M') {
      x = sx = num(); y = sy = num();
    } else if (cmd === 'L') {
      const nx = num(), ny = num();
      prims.push(makeLine(x, y, nx, ny));
      x = nx; y = ny;
    } else if (cmd === 'A') {
      const r = num(); num(); num(); num();
      const sweep = num();
      const nx = num(), ny = num();
      prims.push(makeArc(x, y, r, sweep, nx, ny));
      x = nx; y = ny;
    } else if (cmd === 'Z' || cmd === 'z') {
      closed = true;
      if (Math.hypot(x - sx, y - sy) > 1e-9) prims.push(makeLine(x, y, sx, sy));
      x = sx; y = sy;
    } else {
      throw new Error(`Unsupported path command: ${cmd}`);
    }
  }
  const length = prims.reduce((s, p) => s + p.len, 0);
  return { prims, length, closed };
}

function primStart(p: Primitive): { x: number; y: number } {
  if (p.kind === 'line') return { x: p.x0, y: p.y0 };
  return { x: p.cx + p.r * Math.cos(p.a0), y: p.cy + p.r * Math.sin(p.a0) };
}

/** Point and tangent angle (radians) at distance `s` along one primitive. */
function pointOn(p: Primitive, s: number): { x: number; y: number; angle: number } {
  const f = p.len > 0 ? Math.max(0, Math.min(1, s / p.len)) : 0;
  if (p.kind === 'line') {
    return {
      x: p.x0 + (p.x1 - p.x0) * f,
      y: p.y0 + (p.y1 - p.y0) * f,
      angle: Math.atan2(p.y1 - p.y0, p.x1 - p.x0),
    };
  }
  const a = p.a0 + p.da * f;
  const dir = p.da >= 0 ? 1 : -1;
  return {
    x: p.cx + p.r * Math.cos(a),
    y: p.cy + p.r * Math.sin(a),
    angle: Math.atan2(Math.cos(a) * dir, -Math.sin(a) * dir),
  };
}

/** Point and tangent at distance `s` along the path (clamped; wraps on a closed path). */
export function pointAt(path: ParsedPath, s: number): { x: number; y: number; angle: number } {
  if (path.prims.length === 0) return { x: 0, y: 0, angle: 0 };
  let t = s;
  if (path.closed && path.length > 0) t = ((s % path.length) + path.length) % path.length;
  t = Math.max(0, Math.min(path.length, t));
  let acc = 0;
  for (const p of path.prims) {
    if (t <= acc + p.len || p === path.prims[path.prims.length - 1]) return pointOn(p, t - acc);
    acc += p.len;
  }
  return pointOn(path.prims[path.prims.length - 1], path.prims[path.prims.length - 1].len);
}

/** Cut the sub-primitive of `p` between distances `s0` and `s1` along it. */
function subPrim(p: Primitive, s0: number, s1: number): Primitive {
  if (p.kind === 'line') {
    const a = pointOn(p, s0), b = pointOn(p, s1);
    return makeLine(a.x, a.y, b.x, b.y);
  }
  const f0 = s0 / p.len, f1 = s1 / p.len;
  const a0 = p.a0 + p.da * f0;
  const da = p.da * (f1 - f0);
  return {
    kind: 'arc', cx: p.cx, cy: p.cy, r: p.r, a0, da,
    x1: p.cx + p.r * Math.cos(a0 + da), y1: p.cy + p.r * Math.sin(a0 + da),
    len: Math.abs(da) * p.r,
  };
}

/** The primitives covering [s0, s1] along the path, s0 and s1 already inside [0, length]. */
function sliceOpen(path: ParsedPath, s0: number, s1: number): Primitive[] {
  const out: Primitive[] = [];
  let acc = 0;
  for (const p of path.prims) {
    const pStart = acc, pEnd = acc + p.len;
    acc = pEnd;
    if (p.len === 0 || pEnd <= s0 || pStart >= s1) continue;
    const a = Math.max(s0, pStart) - pStart;
    const b = Math.min(s1, pEnd) - pStart;
    if (b - a <= 1e-9) continue;
    out.push(a <= 1e-9 && b >= p.len - 1e-9 ? p : subPrim(p, a, b));
  }
  return out;
}

/** The primitives covering [s0, s1]; on a closed path the range may run past either end and wraps. */
export function slicePath(path: ParsedPath, s0: number, s1: number): Primitive[] {
  const L = path.length;
  if (!path.closed) return sliceOpen(path, Math.max(0, s0), Math.min(L, s1));
  const out: Primitive[] = [];
  if (s0 < 0) out.push(...sliceOpen(path, L + s0, L));
  out.push(...sliceOpen(path, Math.max(0, s0), Math.min(L, s1)));
  if (s1 > L) out.push(...sliceOpen(path, 0, s1 - L));
  return out;
}

/** Serialise primitives back to an SVG path (M, L, A). */
export function primitivesToD(prims: Primitive[]): string {
  if (prims.length === 0) return '';
  const s = primStart(prims[0]);
  let d = `M ${fmt(s.x)} ${fmt(s.y)}`;
  for (const p of prims) {
    if (p.kind === 'line') {
      d += ` L ${fmt(p.x1)} ${fmt(p.y1)}`;
    } else {
      d += ` A ${fmt(p.r)} ${fmt(p.r)} 0 0 ${p.da > 0 ? 1 : 0} ${fmt(p.x1)} ${fmt(p.y1)}`;
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Colour at `t` in 0..1 across evenly spaced stops (linear in RGB).
 * `spread` (0..1, default 1) is the fraction of each stop-to-stop interval
 * spent blending, centred in the interval: 1 is a plain linear blend, 0 a
 * hard switch halfway between the stops.
 */
export function gradientColor(stops: string[], t: number, spread = 1): string {
  if (stops.length === 0) return '#ffffff';
  if (stops.length === 1) return rgbToHex(...hexToRgb(stops[0]));
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const w = Math.max(0, Math.min(1, spread));
  const raw = u - i;
  const f = w <= 0 ? (raw < 0.5 ? 0 : 1) : Math.max(0, Math.min(1, (raw - (1 - w) / 2) / w));
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

/**
 * Map a position along a scope (0..1) through the cycle count. Cycles run
 * forward and back (A→B→A), so a repeated gradient never jumps.
 */
export function cycleT(t: number, cycles: number): number {
  const c = Math.max(1, cycles);
  const m = (Math.max(0, Math.min(1, t)) * c) % 2;
  return m <= 1 ? m : 2 - m;
}

// ---------------------------------------------------------------------------
// Applying a style to rendered paths
// ---------------------------------------------------------------------------

interface ScopedPath {
  path: RenderedPath;
  parsed: ParsedPath;
  /** Arc-length offset of this path's start within its gradient scope. */
  base: number;
  /** Total arc length of its gradient scope. */
  span: number;
}

function scopePaths(paths: RenderedPath[], style: PathStyle): ScopedPath[] {
  const parsed = paths.map((p) => parsePathD(p.d));
  const out: ScopedPath[] = [];
  if (style.gradientScope === 'whole') {
    const total = parsed.reduce((s, p) => s + p.length, 0);
    let acc = 0;
    paths.forEach((path, i) => {
      out.push({ path, parsed: parsed[i], base: acc, span: total });
      acc += parsed[i].length;
    });
    return out;
  }
  const runLen = new Map<number, number>();
  paths.forEach((p, i) => {
    const k = p.run ?? i;
    runLen.set(k, (runLen.get(k) ?? 0) + parsed[i].length);
  });
  const runAcc = new Map<number, number>();
  paths.forEach((path, i) => {
    const k = path.run ?? i;
    const base = runAcc.get(k) ?? 0;
    out.push({ path, parsed: parsed[i], base, span: runLen.get(k) ?? parsed[i].length });
    runAcc.set(k, base + parsed[i].length);
  });
  return out;
}

function colorAt(sp: ScopedPath, s: number, style: PathStyle): string {
  const t = sp.span > 0 ? (sp.base + s) / sp.span : 0;
  return gradientColor(style.gradientStops, cycleT(t, style.gradientCycles), style.gradientSpread ?? 1);
}

/** True when the stroke itself should be drawn (markers may replace it). */
export function strokesVisible(style: PathStyle): boolean {
  return !(style.markersEnabled && style.markerMode === 'replace');
}

export interface StyledRender {
  /** The stroke paths to draw: the input paths, or gradient pieces each carrying a `stroke`. */
  paths: RenderedPath[];
  markers: RenderedMarker[];
  strokesVisible: boolean;
}

/** Cut one path into gradient pieces. */
export function splitIntoPieces(sp: ScopedPath, style: PathStyle, pieceLen: number): RenderedPath[] {
  const L = sp.parsed.length;
  if (L <= 0) return [];
  const n = Math.max(1, Math.ceil(L / pieceLen));
  const step = L / n;
  const ov = Math.min(OVERLAP, step / 2);
  const out: RenderedPath[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = i * step, s1 = (i + 1) * step;
    const prims = slicePath(sp.parsed, s0 - ov, s1 + ov);
    const d = primitivesToD(prims);
    if (!d) continue;
    out.push({
      d,
      strokeWidth: sp.path.strokeWidth,
      stroke: colorAt(sp, (s0 + s1) / 2, style),
      run: sp.path.run,
    });
  }
  return out;
}

/** Place markers at equal arc-length intervals along one path. */
export function placeMarkers(sp: ScopedPath, style: PathStyle): RenderedMarker[] {
  const L = sp.parsed.length;
  if (L <= 0) return [];
  const spacing = Math.max(1, style.markerSpacing);
  const n = Math.max(1, Math.round(L / spacing));
  const step = L / n;
  const size = Math.max(0.5, style.markerSize * sp.path.strokeWidth);
  const fixed = style.markerColor !== 'gradient' ? style.markerColor : null;
  const out: RenderedMarker[] = [];
  for (let i = 0; i < n; i++) {
    const s = sp.parsed.closed ? i * step : (i + 0.5) * step;
    const p = pointAt(sp.parsed, s);
    out.push({
      shape: style.markerShape,
      x: fmt(p.x),
      y: fmt(p.y),
      angle: fmt((p.angle * 180) / Math.PI + style.markerSkew),
      size: fmt(size),
      color: fixed ?? colorAt(sp, s, style),
    });
  }
  return out;
}

/**
 * Apply `params.style` to rendered paths. Returns the paths to draw (the
 * originals when the gradient is off, coloured pieces when it is on), the
 * markers, and whether the stroke draws at all.
 */
export function applyPathStyle(paths: RenderedPath[], params: GenerationParams): StyledRender {
  const style = params.style;
  const needsGeometry = style.gradientEnabled || style.markersEnabled;
  if (!needsGeometry || paths.length === 0) {
    return { paths, markers: [], strokesVisible: strokesVisible(style) };
  }
  const scoped = scopePaths(paths, style);
  let outPaths = paths;
  if (style.gradientEnabled) {
    const total = scoped.reduce((s, p) => s + p.parsed.length, 0);
    const cell = Math.max(MIN_PIECE_LEN, params.strokeWidth + params.minGap);
    const pieceLen = Math.max(cell, total / MAX_PIECES);
    outPaths = scoped.flatMap((sp) => splitIntoPieces(sp, style, pieceLen));
  }
  const markers = style.markersEnabled ? scoped.flatMap((sp) => placeMarkers(sp, style)) : [];
  return { paths: outPaths, markers, strokesVisible: strokesVisible(style) };
}

/** Render waypoints straight to styled paths (gradient pieces when the gradient is on). */
export function renderStyledPaths(waypoints: Waypoint[], params: GenerationParams): RenderedPath[] {
  return applyPathStyle(renderPaths(waypoints, params), params).paths;
}

/** Render waypoints straight to markers. */
export function renderMarkers(waypoints: Waypoint[], params: GenerationParams): RenderedMarker[] {
  return applyPathStyle(renderPaths(waypoints, params), params).markers;
}

// ---------------------------------------------------------------------------
// Marker shapes, in the marker's own frame (origin at the marker, x along the
// rotated tangent). Shared by the canvas and the SVG export so both agree.
// ---------------------------------------------------------------------------

export type MarkerGeometry =
  | { kind: 'circle'; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; strokeWidth: number }
  | { kind: 'polygon'; points: string };

export function markerGeometry(m: RenderedMarker): MarkerGeometry {
  const s = m.size;
  switch (m.shape) {
    case 'dot':
      return { kind: 'circle', r: s / 2 };
    case 'square':
      return { kind: 'rect', x: -s / 2, y: -s / 2, width: s, height: s };
    case 'dash':
      return { kind: 'line', x1: -s / 2, y1: 0, x2: s / 2, y2: 0, strokeWidth: fmt(Math.max(0.6, s * 0.3)) };
    case 'triangle':
      return { kind: 'polygon', points: `${fmt(s / 2)},0 ${fmt(-s / 2)},${fmt(s / 2)} ${fmt(-s / 2)},${fmt(-s / 2)}` };
  }
}

/** The SVG transform that places a marker. */
export function markerTransform(m: RenderedMarker): string {
  return `translate(${m.x} ${m.y}) rotate(${m.angle})`;
}
