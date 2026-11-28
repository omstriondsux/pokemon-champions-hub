/**
 * Pixel-art battle arena drawn procedurally at 320×200 and scaled up with sharp pixels,
 * so it shares the pixel grid of the gen-5 sprites. Two palettes: day (light theme) and dusk (dark).
 * Deterministic (seeded) so it looks the same every time.
 */
export const ARENA_W = 320;
export const ARENA_H = 200;
export const HORIZON = 92;
/** Platform ellipses (centre x, centre y, radii), in arena pixels. Sprites stand on these. */
export const PAD_FOE = { x: 228, y: 92, rx: 78, ry: 15 };
export const PAD_ME = { x: 84, y: 192, rx: 108, ry: 26 };

interface Palette {
  sky: string[];
  cloud: [string, string];
  far: string;
  farShade: string;
  hill: string;
  hillShade: string;
  tree: string;
  treeDark: string;
  field: string[];
  tuft: [string, string];
  pad: { top: string; mid: string; rim: string; edge: string; shadow: string };
}

const DAY: Palette = {
  sky: ['#5f9ff0', '#6aa9f3', '#78b4f5', '#88bff7', '#9acaf8', '#acd5fa', '#bfe0fb', '#d2eafc'],
  cloud: ['#ffffff', '#cfe5fa'],
  far: '#9fc3e6',
  farShade: '#8bb4dc',
  hill: '#7cbc78',
  hillShade: '#69a866',
  tree: '#3f8a52',
  treeDark: '#2f6e40',
  field: ['#9ad67a', '#93d074', '#8bc96d', '#84c267', '#7cba61', '#74b25b', '#6caa55', '#64a24f'],
  tuft: ['#b6e48f', '#5e9a4b'],
  pad: { top: '#e6f5c6', mid: '#cfe9a6', rim: '#a9d384', edge: '#7fb562', shadow: '#5f9a4c' },
};
const DUSK: Palette = {
  sky: ['#1d1a3e', '#2a2250', '#3d2a60', '#56346a', '#77406f', '#9c4f6e', '#c4646a', '#e7836a'],
  cloud: ['#f2a58a', '#b8607a'],
  far: '#5b3f6e',
  farShade: '#4c3460',
  hill: '#3b4f5e',
  hillShade: '#324452',
  tree: '#243848',
  treeDark: '#1a2b39',
  field: ['#3f6a55', '#3b654f', '#375f4a', '#335a45', '#2f5440', '#2b4f3b', '#284a37', '#244532'],
  tuft: ['#55836a', '#1f3d2d'],
  pad: { top: '#a9c9a0', mid: '#8fb48a', rim: '#729d74', edge: '#557d5c', shadow: '#3c6047' },
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const cache = new Map<string, string>();

export function arenaDataUrl(theme: 'day' | 'dusk'): string {
  const hit = cache.get(theme);
  if (hit) return hit;
  const P = theme === 'day' ? DAY : DUSK;
  const c = document.createElement('canvas');
  c.width = ARENA_W;
  c.height = ARENA_H;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  const r = rng(theme === 'day' ? 7 : 11);

  // sky: bands with a 2-row checkerboard dither between them
  const band = Math.ceil(HORIZON / P.sky.length);
  for (let y = 0; y < HORIZON; y++) {
    const i = Math.min(P.sky.length - 1, Math.floor(y / band));
    const next = P.sky[Math.min(P.sky.length - 1, i + 1)]!;
    const edge = (y % band) >= band - 2;
    for (let x = 0; x < ARENA_W; x++) px(x, y, edge && (x + y) % 2 === 0 ? next : P.sky[i]!);
  }
  // clouds: stacked rounded blobs with a shaded underside
  const cloud = (cx: number, cy: number, w: number) => {
    const blobs = [
      [0, 0, w * 0.5],
      [-w * 0.35, 3, w * 0.33],
      [w * 0.35, 3, w * 0.36],
      [w * 0.12, -4, w * 0.3],
    ];
    for (const [dx, dy, rad] of blobs) {
      for (let y = -rad!; y <= rad! * 0.55; y++)
        for (let x = -rad!; x <= rad!; x++) {
          if ((x * x) / (rad! * rad!) + (y * y) / ((rad! * 0.55) ** 2) > 1) continue;
          px(Math.round(cx + dx! + x), Math.round(cy + dy! + y), y > rad! * 0.2 ? P.cloud[1] : P.cloud[0]);
        }
    }
  };
  cloud(48, 22, 26);
  cloud(150, 12, 18);
  cloud(262, 30, 30);
  cloud(205, 52, 14);

  // far mountains and nearer hills: summed sines, shaded on one flank
  const ridge = (base: number, amp: number, f: number[], col: string, shade: string, seed: number) => {
    for (let x = 0; x < ARENA_W; x++) {
      const h = Math.round(amp * (0.55 * Math.sin(x * f[0]! + seed) + 0.3 * Math.sin(x * f[1]! + seed * 2) + 0.15 * Math.sin(x * f[2]! + seed * 3)) + amp);
      const h2 = Math.round(amp * (0.55 * Math.sin((x + 1) * f[0]! + seed) + 0.3 * Math.sin((x + 1) * f[1]! + seed * 2) + 0.15 * Math.sin((x + 1) * f[2]! + seed * 3)) + amp);
      for (let y = base - h; y < base; y++) px(x, y, h2 > h ? shade : col);
    }
  };
  ridge(HORIZON, 16, [0.031, 0.083, 0.21], P.far, P.farShade, 1.7);
  ridge(HORIZON, 8, [0.05, 0.13, 0.31], P.hill, P.hillShade, 4.2);
  // tree line: round crowns sitting on the horizon
  for (let x = -4; x < ARENA_W + 4; x += 7 + Math.floor(r() * 4)) {
    const rad = 4 + Math.floor(r() * 3);
    for (let y = -rad; y <= 0; y++)
      for (let dx = -rad; dx <= rad; dx++) if (dx * dx + y * y <= rad * rad) px(x + dx, HORIZON - 1 + y, dx > rad * 0.3 ? P.treeDark : P.tree);
  }

  // field: perspective bands (thin near the horizon, wide near the viewer) + grass tufts
  const rows = ARENA_H - HORIZON;
  for (let y = HORIZON; y < ARENA_H; y++) {
    const t = (y - HORIZON) / rows;
    const i = Math.min(P.field.length - 1, Math.floor(Math.sqrt(t) * P.field.length));
    for (let x = 0; x < ARENA_W; x++) px(x, y, P.field[i]!);
  }
  for (let k = 0; k < 900; k++) {
    const y = HORIZON + 2 + Math.floor(r() ** 0.7 * (rows - 2));
    const x = Math.floor(r() * ARENA_W);
    const big = y > HORIZON + rows * 0.45;
    px(x, y, P.tuft[k % 2]!);
    if (big) px(x, y - 1, P.tuft[k % 2]!);
  }

  // platforms: layered ellipse (top light, mid, rim, dark edge) with a soft shadow below
  const pad = (p: { x: number; y: number; rx: number; ry: number }) => {
    for (let y = -p.ry - 2; y <= p.ry + 4; y++)
      for (let x = -p.rx - 2; x <= p.rx + 2; x++) {
        const d = (x * x) / (p.rx * p.rx) + (y * y) / (p.ry * p.ry);
        const X = p.x + x;
        const Y = p.y + y;
        if (X < 0 || X >= ARENA_W || Y < 0 || Y >= ARENA_H) continue;
        const dShadow = (x * x) / (p.rx * p.rx) + ((y - 3) * (y - 3)) / (p.ry * p.ry);
        if (d > 1) {
          if (dShadow <= 1) px(X, Y, P.pad.shadow);
          continue;
        }
        let col = P.pad.mid;
        if (d > 0.86) col = P.pad.edge;
        else if (d > 0.62) col = y > 0 ? P.pad.rim : P.pad.mid;
        else if (d < 0.28 && y < 0) col = P.pad.top;
        if (d > 0.62 && d <= 0.86 && y < -p.ry * 0.5) col = P.pad.top;
        px(X, Y, col);
      }
  };
  pad(PAD_FOE);
  pad(PAD_ME);

  const url = c.toDataURL('image/png');
  cache.set(theme, url);
  return url;
}
