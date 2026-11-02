import { describe, it, expect } from 'vitest';
import { BoundaryShape, DEFAULT_PARAMS } from '../../types';
import { generateSerpentine } from '../serpentineGenerator';
import { renderPaths } from '../pathRenderer';
import {
  createArrangement,
  serializeArrangement,
  parseArrangement,
  loadArrangements,
  storeArrangements,
  ARRANGEMENTS_STORAGE_KEY,
  arrangementFileName,
} from '../arrangements';

const RECT: BoundaryShape = { type: 'rectangle', x: 10, y: 20, width: 300, height: 260 };

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

function sample() {
  const params = { ...DEFAULT_PARAMS, seed: 11, jitter: 0.5, patternMode: 'concentric' as const };
  const result = generateSerpentine(RECT, params);
  return createArrangement('  My piece ', {
    boundary: RECT,
    params,
    guides: [{ x: 50, y: 60, direction: 'up' }],
    rocks: [{ x: 100, y: 100, elevation: 0.5 }],
    waypoints: result.waypoints,
    structure: result.structure,
    frozenIndices: new Set([3, 1]),
  });
}

describe('arrangements', () => {
  it('round-trips through JSON and renders the same paths', () => {
    const a = sample();
    expect(a.name).toBe('My piece');
    expect(a.frozenIndices).toEqual([1, 3]);
    const b = parseArrangement(serializeArrangement(a));
    expect(b).toEqual(a);
    const pa = renderPaths(a.waypoints, a.params);
    const pb = renderPaths(b.waypoints, b.params);
    expect(pb).toEqual(pa);
  });

  it('fills missing settings with defaults and drops bad frozen indices', () => {
    const a = sample();
    const raw = JSON.parse(serializeArrangement(a));
    delete raw.params.jitter;
    delete raw.params.contourScale;
    raw.frozenIndices = [1, 99999, -2, 'x'];
    delete raw.id;
    const b = parseArrangement(JSON.stringify(raw));
    expect(b.params.jitter).toBe(DEFAULT_PARAMS.jitter);
    expect(b.params.contourScale).toBe(DEFAULT_PARAMS.contourScale);
    expect(b.params.seed).toBe(11);
    expect(b.frozenIndices).toEqual([1]);
    expect(b.id).toBeTruthy();
  });

  it('rejects files without a boundary or settings', () => {
    expect(() => parseArrangement('{"name":"x"}')).toThrow(/boundary/);
    expect(() => parseArrangement('{"boundary":{"type":"rectangle","x":0,"y":0,"width":1,"height":1}}')).toThrow(/settings/);
    expect(() => parseArrangement('not json')).toThrow();
  });

  it('stores and loads a list, skipping corrupt entries', () => {
    const storage = new MemoryStorage();
    expect(loadArrangements(storage)).toEqual([]);
    const a = sample();
    expect(storeArrangements([a], storage)).toBe(true);
    expect(loadArrangements(storage)).toEqual([a]);
    storage.setItem(ARRANGEMENTS_STORAGE_KEY, JSON.stringify([a, { junk: true }, 5]));
    expect(loadArrangements(storage)).toEqual([a]);
    storage.setItem(ARRANGEMENTS_STORAGE_KEY, '{{');
    expect(loadArrangements(storage)).toEqual([]);
    expect(loadArrangements(undefined)).toEqual([]);
    expect(storeArrangements([a], undefined)).toBe(false);
  });

  it('names the export file from the arrangement name', () => {
    expect(arrangementFileName(sample())).toBe('serpentine-my-piece.json');
    expect(arrangementFileName({ ...sample(), name: '***' })).toBe('serpentine-arrangement.json');
  });
});
