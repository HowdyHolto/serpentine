import { useState, useCallback, useRef } from 'react';
import { CanvasTransform, Point } from '../types';

export interface CanvasTransformControls {
  transform: CanvasTransform;
  setTransform: React.Dispatch<React.SetStateAction<CanvasTransform>>;
  handleWheel: (e: React.WheelEvent) => void;
  handlePanStart: (e: React.MouseEvent, force?: boolean) => void;
  handlePanMove: (e: React.MouseEvent) => void;
  handlePanEnd: () => void;
  screenToWorld: (screenX: number, screenY: number, svgRect: DOMRect) => Point;
  zoomToFit: (bx: number, by: number, bw: number, bh: number, canvasW: number, canvasH: number) => void;
  isPanning: React.MutableRefObject<boolean>;
}

export function useCanvasTransform(initialTransform?: Partial<CanvasTransform>): CanvasTransformControls {
  const [transform, setTransform] = useState<CanvasTransform>({
    x: initialTransform?.x ?? 80,
    y: initialTransform?.y ?? 80,
    scale: initialTransform?.scale ?? 1,
  });

  const isPanning = useRef(false);
  const lastPos = useRef<Point>({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
    setTransform((prev) => {
      const newScale = Math.min(20, Math.max(0.05, prev.scale * factor));
      const rect = (e.target as Element).closest('svg')?.getBoundingClientRect();
      if (!rect) return prev;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        scale: newScale,
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent, force?: boolean) => {
    if (force || e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform((prev) => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));
  }, []);

  const handlePanEnd = useCallback(() => {
    isPanning.current = false;
  }, []);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number, svgRect: DOMRect): Point => {
      return {
        x: (screenX - svgRect.left - transform.x) / transform.scale,
        y: (screenY - svgRect.top - transform.y) / transform.scale,
      };
    },
    [transform]
  );

  const zoomToFit = useCallback(
    (bx: number, by: number, bw: number, bh: number, canvasW: number, canvasH: number) => {
      const pad = 80;
      const availW = canvasW - pad * 2;
      const availH = canvasH - pad * 2;
      const scale = Math.min(availW / bw, availH / bh, 3);
      const x = pad + (availW - bw * scale) / 2 - bx * scale;
      const y = pad + (availH - bh * scale) / 2 - by * scale;
      setTransform({ x, y, scale });
    },
    []
  );

  return {
    transform,
    setTransform,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    screenToWorld,
    zoomToFit,
    isPanning,
  };
}
