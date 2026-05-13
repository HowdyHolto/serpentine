import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  ActiveTool,
  BoundaryShape,
  Waypoint,
  GenerationParams,
  Point,
  CanvasTransform,
  PathStructure,
  RenderedPath,
  ResizeEdge,
  DirectionGuide,
  WalkDirection,
} from '../types';
import { getGroupIndices } from '../engine/constraintSolver';
import { Rulers, RULER_SIZE, PX_PER_MM } from './Rulers';
import { HelpPanel } from './HelpPanel';
import { colors } from '../theme';

interface CanvasProps {
  boundary: BoundaryShape | null;
  paths: RenderedPath[];
  waypoints: Waypoint[];
  params: GenerationParams;
  activeTool: ActiveTool;
  transform: CanvasTransform;
  onBoundaryCreate: (boundary: BoundaryShape) => void;
  onBoundaryResize: (boundary: BoundaryShape) => void;
  onWheel: (e: React.WheelEvent) => void;
  onPanStart: (e: React.MouseEvent, force?: boolean) => void;
  onPanMove: (e: React.MouseEvent) => void;
  onPanEnd: () => void;
  screenToWorld: (sx: number, sy: number, rect: DOMRect) => Point;
  showWaypoints: boolean;
  onWaypointMove: (index: number, pos: Point) => void;
  structure: PathStructure | null;
  showHelp: boolean;
  onToggleHelp: () => void;
  frozenIndices: Set<number>;
  onToggleFreezeWaypoint: (index: number) => void;
  onFreezeWaypointsInRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  guides: DirectionGuide[];
  onGuideAdd: (guide: DirectionGuide) => void;
  onGuideCycle: (index: number) => void;
  onGuideRemove: (index: number) => void;
}

function hitTestWaypoints(
  waypoints: Waypoint[],
  worldPos: Point,
  hitRadius: number
): number | null {
  for (let i = waypoints.length - 1; i >= 0; i--) {
    const wp = waypoints[i];
    const dx = wp.x - worldPos.x;
    const dy = wp.y - worldPos.y;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return i;
    }
  }
  return null;
}

function hitTestResizeEdge(
  boundary: BoundaryShape,
  worldPos: Point,
  hitSize: number
): ResizeEdge | null {
  const { x, y, width, height } = boundary;
  const midX = x + width / 2;
  const midY = y + height / 2;

  if (Math.abs(worldPos.x - midX) < width * 0.4) {
    if (Math.abs(worldPos.y - y) < hitSize) return 'top';
    if (Math.abs(worldPos.y - (y + height)) < hitSize) return 'bottom';
  }
  if (Math.abs(worldPos.y - midY) < height * 0.4) {
    if (Math.abs(worldPos.x - x) < hitSize) return 'left';
    if (Math.abs(worldPos.x - (x + width)) < hitSize) return 'right';
  }
  return null;
}

function hitTestGuides(
  guides: DirectionGuide[],
  worldPos: Point,
  hitRadius: number
): number | null {
  for (let i = guides.length - 1; i >= 0; i--) {
    const g = guides[i];
    const dx = g.x - worldPos.x;
    const dy = g.y - worldPos.y;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return i;
    }
  }
  return null;
}

const GUIDE_DIR_ANGLES: Record<WalkDirection, number> = {
  right: 0, down: 90, left: 180, up: 270,
  'down-right': 45, 'down-left': 135, 'up-left': 225, 'up-right': 315,
};

const MIN_BOUNDARY_SIZE = 40;

