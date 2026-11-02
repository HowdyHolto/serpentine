import {
  BoundaryShape,
  DirectionGuide,
  GenerationParams,
  Rock,
  PathStructure,
  Waypoint,
  DEFAULT_PARAMS,
} from '../types';

/**
 * A saved arrangement: everything needed to bring a design back exactly.
 * Boundary, settings and seed would regenerate the same layout, but
 * hand-dragged anchors and frozen points are not reproducible from the
 * seed, so the waypoints, structure and frozen set are stored too.
 */
export interface Arrangement {
  version: 1;
  id: string;
  name: string;
  /** ISO timestamp. */
  savedAt: string;
  boundary: BoundaryShape;
  params: GenerationParams;
  guides: DirectionGuide[];
  rocks: Rock[];
  waypoints: Waypoint[];
  structure: PathStructure | null;
  frozenIndices: number[];
}

export const ARRANGEMENTS_STORAGE_KEY = 'serpentine.arrangements.v1';

export interface ArrangementState {
  boundary: BoundaryShape;
  params: GenerationParams;
  guides: DirectionGuide[];
  rocks: Rock[];
  waypoints: Waypoint[];
  structure: PathStructure | null;
  frozenIndices: Set<number>;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createArrangement(name: string, state: ArrangementState): Arrangement {
  return {
    version: 1,
    id: newId(),
    name: name.trim() || defaultName(state),
    savedAt: new Date().toISOString(),
    boundary: { ...state.boundary },
    params: { ...state.params },
    guides: state.guides.map((g) => ({ ...g })),
    rocks: state.rocks.map((r) => ({ ...r })),
    waypoints: state.waypoints.map((w) => ({ ...w })),
    structure: state.structure
      ? {
          cellSize: state.structure.cellSize,
          endCapPairs: state.structure.endCapPairs.map((p) => ({ ...p })),
          segments: state.structure.segments.map((s) => ({ ...s })),
        }
      : null,
    frozenIndices: [...state.frozenIndices].sort((a, b) => a - b),
  };
}

export function defaultName(state: { params: GenerationParams; boundary: BoundaryShape }): string {
  const mode = state.params.patternMode;
  return `${mode.charAt(0).toUpperCase()}${mode.slice(1)} ${state.boundary.type} ${state.params.seed}`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate and normalise a parsed arrangement. Unknown params fall back to
 * the defaults so saves from older builds still load; a malformed object
 * throws with a reason.
 */
export function normaliseArrangement(raw: unknown): Arrangement {
  if (!raw || typeof raw !== 'object') throw new Error('Not an arrangement');
  const a = raw as Partial<Arrangement>;
  const b = a.boundary as Partial<BoundaryShape> | undefined;
  if (
    !b ||
    (b.type !== 'rectangle' && b.type !== 'ellipse' && b.type !== 'path') ||
    !isFiniteNumber(b.x) || !isFiniteNumber(b.y) || !isFiniteNumber(b.width) || !isFiniteNumber(b.height)
  ) {
    throw new Error('Arrangement has no valid boundary');
  }
  if (!a.params || typeof a.params !== 'object') throw new Error('Arrangement has no settings');
  const waypoints = Array.isArray(a.waypoints) ? a.waypoints : [];
  for (const w of waypoints) {
    if (!w || !isFiniteNumber(w.x) || !isFiniteNumber(w.y)) throw new Error('Arrangement has a bad waypoint');
  }
  const guides = Array.isArray(a.guides) ? a.guides.filter((g) => g && isFiniteNumber(g.x) && isFiniteNumber(g.y)) : [];
  const rocks = Array.isArray(a.rocks)
    ? a.rocks
        .filter((r) => r && isFiniteNumber(r.x) && isFiniteNumber(r.y))
        .map((r) => ({ x: r.x, y: r.y, elevation: isFiniteNumber(r.elevation) ? Math.max(-1, Math.min(1, r.elevation)) : 1 }))
    : [];
  const frozen = Array.isArray(a.frozenIndices)
    ? a.frozenIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < waypoints.length)
    : [];
  const structure = a.structure && typeof a.structure === 'object' ? (a.structure as PathStructure) : null;
  return {
    version: 1,
    id: typeof a.id === 'string' && a.id ? a.id : newId(),
    name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : 'Imported arrangement',
    savedAt: typeof a.savedAt === 'string' ? a.savedAt : new Date().toISOString(),
    boundary: b as BoundaryShape,
    params: {
      ...DEFAULT_PARAMS,
      ...(a.params as Partial<GenerationParams>),
      // Saves from before the Style layer have no `style`; later ones may lack new keys.
      style: { ...DEFAULT_PARAMS.style, ...((a.params as Partial<GenerationParams>).style ?? {}) },
    },
    guides,
    rocks,
    waypoints,
    structure,
    frozenIndices: frozen,
  };
}

export function loadArrangements(storage: Storage | undefined = safeStorage()): Arrangement[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARRANGEMENTS_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: Arrangement[] = [];
    for (const item of list) {
      try {
        out.push(normaliseArrangement(item));
      } catch {
        // Skip a corrupt entry rather than losing the rest.
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the list. Returns false when storage is unavailable or full. */
export function storeArrangements(list: Arrangement[], storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ARRANGEMENTS_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function serializeArrangement(a: Arrangement): string {
  return JSON.stringify(a, null, 2);
}

export function parseArrangement(json: string): Arrangement {
  return normaliseArrangement(JSON.parse(json));
}

export function arrangementFileName(a: Arrangement): string {
  const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'arrangement';
  return `serpentine-${slug}.json`;
}

export function downloadArrangement(a: Arrangement): void {
  const blob = new Blob([serializeArrangement(a)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = arrangementFileName(a);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
