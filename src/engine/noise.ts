import { createSeededRandom } from './random';

/**
 * Seeded value noise: a smooth, deterministic height field in 0..1 over the
 * plane. Lattice values come from a hash of the integer coordinates and the
 * seed, interpolated with a smoothstep, summed over three octaves so the
 * field has large hills with smaller detail on them. Used by the Contour
 * pattern as its terrain; anything that samples (x, y) -> height would do.
 */
export type NoiseSampler = (x: number, y: number) => number;

function hash2(x: number, y: number, seed: number): number {
  // Integer mix (xorshift-style) folded to 0..1.
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lattice(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/**
 * A sampler whose features are about `scale` units apart. The seed also
 * picks a random offset so two seeds never share a lattice.
 */
export function createValueNoise(seed: number, scale: number, octaves: number = 3): NoiseSampler {
  const rng = createSeededRandom(seed);
  const ox = rng.next() * 1000;
  const oy = rng.next() * 1000;
  const s = Math.max(1e-6, scale);
  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1 / s;
    for (let o = 0; o < octaves; o++) {
      sum += amp * lattice(ox + x * freq, oy + y * freq, seed + o * 7919);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}
