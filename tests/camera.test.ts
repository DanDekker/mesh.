import { expect, test } from 'bun:test';
import { fit, project, unproject } from '../src/graphics/camera.ts';
import { FieldCamera } from '../src/graphics/field-camera.ts';
import { SurfaceGrab } from '../src/graphics/grab.ts';
import { COUNT, FORMS, writeShape } from '../src/shared/field.ts';

test('picking projects back to the same surface depth', () => {
  for (const aspect of [.46, 1, 1.6, 2.4]) {
    const view = { rotation: [.86, 1.2, -.31], scale: .48, aspect, center: [.12, -.07] };
    for (const point of [{ x: 1.2, y: .4, z: -.6 }, { x: -.7, y: -.3, z: .9 }]) {
      const screen = project(point, view), restored = unproject(screen.x, screen.y, screen.z, view);
      expect(restored.x).toBeCloseTo(point.x, 9); expect(restored.y).toBeCloseTo(point.y, 9); expect(restored.z).toBeCloseTo(point.z, 9);
    }
  }
});

test('the sculpture stays inside the frame on portrait and wide viewports', () => {
  const positions = new Float32Array(COUNT * 3);
  for (const aspect of [390 / 844, 1, 1440 / 900, 2.4]) {
    for (const form of FORMS) {
      for (const time of [0, 30, 70]) {
        writeShape(positions, form, time);
        const rotation = [.86 + Math.sin(time * .055) * .17, .12 + time * .045, -.31 + Math.sin(time * .04) * .13];
        const framing = fit(positions, rotation, aspect), view = { ...framing, rotation, aspect };
        let maxX = 0, maxY = 0;
        for (let i = 0; i < COUNT; i++) {
          const p = project({ x: positions[i * 3]!, y: positions[i * 3 + 1]!, z: positions[i * 3 + 2]! }, view);
          maxX = Math.max(maxX, Math.abs(p.x)); maxY = Math.max(maxY, Math.abs(p.y));
        }
        expect(maxX).toBeLessThan(.9); expect(maxY).toBeLessThan(.8);
      }
    }
  }
});

test('sampled fitting still keeps every point inside the frame', () => {
  const positions = new Float32Array(COUNT * 3);
  for (const aspect of [390 / 844, 1, 1440 / 900, 2.4]) {
    for (const form of FORMS) {
      for (const time of [0, 30, 70]) {
        writeShape(positions, form, time);
        const rotation = [.86 + Math.sin(time * .055) * .17, .12 + time * .045, -.31 + Math.sin(time * .04) * .13];
        const framing = fit(positions, rotation, aspect, 3), view = { ...framing, rotation, aspect };
        let maxX = 0, maxY = 0;
        for (let i = 0; i < COUNT; i++) {
          const p = project({ x: positions[i * 3]!, y: positions[i * 3 + 1]!, z: positions[i * 3 + 2]! }, view);
          maxX = Math.max(maxX, Math.abs(p.x)); maxY = Math.max(maxY, Math.abs(p.y));
        }
        expect(maxX).toBeLessThan(.92); expect(maxY).toBeLessThan(.82);
      }
    }
  }
});

test('dragging preserves the initial cursor offset without a jump or accumulated drift', () => {
  for (const aspect of [.46, 1, 1.6, 2.4]) {
    const viewport = { left: 30, top: 70, width: 900 * aspect, height: 900 };
    const view = { rotation: [.86, 1.2, -.31], scale: .48, aspect, center: [.12, -.07] };
    const point = { x: 1.2, y: .4, z: -.6 }, screen = project(point, view);
    const x = viewport.left + (screen.x + 1) * viewport.width / 2 + 23;
    const y = viewport.top + (1 - screen.y) * viewport.height / 2 - 17;
    const grab = new SurfaceGrab(point, 142, x, y, view, viewport);
    for (const [dx, dy] of [[0, 0], [1, -2], [400, -260], [-120, 30], [0, 0]]) {
      const target = grab.move(x + dx!, y + dy!), moved = project(target, view);
      expect((moved.x - screen.x) * viewport.width / 2).toBeCloseTo(dx!, 8);
      expect((screen.y - moved.y) * viewport.height / 2).toBeCloseTo(dy!, 8);
      expect(moved.z).toBeCloseTo(screen.z, 9);
      expect(target.index).toBe(142);
    }
  }
});

test('a grab keeps its captured projection even if the live view changes', () => {
  const view = { rotation: [.86, .12, -.31], scale: .48, aspect: 1.6, center: [.12, -.07] };
  const grab = new SurfaceGrab({ x: 1, y: .3, z: .1 }, 22, 640, 400, view, { left: 0, top: 0, width: 1440, height: 900 });
  const target = grab.move(750, 420);
  view.rotation[1] = 1.8; view.center[0] = -.1; view.scale = .8;
  expect(grab.move(750, 420)).toEqual(target);
});

test('dragging holds the camera and release frames the resting surface', () => {
  const camera = new FieldCamera(); camera.resize(1.6); camera.update('cube', 0, 1 / 60, false);
  const before = structuredClone(camera.view), stretched = camera.reference.slice();
  for (let index = 0; index < COUNT; index++) if (stretched[index * 3]! > 1) stretched[index * 3] += 2;
  // This deformation used to pull the automatic framing along with it.
  const oldFraming = fit(stretched, before.rotation, before.aspect);
  expect(Math.abs(oldFraming.center[0]! - before.center[0]!)).toBeGreaterThan(.1);
  for (let frame = 1; frame <= 120; frame++) camera.update('cube', frame / 60, 1 / 60, true);
  expect(camera.view).toEqual(before);
  camera.update('cube', 121 / 60, 1 / 60, false);
  expect(Math.abs(camera.view.center[0]! - before.center[0]!)).toBeLessThan(.001);
  expect(Math.abs(camera.view.scale - before.scale)).toBeLessThan(.001);
});
