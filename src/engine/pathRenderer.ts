import { Waypoint, GenerationParams, RenderedPath } from '../types';
import { createSeededRandom } from './random';

function splitAtSegmentBoundaries(waypoints: Waypoint[]): Waypoint[][] {
  const subPaths: Waypoint[][] = [];
  let current: Waypoint[] = [];

  for (const wp of waypoints) {
    if (wp.type === 'segment-start' && current.length > 0) {
      subPaths.push(current);
      current = [wp];
    } else {
      current.push(wp);
    }
  }

  if (current.length >= 2) {
    subPaths.push(current);
  }

  return subPaths;
}

function waypointsToSvgPath(
  waypoints: Waypoint[],
  cornerRadius: number,
  harmonicR: number,
  ringHarmony: number,
  isRounded: boolean
): string {
  if (waypoints.length < 2) return '';

  if (!isRounded) {
    let d = `M ${waypoints[0].x} ${waypoints[0].y}`;
    for (let i = 1; i < waypoints.length; i++) {
      d += ` L ${waypoints[i].x} ${waypoints[i].y}`;
    }
    return d;
  }

  let d = `M ${waypoints[0].x} ${waypoints[0].y}`;

  for (let i = 1; i < waypoints.length; i++) {
    if (i < waypoints.length - 1) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const next = waypoints[i + 1];

      const d1x = curr.x - prev.x;
      const d1y = curr.y - prev.y;
      const d2x = next.x - curr.x;
      const d2y = next.y - curr.y;

      const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y);

      if (len1 === 0 || len2 === 0) {
        d += ` L ${curr.x} ${curr.y}`;
        continue;
      }

      const maxR = Math.min(len1 / 2, len2 / 2);
      const fixedR = Math.min(cornerRadius, maxR);
      const propR = harmonicR > 0 ? (cornerRadius / harmonicR) * maxR : fixedR;
      const r = fixedR + (Math.min(propR, maxR) - fixedR) * ringHarmony;

      const n1x = d1x / len1;
      const n1y = d1y / len1;
      const n2x = d2x / len2;
      const n2y = d2y / len2;

      const ax = curr.x - n1x * r;
      const ay = curr.y - n1y * r;
      const bx = curr.x + n2x * r;
      const by = curr.y + n2y * r;

      const cross = n1x * n2y - n1y * n2x;
      const sweep = cross > 0 ? 1 : 0;

      d += ` L ${ax} ${ay}`;
      d += ` A ${r} ${r} 0 0 ${sweep} ${bx} ${by}`;
    } else {
      d += ` L ${waypoints[i].x} ${waypoints[i].y}`;
    }
  }

  return d;
}

function splitWithGaps(
  waypoints: Waypoint[],
  params: GenerationParams
): Waypoint[][] {
  if (!params.gapsEnabled || waypoints.length < 3) return [waypoints];

  const rng = createSeededRandom(params.seed + 7919);

  const segLengths: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    segLengths.push(Math.sqrt(dx * dx + dy * dy));
  }

  const runs: Waypoint[][] = [];
  let currentRun: Waypoint[] = [waypoints[0]];
  let distAccum = 0;
  let nextGapAt = rng.nextFloat(params.gapFrequencyMin, params.gapFrequencyMax);
  let inGap = false;
  let gapRemaining = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];

    if (inGap) {
      gapRemaining -= segLen;
      if (gapRemaining <= 0) {
        inGap = false;
        distAccum = 0;
        nextGapAt = rng.nextFloat(params.gapFrequencyMin, params.gapFrequencyMax);
        currentRun = [waypoints[i + 1]];
      }
      continue;
    }

    distAccum += segLen;
    currentRun.push(waypoints[i + 1]);

    if (distAccum >= nextGapAt && currentRun.length >= 2 && i < segLengths.length - 1) {
      runs.push(currentRun);
      inGap = true;
      gapRemaining = rng.nextFloat(params.minGapLength, params.maxGapLength);
      currentRun = [];
    }
  }

  if (currentRun.length >= 2) {
    runs.push(currentRun);
  }

  return runs.length > 0 ? runs : [waypoints];
}

export function renderPaths(
  waypoints: Waypoint[],
  params: GenerationParams
): RenderedPath[] {
  if (waypoints.length < 2) return [];

  const isRounded = params.turnStyle === 'rounded';
  const subPaths = splitAtSegmentBoundaries(waypoints);
  const results: RenderedPath[] = [];

  for (const subPath of subPaths) {
    const runs = splitWithGaps(subPath, params);

    for (const run of runs) {
      const harmonicR = (params.strokeWidth + params.minGap) / 2;
      const path = waypointsToSvgPath(run, params.cornerRadius, harmonicR, params.ringHarmony, isRounded);
      if (path) {
        results.push({ d: path, strokeWidth: params.strokeWidth });
      }
    }
  }

  return results;
}
