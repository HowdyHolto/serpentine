export interface SeededRandom {
  next(): number;
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
}

export function createSeededRandom(seed: number): SeededRandom {
  let s = seed | 0;

  function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    nextInt(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    nextFloat(min: number, max: number): number {
      return next() * (max - min) + min;
    },
  };
}
