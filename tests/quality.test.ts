import { expect, test } from 'bun:test';
import { MAX_RENDER_PIXELS, renderPixelRatio } from '../src/graphics/quality.ts';

test('large Retina viewports stay inside the render pixel budget', () => {
  for (const [width, height, dpr] of [[1440, 900, 2], [2560, 1440, 2], [3840, 2160, 2]]) {
    const ratio = renderPixelRatio(width, height, dpr);
    expect(width * height * ratio * ratio).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1);
  }
});

test('small screens keep native density and adaptive quality still scales it', () => {
  expect(renderPixelRatio(390, 844, 2)).toBe(2);
  expect(renderPixelRatio(390, 844, 2, .8)).toBe(1.6);
});
