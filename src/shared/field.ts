import { SURFACE, SURFACE_GRID, SURFACE_SLOTS } from './surface.ts';

export type Form = 'silk' | 'orbit' | 'wave' | 'knot' | 'sphere' | 'cube';
export type Palette = 'alpine';
export type FieldSettings = { form: Form; turbulence: number; tension: number; paused: boolean; palette: Palette };
export type Pointer = { x: number; y: number; z: number; active: boolean; down: boolean; index?: number; vx?: number; vy?: number; vz?: number };
export type WheelKick = { delta: number; x: number; y: number; z: number };
export const ROWS = 192;
export const COLUMNS = 40;
export const COUNT = ROWS * COLUMNS;
export const FRAME_HEADER = 3;
export const HZ = 77;
export const DEFAULT_SETTINGS: FieldSettings = { form: 'silk', turbulence: .32, tension: .65, paused: false, palette: 'alpine' };
export const FORMS: Form[] = ['silk', 'orbit', 'wave', 'knot', 'sphere', 'cube'];
export const PALETTES: Palette[] = ['alpine'];
export const IDLE_POINTER: Pointer = { x: 0, y: 0, z: 0, active: false, down: false };

export function normalizeSettings(input: Partial<FieldSettings>, previous = DEFAULT_SETTINGS): FieldSettings {
  const unit = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return {
    form: FORMS.includes(input.form!) ? input.form! : previous.form,
    turbulence: unit(input.turbulence, previous.turbulence),
    tension: unit(input.tension, previous.tension),
    paused: typeof input.paused === 'boolean' ? input.paused : previous.paused,
    palette: PALETTES.includes(input.palette!) ? input.palette! : previous.palette,
  };
}

const surfaceShapes = new Map<Form, Float64Array>();

// Original presentation geometry. No engine source or engine assets are used.
export function writeShape(target: Float32Array, form: Form, time = 0, torsion = 0): void {
  if (isSurface(form)) {
    target.fill(0);
    let base = surfaceShapes.get(form);
    if (!base) {
      base = new Float64Array(SURFACE_SLOTS * 3);
      const middle = (SURFACE_GRID - 1) / 2;
      for (let index = 0; index < SURFACE_SLOTS; index++) {
        const at = index * 3;
        let x = SURFACE.coordinates[at]! / middle, y = SURFACE.coordinates[at + 1]! / middle, z = SURFACE.coordinates[at + 2]! / middle;
        if (form === 'sphere') {
          const xx = x * x, yy = y * y, zz = z * z;
          x *= 1.36 * Math.sqrt(1 - yy / 2 - zz / 2 + yy * zz / 3);
          y *= 1.36 * Math.sqrt(1 - zz / 2 - xx / 2 + zz * xx / 3);
          z *= 1.36 * Math.sqrt(1 - xx / 2 - yy / 2 + xx * yy / 3);
        } else { x *= 1.04; y *= 1.04; z *= 1.04; }
        base[at] = x; base[at + 1] = y; base[at + 2] = z;
      }
      surfaceShapes.set(form, base);
    }
    for (let index = 0; index < SURFACE_SLOTS; index++) {
      const at = index * 3, x = base[at]!, y = base[at + 1]!, z = base[at + 2]!;
      const twist = torsion * y * .8;
      target[at] = x * Math.cos(twist) - z * Math.sin(twist);
      target[at + 1] = y;
      target[at + 2] = x * Math.sin(twist) + z * Math.cos(twist);
    }
    return;
  }
  const tau = Math.PI * 2;
  for (let row = 0; row < ROWS; row++) {
    const u = row / (form === 'wave' ? ROWS - 1 : ROWS) * tau;
    const cu = Math.cos(u), su = Math.sin(u);
    // These values are shared by every column in the row.
    if (form === 'silk' || form === 'knot') {
      const silk = form === 'silk';
      const twist = silk ? u + .2 * Math.sin(time * .17) + torsion * su : u * 2 + torsion * su + .15 * Math.sin(time * .16);
      const widthScale = silk ? .66 + .1 * Math.cos(u * 3 + time * .11) : .24 + .025 * Math.sin(u * 2 + time * .14);
      const radiusBase = silk ? 1.48 : 1.05 + .36 * Math.cos(u * 3);
      const height = silk ? .22 * Math.sin(u * 2 + time * .15) : .5 * Math.sin(u * 3);
      const ct = Math.cos(twist), st = Math.sin(twist);
      const cx = silk ? cu : Math.cos(u * 2), sz = silk ? su : Math.sin(u * 2);
      for (let column = 0; column < COLUMNS; column++) {
        const width = (column / (COLUMNS - 1) * 2 - 1) * widthScale;
        const radius = radiusBase + width * ct, at = (row * COLUMNS + column) * 3;
        target[at] = radius * cx;
        target[at + 1] = silk ? width * st + height : height + width * st;
        target[at + 2] = radius * sz;
      }
    } else if (form === 'orbit') {
      const twist = torsion * su * 1.2, tube = .39 + .06 * Math.sin(u * 3 + time * .2);
      const height = .32 * Math.sin(u * 3 + time * .12), lift = torsion * .12 * Math.sin(u * 2);
      for (let column = 0; column < COLUMNS; column++) {
        const angle = (column / COLUMNS * 2 - 1) * Math.PI + twist;
        const radius = 1.24 + tube * Math.cos(angle), at = (row * COLUMNS + column) * 3;
        target[at] = radius * cu;
        target[at + 1] = tube * Math.sin(angle) + height + lift;
        target[at + 2] = radius * su;
      }
    } else {
      const a = (row / (ROWS - 1) * 2 - 1) * 2.25, twist = torsion * a * .8;
      const ct = Math.cos(twist), st = Math.sin(twist);
      for (let column = 0; column < COLUMNS; column++) {
        const b = (column / (COLUMNS - 1) * 2 - 1) * 1.18, at = (row * COLUMNS + column) * 3;
        const height = .38 * Math.sin(a * 2.1 + b * 1.2 + time * .22) + .17 * Math.cos(b * 3 - a + time * .18);
        target[at] = a;
        target[at + 1] = height * ct - b * st;
        target[at + 2] = height * st + b * ct;
      }
    }
  }
}

