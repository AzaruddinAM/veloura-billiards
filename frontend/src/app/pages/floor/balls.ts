import { TableType } from '../../core/models';

export interface Ball { x: number; y: number; c: string; stripe?: boolean; cue?: boolean; }

const POOL = ['#f2c230', '#2f6fd6', '#d8432f', '#7b3fb8', '#e2742a', '#1c8a4c', '#8b1d2c', '#111'];

/** Seeded PRNG so a table's "scattered" layout is stable between renders. */
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function triangle(colors: { c: string; stripe?: boolean }[], apexX = 68): Ball[] {
  const out: Ball[] = [];
  let i = 0;
  for (let row = 0; row < 5 && i < colors.length; row++) {
    for (let j = 0; j <= row && i < colors.length; j++, i++) {
      out.push({ x: apexX + row * 3.7, y: 50 + (j - row / 2) * 8.6, ...colors[i] });
    }
  }
  return out;
}

export function rackFor(type: TableType): Ball[] {
  if (type === 'carom') {
    return [{ x: 25, y: 40, c: '#f4ecdb', cue: true }, { x: 25, y: 60, c: '#f2c230' }, { x: 75, y: 50, c: '#d8432f' }];
  }
  if (type === 'snooker') {
    const reds = Array.from({ length: 15 }, () => ({ c: '#c8321f' }));
    return [
      ...triangle(reds, 70),
      { x: 88, y: 50, c: '#111' }, { x: 66, y: 50, c: '#e86fa0' }, { x: 50, y: 50, c: '#2f6fd6' },
      { x: 22, y: 50, c: '#7a4a1e' }, { x: 22, y: 34, c: '#1c8a4c' }, { x: 22, y: 66, c: '#f2c230' },
      { x: 16, y: 44, c: '#f4ecdb', cue: true },
    ];
  }
  // 8-ball: 1..7 solids, 8 black, 9..15 stripes — 8 in the middle of the rack
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const balls = order.map((n) => ({ c: POOL[(n - 1) % 8], stripe: n > 8 }));
  return [...triangle(balls), { x: 25, y: 50, c: '#f4ecdb', cue: true }];
}

export function scatterFor(type: TableType, seed: number): Ball[] {
  const r = rng(seed);
  const rack = rackFor(type);
  const keep = type === 'carom' ? rack : rack.filter(() => r() > 0.35);
  return keep.map((b) => ({ ...b, x: 10 + r() * 80, y: 14 + r() * 72 }));
}

export const POCKETS: [number, number][] = [[0, 0], [50, -3], [100, 0], [0, 100], [50, 103], [100, 100]];
