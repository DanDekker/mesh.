import { describe, expect, test } from 'bun:test';
import { Simulation } from '../src/physics/simulation.ts';
import { COUNT, ROWS, COLUMNS, FORMS, HZ, createEdges, pointIndices, normalizeSettings, writeShape } from '../src/shared/field.ts';
import { SURFACE_GRID, SURFACE_SLOTS } from '../src/shared/surface.ts';

describe('field geometry', () => {
  test('all forms fit the same valid topology', () => {
    const edges = createEdges();
    expect(edges.length % 2).toBe(0);
    for (const index of edges) expect(index).toBeLessThan(COUNT);
    for (const form of FORMS) {
      const positions = new Float32Array(COUNT * 3); writeShape(positions, form);
      expect(positions.every(value => Number.isFinite(value) && Math.abs(value) < 3)).toBe(true);
    }
  });

  test('settings reject invalid values without losing prior state', () => {
    expect(normalizeSettings({ turbulence: Infinity, tension: -4, form: 'unknown' as never })).toMatchObject({ turbulence: .32, tension: 0, form: 'silk' });
  });

  test('sphere and cube retain their exact undeformed surfaces', () => {
    const positions = new Float32Array(COUNT * 3);
    for (const form of ['sphere', 'cube'] as const) {
      writeShape(positions, form);
      let error = 0;
      for (const index of pointIndices(form)) {
        const x = positions[index * 3]!, y = positions[index * 3 + 1]!, z = positions[index * 3 + 2]!;
        if (form === 'sphere') error = Math.max(error, Math.abs(Math.hypot(x, y, z) - 1.36));
        if (form === 'cube') error = Math.max(error, Math.abs(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 1.04));
      }
      expect(error).toBeLessThan(.000001);
    }
  });

  test('sphere and cube have welded faces without crowded poles or disconnected edges', () => {
    expect(SURFACE_SLOTS).toBeLessThanOrEqual(COUNT);
    for (const form of ['sphere', 'cube'] as const) {
      const points = pointIndices(form), active = new Set(points), edges = createEdges(form);
      const positions = new Float32Array(COUNT * 3); writeShape(positions, form);
      const connections = new Set<number>(), neighbors = new Map<number, number[]>();
      const coordinates = new Set<string>();
      expect(points.length).toBe(6 * (SURFACE_GRID - 1) ** 2 + 2);
      for (const index of points) coordinates.add(Array.from(positions.subarray(index * 3, index * 3 + 3)).join(','));
      expect(coordinates.size).toBe(points.length);
      let shortest = Infinity, longest = 0;
      for (let edge = 0; edge < edges.length; edge += 2) {
        const a = edges[edge]!, b = edges[edge + 1]!;
        expect(active.has(a) && active.has(b)).toBe(true); expect(a).not.toBe(b);
        const key = Math.min(a, b) * COUNT + Math.max(a, b);
        expect(connections.has(key)).toBe(false); connections.add(key);
        if (!neighbors.has(a)) neighbors.set(a, []);
        if (!neighbors.has(b)) neighbors.set(b, []);
        neighbors.get(a)!.push(b); neighbors.get(b)!.push(a);
        const length = Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
        shortest = Math.min(shortest, length); longest = Math.max(longest, length);
      }
      expect(shortest).toBeGreaterThan(.04); expect(longest / shortest).toBeLessThan(2.1);
      expect(Math.max(...Array.from(neighbors.values(), list => list.length))).toBeLessThanOrEqual(8);
      const visited = new Set<number>(), queue = [points[0]!];
      while (queue.length) {
        const index = queue.pop()!;
        if (visited.has(index)) continue;
        visited.add(index); queue.push(...neighbors.get(index)!);
      }
      expect(visited.size).toBe(active.size);
    }
  });

  test('closed forms share their seam vertices without a gap or long closing edge', () => {
    for (const form of ['silk', 'orbit', 'knot'] as const) {
      const positions = new Float32Array(COUNT * 3), edges = createEdges(form);
      for (const time of [0, 4, 17, 60]) {
        writeShape(positions, form, time);
        for (let column = 0; column < COLUMNS; column++) {
          const a = (ROWS - 1) * COLUMNS + column, b = column;
          let joined = false;
          for (let e = 0; e < edges.length; e += 2) if (edges[e] === a && edges[e + 1] === b) joined = true;
          expect(joined).toBe(true);
          expect(Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!)).toBeLessThan(.15);
        }
      }
      if (form === 'orbit') {
        for (let row = 0; row < ROWS; row++) {
          const a = row * COLUMNS + COLUMNS - 1, b = row * COLUMNS;
          let joined = false;
          for (let e = 0; e < edges.length; e += 2) if (edges[e] === a && edges[e + 1] === b) joined = true;
          expect(joined).toBe(true);
        }
      }
    }
  });
});

