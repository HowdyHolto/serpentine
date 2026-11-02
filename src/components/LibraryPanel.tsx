import { useRef, useState } from 'react';
import { X, Download, Trash2, Upload, BookmarkPlus } from 'lucide-react';
import { Arrangement } from '../engine/arrangements';
import { Waypoint } from '../types';
import { colors, gradients } from '../theme';

interface LibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  items: Arrangement[];
  canSave: boolean;
  suggestedName: string;
  onSave: (name: string) => void;
  onLoad: (item: Arrangement) => void;
  onDelete: (item: Arrangement) => void;
  onExport: (item: Arrangement) => void;
  onImport: (file: File) => void;
}

/** Polyline runs through the waypoints, split at each new start. */
function runsOf(waypoints: Waypoint[]): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  for (const wp of waypoints) {
    if ((wp.type === 'start' || wp.type === 'segment-start') && cur.length > 0) {
      runs.push(cur.join(' '));
      cur = [];
    }
    cur.push(`${wp.x.toFixed(1)},${wp.y.toFixed(1)}`);
  }
  if (cur.length > 0) runs.push(cur.join(' '));
  return runs;
}

function Thumbnail({ item }: { item: Arrangement }) {
  const b = item.boundary;
  const pad = Math.max(b.width, b.height) * 0.04;
  return (
    <svg
      viewBox={`${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`}
      width={56}
      height={56}
      preserveAspectRatio="xMidYMid meet"
      className="shrink-0 rounded-md"
      style={{ background: colors.canvasBg, border: `1px solid ${colors.borderLight}` }}
    >
      {b.type === 'path' && b.pathData ? (
        <path d={b.pathData} fill="none" stroke={colors.boundaryStroke} strokeWidth={Math.max(b.width, b.height) / 120} />
      ) : b.type === 'ellipse' ? (
        <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} fill="none" stroke={colors.boundaryStroke} strokeWidth={Math.max(b.width, b.height) / 120} />
      ) : (
        <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={colors.boundaryStroke} strokeWidth={Math.max(b.width, b.height) / 120} />
      )}
      {runsOf(item.waypoints).map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={colors.pathStroke}
          strokeWidth={item.params.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function IconButton({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
      style={{ color: danger ? 'rgba(248,113,113,0.6)' : colors.textDim }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
        (e.currentTarget as HTMLButtonElement).style.color = danger ? '#f87171' : colors.textPrimary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '';
        (e.currentTarget as HTMLButtonElement).style.color = danger ? 'rgba(248,113,113,0.6)' : colors.textDim;
      }}
    >
      {children}
    </button>
  );
}

export function LibraryPanel({
  isOpen,
  onClose,
  items,
  canSave,
  suggestedName,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
}: LibraryPanelProps) {
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const submit = () => {
    if (!canSave) return;
    onSave(name.trim() || suggestedName);
    setName('');
  };

  return (
    <div
      className="absolute top-4 left-4 z-30 w-80 rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        background: colors.bgHelpPanel,
        backdropFilter: 'blur(24px)',
        border: `1px solid ${colors.borderMedium}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        maxHeight: 'calc(100% - 2rem)',
      }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: colors.textSecondary }}>
          Library
        </span>
        <button onClick={onClose} style={{ color: colors.textFaint }} className="transition-colors hover:!text-white/70" title="Close (L)">
          <X size={13} />
        </button>
      </div>

      <div className="px-3.5 py-3 space-y-2" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            placeholder={canSave ? suggestedName : 'Draw a boundary first'}
            disabled={!canSave}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              e.stopPropagation();
            }}
            className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-xs focus:outline-none transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${colors.borderInput}`, color: 'rgba(255,255,255,0.8)' }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = colors.accentBorder;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = colors.borderInput;
            }}
          />
          <button
            onClick={submit}
            disabled={!canSave}
            title="Save the current boundary, settings, seed, guides and anchors"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: gradients.accentButton, color: '#001f18' }}
          >
            <BookmarkPlus size={13} />
            Save
          </button>
        </div>
        <div className="text-[10px]" style={{ color: colors.textFaint }}>
          Saves boundary, settings, seed, guides and anchors. Kept in this browser; export to keep a file.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[11px]" style={{ color: colors.textFaint }}>
            No saved arrangements yet.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 px-3.5 py-2 transition-colors"
              style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = '')}
            >
              <button onClick={() => onLoad(item)} title="Load" className="shrink-0">
                <Thumbnail item={item} />
              </button>
              <button onClick={() => onLoad(item)} title="Load" className="flex-1 min-w-0 text-left">
                <div className="text-[11px] font-medium truncate" style={{ color: colors.textPrimary }}>{item.name}</div>
                <div className="text-[10px] truncate" style={{ color: colors.textFaint }}>
                  {item.params.patternMode} · seed {item.params.seed} · {new Date(item.savedAt).toLocaleDateString()}
                </div>
              </button>
              <IconButton title="Export as JSON" onClick={() => onExport(item)}>
                <Download size={13} />
              </IconButton>
              <IconButton title="Delete" onClick={() => onDelete(item)} danger>
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))
        )}
      </div>

      <div className="px-3.5 py-2.5" style={{ borderTop: `1px solid ${colors.borderLight}` }}>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-[11px] transition-colors"
          style={{ color: colors.textMuted }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = colors.textMuted)}
        >
          <Upload size={12} />
          Import JSON
        </button>
      </div>
    </div>
  );
}
