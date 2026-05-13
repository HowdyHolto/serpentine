import { useMemo } from 'react';
import { CanvasTransform } from '../types';
import { colors } from '../theme';

export const PX_PER_MM = 3.7795275591;
const RULER_SIZE = 20;

interface RulersProps {
  transform: CanvasTransform;
  containerWidth: number;
  containerHeight: number;
}

function niceInterval(rawInterval: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function computeTicks(
  start: number,
  end: number,
  scale: number,
  minPixelSpacing: number
): { positions: number[]; interval: number; subInterval: number } {
  const worldRange = (end - start) / scale;
  const mmRange = worldRange / PX_PER_MM;
  const rawInterval = (minPixelSpacing / scale) / PX_PER_MM;
  const interval = niceInterval(rawInterval);
  const subInterval = interval / 5;

  const mmStart = ((-start / scale) / PX_PER_MM);
  const mmEnd = mmStart + mmRange;

  const firstMajor = Math.ceil(mmStart / interval) * interval;
  const positions: number[] = [];

  for (let mm = firstMajor; mm <= mmEnd; mm += interval) {
    positions.push(mm);
  }

  return { positions, interval, subInterval };
}

function HorizontalRuler({
  transform,
  width,
}: {
  transform: CanvasTransform;
  width: number;
}) {
  const ticks = useMemo(
    () => computeTicks(0, width, transform.scale, 60),
    [width, transform.scale, transform.x]
  );

  return (
    <div
      className="relative select-none overflow-hidden"
      style={{
        height: RULER_SIZE,
        marginLeft: RULER_SIZE,
        background: colors.bgRuler,
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <svg width={width} height={RULER_SIZE} className="block">
        {ticks.positions.map((mm) => {
          const worldX = mm * PX_PER_MM;
          const screenX = worldX * transform.scale + transform.x;

          if (screenX < -20 || screenX > width + 20) return null;

          return (
            <g key={mm}>
              <line
                x1={screenX}
                y1={RULER_SIZE - 7}
                x2={screenX}
                y2={RULER_SIZE}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={0.75}
              />
              <text
                x={screenX + 3}
                y={RULER_SIZE - 9}
                fill="rgba(255,255,255,0.3)"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
              >
                {mm % 1 === 0 ? mm : mm.toFixed(1)}
              </text>
            </g>
          );
        })}

        {ticks.positions.flatMap((mm) => {
          const subs = [];
          for (let s = 1; s < 5; s++) {
            const subMm = mm + s * ticks.subInterval;
            const worldX = subMm * PX_PER_MM;
            const screenX = worldX * transform.scale + transform.x;
            if (screenX < 0 || screenX > width) continue;
            subs.push(
              <line
                key={`${mm}-${s}`}
                x1={screenX}
                y1={RULER_SIZE - 4}
                x2={screenX}
                y2={RULER_SIZE}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={0.5}
              />
            );
          }
          return subs;
        })}
      </svg>
    </div>
  );
}

function VerticalRuler({
  transform,
  height,
}: {
  transform: CanvasTransform;
  height: number;
}) {
  const ticks = useMemo(
    () => computeTicks(0, height, transform.scale, 60),
    [height, transform.scale, transform.y]
  );

  return (
    <div
      className="relative select-none overflow-hidden"
      style={{
        width: RULER_SIZE,
        background: colors.bgRuler,
        borderRight: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <svg width={RULER_SIZE} height={height} className="block">
        {ticks.positions.map((mm) => {
          const worldY = mm * PX_PER_MM;
          const screenY = worldY * transform.scale + transform.y;

          if (screenY < -20 || screenY > height + 20) return null;

          return (
            <g key={mm}>
              <line
                x1={RULER_SIZE - 7}
                y1={screenY}
                x2={RULER_SIZE}
                y2={screenY}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={0.75}
              />
              <text
                x={RULER_SIZE - 9}
                y={screenY + 3}
                fill="rgba(255,255,255,0.3)"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {mm % 1 === 0 ? mm : mm.toFixed(1)}
              </text>
            </g>
          );
        })}

        {ticks.positions.flatMap((mm) => {
          const subs = [];
          for (let s = 1; s < 5; s++) {
            const subMm = mm + s * ticks.subInterval;
            const worldY = subMm * PX_PER_MM;
            const screenY = worldY * transform.scale + transform.y;
            if (screenY < 0 || screenY > height) continue;
            subs.push(
              <line
                key={`${mm}-${s}`}
                x1={RULER_SIZE - 4}
                y1={screenY}
                x2={RULER_SIZE}
                y2={screenY}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={0.5}
              />
            );
          }
          return subs;
        })}
      </svg>
    </div>
  );
}

export function Rulers({ transform, containerWidth, containerHeight }: RulersProps) {
  const canvasWidth = containerWidth - RULER_SIZE;
  const canvasHeight = containerHeight;

  return (
    <>
      <div
        className="absolute top-0 left-0 z-20 flex items-center justify-center"
        style={{
          width: RULER_SIZE,
          height: RULER_SIZE,
          background: colors.bgRuler,
          borderBottom: `1px solid ${colors.borderSubtle}`,
          borderRight: `1px solid ${colors.borderSubtle}`,
        }}
      >
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>mm</span>
      </div>

      <div className="absolute top-0 left-0 z-10" style={{ width: containerWidth }}>
        <HorizontalRuler transform={transform} width={canvasWidth} />
      </div>

      <div
        className="absolute left-0 z-10"
        style={{ top: RULER_SIZE, height: canvasHeight - RULER_SIZE }}
      >
        <VerticalRuler transform={transform} height={canvasHeight - RULER_SIZE} />
      </div>
    </>
  );
}

export { RULER_SIZE };
