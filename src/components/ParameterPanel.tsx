import { useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { GenerationParams, TurnStyle, CapStyle, SegmentMode, FillMode, AngleMode, PatternMode, ContourSource, Rock, usesTrace, PathStyle, GradientScope, MarkerShape, MarkerMode } from '../types';
import { SliderControl } from './SliderControl';
import { colors, gradients } from '../theme';

interface ParameterPanelProps {
  params: GenerationParams;
  onChange: (params: GenerationParams) => void;
  onGenerate: () => void;
  hasBoundary: boolean;
  hasFrozen: boolean;
  rocks: Rock[];
  selectedRock: number | null;
  onRockChange: (index: number, rock: Rock) => void;
  onSelectRock: (index: number | null) => void;
}

function PanelSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-2.5 transition-colors"
        style={{ color: colors.textSecondary }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest">{title}</span>
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? '' : '-rotate-90'}`}
          style={{ color: colors.textFaint }}
        />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  /** Lay the options out in a grid instead of one row. */
  columns?: number;
}) {
  return (
    <div
      className={`${columns ? 'grid' : 'flex'} rounded-lg overflow-hidden p-0.5 gap-0.5`}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${colors.borderLight}`,
        gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-all duration-150"
          style={value === opt.value ? {
            background: colors.accentBgActive,
            color: colors.accent,
            border: `1px solid ${colors.accentBorder}`,
          } : {
            color: 'rgba(255,255,255,0.38)',
            border: '1px solid transparent',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-[11px]" style={{ color: colors.textMuted }}>{label}</label>
      <button
        onClick={() => onChange(!checked)}
        className="w-9 h-5 rounded-full relative transition-all duration-200"
        title={title}
        style={{
          background: checked ? 'rgba(14,201,176,0.9)' : 'rgba(255,255,255,0.1)',
          boxShadow: checked ? `0 0 8px ${colors.accentBorder}` : 'none',
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
          style={{ background: '#fff', left: checked ? '18px' : '2px' }}
        />
      </button>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Shown as a small × when the stop can be removed. */
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px]" style={{ color: colors.textMuted }}>{label}</label>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono" style={{ color: colors.textDim }}>{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-5 rounded-md cursor-pointer bg-transparent"
          style={{ border: `1px solid ${colors.borderInput}`, padding: 0 }}
          title={label}
        />
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-[11px] leading-none px-1 rounded"
            style={{ color: colors.textDim }}
            title="Remove this stop"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

const MODE_HINTS: Record<PatternMode, string> = {
  serpentine: 'Free random fill: one non-crossing line that covers every cell on every seed.',
  concentric: "Follows the boundary's offset contours as it works inward, hairpinning between rings.",
  contour: 'One line follows the iso-lines of a terrain, like a topographic map. The seed reshapes the terrain.',
  rake: 'Draws the terrain\'s iso-lines as separate rake lines, like a zen garden or a topographic map. Lines never cross.',
};

function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg" style={{ border: `1px solid ${colors.borderSubtle}` }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-2.5 py-1.5"
        style={{ color: colors.textDim }}
      >
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? '' : '-rotate-90'}`}
          style={{ color: colors.textFaint }}
        />
      </button>
      {open && <div className="px-2.5 pb-2.5 space-y-3">{children}</div>}
    </div>
  );
}

export function ParameterPanel({
  params,
  onChange,
  onGenerate,
  hasBoundary,
  hasFrozen,
  rocks,
  selectedRock,
  onRockChange,
  onSelectRock,
}: ParameterPanelProps) {
  const update = <K extends keyof GenerationParams>(
    key: K,
    value: GenerationParams[K]
  ) => {
    onChange({ ...params, [key]: value });
  };

  const cellSize = params.strokeWidth + params.minGap;
  const terrain = params.patternMode === 'contour' || params.patternMode === 'rake';
  const style = params.style;
  const updateStyle = <K extends keyof PathStyle>(key: K, value: PathStyle[K]) => {
    onChange({ ...params, style: { ...style, [key]: value } });
  };
  const setStop = (i: number, hex: string) => {
    const stops = style.gradientStops.slice();
    stops[i] = hex;
    updateStyle('gradientStops', stops);
  };
  const stopLabels = style.gradientStops.length === 3 ? ['Start', 'Middle', 'End'] : ['Start', 'End'];

  return (
    <div
      className="w-72 flex flex-col shrink-0 overflow-y-auto"
      style={{
        background: colors.bgPanel,
        backdropFilter: 'blur(24px)',
        borderLeft: `1px solid ${colors.borderLight}`,
      }}
    >
      <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <h2 className="text-xs font-semibold tracking-wider uppercase" style={{ color: colors.textSecondary }}>
          Parameters
        </h2>
      </div>

      {hasFrozen && (
        <div
          className="px-4 py-2.5"
          style={{ background: 'rgba(96, 165, 250, 0.04)', borderBottom: '1px solid rgba(96, 165, 250, 0.08)' }}
        >
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(96, 165, 250, 0.65)' }}>
            <Lock size={10} />
            <span>Parameters locked to frozen path</span>
          </div>
        </div>
      )}

      <PanelSection title="Mode">
        <ToggleGroup
          options={[
            { label: 'Serpentine', value: 'serpentine' as PatternMode },
            { label: 'Concentric', value: 'concentric' as PatternMode },
            { label: 'Contour', value: 'contour' as PatternMode },
            { label: 'Rake', value: 'rake' as PatternMode },
          ]}
          columns={2}
          value={params.patternMode}
          onChange={(v) => update('patternMode', v)}
        />
        <div className="text-[10px]" style={{ color: colors.textFaint }}>
          {MODE_HINTS[params.patternMode]}
        </div>

        {params.patternMode === 'concentric' && (
          <>
            <SliderControl
              label="Strength"
              value={params.concentricStrength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update('concentricStrength', v)}
            />
            <SliderControl
              label="Falloff"
              value={params.concentricFalloff}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update('concentricFalloff', v)}
            />
            <Switch
              label="Invert"
              checked={params.concentricInvert}
              onChange={(v) => update('concentricInvert', v)}
              title="Faithful to the contours at the center, random at the edge"
            />
            <div className="text-[10px]" style={{ color: colors.textFaint }}>
              Falloff 0 follows the contours everywhere; 1 lets go toward the center.
            </div>
          </>
        )}

        {terrain && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Terrain</label>
              <ToggleGroup
                options={[
                  { label: 'Noise', value: 'noise' as ContourSource },
                  { label: 'Pond', value: 'pond' as ContourSource },
                  { label: 'Garden', value: 'garden' as ContourSource },
                ]}
                value={params.contourSource}
                onChange={(v) => update('contourSource', v)}
              />
              <div className="text-[10px] mt-1.5" style={{ color: colors.textFaint }}>
                {params.contourSource === 'noise' && 'Seeded hills and valleys. The seed reshapes them.'}
                {params.contourSource === 'pond' && 'Each rock (K) is a bump with its own elevation; ripples spread and merge where bumps overlap.'}
                {params.contourSource === 'garden' && 'Rake lines radiate from each rock (K) and the edge until they meet along ridges.'}
              </div>
            </div>
            {params.patternMode === 'contour' && (
              <SliderControl
                label="Strength"
                value={params.contourStrength}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => update('contourStrength', v)}
              />
            )}
            {params.patternMode === 'rake' && (
              <>
                <SliderControl
                  label="Width Variation"
                  value={params.rakeWidthVariation}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(v) => update('rakeWidthVariation', v)}
                />
                <SliderControl
                  label="Min Length (cells)"
                  value={params.rakeMinLength}
                  min={1}
                  max={20}
                  onChange={(v) => update('rakeMinLength', v)}
                />
                {params.contourSource !== 'garden' && (
                  <>
                    <SliderControl
                      label="Crowding"
                      value={params.rakeCrowding}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => update('rakeCrowding', v)}
                    />
                    <div className="text-[10px] -mt-1" style={{ color: colors.textFaint }}>
                      Clear gap a line keeps before it is cut where lines bunch, as a share of Line Gap. 0 lets strokes touch.
                    </div>
                    <Switch
                      label="Merge Pairs"
                      checked={params.rakeMerge}
                      onChange={(v) => update('rakeMerge', v)}
                      title="Where lines bunch, a line may run over one neighbour as a thicker stroke, but never two."
                    />
                    <SliderControl
                      label="Slope Limit"
                      value={params.rakeSlopeLimit}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => update('rakeSlopeLimit', v)}
                    />
                    <div className="text-[10px] -mt-1" style={{ color: colors.textFaint }}>
                      Caps how steep the terrain can be, like sand settling, so lines never bunch tighter than a cell. 1 keeps every line whole; 0 draws the terrain as it is.
                    </div>
                  </>
                )}
              </>
            )}
            {(params.contourSource === 'noise' || params.contourNoiseMix > 0) && (
              <SliderControl
                label="Feature Size"
                value={params.contourScale}
                min={40}
                max={600}
                step={10}
                onChange={(v) => update('contourScale', v)}
              />
            )}
            {params.contourSource === 'pond' && (
              <>
                <SliderControl
                  label="Rock Spread"
                  value={params.rockSpread}
                  min={20}
                  max={600}
                  step={10}
                  onChange={(v) => update('rockSpread', v)}
                />
                <SliderControl
                  label="Terrain Mix"
                  value={params.contourNoiseMix}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => update('contourNoiseMix', v)}
                />
              </>
            )}
            {params.contourSource === 'garden' && (
              <SliderControl
                label="Edge Influence"
                value={params.rockEdge}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => update('rockEdge', v)}
              />
            )}
            {params.contourSource !== 'noise' && rocks.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {rocks.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => onSelectRock(i)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono transition-all"
                      style={selectedRock === i ? {
                        background: colors.rockNoticeBg,
                        color: colors.rockNotice,
                        border: `1px solid ${colors.rockStroke}`,
                      } : {
                        color: colors.textDim,
                        border: `1px solid ${colors.borderLight}`,
                      }}
                    >
                      {i + 1}: {r.elevation > 0 ? '+' : ''}{r.elevation.toFixed(2)}
                    </button>
                  ))}
                </div>
                {selectedRock !== null && rocks[selectedRock] && (
                  <SliderControl
                    label={`Rock ${selectedRock + 1} Elevation`}
                    value={rocks[selectedRock].elevation}
                    min={-1}
                    max={1}
                    step={0.05}
                    onChange={(v) => onRockChange(selectedRock, { ...rocks[selectedRock], elevation: v })}
                  />
                )}
              </div>
            )}
            {params.patternMode === 'contour' && (
              <>
                <SliderControl
                  label="Slope Response"
                  value={params.contourSlope}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => update('contourSlope', v)}
                />
                <Switch
                  label="Invert"
                  checked={params.contourInvert}
                  onChange={(v) => update('contourInvert', v)}
                  title="Faithful on flat ground instead of steep"
                />
                <div className="text-[10px]" style={{ color: colors.textFaint }}>
                  Slope Response 0 follows the terrain everywhere; 1 is faithful on steep ground and loose on flat.
                </div>
              </>
            )}
            {params.patternMode === 'rake' && (
              <div className="text-[10px]" style={{ color: colors.textFaint }}>
                Garden spaces lines exactly one gap apart. Pond and Noise space them by slope, so steep ground gets dense lines; widen the gap if they crowd.
              </div>
            )}
          </>
        )}

        {params.patternMode === 'serpentine' && (
          <Disclosure label="Engine" defaultOpen={params.fillMode !== 'trace'}>
            <ToggleGroup
              columns={2}
              options={[
                { label: 'Trace', value: 'trace' as FillMode },
                { label: 'Continuous', value: 'continuous' as FillMode },
                { label: 'Multi-Pass', value: 'multi-pass' as FillMode },
                { label: 'Wicked Wise', value: 'wicked-wise' as FillMode },
              ]}
              value={params.fillMode}
              onChange={(v) => update('fillMode', v)}
            />
            {params.fillMode === 'trace' ? (
              <div className="text-[10px]" style={{ color: colors.textFaint }}>
                Trace always fills completely. The others are the older walkers, kept for their sparser look.
              </div>
            ) : params.fillMode === 'multi-pass' ? (
              <>
                <SliderControl
                  label="Target Fill %"
                  value={params.targetFillPercent}
                  min={10}
                  max={100}
                  onChange={(v) => update('targetFillPercent', v)}
                />
                <SliderControl
                  label="Max Separate Paths"
                  value={params.maxPasses}
                  min={1}
                  max={30}
                  onChange={(v) => update('maxPasses', v)}
                />
              </>
            ) : (
              <div>
                <Switch
                  label="Fill Completely"
                  checked={params.targetFillPercent >= 100}
                  onChange={(v) => update('targetFillPercent', v ? 100 : 75)}
                  title="Retry with nearby seeds until the boundary is fully covered (slower)"
                />
                <div className="text-[10px] mt-1" style={{ color: colors.textFaint }}>
                  Sweeps nearby seeds and keeps the best coverage. Slower.
                </div>
              </div>
            )}
          </Disclosure>
        )}
      </PanelSection>

      <PanelSection title="Stroke">
        <SliderControl
          label="Width"
          value={params.strokeWidth}
          min={1}
          max={40}
          onChange={(v) => update('strokeWidth', v)}
        />
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Cap Style</label>
          <ToggleGroup
            options={[
              { label: 'Round', value: 'round' as CapStyle },
              { label: 'Flat', value: 'butt' as CapStyle },
            ]}
            value={params.capStyle}
            onChange={(v) => update('capStyle', v)}
          />
        </div>
      </PanelSection>

      <PanelSection title="Style" defaultOpen={false}>
        <Switch
          label="Length Gradient"
          checked={style.gradientEnabled}
          onChange={(v) => updateStyle('gradientEnabled', v)}
          title="Colour the line with a gradient that follows its length"
        />
        {style.gradientEnabled && (
          <>
            {style.gradientStops.map((hex, i) => (
              <ColorInput
                key={i}
                label={stopLabels[i] ?? `Stop ${i + 1}`}
                value={hex}
                onChange={(h) => setStop(i, h)}
                onRemove={style.gradientStops.length === 3 && i === 1 ? () => updateStyle('gradientStops', [style.gradientStops[0], style.gradientStops[2]]) : undefined}
              />
            ))}
            {style.gradientStops.length < 3 && (
              <button
                onClick={() => updateStyle('gradientStops', [style.gradientStops[0], '#ffd166', style.gradientStops[1]])}
                className="text-[11px] w-full py-1 rounded-md transition-colors"
                style={{ color: colors.textDim, border: `1px dashed ${colors.borderInput}` }}
              >
                + Middle stop
              </button>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Scope</label>
              <ToggleGroup
                options={[
                  { label: 'Per Run', value: 'per-run' as GradientScope },
                  { label: 'Whole', value: 'whole' as GradientScope },
                ]}
                value={style.gradientScope}
                onChange={(v) => updateStyle('gradientScope', v)}
              />
              <p className="text-[10px] mt-1.5 leading-snug" style={{ color: colors.textFaint }}>
                Per Run restarts the gradient on every piece, pass or rake line; Whole runs it once across them all.
              </p>
            </div>
            <SliderControl
              label="Transition"
              value={style.gradientSpread}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateStyle('gradientSpread', v)}
            />
            <p className="text-[10px] -mt-1.5 leading-snug" style={{ color: colors.textFaint }}>
              How much of the way between two colours is spent blending: 1 is a smooth sweep, 0 is hard bands.
            </p>
            <SliderControl
              label="Repeats"
              value={style.gradientCycles}
              min={1}
              max={12}
              onChange={(v) => updateStyle('gradientCycles', v)}
            />
          </>
        )}
        <Switch
          label="Markers"
          checked={style.markersEnabled}
          onChange={(v) => updateStyle('markersEnabled', v)}
          title="Place shapes along the path"
        />
        {style.markersEnabled && (
          <>
            <ToggleGroup
              options={[
                { label: 'Dot', value: 'dot' as MarkerShape },
                { label: 'Square', value: 'square' as MarkerShape },
                { label: 'Dash', value: 'dash' as MarkerShape },
                { label: 'Triangle', value: 'triangle' as MarkerShape },
              ]}
              value={style.markerShape}
              onChange={(v) => updateStyle('markerShape', v)}
              columns={2}
            />
            <SliderControl
              label="Spacing (px)"
              value={style.markerSpacing}
              min={2}
              max={200}
              onChange={(v) => updateStyle('markerSpacing', v)}
            />
            <SliderControl
              label="Size (× stroke)"
              value={style.markerSize}
              min={0.1}
              max={4}
              step={0.05}
              onChange={(v) => updateStyle('markerSize', v)}
            />
            <SliderControl
              label="Skew (°)"
              value={style.markerSkew}
              min={-90}
              max={90}
              onChange={(v) => updateStyle('markerSkew', v)}
            />
            <Switch
              label="Follow Gradient Colour"
              checked={style.markerColor === 'gradient'}
              onChange={(v) => updateStyle('markerColor', v ? 'gradient' : (style.gradientStops[0] ?? '#ffffff'))}
              title="Take each marker's colour from the gradient stops at its position"
            />
            {style.markerColor !== 'gradient' && (
              <ColorInput label="Colour" value={style.markerColor} onChange={(h) => updateStyle('markerColor', h)} />
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Stroke</label>
              <ToggleGroup
                options={[
                  { label: 'Overlay', value: 'overlay' as MarkerMode },
                  { label: 'Replace', value: 'replace' as MarkerMode },
                ]}
                value={style.markerMode}
                onChange={(v) => updateStyle('markerMode', v)}
              />
            </div>
          </>
        )}
      </PanelSection>

      <PanelSection title="Turns">
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Style</label>
          <ToggleGroup
            options={[
              { label: 'Rounded', value: 'rounded' as TurnStyle },
              { label: 'Squared', value: 'squared' as TurnStyle },
            ]}
            value={params.turnStyle}
            onChange={(v) => update('turnStyle', v)}
          />
        </div>
        {params.turnStyle === 'rounded' && (
          <>
            <SliderControl
              label="Corner Radius"
              value={params.cornerRadius}
              min={0}
              max={Math.max(2, Math.floor(cellSize / 2))}
              onChange={(v) => update('cornerRadius', v)}
            />
            <SliderControl
              label="Ring Harmony"
              value={params.ringHarmony}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update('ringHarmony', v)}
            />
          </>
        )}
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Angle Mode</label>
          <ToggleGroup
            options={[
              { label: '90\u00B0', value: '90' },
              { label: '45\u00B0', value: '45' },
            ]}
            value={String(params.angleMode)}
            onChange={(v) => update('angleMode', Number(v) as AngleMode)}
          />
        </div>
      </PanelSection>

      <PanelSection title="Spacing">
        <SliderControl
          label="Line Gap"
          value={params.minGap}
          min={1}
          max={50}
          onChange={(v) => update('minGap', v)}
        />
        <div className="text-[10px]" style={{ color: colors.textFaint }}>
          Cell size: {cellSize}px (width + gap)
        </div>
      </PanelSection>

      {params.patternMode !== 'rake' && (
      <PanelSection title="Segments">
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Mode</label>
          <ToggleGroup
            options={[
              { label: 'Fixed', value: 'fixed' as SegmentMode },
              { label: 'Random', value: 'random' as SegmentMode },
            ]}
            value={params.segmentMode}
            onChange={(v) => update('segmentMode', v)}
          />
        </div>
        {params.segmentMode === 'fixed' ? (
          <SliderControl
            label="Segment Length"
            value={params.fixedSegmentLength}
            min={10}
            max={400}
            onChange={(v) => update('fixedSegmentLength', v)}
          />
        ) : (
          <>
            <SliderControl
              label="Min Length"
              value={params.minSegmentLength}
              min={10}
              max={params.maxSegmentLength}
              onChange={(v) => update('minSegmentLength', v)}
            />
            <SliderControl
              label="Max Length"
              value={params.maxSegmentLength}
              min={params.minSegmentLength}
              max={500}
              onChange={(v) => update('maxSegmentLength', v)}
            />
          </>
        )}
      </PanelSection>
      )}

      <PanelSection title="Path">
        {usesTrace(params) && (
          <>
            <Switch
              label="Closed Loop"
              checked={params.closedLoop}
              onChange={(v) => update('closedLoop', v)}
              title="Keep the path as one closed loop with no ends"
            />
            {!params.closedLoop && (
              <SliderControl
                label="Pieces"
                value={params.tracePieces}
                min={1}
                max={30}
                onChange={(v) => update('tracePieces', v)}
              />
            )}
          </>
        )}
        {params.patternMode !== 'rake' && (
          <>
            <SliderControl
              label="Horizontal Bias"
              value={params.fillDirectionBias}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update('fillDirectionBias', v)}
            />
            <SliderControl
              label="Direction Switch Freq"
              value={params.directionSwitchFrequency}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => update('directionSwitchFrequency', v)}
            />
          </>
        )}
        <SliderControl
          label="Jitter"
          value={params.jitter}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => update('jitter', v)}
        />
        {params.jitter > 0 && (
          <div className="text-[10px]" style={{ color: colors.textFaint }}>
            Nudges every anchor with smooth noise, never more than half the gap, so lines lean and wobble without touching.
          </div>
        )}
      </PanelSection>

      <PanelSection title="Gaps" defaultOpen={false}>
        <Switch
          label="Enable Gaps"
          checked={params.gapsEnabled}
          onChange={(v) => update('gapsEnabled', v)}
        />
        {params.gapsEnabled && (
          <>
            <SliderControl label="Gap Freq Min" value={params.gapFrequencyMin} min={20} max={params.gapFrequencyMax} onChange={(v) => update('gapFrequencyMin', v)} />
            <SliderControl label="Gap Freq Max" value={params.gapFrequencyMax} min={params.gapFrequencyMin} max={600} onChange={(v) => update('gapFrequencyMax', v)} />
            <SliderControl label="Gap Length Min" value={params.minGapLength} min={2} max={params.maxGapLength} onChange={(v) => update('minGapLength', v)} />
            <SliderControl label="Gap Length Max" value={params.maxGapLength} min={params.minGapLength} max={60} onChange={(v) => update('maxGapLength', v)} />
          </>
        )}
      </PanelSection>

      <PanelSection title="Seed">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={params.seed}
            onChange={(e) => update('seed', Number(e.target.value) || 0)}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${colors.borderInput}`,
              color: 'rgba(255,255,255,0.8)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = colors.accentBorder;
              e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.accentFocusRing}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = colors.borderInput;
              e.currentTarget.style.boxShadow = '';
            }}
          />
        </div>
      </PanelSection>

      <div className="p-4 mt-auto" style={{ borderTop: `1px solid ${colors.borderLight}` }}>
        <button
          onClick={onGenerate}
          disabled={!hasBoundary}
          className="w-full py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          style={hasBoundary ? {
            background: gradients.accentButton,
            color: '#001f18',
            boxShadow: `0 0 20px ${colors.accentGlow}`,
          } : {
            background: colors.accentBgSubtle,
            color: 'rgba(14,201,176,0.3)',
            border: `1px solid ${colors.accentBorderLight}`,
          }}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