describe('standalone simulation', () => {
  test('motion is deterministic and pause preserves state', () => {
    const a = new Simulation(), b = new Simulation();
    for (let i = 0; i < 20; i++) { a.step(); b.step(); }
    expect(a.positions).toEqual(b.positions);
    const before = a.positions.slice(), time = a.time;
    a.configure({ paused: true }); a.step();
    expect(a.positions).toEqual(before); expect(a.time).toBe(time);
  });

  test('switching form while paused updates the sculpture and keeps it paused', () => {
    const simulation = new Simulation({ paused: true });
    simulation.configure({ form: 'orbit' });
    const expected = new Float32Array(COUNT * 3); writeShape(expected, 'orbit');
    expect(simulation.positions).toEqual(expected);
    expect(simulation.settings.paused).toBe(true);
  });

  test('switching shapes clears old folds and twist without resetting the clock', () => {
    const simulation = new Simulation({ turbulence: 0 });
    for (const form of ['sphere', 'cube'] as const) {
      simulation.swirl({ delta: .35, x: 0, y: 1, z: 0 });
      simulation.pulse(.8, .2, 0);
      for (let tick = 0; tick < HZ; tick++) simulation.step();
      const time = simulation.time;
      simulation.configure({ form });
      expect(simulation.time).toBe(time); expect(simulation.torsion).toBe(0);
      expect(simulation.velocities.every(value => value === 0)).toBe(true);
      const expected = new Float32Array(COUNT * 3); writeShape(expected, form, time);
      expect(simulation.positions).toEqual(expected);
      for (let tick = 0; tick < HZ * 2; tick++) simulation.step();
      let error = 0;
      for (const index of pointIndices(form)) for (let axis = 0; axis < 3; axis++) error = Math.max(error, Math.abs(simulation.positions[index * 3 + axis]! - expected[index * 3 + axis]!));
      expect(error).toBeLessThan(.0001);
    }
  });

  test('pointer impulses move the mesh and reset restores it', () => {
    const a = new Simulation(), b = new Simulation();
    a.pulse(1.3, .1, .1);
    for (let i = 0; i < 25; i++) { a.step(); b.step(); }
    let difference = 0;
    for (let i = 0; i < a.positions.length; i++) difference += Math.abs(a.positions[i]! - b.positions[i]!);
    expect(difference).toBeGreaterThan(.5);
    a.reset(); b.reset(); expect(a.positions).toEqual(b.positions);
  });

  test('pulling follows the picked surface and relaxes after release', () => {
    const simulation = new Simulation({ turbulence: 0 });
    const index = COLUMNS * 28 + 20, at = index * 3;
    const initial = { x: simulation.positions[at]!, y: simulation.positions[at + 1]!, z: simulation.positions[at + 2]! };
    simulation.pointer = { x: initial.x + .55, y: initial.y + .3, z: initial.z, index, active: true, down: true };
    for (let tick = 0; tick < HZ; tick++) simulation.step();
    const pulled = Math.hypot(simulation.positions[at]! - simulation.anchors[at]!, simulation.positions[at + 1]! - simulation.anchors[at + 1]!, simulation.positions[at + 2]! - simulation.anchors[at + 2]!);
    expect(pulled).toBeGreaterThan(.15);
    simulation.pointer = { x: 0, y: 0, z: 0, active: false, down: false };
    for (let tick = 0; tick < HZ * 2; tick++) simulation.step();
    const released = Math.hypot(simulation.positions[at]! - simulation.anchors[at]!, simulation.positions[at + 1]! - simulation.anchors[at + 1]!, simulation.positions[at + 2]! - simulation.anchors[at + 2]!);
    expect(released).toBeLessThan(pulled * .5);
  });

  test('wheel impulses apply angular momentum and remain bounded', () => {
    const simulation = new Simulation({ turbulence: 0 });
    simulation.swirl({ delta: .35, x: 0, y: 1, z: 0 });
    let momentum = 0;
    for (let i = 0; i < COUNT; i++) momentum += simulation.positions[i * 3 + 2]! * simulation.velocities[i * 3]! - simulation.positions[i * 3]! * simulation.velocities[i * 3 + 2]!;
    expect(momentum).toBeGreaterThan(1);
    for (let tick = 0; tick < 6; tick++) simulation.step();
    expect(simulation.torsion).toBeGreaterThan(.3);
    expect(simulation.positions.every(value => Number.isFinite(value) && Math.abs(value) < 5)).toBe(true);
  });

  test('scrolling in opposite directions winds and unwinds the surface', () => {
    const simulation = new Simulation({ turbulence: 0 });
    simulation.swirl({ delta: .35, x: 0, y: 1, z: 0 });
    for (let tick = 0; tick < 15; tick++) simulation.step();
    const wound = simulation.torsion;
    simulation.swirl({ delta: -.35, x: 0, y: 1, z: 0 });
    for (let tick = 0; tick < 12; tick++) simulation.step();
    expect(simulation.torsion).toBeLessThan(wound * .5);
  });

  test('wheel movement is immediate and settles instead of slowly winding up', () => {
    const wound = new Simulation({ turbulence: 0 }), idle = new Simulation({ turbulence: 0 });
    wound.swirl({ delta: .35, x: 0, y: 1, z: 0 });
    const difference = () => {
      let sum = 0;
      for (let i = 0; i < wound.positions.length; i++) sum += (wound.positions[i]! - idle.positions[i]!) ** 2;
      return Math.sqrt(sum / COUNT);
    };
    for (let tick = 0; tick < 6; tick++) { wound.step(); idle.step(); }
    expect(difference()).toBeGreaterThan(.05);
    for (let tick = 6; tick < HZ * 3; tick++) { wound.step(); idle.step(); }
    expect(difference()).toBeLessThan(.025);
  });

  test('rapid wheel bursts stay bounded on ribbons and solid shapes', () => {
    for (const form of ['silk', 'sphere', 'cube'] as const) {
      const simulation = new Simulation({ form, turbulence: 0 });
      for (let tick = 0; tick < HZ; tick++) {
        if (tick < 20) for (let event = 0; event < 4; event++) simulation.swirl({ delta: .55, x: 0, y: 1, z: 0 });
        simulation.step();
        expect(simulation.positions.every(value => Number.isFinite(value) && Math.abs(value) < 5)).toBe(true);
        expect(Math.abs(simulation.torsion)).toBeLessThanOrEqual(2.4);
      }
    }
  });

  test('a fast-moving pointer brushes the surface along its path', () => {
    const brushed = new Simulation({ turbulence: 0 }), still = new Simulation({ turbulence: 0 });
    const index = COLUMNS * 28 + 20, at = index * 3;
    const origin = { x: brushed.positions[at]!, y: brushed.positions[at + 1]!, z: brushed.positions[at + 2]! };
    brushed.pointer = { ...origin, active: true, down: false, vx: 5, vy: 0, vz: 0 };
    still.pointer = { ...origin, active: true, down: false };
    for (let tick = 0; tick < 20; tick++) { brushed.step(); still.step(); }
    let momentum = 0;
    for (let i = 0; i < COUNT; i++) momentum += brushed.velocities[i * 3]! - still.velocities[i * 3]!;
    expect(momentum).toBeGreaterThan(1);
    expect(brushed.pointer.vx!).toBeLessThan(5);
  });

  test('flinging throws the grabbed patch and settles back', () => {
    const simulation = new Simulation({ turbulence: 0 });
    const index = COLUMNS * 28 + 20, at = index * 3;
    simulation.fling(index, 6, 0, 0);
    expect(simulation.velocities[at]!).toBeGreaterThan(3);
    const far = (index + COUNT / 2) % COUNT;
    expect(Math.abs(simulation.velocities[far * 3]!)).toBeLessThan(.05);
    for (let tick = 0; tick < 12; tick++) simulation.step();
    const thrown = Math.hypot(simulation.positions[at]! - simulation.anchors[at]!, simulation.positions[at + 1]! - simulation.anchors[at + 1]!, simulation.positions[at + 2]! - simulation.anchors[at + 2]!);
    expect(thrown).toBeGreaterThan(.05);
    for (let tick = 0; tick < HZ * 2; tick++) simulation.step();
    const settled = Math.hypot(simulation.positions[at]! - simulation.anchors[at]!, simulation.positions[at + 1]! - simulation.anchors[at + 1]!, simulation.positions[at + 2]! - simulation.anchors[at + 2]!);
    expect(settled).toBeLessThan(thrown * .5);
  });

  test('flinging rejects invalid input and negligible speed', () => {
    const simulation = new Simulation({ turbulence: 0 });
    simulation.fling(-1, 5, 0, 0);
    simulation.fling(10, Number.NaN, 0, 0);
    simulation.fling(10, .1, 0, 0);
    expect(simulation.velocities.every(value => value === 0)).toBe(true);
  });

  test('a charged pulse ripples harder than a tap and stays bounded', () => {
    const displacement = (force: number) => {
      const simulation = new Simulation({ turbulence: 0 });
      simulation.pulse(1.3, .1, .1, force);
      for (let tick = 0; tick < 18; tick++) simulation.step();
      let total = 0;
      for (let i = 0; i < COUNT; i++) total += Math.abs(simulation.positions[i * 3]! - simulation.anchors[i * 3]!);
      expect(simulation.positions.every(value => Number.isFinite(value) && Math.abs(value) < 5)).toBe(true);
      return total;
    };
    expect(displacement(2)).toBeGreaterThan(displacement(.5) * 1.5);
    expect(displacement(99)).toBeLessThanOrEqual(displacement(2) * 1.01);
  });

  test('strong forces and form changes remain bounded', () => {
    const simulation = new Simulation({ turbulence: 1, tension: 1 });
    for (const form of FORMS) {
      simulation.configure({ form });
      simulation.pointer = { x: .7, y: .3, z: .1, active: true, down: true };
      simulation.pulse(.7, .3, .1, 2);
      for (let i = 0; i < HZ; i++) simulation.step();
      expect(simulation.positions.every(value => Number.isFinite(value) && Math.abs(value) < 5)).toBe(true);
    }
  });
});