export function Canvas({
  boundary,
  paths,
  waypoints,
  params,
  activeTool,
  transform,
  onBoundaryCreate,
  onBoundaryResize,
  onWheel,
  onPanStart,
  onPanMove,
  onPanEnd,
  screenToWorld,
  showWaypoints,
  onWaypointMove,
  structure,
  showHelp,
  onToggleHelp,
  frozenIndices,
  onToggleFreezeWaypoint,
  onFreezeWaypointsInRect,
  guides,
  onGuideAdd,
  onGuideCycle,
  onGuideRemove,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const [hoveredWpIndex, setHoveredWpIndex] = useState<number | null>(null);
  const [draggingWpIndex, setDraggingWpIndex] = useState<number | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [resizingEdge, setResizingEdge] = useState<ResizeEdge | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<ResizeEdge | null>(null);
  const [marqueeStart, setMarqueeStart] = useState<Point | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<Point | null>(null);
  const [ghostGuidePos, setGhostGuidePos] = useState<Point | null>(null);

  const activeGroup = useMemo(() => {
    const idx = draggingWpIndex ?? hoveredWpIndex;
    if (idx === null || !structure) return new Set<number>();
    return new Set(getGroupIndices(idx, structure));
  }, [draggingWpIndex, hoveredWpIndex, structure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    setContainerSize({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input, textarea')) {
        e.preventDefault();
        setSpaceDown(true);
      }
      if (e.key === 'Shift') setShiftDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceDown(false);
        setIsPanDragging(false);
      }
      if (e.key === 'Shift') setShiftDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const getWorldPos = useCallback(
    (e: React.MouseEvent): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return screenToWorld(e.clientX, e.clientY, rect);
    },
    [screenToWorld]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        onPanStart(e);
        setIsPanDragging(true);
        return;
      }

      if (e.button === 0 && spaceDown) {
        onPanStart(e, true);
        setIsPanDragging(true);
        return;
      }

      if (e.button !== 0) return;

      if (e.shiftKey && activeTool === 'select') {
        const world = getWorldPos(e);
        if (world) {
          if (showWaypoints) {
            const hitRadius = 8 / transform.scale;
            const idx = hitTestWaypoints(waypoints, world, hitRadius);
            if (idx !== null) {
              onToggleFreezeWaypoint(idx);
              return;
            }
          }
          setMarqueeStart(world);
          setMarqueeEnd(world);
        }
        return;
      }

      if (activeTool === 'select' && boundary) {
        const world = getWorldPos(e);
        if (world) {
          const hitSize = 10 / transform.scale;
          const edge = hitTestResizeEdge(boundary, world, hitSize);
          if (edge) {
            setResizingEdge(edge);
            return;
          }
        }
      }

      if (activeTool === 'select' && showWaypoints && hoveredWpIndex !== null) {
        setDraggingWpIndex(hoveredWpIndex);
        return;
      }

      if (activeTool === 'redirect') {
        const world = getWorldPos(e);
        if (world) {
          const hitRadius = 14 / transform.scale;
          const idx = hitTestGuides(guides, world, hitRadius);
          if (idx !== null) {
            if (e.shiftKey) {
              onGuideRemove(idx);
            } else {
              onGuideCycle(idx);
            }
          } else {
            onGuideAdd({ x: world.x, y: world.y, direction: 'right' });
          }
        }
        return;
      }

      if (activeTool === 'rectangle' || activeTool === 'ellipse') {
        const world = getWorldPos(e);
        if (world) {
          setDrawStart(world);
          setDrawCurrent(world);
        }
      }
    },
    [activeTool, getWorldPos, onPanStart, spaceDown, showWaypoints, hoveredWpIndex, boundary, transform.scale, waypoints, onToggleFreezeWaypoint, guides, onGuideAdd, onGuideCycle, onGuideRemove]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const world = getWorldPos(e);

      if (marqueeStart) {
        if (world) setMarqueeEnd(world);
        return;
      }

      if (resizingEdge && boundary) {
        if (world) {
          let { x, y, width, height } = boundary;
          switch (resizingEdge) {
            case 'top': {
              const newY = Math.min(world.y, y + height - MIN_BOUNDARY_SIZE);
              height = height + (y - newY);
              y = newY;
              break;
            }
            case 'bottom': {
              height = Math.max(MIN_BOUNDARY_SIZE, world.y - y);
              break;
            }
            case 'left': {
              const newX = Math.min(world.x, x + width - MIN_BOUNDARY_SIZE);
              width = width + (x - newX);
              x = newX;
              break;
            }
            case 'right': {
              width = Math.max(MIN_BOUNDARY_SIZE, world.x - x);
              break;
            }
          }
          onBoundaryResize({ ...boundary, x, y, width, height });
        }
        return;
      }

      if (draggingWpIndex !== null) {
        if (world) {
          onWaypointMove(draggingWpIndex, world);
        }
        return;
      }

      onPanMove(e);

      if (drawStart) {
        if (world) {
          setDrawCurrent(world);
        }
        return;
      }

      if (activeTool === 'select' && boundary) {
        if (world) {
          const hitSize = 10 / transform.scale;
          const edge = hitTestResizeEdge(boundary, world, hitSize);
          setHoveredEdge(edge);

          if (!edge && showWaypoints && waypoints.length > 0) {
            const hitRadius = 8 / transform.scale;
            const idx = hitTestWaypoints(waypoints, world, hitRadius);
            setHoveredWpIndex(idx);
          } else {
            setHoveredWpIndex(null);
          }
        }
      } else if (activeTool === 'select' && showWaypoints && waypoints.length > 0) {
        if (world) {
          const hitRadius = 8 / transform.scale;
          const idx = hitTestWaypoints(waypoints, world, hitRadius);
          setHoveredWpIndex(idx);
        }
        setHoveredEdge(null);
      } else {
        setHoveredWpIndex(null);
        setHoveredEdge(null);
      }

      if (activeTool === 'redirect' && world) {
        setGhostGuidePos(world);
      } else {
        setGhostGuidePos(null);
      }
    },
    [marqueeStart, resizingEdge, boundary, draggingWpIndex, drawStart, getWorldPos, onPanMove, onWaypointMove, onBoundaryResize, activeTool, showWaypoints, waypoints, transform.scale]
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (marqueeStart && marqueeEnd) {
        const minX = Math.min(marqueeStart.x, marqueeEnd.x);
        const minY = Math.min(marqueeStart.y, marqueeEnd.y);
        const maxX = Math.max(marqueeStart.x, marqueeEnd.x);
        const maxY = Math.max(marqueeStart.y, marqueeEnd.y);
        if (maxX - minX > 5 / transform.scale && maxY - minY > 5 / transform.scale) {
          onFreezeWaypointsInRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
        }
        setMarqueeStart(null);
        setMarqueeEnd(null);
        return;
      }

      if (resizingEdge) {
        setResizingEdge(null);
        return;
      }

      if (draggingWpIndex !== null) {
        setDraggingWpIndex(null);
        return;
      }

      onPanEnd();
      setIsPanDragging(false);

      if (drawStart && drawCurrent) {
        const x = Math.min(drawStart.x, drawCurrent.x);
        const y = Math.min(drawStart.y, drawCurrent.y);
        const w = Math.abs(drawCurrent.x - drawStart.x);
        const h = Math.abs(drawCurrent.y - drawStart.y);

        if (w > 20 && h > 20) {
          onBoundaryCreate({
            type: activeTool === 'ellipse' ? 'ellipse' : 'rectangle',
            x,
            y,
            width: w,
            height: h,
          });
        }

        setDrawStart(null);
        setDrawCurrent(null);
      }
    },
    [marqueeStart, marqueeEnd, resizingEdge, draggingWpIndex, drawStart, drawCurrent, activeTool, onBoundaryCreate, onPanEnd, onFreezeWaypointsInRect, transform.scale]
  );

  const drawPreview = drawStart && drawCurrent;
  const previewX = drawPreview ? Math.min(drawStart.x, drawCurrent.x) : 0;
  const previewY = drawPreview ? Math.min(drawStart.y, drawCurrent.y) : 0;
  const previewW = drawPreview ? Math.abs(drawCurrent.x - drawStart.x) : 0;
  const previewH = drawPreview ? Math.abs(drawCurrent.y - drawStart.y) : 0;

  const isMarqueeActive = marqueeStart !== null && marqueeEnd !== null;
  const marqueeX = isMarqueeActive ? Math.min(marqueeStart.x, marqueeEnd.x) : 0;
  const marqueeY = isMarqueeActive ? Math.min(marqueeStart.y, marqueeEnd.y) : 0;
  const marqueeW = isMarqueeActive ? Math.abs(marqueeEnd.x - marqueeStart.x) : 0;
  const marqueeH = isMarqueeActive ? Math.abs(marqueeEnd.y - marqueeStart.y) : 0;

  const isDraggingWp = draggingWpIndex !== null;
  const isHoveringWp = hoveredWpIndex !== null;
  const isResizing = resizingEdge !== null;

  const cursorClass = isMarqueeActive
    ? 'cursor-crosshair'
    : isResizing
    ? (resizingEdge === 'top' || resizingEdge === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize')
    : hoveredEdge && activeTool === 'select'
    ? (hoveredEdge === 'top' || hoveredEdge === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize')
    : isDraggingWp
    ? 'cursor-grabbing'
    : isHoveringWp && activeTool === 'select' && shiftDown
    ? 'cursor-crosshair'
    : isHoveringWp && activeTool === 'select'
    ? 'cursor-grab'
    : isPanDragging
    ? 'cursor-grabbing'
    : spaceDown
    ? 'cursor-grab'
    : shiftDown && activeTool === 'select'
    ? 'cursor-crosshair'
    : activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'redirect'
    ? 'cursor-crosshair'
    : 'cursor-default';

  const wpSize = 4 / transform.scale;
  const wpActiveSize = 6 / transform.scale;

  const resizeHandleSize = 8 / transform.scale;
  const arrowLen = 12 / transform.scale;
  const arrowW = 4 / transform.scale;
  const handleStroke = 1.5 / transform.scale;

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      {containerSize.width > 0 && (
        <Rulers
          transform={transform}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />
      )}

      <svg
        ref={svgRef}
        className={`absolute select-none ${cursorClass}`}
        style={{
          background: colors.canvasBg,
          top: RULER_SIZE,
          left: RULER_SIZE,
          width: containerSize.width - RULER_SIZE,
          height: containerSize.height - RULER_SIZE,
        }}
        onWheel={onWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          onPanEnd();
          if (draggingWpIndex !== null) setDraggingWpIndex(null);
          if (resizingEdge !== null) setResizingEdge(null);
          if (marqueeStart !== null) {
            setMarqueeStart(null);
            setMarqueeEnd(null);
          }
        }}
      >
        <defs>
          {boundary && boundary.type === 'ellipse' && (
            <clipPath id="boundary-clip">
              <ellipse
                cx={boundary.x + boundary.width / 2}
                cy={boundary.y + boundary.height / 2}
                rx={boundary.width / 2}
                ry={boundary.height / 2}
              />
            </clipPath>
          )}
          {boundary && boundary.type === 'rectangle' && (
            <clipPath id="boundary-clip">
              <rect
                x={boundary.x}
                y={boundary.y}
                width={boundary.width}
                height={boundary.height}
              />
            </clipPath>
          )}
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {boundary && boundary.type === 'rectangle' && (
            <rect
              x={boundary.x}
              y={boundary.y}
              width={boundary.width}
              height={boundary.height}
              fill="none"
              stroke={colors.boundaryStroke}
              strokeWidth={1 / transform.scale}
              strokeDasharray={`${4 / transform.scale} ${3 / transform.scale}`}
            />
          )}
          {boundary && boundary.type === 'ellipse' && (
            <ellipse
              cx={boundary.x + boundary.width / 2}
              cy={boundary.y + boundary.height / 2}
              rx={boundary.width / 2}
              ry={boundary.height / 2}
              fill="none"
              stroke={colors.boundaryStroke}
              strokeWidth={1 / transform.scale}
              strokeDasharray={`${4 / transform.scale} ${3 / transform.scale}`}
            />
          )}

          <g clipPath={boundary ? 'url(#boundary-clip)' : undefined}>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={colors.pathStroke}
                strokeWidth={p.strokeWidth}
                strokeLinecap={params.capStyle}
                strokeLinejoin="round"
              />
            ))}
          </g>

          {boundary && (
            <BoundaryDimensions boundary={boundary} scale={transform.scale} />
          )}

          {boundary && activeTool === 'select' && (
            <ResizeHandles
              boundary={boundary}
              handleSize={resizeHandleSize}
              arrowLen={arrowLen}
              arrowW={arrowW}
              strokeW={handleStroke}
              hoveredEdge={resizingEdge ?? hoveredEdge}
            />
          )}

          {showWaypoints &&
            waypoints.map((wp, i) => {
              const isFrozen = frozenIndices.has(i);
              const isInGroup = activeGroup.has(i);
              const isDragging = draggingWpIndex !== null && activeGroup.has(i);

              if (isFrozen) {
                const size = wpActiveSize * 0.8;
                return (
                  <g key={i}>
                    <circle
                      cx={wp.x}
                      cy={wp.y}
                      r={size * 2.5}
                      fill={colors.wpFrozenGlow}
                      stroke="none"
                    />
                    <rect
                      x={wp.x - size}
                      y={wp.y - size}
                      width={size * 2}
                      height={size * 2}
                      fill={colors.wpFrozen}
                      stroke={colors.wpFrozenStroke}
                      strokeWidth={1 / transform.scale}
                      transform={`rotate(45 ${wp.x} ${wp.y})`}
                    />
                  </g>
                );
              }

              if (isInGroup) {
                const size = wpActiveSize;
                return (
                  <rect
                    key={i}
                    x={wp.x - size}
                    y={wp.y - size}
                    width={size * 2}
                    height={size * 2}
                    fill={isDragging ? colors.wpDragFill : colors.wpGroupFill}
                    stroke={isDragging ? colors.wpDragStroke : colors.wpGroupStroke}
                    strokeWidth={1 / transform.scale}
                  />
                );
              }
              return (
                <circle
                  key={i}
                  cx={wp.x}
                  cy={wp.y}
                  r={wpSize}
                  fill={
                    wp.type === 'start'
                      ? colors.wpStart
                      : wp.type === 'end'
                      ? colors.wpEnd
                      : wp.type === 'segment-start'
                      ? colors.wpSegmentStart
                      : colors.wpDefault
                  }
                  stroke="none"
                />
              );
            })}

          {guides.map((guide, i) => {
            const angle = GUIDE_DIR_ANGLES[guide.direction];
            const sz = 10 / transform.scale;
            const sw = 2 / transform.scale;
            return (
              <g key={`guide-${i}`} transform={`translate(${guide.x}, ${guide.y})`}>
                <circle
                  r={sz * 1.6}
                  fill={colors.guideBg}
                  stroke={colors.guideBorder}
                  strokeWidth={sw * 0.5}
                />
                <g transform={`rotate(${angle})`}>
                  <line
                    x1={-sz * 0.5}
                    y1={0}
                    x2={sz * 0.45}
                    y2={0}
                    stroke={colors.guideArrow}
                    strokeWidth={sw}
                    strokeLinecap="round"
                  />
                  <polygon
                    points={`${sz * 0.8},0 ${sz * 0.3},-${sz * 0.35} ${sz * 0.3},${sz * 0.35}`}
                    fill={colors.guideArrow}
                  />
                </g>
              </g>
            );
          })}

          {activeTool === 'redirect' && ghostGuidePos && (
            <g transform={`translate(${ghostGuidePos.x}, ${ghostGuidePos.y})`} opacity={0.35}>
              <circle
                r={10 / transform.scale * 1.6}
                fill={colors.guideBg}
                stroke={colors.guideBorder}
                strokeWidth={1 / transform.scale}
              />
              <line
                x1={-5 / transform.scale}
                y1={0}
                x2={4.5 / transform.scale}
                y2={0}
                stroke={colors.guideArrow}
                strokeWidth={2 / transform.scale}
                strokeLinecap="round"
              />
              <polygon
                points={`${8 / transform.scale},0 ${3 / transform.scale},-${3.5 / transform.scale} ${3 / transform.scale},${3.5 / transform.scale}`}
                fill={colors.guideArrow}
              />
            </g>
          )}

          {isMarqueeActive && (
            <rect
              x={marqueeX}
              y={marqueeY}
              width={marqueeW}
              height={marqueeH}
              fill={colors.marqueeFill}
              stroke={colors.marqueeStroke}
              strokeWidth={1.5 / transform.scale}
              strokeDasharray={`${5 / transform.scale} ${3 / transform.scale}`}
            />
          )}

          {drawPreview && activeTool === 'rectangle' && (
            <rect
              x={previewX}
              y={previewY}
              width={previewW}
              height={previewH}
              fill="none"
              stroke={colors.previewStroke}
              strokeWidth={1.5 / transform.scale}
              strokeDasharray={`${5 / transform.scale} ${3 / transform.scale}`}
            />
          )}
          {drawPreview && activeTool === 'ellipse' && (
            <ellipse
              cx={previewX + previewW / 2}
              cy={previewY + previewH / 2}
              rx={previewW / 2}
              ry={previewH / 2}
              fill="none"
              stroke={colors.previewStroke}
              strokeWidth={1.5 / transform.scale}
              strokeDasharray={`${5 / transform.scale} ${3 / transform.scale}`}
            />
          )}
        </g>

        {!boundary && !drawPreview && (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.textGhost}
            fontSize="13"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            Draw a rectangle or ellipse to define the fill boundary
          </text>
        )}
      </svg>

      <HelpPanel isOpen={showHelp} onToggle={onToggleHelp} />
    </div>
  );
}

