import { useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { GenerationParams, TurnStyle, CapStyle, SegmentMode, FillMode, AngleMode } from '../types';
import { SliderControl } from './SliderControl';
import { colors, gradients } from '../theme';

interface ParameterPanelProps {
  params: GenerationParams;
  onChange: (params: GenerationParams) => void;
  onGenerate: () => void;
  hasBoundary: boolean;
  hasFrozen: boolean;
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
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex rounded-lg overflow-hidden p-0.5 gap-0.5"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.borderLight}` }}
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

export function ParameterPanel({
  params,
  onChange,
  onGenerate,
  hasBoundary,
  hasFrozen,
}: ParameterPanelProps) {
  const update = <K extends keyof GenerationParams>(
    key: K,
    value: GenerationParams[K]
  ) => {
    onChange({ ...params, [key]: value });
  };

  const cellSize = params.strokeWidth + params.minGap;

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

      <PanelSection title="Fill">
        <div>
          <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: colors.textDim }}>Fill Mode</label>
          <ToggleGroup
            options={[
              { label: 'Continuous', value: 'continuous' as FillMode },
              { label: 'Multi-Pass', value: 'multi-pass' as FillMode },
              { label: 'Wicked Wise', value: 'wicked-wise' as FillMode },
            ]}
            value={params.fillMode}
            onChange={(v) => update('fillMode', v)}
          />
        </div>
        <SliderControl
          label="Target Fill %"
          value={params.targetFillPercent}
          min={10}
          max={100}
          onChange={(v) => update('targetFillPercent', v)}
        />
        {params.fillMode === 'multi-pass' && (
          <SliderControl
            label="Max Separate Paths"
            value={params.maxPasses}
            min={1}
            max={30}
            onChange={(v) => update('maxPasses', v)}
          />
        )}
        <SliderControl
          label="Direction Bias (V / H)"
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
      </PanelSection>

      <PanelSection title="Gaps" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <label className="text-[11px]" style={{ color: colors.textMuted }}>Enable Gaps</label>
          <button
            onClick={() => update('gapsEnabled', !params.gapsEnabled)}
            className="w-9 h-5 rounded-full relative transition-all duration-200"
            style={{
              background: params.gapsEnabled ? 'rgba(14,201,176,0.9)' : 'rgba(255,255,255,0.1)',
              boxShadow: params.gapsEnabled ? `0 0 8px ${colors.accentBorder}` : 'none',
            }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
              style={{ background: '#fff', left: params.gapsEnabled ? '18px' : '2px' }}
            />
          </button>
        </div>
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
