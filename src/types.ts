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
 * iso-lines of a terrain-like height field. Concentric and Contour always run
 * on the Trace engine; Serpentine runs on `fillMode`.
 */
export type PatternMode = 'serpentine' | 'concentric' | 'contour';
/** The engine behind a Serpentine pattern. Trace is the default; the rest are the legacy walkers. */
export type FillMode = 'trace' | 'continuous' | 'multi-pass' | 'wicked-wise';
export type AngleMode = 90 | 45 | 30;
export type ActiveTool = 'select' | 'rectangle' | 'ellipse' | 'pen' | 'redirect' | 'fill';
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';
export type WalkDirection = 'up' | 'down' | 'left' | 'right' | 'up-right' | 'up-left' | 'down-right' | 'down-left';

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
  /**
   * 0..1: nudge every anchor with smooth seeded noise so lines lean and
   * wobble organically. Capped below half the gap, so lines never touch.
   */
  jitter: number;
}

/** True when the pattern runs on the Trace engine (every mode but a legacy Serpentine engine). */
export function usesTrace(params: GenerationParams): boolean {
  return params.patternMode !== 'serpentine' || params.fillMode === 'trace';
}

export interface Waypoint {
  x: number;
  y: number;
  type: 'start' | 'turn' | 'end' | 'segment-start';
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
}

export interface DirectionGuide {
  x: number;
  y: number;
  direction: WalkDirection;
}

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
};
