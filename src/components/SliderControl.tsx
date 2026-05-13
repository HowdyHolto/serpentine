import { colors, gradients } from '../theme';

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: SliderControlProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px]" style={{ color: colors.textMuted }}>{label}</label>
        <span
          className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md"
          style={{
            color: colors.accent,
            background: colors.accentBgLight,
          }}
        >
          {step < 1 ? value.toFixed(2) : value}
        </span>
      </div>
      <div className="relative">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full pointer-events-none"
          style={{
            left: 0,
            width: `${pct}%`,
            background: gradients.sliderFill,
            opacity: 0.7,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full relative"
          style={{ position: 'relative' }}
        />
      </div>
    </div>
  );
}
