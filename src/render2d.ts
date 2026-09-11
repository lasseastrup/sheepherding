import { SNAP_HEADER, SNAP_STRIDE, SheepState } from './sim';

export interface RenderOptions {
  worldWidth: number;
  worldHeight: number;
  showLinks: boolean;
  showHeadings: boolean;
  pointer?: { x: number; y: number } | null;
}

const STATE_COLOURS: Record<number, string> = {
  [SheepState.Graze]: '#f2efe6',
  [SheepState.Alert]: '#ffd166',
  [SheepState.Walk]: '#8ecae6',
  [SheepState.Run]: '#ef476f',
  [SheepState.Rest]: '#bdbdbd',
};

/** Draw an interpolated snapshot pair onto a 2D canvas. */
export function render2d(
  ctx: CanvasRenderingContext2D,
  prev: Float32Array | null,
  cur: Float32Array,
  alpha: number,
  opts: RenderOptions,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const scale = Math.min(W / opts.worldWidth, H / opts.worldHeight);
  const ox = (W - opts.worldWidth * scale) / 2;
  const oy = (H - opts.worldHeight * scale) / 2;
  const n = cur[0] | 0;

  ctx.clearRect(0, 0, W, H);
  // paddock
  ctx.fillStyle = '#3f7a45';
  ctx.fillRect(ox, oy, opts.worldWidth * scale, opts.worldHeight * scale);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, opts.worldWidth * scale, opts.worldHeight * scale);

  const sx = (x: number) => ox + x * scale;
  const sy = (y: number) => oy + y * scale;
  const lerpAngle = (a: number, b: number, t: number) => {
    let d = b - a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return a + d * t;
  };

  const usePrev = prev && (prev[0] | 0) === n;

  // leader links
  if (opts.showLinks) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const o = SNAP_HEADER + i * SNAP_STRIDE;
      const L = cur[o + 7] | 0;
      if (L < 0 || L >= n) continue;
      const lo = SNAP_HEADER + L * SNAP_STRIDE;
      ctx.moveTo(sx(cur[o]), sy(cur[o + 1]));
      ctx.lineTo(sx(cur[lo]), sy(cur[lo + 1]));
    }
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const o = SNAP_HEADER + i * SNAP_STRIDE;
    let x = cur[o];
    let y = cur[o + 1];
    let h = cur[o + 2];
    if (usePrev) {
      x = prev![o] + (x - prev![o]) * alpha;
      y = prev![o + 1] + (y - prev![o + 1]) * alpha;
      h = lerpAngle(prev![o + 2], h, alpha);
    }
    const state = cur[o + 4] | 0;
    const s = cur[o + 6] * scale;
    const px = sx(x);
    const py = sy(y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px + s * 0.08, py + s * 0.1, s * 0.5, s * 0.28, h, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = STATE_COLOURS[state] ?? '#fff';
    ctx.beginPath();
    ctx.ellipse(px, py, s * 0.5, s * 0.27, h, 0, Math.PI * 2);
    ctx.fill();
    // head
    const hx = px + Math.cos(h) * s * 0.5;
    const hy = py + Math.sin(h) * s * 0.5;
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(hx, hy, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    if (opts.showHeadings) {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(h) * s * 0.9, py + Math.sin(h) * s * 0.9);
      ctx.stroke();
    }
  }

  if (opts.pointer) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(opts.pointer.x), sy(opts.pointer.y), scale * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function screenToWorld(px: number, py: number, canvasW: number, canvasH: number, worldW: number, worldH: number): { x: number; y: number } {
  const scale = Math.min(canvasW / worldW, canvasH / worldH);
  const ox = (canvasW - worldW * scale) / 2;
  const oy = (canvasH - worldH * scale) / 2;
  return { x: (px - ox) / scale, y: (py - oy) / scale };
}
