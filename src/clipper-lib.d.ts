// Minimal typings for the parts of clipper-lib (Clipper 6.4.2) the fabrication export uses.
declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[];
  export type Paths = Path[];
  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  export const EndType: { etOpenSquare: number; etOpenRound: number; etOpenButt: number; etClosedLine: number; etClosedPolygon: number };
  export const ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
  export const PolyType: { ptSubject: number; ptClip: number };
  export const PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }
  export class Clipper {
    constructor(initOptions?: number);
    AddPath(path: Path, polyType: number, closed: boolean): boolean;
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Paths, subjFillType?: number, clipFillType?: number): boolean;
    static Area(path: Path): number;
    static CleanPolygons(paths: Paths, distance: number): Paths;
  }
  const ClipperLib: {
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    ClipType: typeof ClipType;
    PolyType: typeof PolyType;
    PolyFillType: typeof PolyFillType;
    ClipperOffset: typeof ClipperOffset;
    Clipper: typeof Clipper;
  };
  export default ClipperLib;
}
