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
  Maximize,
  Eye,
  EyeOff,
  Library,
  Mountain,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { ActiveTool } from '../types';
import { colors, gradients } from '../theme';

interface ToolbarProps {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  onGenerate: () => void;
  /** 'artwork' = strokes as on screen; 'fabrication' = outline, centerline and colour layers. */
  onExport: (kind: 'artwork' | 'fabrication', options: { colourSteps: number; includeBoundary: boolean }) => void;
  /** The length gradient is on, so the fabrication export has a colour layer. */
  gradientOn: boolean;
  onRandomizeSeed: () => void;
  hasBoundary: boolean;
  hasPath: boolean;
  frozenCount: number;
  onUnfreezeAll: () => void;
  guideCount: number;
  onClearGuides: () => void;
  rockCount: number;
  onClearRocks: () => void;
  onFitView: () => void;
  cleanView: boolean;
  onToggleCleanView: () => void;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
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

const BOUNDARY_PREF_KEY = 'serpentine.export.includeBoundary';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage unavailable: the choice just lasts for this visit.
  }
}

function ExportOption({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-3.5 py-2.5 transition-colors"
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '')}
    >
      <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>{title}</div>
      <div className="text-[10px] leading-relaxed mt-0.5" style={{ color: colors.textFaint }}>{detail}</div>
    </button>
  );
}

export function Toolbar({
  activeTool,
  onToolChange,
  onGenerate,
  onExport,
  gradientOn,
  onRandomizeSeed,
  hasBoundary,
  hasPath,
  frozenCount,
  onUnfreezeAll,
  guideCount,
  onClearGuides,
  rockCount,
  onClearRocks,
  onFitView,
  cleanView,
  onToggleCleanView,
  libraryOpen,
  onToggleLibrary,
}: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [colourSteps, setColourSteps] = useState(0);
  const [includeBoundary, setIncludeBoundary] = useState(() => readFlag(BOUNDARY_PREF_KEY, false));
  const toggleBoundary = () => {
    setIncludeBoundary((prev) => {
      writeFlag(BOUNDARY_PREF_KEY, !prev);
      return !prev;
    });
  };
  const runExport = (kind: 'artwork' | 'fabrication') => {
    setExportOpen(false);
    onExport(kind, { colourSteps, includeBoundary });
  };
  return (
    <div
      className="h-12 flex items-center px-4 gap-1 shrink-0 relative z-40"
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
        <ToolButton active={activeTool === 'rock'} onClick={() => onToolChange('rock')} title="Rock: a point the Contour terrain reacts to (K)">
          <Mountain size={15} />
        </ToolButton>
      </div>

      <ToolButton onClick={onFitView} title="Fit boundary to view (0)">
        <Maximize size={15} />
      </ToolButton>
      <ToolButton active={cleanView} onClick={onToggleCleanView} title="Lines only: hide boundary, points and guides (H)">
        {cleanView ? <EyeOff size={15} /> : <Eye size={15} />}
      </ToolButton>
      <ToolButton active={libraryOpen} onClick={onToggleLibrary} title="Library: save and load arrangements (L)">
        <Library size={15} />
      </ToolButton>

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

      {rockCount > 0 && (
        <>
          <Divider />
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
            style={{ color: colors.rockNotice, background: colors.rockNoticeBg }}
          >
            <Mountain size={11} />
            <span className="font-medium">{rockCount} rock{rockCount !== 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={onClearRocks}
            title="Clear all rocks"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ color: colors.rockNotice }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = colors.rockNoticeBg;
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

      <div className="relative">
        <button
          onClick={() => setExportOpen((o) => !o)}
          disabled={!hasPath}
          title="Export SVG"
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed"
          style={{
            color: exportOpen ? colors.textPrimary : colors.textMuted,
            border: `1px solid ${colors.borderMedium}`,
            background: exportOpen ? 'rgba(255,255,255,0.05)' : '',
          }}
        >
          <Download size={13} />
          Export SVG
          <ChevronDown size={12} />
        </button>
        {exportOpen && hasPath && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div
              className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl overflow-hidden shadow-2xl"
              style={{
                background: colors.bgHelpPanel,
                backdropFilter: 'blur(24px)',
                border: `1px solid ${colors.borderMedium}`,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              }}
            >
              <div
                className="flex items-center justify-between px-3.5 py-2.5"
                style={{ borderBottom: `1px solid ${colors.borderLight}` }}
              >
                <div>
                  <div className="text-[11px]" style={{ color: colors.textMuted }}>Include boundary outline</div>
                  <div className="text-[10px] mt-0.5" style={{ color: colors.textFaint }}>The shape around the piece, as a thin grey line.</div>
                </div>
                <button
                  onClick={toggleBoundary}
                  role="switch"
                  aria-checked={includeBoundary}
                  title="Include the boundary outline in exported files"
                  className="w-9 h-5 rounded-full relative transition-all duration-200 shrink-0"
                  style={{ background: includeBoundary ? 'rgba(14,201,176,0.9)' : 'rgba(255,255,255,0.1)' }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                    style={{ background: '#fff', left: includeBoundary ? '18px' : '2px' }}
                  />
                </button>
              </div>
              <ExportOption
                title="Artwork"
                detail="Strokes as on screen, with the gradient as coloured stroke pieces."
                onClick={() => runExport('artwork')}
              />
              <div style={{ borderTop: `1px solid ${colors.borderLight}` }} />
              <ExportOption
                title="Fabrication"
                detail="Layers: Outline (the stroke expanded to one filled shape), Centerline (one path per line), and Colour bands when the gradient is on."
                onClick={() => runExport('fabrication')}
              />
              {gradientOn && (
                <div className="px-3.5 pb-3 -mt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px]" style={{ color: colors.textMuted }}>Colour bands</label>
                    <span
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded-md"
                      style={{ color: colors.accent, background: colors.accentBgLight }}
                    >
                      {colourSteps < 2 ? 'Smooth' : colourSteps}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={32}
                    step={1}
                    value={Math.max(1, colourSteps)}
                    onChange={(e) => setColourSteps(Number(e.target.value) < 2 ? 0 : Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="text-[10px] mt-1" style={{ color: colors.textFaint }}>
                    Smooth keeps the gradient as many small flat shapes. A number snaps it to that many colours, one shape per colour, for separate materials or inks.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
