export interface Point {
  x: number;
  y: number;
}

export interface BoundaryShape {
  type: 'rectangle' | 'ellipse' | 'path';
  x: number;
  y: number;
  width: number;
  height: number;
  pathData?: string;
}

export type TurnStyle = 'rounded' | 'squared';
export type CapStyle = 'round' | 'butt';
export type SegmentMode = 'fixed' | 'random';
export type FillMode = 'continuous' | 'multi-pass' | 'wicked-wise';
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
  fillMode: 'continuous',
  fixedSegmentLength: 100,
  minSegmentLength: 30,
  maxSegmentLength: 200,
  angleMode: 90,
  fillDirectionBias: 0.3,
  directionSwitchFrequency: 0.12,
  seed: Math.floor(Math.random() * 999999),
  cornerRadius: 7,
  ringHarmony: 1,
  gapsEnabled: false,
  gapFrequencyMin: 80,
  gapFrequencyMax: 200,
  minGapLength: 10,
  maxGapLength: 25,
  targetFillPercent: 75,
  maxPasses: 10,
};
