import { Waypoint, PathStructure, EndCapPair, Point, BoundaryShape } from '../types';

export function findEndCapGroup(
  waypointIndex: number,
  structure: PathStructure
): EndCapPair | null {
  for (const pair of structure.endCapPairs) {
    if (pair.indexA === waypointIndex || pair.indexB === waypointIndex) {
      return pair;
    }
  }
  return null;
}

export function getGroupIndices(
  waypointIndex: number,
  structure: PathStructure
): number[] {
  const pair = findEndCapGroup(waypointIndex, structure);
  if (pair) return [pair.indexA, pair.indexB];
  return [waypointIndex];
}

function clampToBoundary(
  val: number,
  axis: 'horizontal' | 'vertical',
  boundary: BoundaryShape,
  margin: number
): number {
  if (axis === 'vertical') {
    return Math.max(boundary.y + margin, Math.min(boundary.y + boundary.height - margin, val));
  }
  return Math.max(boundary.x + margin, Math.min(boundary.x + boundary.width - margin, val));
}

function findNearestParallelConstraint(
  waypoints: Waypoint[],
  pair: EndCapPair,
  delta: number,
  structure: PathStructure
): number {
  const cellSize = structure.cellSize;
  const minSpacing = cellSize;
  const a = waypoints[pair.indexA];
  const b = waypoints[pair.indexB];

  if (pair.axis === 'vertical') {
    const proposedY = a.y + delta;
    const capMinX = Math.min(a.x, b.x);
    const capMaxX = Math.max(a.x, b.x);

    let clampedDelta = delta;

    for (let i = 0; i < waypoints.length - 1; i++) {
      if (i === pair.indexA || i === pair.indexB) continue;
      if (i + 1 === pair.indexA || i + 1 === pair.indexB) continue;

      const w1 = waypoints[i];
      const w2 = waypoints[i + 1];

      const segMinX = Math.min(w1.x, w2.x);
      const segMaxX = Math.max(w1.x, w2.x);
      if (segMaxX < capMinX - cellSize || segMinX > capMaxX + cellSize) continue;

      const isHorizontalSeg = Math.abs(w2.y - w1.y) < Math.abs(w2.x - w1.x) * 0.1;
      if (!isHorizontalSeg) continue;

      const segY = (w1.y + w2.y) / 2;

      if (delta > 0 && segY > a.y && segY < proposedY + minSpacing) {
        clampedDelta = Math.min(clampedDelta, segY - a.y - minSpacing);
      } else if (delta < 0 && segY < a.y && segY > proposedY - minSpacing) {
        clampedDelta = Math.max(clampedDelta, segY - a.y + minSpacing);
      }
    }

    return clampedDelta;
  } else {
    const proposedX = a.x + delta;
    const capMinY = Math.min(a.y, b.y);
    const capMaxY = Math.max(a.y, b.y);

    let clampedDelta = delta;

    for (let i = 0; i < waypoints.length - 1; i++) {
      if (i === pair.indexA || i === pair.indexB) continue;
      if (i + 1 === pair.indexA || i + 1 === pair.indexB) continue;

      const w1 = waypoints[i];
      const w2 = waypoints[i + 1];

      const segMinY = Math.min(w1.y, w2.y);
      const segMaxY = Math.max(w1.y, w2.y);
      if (segMaxY < capMinY - cellSize || segMinY > capMaxY + cellSize) continue;

      const isVerticalSeg = Math.abs(w2.x - w1.x) < Math.abs(w2.y - w1.y) * 0.1;
      if (!isVerticalSeg) continue;

      const segX = (w1.x + w2.x) / 2;

      if (delta > 0 && segX > a.x && segX < proposedX + minSpacing) {
        clampedDelta = Math.min(clampedDelta, segX - a.x - minSpacing);
      } else if (delta < 0 && segX < a.x && segX > proposedX - minSpacing) {
        clampedDelta = Math.max(clampedDelta, segX - a.x + minSpacing);
      }
    }

    return clampedDelta;
  }
}

