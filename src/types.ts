export interface Point {
  x: number;
  y: number;
}

export interface BoundaryShape {
  type: 'rectangle' | 'ellipse' | 'path';
  /** Bounding box (for 'path', of the polygon). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 'path' only: the closed polygon's SVG path, used for outlines and clipping. */
  pathData?: string;
  /** 'path' only: the polygon's vertices, used for the fill mask. */
  points?: Point[];
}

export type TurnStyle = 'rounded' | 'squared';
export type CapStyle = 'round' | 'butt';
export type SegmentMode = 'fixed' | 'random';
/**
 * What the pattern is: a free Serpentine fill, a Concentric fill that follows
 * the boundary's offset contours, or a Contour fill that follows the
 * iso-lines of a terrain-like height field, or a Rake that draws those
 * iso-lines as separate lines (a raked garden, a topographic map). Concentric
 * and Contour always run on the Trace engine; Serpentine runs on `fillMode`;
 * Rake is its own engine.
 */
export type PatternMode = 'serpentine' | 'concentric' | 'contour' | 'rake';
/** The engine behind a Serpentine pattern. Trace is the default; the rest are the legacy walkers. */
export type FillMode = 'trace' | 'continuous' | 'multi-pass' | 'wicked-wise';
export type AngleMode = 90 | 45 | 30;
export type ActiveTool = 'select' | 'rectangle' | 'ellipse' | 'pen' | 'redirect' | 'fill' | 'rock';
/** What the Contour terrain is made of: seeded noise, rocks as bumps in a pond, or rocks as rake centres in a garden. */
export type ContourSource = 'noise' | 'pond' | 'garden';
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';
export type WalkDirection = 'up' | 'down' | 'left' | 'right' | 'up-right' | 'up-left' | 'down-right' | 'down-left';

/** Whether a length gradient spans the whole design or restarts on every run (piece, pass, rake line). */
export type GradientScope = 'whole' | 'per-run';
export type MarkerShape = 'dot' | 'square' | 'dash' | 'triangle';
/** Whether the stroke still draws under the markers. */
export type MarkerMode = 'overlay' | 'replace';
/** A marker colour: a hex string, or 'gradient' to take the gradient colour at the marker's position. */
export type MarkerColor = string;

/**
 * How the generated lines are coloured and decorated along their length.
 * Pure rendering: nothing here changes the geometry, so style edits never
 * regenerate and apply even to a frozen path.
 */
export interface PathStyle {
  /** Colour the stroke with a gradient that follows the line's arc length. */
  gradientEnabled: boolean;
  /** Two or three hex colour stops, evenly spaced along the length. */
  gradientStops: string[];
  gradientScope: GradientScope;
  /**
   * 0..1: how much of the distance between two stops is spent blending.
   * 1 blends the whole way (smooth); 0 switches colour sharply halfway
   * between stops (hard bands); in between, each stop holds its colour
   * and the transition is centred between them.
   */
  gradientSpread: number;
  /** How many times the gradient runs along the length (mirrored, so it never jumps). 1 = once. */
  gradientCycles: number;
  /** Place shapes along the path. */
  markersEnabled: boolean;
  markerShape: MarkerShape;
  /** Distance between markers along the path, in px (adjusted so markers fit a run evenly). */
  markerSpacing: number;
  /** Marker size as a fraction of the stroke width (dot diameter, square side, dash length, triangle height). */
  markerSize: number;
  /** Hex colour, or 'gradient' to follow the gradient stops along the path. */
  markerColor: MarkerColor;
  /** Rotation in degrees relative to the path tangent. */
  markerSkew: number;
  markerMode: MarkerMode;
}

export interface GenerationParams {
  strokeWidth: number;
  minGap: number;
  turnStyle: TurnStyle;
  capStyle: CapStyle;
  segmentMode: SegmentMode;
  fillMode: FillMode;
  fixedSegmentLength: number;
  minSegmentLength: number;
  maxSegmentLength: number;
  angleMode: AngleMode;
  fillDirectionBias: number;
  directionSwitchFrequency: number;
  seed: number;
  cornerRadius: number;
  ringHarmony: number;
  gapsEnabled: boolean;
  gapFrequencyMin: number;
  gapFrequencyMax: number;
  minGapLength: number;
  maxGapLength: number;
  targetFillPercent: number;
  maxPasses: number;
  /** Trace only: keep the Hamiltonian cycle closed (no end caps). */
  closedLoop: boolean;
  /** Trace only: cut the loop into this many open paths (1 = one path). */
  tracePieces: number;
  patternMode: PatternMode;
  /** Concentric, 0..1: how strongly edges prefer to run along iso-distance contours. */
  concentricStrength: number;
  /** 0..1: 0 = uniform conformity, 1 = faithful at the edge and fully random at the center. */
  concentricFalloff: number;
  /** Reverse the gradient: faithful at the center, random at the edge. */
  concentricInvert: boolean;
  /** Contour, 0..1: how strongly edges prefer to run along the height field's iso-lines. */
  contourStrength: number;
  /** Contour: feature size of the height field in px (how far apart its hills are). */
  contourScale: number;
  /** Contour, 0..1: 0 = conformity uniform, 1 = conformity follows slope (faithful on steep ground, loose on flat). */
  contourSlope: number;
  /** Contour: faithful on flat ground instead of steep. */
  contourInvert: boolean;
  contourSource: ContourSource;
  /** Pond: radius in px over which a rock's bump fades. */
  rockSpread: number;
  /** Garden, 0..1: how much the boundary edge counts as a rake centre (0 ignores it, 1 like a rock). */
  rockEdge: number;
  /** Pond, 0..1: how much of the noise terrain to blend under the rocks. */
  contourNoiseMix: number;
  /** Rake, -1..1: 0 uniform width; positive thins the low lines, negative thins the high ones. */
  rakeWidthVariation: number;
  /** Rake: drop lines shorter than this many cells (strays left where lines crowd at a junction). */
  rakeMinLength: number;
  /**
   * 0..1: nudge every anchor with smooth seeded noise so lines lean and
   * wobble organically. Capped below half the gap, so lines never touch.
   */
  jitter: number;
  style: PathStyle;
}

