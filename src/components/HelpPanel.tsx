import { HelpCircle, X } from 'lucide-react';
import { colors } from '../theme';

interface HelpPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px]" style={{ color: colors.textMuted }}>{label}</span>
      <kbd
        className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-mono"
        style={{
          background: colors.borderLight,
          color: colors.textSecondary,
          border: `1px solid ${colors.borderInput}`,
        }}
      >
        {keys}
      </kbd>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      className="text-[9px] font-semibold uppercase tracking-widest pt-2.5 pb-1 first:pt-0"
      style={{ color: colors.accent }}
    >
      {title}
    </div>
  );
}

export function HelpPanel({ isOpen, onToggle }: HelpPanelProps) {
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute bottom-4 left-4 z-30 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200"
        style={{
          background: colors.bgHelpToggle,
          backdropFilter: 'blur(12px)',
          border: `1px solid ${colors.borderInput}`,
          color: colors.textDim,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accentBorder;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.textDim;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.borderInput;
        }}
        title="Show keyboard shortcuts (?)"
      >
        <HelpCircle size={15} />
      </button>
    );
  }

  return (
    <div
      className="absolute bottom-4 left-4 z-30 w-60 rounded-xl overflow-hidden shadow-2xl"
      style={{
        background: colors.bgHelpPanel,
        backdropFilter: 'blur(24px)',
        border: `1px solid ${colors.borderMedium}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-2.5"
        style={{ borderBottom: `1px solid ${colors.borderLight}` }}
      >
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: colors.textSecondary }}>
          Keyboard Shortcuts
        </span>
        <button
          onClick={onToggle}
          style={{ color: colors.textFaint }}
          className="transition-colors hover:!text-white/70"
        >
          <X size={13} />
        </button>
      </div>

      <div className="px-3.5 py-2 max-h-80 overflow-y-auto space-y-0.5">
        <SectionTitle title="Tools" />
        <ShortcutRow keys="V" label="Select tool" />
        <ShortcutRow keys="R" label="Rectangle boundary" />
        <ShortcutRow keys="E" label="Ellipse boundary" />
        <ShortcutRow keys="P" label="Pen tool" />
        <ShortcutRow keys="D" label="Direction guide" />

        <SectionTitle title="Actions" />
        <ShortcutRow keys="G" label="Generate path" />
        <ShortcutRow keys="W" label="Toggle waypoints" />
        <ShortcutRow keys="H" label="Lines only (hide boundary, points, guides)" />
        <ShortcutRow keys="L" label="Library: save / load arrangements" />
        <ShortcutRow keys="?" label="Toggle this panel" />

        <SectionTitle title="Navigation" />
        <ShortcutRow keys="Space+Drag" label="Pan canvas" />
        <ShortcutRow keys="Alt+Click" label="Pan canvas" />
        <ShortcutRow keys="Scroll" label="Zoom in/out" />
        <ShortcutRow keys="0" label="Fit boundary to view" />

        <SectionTitle title="Editing" />
        <div className="text-[10px] py-0.5 leading-relaxed" style={{ color: colors.textFaint }}>
          Drag waypoints to reshape. Points are axis-locked. End-cap pairs move together. Drag edge arrows to resize boundary.
        </div>

        <SectionTitle title="Freeze" />
        <ShortcutRow keys="Shift+Click" label="Toggle freeze waypoint" />
        <ShortcutRow keys="Shift+Drag" label="Freeze area (marquee)" />
        <ShortcutRow keys="F" label="Unfreeze all" />
        <div className="text-[10px] py-0.5 leading-relaxed" style={{ color: colors.textFaint }}>
          Frozen waypoints stay fixed when regenerating. Unfrozen gaps fill with new paths using the locked parameters.
        </div>

        <SectionTitle title="Modes" />
        <div className="text-[10px] py-0.5 leading-relaxed" style={{ color: colors.textFaint }}>
          <span style={{ color: colors.accent }}>Serpentine</span> — grows a random tree over the boundary and traces around it: one non-crossing line that fills every cell on every seed.{' '}
          <span style={{ color: colors.accent }}>Concentric</span> — the same line follows the boundary's offset contours as it works inward. Strength sets how strictly, Falloff how soon it goes random toward the center, Invert makes it faithful at the center instead.{' '}
          <span style={{ color: colors.accent }}>Contour</span> — the line follows the iso-lines of a seeded terrain, like a topographic map. Feature Size spaces the hills, Slope Response keeps it faithful on steep ground and loose on flat.{' '}
          <span style={{ color: colors.accent }}>Rake</span> — draws the terrain's iso-lines as separate rake lines, like a zen garden (Garden: rings spread from each rock, K, and the edge until they meet) or a topographic map (Noise, Pond: lines bunch on steep ground). Width Variation thins the low or high lines.{' '}
          <span style={{ color: colors.accent }}>Style</span> — a Length Gradient colours each line along its length (per run or across the whole design, repeating if you like), and Markers place dots, squares, dashes or triangles along the path at a spacing, size and skew, over the stroke or instead of it. Both export to SVG.{' '}
          Closed Loop keeps the one-line modes as a ring with no ends; Pieces cuts the line into several paths. The Engine disclosure under Serpentine still offers the older walkers (Continuous, Multi-Pass, Wicked Wise) for a sparser look.
        </div>

        <SectionTitle title="Direction Guides" />
        <div className="text-[10px] py-0.5 leading-relaxed" style={{ color: colors.textFaint }}>
          Use the <span style={{ color: colors.guideArrow }}>Direction Guide</span> tool (D) to influence path direction.
          Click to place an arrow, click again to rotate it. Shift+click to remove. The path generator will prefer the arrow direction in nearby areas.
        </div>

        <SectionTitle title="Angle Mode" />
        <div className="text-[10px] py-0.5 leading-relaxed" style={{ color: colors.textFaint }}>
          45° mode enables diagonal grid movement for varied patterns. In Trace it chamfers every corner instead, so fill stays complete.
        </div>
      </div>
    </div>
  );
}
