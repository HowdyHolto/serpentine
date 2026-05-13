import { useState, useCallback, useEffect, useRef } from 'react';
import {
  BoundaryShape,
  GenerationParams,
  Waypoint,
  ActiveTool,
  Point,
  PathStructure,
  RenderedPath,
  DirectionGuide,
  WalkDirection,
  DEFAULT_PARAMS,
} from './types';
import { generateSerpentine } from './engine/serpentineGenerator';
import { partialRegenerate } from './engine/partialRegenerate';
import { renderPaths } from './engine/pathRenderer';
import { resolveConstrainedMove } from './engine/constraintSolver';
import { buildSvgDocument, downloadSvg } from './engine/svgExport';
import { Toolbar } from './components/Toolbar';
import { ParameterPanel } from './components/ParameterPanel';
import { Canvas } from './components/Canvas';
import { Toast } from './components/Toast';
import { useCanvasTransform } from './hooks/useCanvasTransform';

const CYCLE_DIRS: WalkDirection[] = ['right', 'down', 'left', 'up'];

export default function App() {
  const [boundary, setBoundary] = useState<BoundaryShape | null>(null);
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [paths, setPaths] = useState<RenderedPath[]>([]);
  const [structure, setStructure] = useState<PathStructure | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('rectangle');
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [frozenIndices, setFrozenIndices] = useState<Set<number>>(new Set());
  const [frozenParams, setFrozenParams] = useState<GenerationParams | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [guides, setGuides] = useState<DirectionGuide[]>([]);

  const waypointsRef = useRef<Waypoint[]>([]);
  const frozenIndicesRef = useRef<Set<number>>(new Set());
  const frozenParamsRef = useRef<GenerationParams | null>(null);
  const guidesRef = useRef<DirectionGuide[]>([]);

  waypointsRef.current = waypoints;
  frozenIndicesRef.current = frozenIndices;
  frozenParamsRef.current = frozenParams;
  guidesRef.current = guides;

  const hasFrozen = frozenIndices.size > 0;

  const {
    transform,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    screenToWorld,
  } = useCanvasTransform();

  const generate = useCallback(() => {
    if (!boundary) return;
    const result = generateSerpentine(boundary, params, guidesRef.current);
    setWaypoints(result.waypoints);
    setStructure(result.structure);
    // Use the params actually applied by the engine (may differ from input
    // when fill-completion retry tweaked strokeWidth/minGap to fully fill).
    setPaths(renderPaths(result.waypoints, result.params));
    if (result.adjusted) {
      const dStroke = result.params.strokeWidth - params.strokeWidth;
      const dGap = result.params.minGap - params.minGap;
      const dSeed = result.params.seed - params.seed;
      const pct = Math.round(result.fillRatio * 100);
      const visibleParts: string[] = [];
      if (dStroke !== 0) {
        visibleParts.push(`width ${params.strokeWidth}→${result.params.strokeWidth}`);
      }
      if (dGap !== 0) {
        visibleParts.push(`spacing ${params.minGap}→${result.params.minGap}`);
      }
      if (visibleParts.length === 0 && dSeed !== 0) {
        // Seed-only retry — visually invisible, but worth telling the user.
        setToastMessage(`Reseeded to reach ${pct}% fill`);
      } else if (visibleParts.length > 0) {
        setToastMessage(
          `Adjusted ${visibleParts.join(', ')} to reach ${pct}% fill`
        );
      }
    } else if (
      params.targetFillPercent >= 100 &&
      (params.fillMode === 'continuous' || params.fillMode === 'wicked-wise') &&
      result.fillRatio < 0.999
    ) {
      // Target was 100% but we couldn't fully fill — surface the best we got.
      const pct = Math.round(result.fillRatio * 100);
      setToastMessage(`Couldn't fully fill — best coverage ${pct}%`);
    }
  }, [boundary, params]);

  const handleGenerate = useCallback(() => {
    if (!boundary) return;
    const fi = frozenIndicesRef.current;
    const fp = frozenParamsRef.current;
    if (fi.size > 0 && fp) {
      const result = partialRegenerate(boundary, fp, waypointsRef.current, fi, guidesRef.current);
      setWaypoints(result.waypoints);
      setStructure(result.structure);
      setFrozenIndices(result.newFrozenIndices);
      setPaths(renderPaths(result.waypoints, fp));
      if (result.warning) setToastMessage(result.warning);
    } else {
      generate();
    }
  }, [boundary, generate]);

  const handleBoundaryCreate = useCallback(
    (b: BoundaryShape) => {
      setBoundary(b);
      setActiveTool('select');
      setFrozenIndices(new Set());
      setFrozenParams(null);
    },
    []
  );

  const handleBoundaryResize = useCallback(
    (b: BoundaryShape) => {
      setBoundary(b);
      setFrozenIndices(new Set());
      setFrozenParams(null);
    },
    []
  );

  useEffect(() => {
    if (!boundary) return;
    if (frozenIndices.size > 0) return;
    generate();
  }, [boundary, generate, frozenIndices.size]);

  useEffect(() => {
    if (frozenIndices.size > 0 && !frozenParams) {
      setFrozenParams({ ...params });
    } else if (frozenIndices.size === 0 && frozenParams) {
      setFrozenParams(null);
    }
  }, [frozenIndices.size, frozenParams, params]);

  const handleExport = useCallback(() => {
    if (!boundary || paths.length === 0) return;
    const exportParams = frozenParams || params;
    const svg = buildSvgDocument(boundary, paths, exportParams);
    downloadSvg(svg, exportParams.seed);
  }, [boundary, paths, params, frozenParams]);

  const handleRandomizeSeed = useCallback(() => {
    const fp = frozenParamsRef.current;
    const fi = frozenIndicesRef.current;
    if (fi.size > 0 && fp) {
      const newSeed = Math.floor(Math.random() * 999999);
      const updatedFp = { ...fp, seed: newSeed };
      setFrozenParams(updatedFp);
      if (!boundary) return;
      const result = partialRegenerate(boundary, updatedFp, waypointsRef.current, fi, guidesRef.current);
      setWaypoints(result.waypoints);
      setStructure(result.structure);
      setFrozenIndices(result.newFrozenIndices);
      setPaths(renderPaths(result.waypoints, updatedFp));
      if (result.warning) setToastMessage(result.warning);
    } else {
      setParams((prev) => ({
        ...prev,
        seed: Math.floor(Math.random() * 999999),
      }));
    }
  }, [boundary]);

  const handleWaypointMove = useCallback(
    (index: number, pos: Point) => {
      setWaypoints((prev) => {
        const renderParams = frozenParamsRef.current || params;
        if (!structure) {
          const next = [...prev];
          next[index] = { ...next[index], x: pos.x, y: pos.y };
          setPaths(renderPaths(next, renderParams));
          return next;
        }
        const next = resolveConstrainedMove(prev, index, pos, structure, boundary);
        setPaths(renderPaths(next, renderParams));
        return next;
      });
    },
    [params, structure, boundary]
  );

  const handleToggleFreezeWaypoint = useCallback((index: number) => {
    setFrozenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleFreezeWaypointsInRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const wps = waypointsRef.current;
      const toAdd: number[] = [];
      for (let i = 0; i < wps.length; i++) {
        if (
          wps[i].x >= rect.x && wps[i].x <= rect.x + rect.width &&
          wps[i].y >= rect.y && wps[i].y <= rect.y + rect.height
        ) {
          toAdd.push(i);
        }
      }
      if (toAdd.length === 0) return;
      setFrozenIndices((prev) => {
        const next = new Set(prev);
        for (const idx of toAdd) next.add(idx);
        return next;
      });
    },
    []
  );

  const handleUnfreezeAll = useCallback(() => {
    setFrozenIndices(new Set());
    setFrozenParams(null);
  }, []);

  const handleGuideAdd = useCallback((guide: DirectionGuide) => {
    setGuides((prev) => [...prev, guide]);
  }, []);

  const handleGuideCycle = useCallback((index: number) => {
    setGuides((prev) => {
      const next = [...prev];
      const current = next[index].direction;
      const idx = CYCLE_DIRS.indexOf(current);
      if (idx === CYCLE_DIRS.length - 1) {
        next.splice(index, 1);
      } else {
        next[index] = { ...next[index], direction: CYCLE_DIRS[(idx + 1) % CYCLE_DIRS.length] };
      }
      return next;
    });
  }, []);

  const handleGuideRemove = useCallback((index: number) => {
    setGuides((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearGuides = useCallback(() => {
    setGuides([]);
  }, []);

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;
  const handleUnfreezeAllRef = useRef(handleUnfreezeAll);
  handleUnfreezeAllRef.current = handleUnfreezeAll;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '?') {
        setShowHelp((prev) => !prev);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'r':
          setActiveTool('rectangle');
          break;
        case 'e':
          setActiveTool('ellipse');
          break;
        case 'p':
          setActiveTool('pen');
          break;
        case 'd':
          setActiveTool('redirect');
          break;
        case 'g':
          handleGenerateRef.current();
          break;
        case 'w':
          setShowWaypoints((prev) => !prev);
          break;
        case 'f':
          handleUnfreezeAllRef.current();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'linear-gradient(160deg, #06111e 0%, #081928 50%, #071520 100%)', color: 'rgba(255,255,255,0.88)' }}>
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onGenerate={handleGenerate}
        onExport={handleExport}
        onRandomizeSeed={handleRandomizeSeed}
        hasBoundary={!!boundary}
        hasPath={paths.length > 0}
        frozenCount={frozenIndices.size}
        onUnfreezeAll={handleUnfreezeAll}
        guideCount={guides.length}
        onClearGuides={handleClearGuides}
      />
      <div className="flex flex-1 min-h-0">
        <Canvas
          boundary={boundary}
          paths={paths}
          waypoints={waypoints}
          params={params}
          activeTool={activeTool}
          transform={transform}
          onBoundaryCreate={handleBoundaryCreate}
          onBoundaryResize={handleBoundaryResize}
          onWheel={handleWheel}
          onPanStart={handlePanStart}
          onPanMove={handlePanMove}
          onPanEnd={handlePanEnd}
          screenToWorld={screenToWorld}
          showWaypoints={showWaypoints}
          onWaypointMove={handleWaypointMove}
          structure={structure}
          showHelp={showHelp}
          onToggleHelp={toggleHelp}
          frozenIndices={frozenIndices}
          onToggleFreezeWaypoint={handleToggleFreezeWaypoint}
          onFreezeWaypointsInRect={handleFreezeWaypointsInRect}
          guides={guides}
          onGuideAdd={handleGuideAdd}
          onGuideCycle={handleGuideCycle}
          onGuideRemove={handleGuideRemove}
        />
        <ParameterPanel
          params={params}
          onChange={setParams}
          onGenerate={handleGenerate}
          hasBoundary={!!boundary}
          hasFrozen={hasFrozen}
        />
      </div>
      <Toast
        message={toastMessage}
        onDismiss={() => setToastMessage(null)}
      />
    </div>
  );
}