export function isSurface(form: Form) { return form === 'sphere' || form === 'cube'; }

export function textureCoordinates(form: Form): Float32Array {
  const uv = new Float32Array(COUNT * 2);
  if (isSurface(form)) uv.set(SURFACE.uv);
  else for (let index = 0; index < COUNT; index++) {
    uv[index * 2] = Math.floor(index / COLUMNS) / (ROWS - 1);
    uv[index * 2 + 1] = (index % COLUMNS) / (COLUMNS - 1);
  }
  return uv;
}

export function pointIndices(form: Form): Uint16Array {
  if (isSurface(form)) return SURFACE.points.slice();
  const indices: number[] = [];
  for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
    indices.push(row * COLUMNS + column);
  }
  return new Uint16Array(indices);
}

export function gridIndex(form: Form, row: number, column: number): number {
  const r = form === 'wave' ? Math.max(0, Math.min(ROWS - 1, row)) : (row + ROWS) % ROWS;
  const c = form === 'orbit' ? (column + COLUMNS) % COLUMNS : Math.max(0, Math.min(COLUMNS - 1, column));
  return r * COLUMNS + c;
}

export function createEdges(form: Form = 'silk'): Uint16Array {
  if (isSurface(form)) return SURFACE.edges.slice();
  const edges: number[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const i = row * COLUMNS + column;
      const nextRow = row + 1 < ROWS || form !== 'wave';
      const nextColumn = column + 1 < COLUMNS || form === 'orbit';
      if (nextRow) edges.push(i, gridIndex(form, row + 1, column));
      if (nextColumn) edges.push(i, gridIndex(form, row, column + 1));
      if (nextRow && nextColumn && (row + column) % 2 === 0) edges.push(i, gridIndex(form, row + 1, column + 1));
    }
  }
  return new Uint16Array(edges);
}
