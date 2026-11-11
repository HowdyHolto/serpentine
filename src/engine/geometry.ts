import { BoundaryShape, Point } from '../types';

/** Even-odd ray cast: is (x, y) inside the polygon? */
export function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonBounds(points: Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function polygonPathData(points: Point[]): string {
  if (points.length === 0) return '';
  const fmt = (n: number) => Number(n.toFixed(2));
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ') + ' Z';
}

/** Signed area; the sign tells the winding, the magnitude twice the area. */
export function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return a / 2;
}

/** A 'path' boundary from polygon vertices: bounding box plus the SVG path. */
export function makePolygonBoundary(points: Point[]): BoundaryShape {
  const b = polygonBounds(points);
  return { type: 'path', ...b, points: points.map((p) => ({ ...p })), pathData: polygonPathData(points) };
}

/** The SVG element for a boundary's outline or clip, without closing tag or styling. */
export function boundaryShapeElement(boundary: BoundaryShape): string {
  if (boundary.type === 'ellipse') {
    return `<ellipse cx="${boundary.x + boundary.width / 2}" cy="${boundary.y + boundary.height / 2}" rx="${boundary.width / 2}" ry="${boundary.height / 2}"`;
  }
  if (boundary.type === 'path' && boundary.pathData) {
    return `<path d="${boundary.pathData}"`;
  }
  return `<rect x="${boundary.x}" y="${boundary.y}" width="${boundary.width}" height="${boundary.height}"`;
}

/**
 * The boundary at a new width and/or height (px), keeping its centre where
 * it is. A polygon is scaled about that centre.
 */
export function resizeBoundary(boundary: BoundaryShape, size: { width?: number; height?: number }): BoundaryShape {
  const width = size.width ?? boundary.width;
  const height = size.height ?? boundary.height;
  const cx = boundary.x + boundary.width / 2;
  const cy = boundary.y + boundary.height / 2;
  if (boundary.type === 'path' && boundary.points && boundary.points.length >= 3) {
    const sx = boundary.width > 0 ? width / boundary.width : 1;
    const sy = boundary.height > 0 ? height / boundary.height : 1;
    return makePolygonBoundary(boundary.points.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy })));
  }
  return { ...boundary, x: cx - width / 2, y: cy - height / 2, width, height };
}

export interface DragRectModifiers {
  /** Constrain to a square (a circle for the ellipse tool). */
  square: boolean;
  /** The press point is the centre, not a corner. */
  fromCenter: boolean;
}

/**
 * The box a drag from `start` to `current` draws. Constrained, the side is
 * the larger of the two drag distances and the box grows toward the cursor's
 * quadrant; from the centre, the drag is half the size in each direction.
 */
export function dragRect(
  start: Point,
  current: Point,
  mods: DragRectModifiers
): { x: number; y: number; width: number; height: number } {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (mods.square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  if (mods.fromCenter) {
    return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), width: 2 * Math.abs(dx), height: 2 * Math.abs(dy) };
  }
  return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}