export function resolveConstrainedMove(
  waypoints: Waypoint[],
  dragIndex: number,
  worldPos: Point,
  structure: PathStructure,
  boundary: BoundaryShape | null
): Waypoint[] {
  const pair = findEndCapGroup(dragIndex, structure);

  if (!pair) {
    const wp = waypoints[dragIndex];
    const next = [...waypoints];

    let lockAxis: 'horizontal' | 'vertical' | null = null;
    let maxLen = 0;

    if (dragIndex > 0) {
      const prev = waypoints[dragIndex - 1];
      const dx = Math.abs(wp.x - prev.x);
      const dy = Math.abs(wp.y - prev.y);
      const len = dx + dy;
      if (len > maxLen) {
        maxLen = len;
        lockAxis = dx > dy ? 'horizontal' : 'vertical';
      }
    }
    if (dragIndex < waypoints.length - 1) {
      const nxt = waypoints[dragIndex + 1];
      const dx = Math.abs(wp.x - nxt.x);
      const dy = Math.abs(wp.y - nxt.y);
      const len = dx + dy;
      if (len > maxLen) {
        maxLen = len;
        lockAxis = dx > dy ? 'horizontal' : 'vertical';
      }
    }

    if (lockAxis === 'horizontal') {
      let newX = worldPos.x;
      if (boundary) {
        const margin = structure.cellSize / 2;
        newX = Math.max(boundary.x + margin, Math.min(boundary.x + boundary.width - margin, newX));
      }
      const minDist = structure.cellSize;
      if (dragIndex > 0) {
        const prev = waypoints[dragIndex - 1];
        if (Math.abs(prev.y - wp.y) < 0.1) {
          if (Math.abs(newX - prev.x) < minDist) {
            newX = prev.x + (newX > prev.x ? minDist : -minDist);
          }
        }
      }
      if (dragIndex < waypoints.length - 1) {
        const nxt = waypoints[dragIndex + 1];
        if (Math.abs(nxt.y - wp.y) < 0.1) {
          if (Math.abs(newX - nxt.x) < minDist) {
            newX = nxt.x + (newX > nxt.x ? minDist : -minDist);
          }
        }
      }
      next[dragIndex] = { ...wp, x: newX };
    } else if (lockAxis === 'vertical') {
      let newY = worldPos.y;
      if (boundary) {
        const margin = structure.cellSize / 2;
        newY = Math.max(boundary.y + margin, Math.min(boundary.y + boundary.height - margin, newY));
      }
      const minDist = structure.cellSize;
      if (dragIndex > 0) {
        const prev = waypoints[dragIndex - 1];
        if (Math.abs(prev.x - wp.x) < 0.1) {
          if (Math.abs(newY - prev.y) < minDist) {
            newY = prev.y + (newY > prev.y ? minDist : -minDist);
          }
        }
      }
      if (dragIndex < waypoints.length - 1) {
        const nxt = waypoints[dragIndex + 1];
        if (Math.abs(nxt.x - wp.x) < 0.1) {
          if (Math.abs(newY - nxt.y) < minDist) {
            newY = nxt.y + (newY > nxt.y ? minDist : -minDist);
          }
        }
      }
      next[dragIndex] = { ...wp, y: newY };
    } else {
      next[dragIndex] = { ...wp, x: worldPos.x, y: worldPos.y };
    }

    return next;
  }

  const a = waypoints[pair.indexA];
  const margin = structure.cellSize / 2;

  let delta: number;
  if (pair.axis === 'vertical') {
    delta = worldPos.y - a.y;
    if (boundary) {
      const clampedY = clampToBoundary(a.y + delta, 'vertical', boundary, margin);
      delta = clampedY - a.y;
    }
  } else {
    delta = worldPos.x - a.x;
    if (boundary) {
      const clampedX = clampToBoundary(a.x + delta, 'horizontal', boundary, margin);
      delta = clampedX - a.x;
    }
  }

  delta = findNearestParallelConstraint(waypoints, pair, delta, structure);

  const minSegLen = structure.cellSize;
  if (pair.indexA > 0) {
    const prev = waypoints[pair.indexA - 1];
    if (pair.axis === 'vertical') {
      const dist = Math.abs(a.y + delta - prev.y);
      if (dist < minSegLen) {
        const sign = a.y + delta > prev.y ? 1 : -1;
        delta = prev.y + sign * minSegLen - a.y;
      }
    } else {
      const dist = Math.abs(a.x + delta - prev.x);
      if (dist < minSegLen) {
        const sign = a.x + delta > prev.x ? 1 : -1;
        delta = prev.x + sign * minSegLen - a.x;
      }
    }
  }

  if (pair.indexB < waypoints.length - 1) {
    const after = waypoints[pair.indexB + 1];
    const b = waypoints[pair.indexB];
    if (pair.axis === 'vertical') {
      const dist = Math.abs(b.y + delta - after.y);
      if (dist < minSegLen) {
        const sign = b.y + delta > after.y ? 1 : -1;
        delta = after.y + sign * minSegLen - b.y;
      }
    } else {
      const dist = Math.abs(b.x + delta - after.x);
      if (dist < minSegLen) {
        const sign = b.x + delta > after.x ? 1 : -1;
        delta = after.x + sign * minSegLen - b.x;
      }
    }
  }

  const next = [...waypoints];
  if (pair.axis === 'vertical') {
    next[pair.indexA] = { ...next[pair.indexA], y: waypoints[pair.indexA].y + delta };
    next[pair.indexB] = { ...next[pair.indexB], y: waypoints[pair.indexB].y + delta };
  } else {
    next[pair.indexA] = { ...next[pair.indexA], x: waypoints[pair.indexA].x + delta };
    next[pair.indexB] = { ...next[pair.indexB], x: waypoints[pair.indexB].x + delta };
  }

  return next;
}