function BoundaryDimensions({
  boundary,
  scale,
}: {
  boundary: BoundaryShape;
  scale: number;
}) {
  const { x, y, width, height } = boundary;
  const wMm = (width / PX_PER_MM).toFixed(1);
  const hMm = (height / PX_PER_MM).toFixed(1);

  const fontSize = 9.5 / scale;
  const offset = 13 / scale;
  const pad = { x: 5 / scale, y: 3 / scale };
  const rx = 2 / scale;
  const strokeW = 0.5 / scale;

  const wLabel = `${wMm} mm`;
  const hLabel = `${hMm} mm`;

  const wLabelW = wLabel.length * fontSize * 0.52;
  const hLabelW = hLabel.length * fontSize * 0.52;

  const wCx = x + width / 2;
  const wCy = y - offset;

  const hCx = x + width + offset;
  const hCy = y + height / 2;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={wCx - wLabelW / 2 - pad.x}
        y={wCy - fontSize / 2 - pad.y}
        width={wLabelW + pad.x * 2}
        height={fontSize + pad.y * 2}
        rx={rx}
        fill={colors.bgPanel}
        stroke={colors.borderLight}
        strokeWidth={strokeW}
        opacity={0.88}
      />
      <text
        x={wCx}
        y={wCy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="ui-monospace, monospace"
        fill={colors.textSecondary}
        letterSpacing={0.2 / scale}
      >
        {wLabel}
      </text>

      <rect
        x={hCx - hLabelW / 2 - pad.x}
        y={hCy - fontSize / 2 - pad.y}
        width={hLabelW + pad.x * 2}
        height={fontSize + pad.y * 2}
        rx={rx}
        fill={colors.bgPanel}
        stroke={colors.borderLight}
        strokeWidth={strokeW}
        opacity={0.88}
        transform={`rotate(-90, ${hCx}, ${hCy})`}
      />
      <text
        x={hCx}
        y={hCy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="ui-monospace, monospace"
        fill={colors.textSecondary}
        letterSpacing={0.2 / scale}
        transform={`rotate(-90, ${hCx}, ${hCy})`}
      >
        {hLabel}
      </text>
    </g>
  );
}

function ResizeHandles({
  boundary,
  handleSize,
  arrowLen,
  arrowW,
  strokeW,
  hoveredEdge,
}: {
  boundary: BoundaryShape;
  handleSize: number;
  arrowLen: number;
  arrowW: number;
  strokeW: number;
  hoveredEdge: ResizeEdge | null;
}) {
  const { x, y, width, height } = boundary;
  const midX = x + width / 2;
  const midY = y + height / 2;

  const edges: { edge: ResizeEdge; cx: number; cy: number; vertical: boolean }[] = [
    { edge: 'top', cx: midX, cy: y, vertical: true },
    { edge: 'bottom', cx: midX, cy: y + height, vertical: true },
    { edge: 'left', cx: x, cy: midY, vertical: false },
    { edge: 'right', cx: x + width, cy: midY, vertical: false },
  ];

  return (
    <g>
      {edges.map(({ edge, cx, cy, vertical }) => {
        const isActive = hoveredEdge === edge;
        const color = isActive ? colors.handleActive : colors.handleInactive;
        const dir = edge === 'top' || edge === 'left' ? -1 : 1;

        return (
          <g key={edge}>
            <rect
              x={cx - handleSize / 2}
              y={cy - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={handleSize * 0.2}
              fill={isActive ? colors.handleActiveFill : 'transparent'}
              stroke="none"
            />
            {vertical ? (
              <line
                x1={cx}
                y1={cy - arrowLen * 0.4 * dir}
                x2={cx}
                y2={cy + arrowLen * 0.6 * dir}
                stroke={color}
                strokeWidth={strokeW}
                strokeLinecap="round"
              />
            ) : (
              <line
                x1={cx - arrowLen * 0.4 * dir}
                y1={cy}
                x2={cx + arrowLen * 0.6 * dir}
                y2={cy}
                stroke={color}
                strokeWidth={strokeW}
                strokeLinecap="round"
              />
            )}
            {vertical ? (
              <polygon
                points={`${cx},${cy + arrowLen * 0.6 * dir} ${cx - arrowW},${cy + arrowLen * 0.2 * dir} ${cx + arrowW},${cy + arrowLen * 0.2 * dir}`}
                fill={color}
              />
            ) : (
              <polygon
                points={`${cx + arrowLen * 0.6 * dir},${cy} ${cx + arrowLen * 0.2 * dir},${cy - arrowW} ${cx + arrowLen * 0.2 * dir},${cy + arrowW}`}
                fill={color}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
