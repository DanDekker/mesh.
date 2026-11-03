import { expect, test } from 'bun:test';
import { COUNT, writeShape } from '../src/shared/field.ts';

test('surface caches survive output mutation and alternating forms and twists', () => {
  const target = new Float32Array(COUNT * 3);
  for (const form of ['sphere', 'cube'] as const) {
    writeShape(target, form);
    const resting = target.slice();
    writeShape(target, form, 30, 1.2);
    expect(target).not.toEqual(resting);
    target.fill(99);
    writeShape(target, form === 'sphere' ? 'cube' : 'sphere', 40, -.7);
    writeShape(target, form, 70);
    expect(target).toEqual(resting);
  }
});