/** True when the pattern runs on the Trace engine (every mode but a legacy Serpentine engine). */
export function usesTrace(params: GenerationParams): boolean {
  if (params.patternMode === 'rake') return false;
  return params.patternMode !== 'serpentine' || params.fillMode === 'trace';
}

export interface Waypoint {
  x: number;
  y: number;
  type: 'start' | 'turn' | 'end' | 'segment-start';
  /** Rake: on a line's 'start' point, its level 0..1 (lowest to highest), for width variation. */
  level?: number;
}

export interface GridPoint {
  col: number;
  row: number;
}

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

export interface EndCapPair {
  indexA: number;
  indexB: number;
  axis: 'horizontal' | 'vertical';
}

export interface SegmentDescriptor {
  startIndex: number;
  endIndex: number;
  axis: 'horizontal' | 'vertical';
}

export interface PathStructure {
  endCapPairs: EndCapPair[];
  segments: SegmentDescriptor[];
  cellSize: number;
}

export interface RenderedPath {
  d: string;
  strokeWidth: number;
  /** Stroke colour as a hex string; absent means the renderer's default (white on screen, black in the export). */
  stroke?: string;
  /** Index of the run (sub-path, pass or rake line) this path belongs to; gap pieces share a run. */
  run?: number;
}

/** A shape placed on the path by the Style layer, at `x, y`, rotated `angle` degrees (tangent plus skew). */
export interface RenderedMarker {
  shape: MarkerShape;
  x: number;
  y: number;
  angle: number;
  /** Size in px (dot diameter, square side, dash length, triangle height). */
  size: number;
  color: string;
}

/**
 * A rock: a point the Contour terrain reacts to. In a pond it is a bump of
 * height `elevation` (-1..1, negative is a dip); in a garden it is a rake
 * centre whose rings spread 2^elevation as fast as a neutral one.
 */
export interface Rock {
  x: number;
  y: number;
  elevation: number;
}

export interface DirectionGuide {
  x: number;
  y: number;
  direction: WalkDirection;
}

export const DEFAULT_STYLE: PathStyle = {
  gradientEnabled: false,
  gradientStops: ['#ff4d8d', '#ffd166', '#2ec4ff'],
  gradientScope: 'per-run',
  gradientSpread: 1,
  gradientCycles: 1,
  markersEnabled: false,
  markerShape: 'dot',
  markerSpacing: 24,
  markerSize: 1,
  markerColor: 'gradient',
  markerSkew: 0,
  markerMode: 'overlay',
};

export const DEFAULT_PARAMS: GenerationParams = {
  strokeWidth: 8,
  minGap: 6,
  turnStyle: 'rounded',
  capStyle: 'round',
  segmentMode: 'random',
  fillMode: 'trace',
  fixedSegmentLength: 100,
  minSegmentLength: 30,
  maxSegmentLength: 200,
  angleMode: 90,
  fillDirectionBias: 0.3,
  directionSwitchFrequency: 0.12,
  seed: Math.floor(Math.random() * 999999),
  cornerRadius: 7,
  ringHarmony: 0.5,
  gapsEnabled: false,
  gapFrequencyMin: 80,
  gapFrequencyMax: 200,
  minGapLength: 10,
  maxGapLength: 25,
  targetFillPercent: 75,
  maxPasses: 10,
  closedLoop: false,
  tracePieces: 1,
  patternMode: 'serpentine',
  concentricStrength: 0.7,
  concentricFalloff: 0.5,
  concentricInvert: false,
  contourStrength: 0.8,
  contourScale: 160,
  contourSlope: 0.6,
  contourInvert: false,
  jitter: 0,
  contourSource: 'noise',
  rockSpread: 150,
  rockEdge: 0.5,
  contourNoiseMix: 0,
  rakeWidthVariation: 0,
  rakeMinLength: 3,
  style: DEFAULT_STYLE,
};
