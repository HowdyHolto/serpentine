import {
  MousePointer2,
  Square,
  Circle,
  PenTool,
  Shuffle,
  Download,
  Play,
  Cpu,
  Unlock,
  Lock,
  Compass,
  Trash2,
} from 'lucide-react';
import { ActiveTool } from '../types';
import { colors, gradients } from '../theme';

interface ToolbarProps {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  onGenerate: () => void;
  onExport: () => void;
  onRandomizeSeed: () => void;
  hasBoundary: boolean;
  hasPath: boolean;
  frozenCount: number;
  onUnfreezeAll: () => void;
  guideCount: number;
  onClearGuides: () => void;
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={active ? {
        background: colors.accentBgMedium,
        color: colors.accent,
        border: `1px solid ${colors.accentBorder}`,
      } : {
        color: colors.textIcon,
        border: '1px solid transparent',
      }}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:!text-white/75 hover:!bg-white/5"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 mx-1.5" style={{ background: colors.borderMedium }} />;
}

export function Toolbar({
  activeTool,
  onToolChange,
  onGenerate,
  onExport,
  onRandomizeSeed,
  hasBoundary,
  hasPath,
  frozenCount,
  onUnfreezeAll,
  guideCount,
  onClearGuides,
}: ToolbarProps) {
  return (
    <div
      className="h-12 flex items-center px-4 gap-1 shrink-0"
      style={{
        background: colors.bgToolbar,
        backdropFilter: 'blur(24px)',
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div className="flex items-center gap-2 mr-1.5">
        <Cpu size={16} color={colors.accent} />
        <span
          className="text-[11px] font-semibold tracking-widest uppercase select-none"
          style={{ color: colors.textSecondary }}
        >
          Serpentine
        </span>
      </div>

      <Divider />

      <div className="flex items-center gap-0.5">
        <ToolButton active={activeTool === 'select'} onClick={() => onToolChange('select')} title="Select (V)">
          <MousePointer2 size={15} />
        </ToolButton>
        <ToolButton active={activeTool === 'rectangle'} onClick={() => onToolChange('rectangle')} title="Rectangle (R)">
          <Square size={15} />
        </ToolButton>
        <ToolButton active={activeTool === 'ellipse'} onClick={() => onToolChange('ellipse')} title="Ellipse (E)">
          <Circle size={15} />
        </ToolButton>
        <ToolButton active={activeTool === 'pen'} onClick={() => onToolChange('pen')} title="Pen (P)">
          <PenTool size={15} />
        </ToolButton>
        <ToolButton active={activeTool === 'redirect'} onClick={() => onToolChange('redirect')} title="Direction guide (D)">
          <Compass size={15} />
        </ToolButton>
      </div>

      <Divider />

      <button
        onClick={onGenerate}
        disabled={!hasBoundary}
        title="Generate path (G)"
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
        style={hasBoundary ? {
          background: gradients.accentButton,
          color: '#001f18',
          boxShadow: `0 0 20px ${colors.accentGlow}`,
        } : {
          background: colors.accentBgSubtle,
          color: 'rgba(14,201,176,0.35)',
          border: `1px solid ${colors.accentBorderLight}`,
        }}
      >
        <Play size={12} />
        Generate
      </button>

      <button
        onClick={onRandomizeSeed}
        title="Randomize seed"
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
        style={{ color: colors.textIcon }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
          (e.currentTarget as HTMLButtonElement).style.background = colors.accentBgSubtle;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.textIcon;
          (e.currentTarget as HTMLButtonElement).style.background = '';
        }}
      >
        <Shuffle size={15} />
      </button>

      {frozenCount > 0 && (
        <>
          <Divider />
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
            style={{ color: colors.frozenNotice, background: colors.frozenNoticeBg }}
          >
            <Lock size={11} />
            <span className="font-medium">{frozenCount} locked</span>
          </div>
          <button
            onClick={onUnfreezeAll}
            title="Unfreeze all (F)"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ color: colors.frozenNotice }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = colors.frozenNoticeBg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '';
            }}
          >
            <Unlock size={14} />
          </button>
        </>
      )}

      {guideCount > 0 && (
        <>
          <Divider />
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
            style={{ color: colors.guideNotice, background: colors.guideNoticeBg }}
          >
            <Compass size={11} />
            <span className="font-medium">{guideCount} guide{guideCount !== 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={onClearGuides}
            title="Clear all guides"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ color: colors.guideNotice }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = colors.guideNoticeBg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '';
            }}
          >
            <Trash2 size={13} />
          </button>
        </>
      )}

      <Divider />

      <button
        onClick={onExport}
        disabled={!hasPath}
        title="Export SVG"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed"
        style={{
          color: colors.textMuted,
          border: `1px solid ${colors.borderMedium}`,
        }}
        onMouseEnter={(e) => {
          if (!hasPath) return;
          (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary;
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.13)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.borderMedium;
          (e.currentTarget as HTMLButtonElement).style.background = '';
        }}
      >
        <Download size={13} />
        Export SVG
      </button>
    </div>
  );
}
