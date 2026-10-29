// Bound full-screen render targets before the first frame, including on Retina displays.
export const MAX_RENDER_PIXELS = 3_000_000;

export function renderPixelRatio(width: number, height: number, devicePixelRatio: number, quality = 1): number {
  const pixels = Math.max(1, width) * Math.max(1, height);
  return Math.min(Math.max(.5, devicePixelRatio), 2, Math.sqrt(MAX_RENDER_PIXELS / pixels)) * quality;
}
