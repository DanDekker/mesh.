import { COUNT, ROWS, COLUMNS, HZ, DEFAULT_SETTINGS, IDLE_POINTER, normalizeSettings, writeShape, createEdges, isSurface, type FieldSettings, type Pointer, type WheelKick } from '../shared/field.ts';
import { WheelMotion } from '../shared/wheel.ts';

// Standalone, original browser fallback. It is independent of the optional
// proprietary server provider. Standard mass/spring projection only.
export class Simulation {
  readonly positions = new Float32Array(COUNT * 3);
  readonly velocities = new Float32Array(COUNT * 3);
  readonly anchors = new Float32Array(COUNT * 3);
  readonly desired = new Float32Array(COUNT * 3);
  readonly previous = new Float32Array(COUNT * 3);
  edges = createEdges();
  lengths = new Float32Array(this.edges.length / 2);
  settings: FieldSettings = { ...DEFAULT_SETTINGS };
  pointer: Pointer = { ...IDLE_POINTER };
  time = 0;
  ticks = 0;
  private wheel = new WheelMotion();
  get torsion() { return this.wheel.amount; }
  private pulses: { x: number; y: number; z: number; age: number; force: number }[] = [];
  private rowTwist = new Float32Array(ROWS);

  constructor(settings?: Partial<FieldSettings>) {
    for (let row = 0; row < ROWS; row++) this.rowTwist[row] = .25 + .75 * Math.sin(row / ROWS * Math.PI * 2);
    this.configure(settings ?? {});
    this.reset();
  }

  configure(settings: Partial<FieldSettings>) {
    const previousForm = this.settings.form;
    this.settings = normalizeSettings(settings, this.settings);
    if (previousForm !== this.settings.form) {
      this.edges = createEdges(this.settings.form);
      this.lengths = new Float32Array(this.edges.length / 2);
      this.reset(false);
    }
  }

  reset(restartClock = true) {
    if (restartClock) { this.time = 0; this.ticks = 0; }
    this.wheel.reset();
    this.pulses.length = 0;
    writeShape(this.positions, this.settings.form, this.time);
    this.anchors.set(this.positions);
    this.desired.set(this.positions);
    this.velocities.fill(0);
    this.updateLengths();
  }

  pulse(x: number, y: number, z: number, force = 1) {
    if (![x, y, z, force].every(Number.isFinite)) return;
    if (this.pulses.length >= 6) this.pulses.shift();
    this.pulses.push({ x, y, z, age: 0, force: Math.max(0, Math.min(2, force)) });
  }

  swirl(kick: WheelKick) {
    if (![kick.delta, kick.x, kick.y, kick.z].every(Number.isFinite)) return;
    const strength = this.wheel.kick(kick.delta) * 2.8;
    for (let i = 0; i < COUNT; i++) {
      const at = i * 3, x = this.positions[at]!, y = this.positions[at + 1]!, z = this.positions[at + 2]!;
      const twist = this.rowTwist[Math.floor(i / COLUMNS)]!;
      this.velocities[at] += (kick.y * z - kick.z * y) * strength * twist;
      this.velocities[at + 1] += (kick.z * x - kick.x * z) * strength * twist;
      this.velocities[at + 2] += (kick.x * y - kick.y * x) * strength * twist;
    }
  }

  private updateLengths() {
    const p = this.anchors, edges = this.edges, lengths = this.lengths;
    for (let e = 0; e < lengths.length; e++) {
      const a = edges[e * 2]! * 3, b = edges[e * 2 + 1]! * 3;
      const dx = p[a]! - p[b]!, dy = p[a + 1]! - p[b + 1]!, dz = p[a + 2]! - p[b + 2]!;
      lengths[e] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  step() {
    if (this.settings.paused) return;
    const dt = 1 / HZ, p = this.positions, velocity = this.velocities;
    const { turbulence, tension } = this.settings;
    this.time += dt;
    this.ticks++;
    this.wheel.step(dt);
    writeShape(this.desired, this.settings.form, this.time, this.torsion);
    const follow = 1 - Math.exp(-dt * this.wheel.followRate);
    for (let i = 0; i < p.length; i++) this.anchors[i] += (this.desired[i]! - this.anchors[i]!) * follow;
    this.updateLengths();
    this.previous.set(p);
    const t = this.time * .34;
    const restore = 9 + tension * 14;
    const damping = Math.exp(-(1.5 + tension * 1.1) * dt);
    const pointer = this.pointer, form = this.settings.form, surface = isSurface(form);
    const grabbed = pointer.index ?? -1;
    const grabbing = pointer.down && grabbed >= 0 && grabbed < COUNT;
    const grabAnchor = grabbed * 3, grabRow = Math.floor(grabbed / COLUMNS), grabColumn = grabbed % COLUMNS;
    const pullX = grabbing ? pointer.x - this.anchors[grabAnchor]! : 0;
    const pullY = grabbing ? pointer.y - this.anchors[grabAnchor + 1]! : 0;
    const pullZ = grabbing ? pointer.z - this.anchors[grabAnchor + 2]! : 0;
    const pulses = this.pulses, pulseRadius = pulses.map(pulse => pulse.age * 2.9);
    const pulseAmplitude = pulses.map(pulse => Math.exp(-pulse.age * 2.2) * pulse.force * 33);
    for (let i = 0; i < COUNT; i++) {
      const a = i * 3, x = p[a]!, y = p[a + 1]!, z = p[a + 2]!;
      let fx = (this.anchors[a]! - x) * restore + (Math.sin(y * 2.3 + t) + Math.cos(z * 1.7 - t * .7)) * turbulence * .65;
      let fy = (this.anchors[a + 1]! - y) * restore + (Math.sin(z * 2.1 + t * .8) - Math.cos(x * 1.8 + t)) * turbulence * .65;
      let fz = (this.anchors[a + 2]! - z) * restore + (Math.sin(x * 1.9 - t) + Math.cos(y * 2 + t * .5)) * turbulence * .65;
      if (grabbing) {
        let distance: number;
        if (surface) {
          const ex = this.anchors[a]! - this.anchors[grabAnchor]!, ey = this.anchors[a + 1]! - this.anchors[grabAnchor + 1]!, ez = this.anchors[a + 2]! - this.anchors[grabAnchor + 2]!;
          distance = (ex * ex + ey * ey + ez * ez) / .14;
        } else {
          let dr = Math.abs(Math.floor(i / COLUMNS) - grabRow);
          let dc = Math.abs(i % COLUMNS - grabColumn);
          if (form !== 'wave') dr = Math.min(dr, ROWS - dr);
          if (form === 'orbit') dc = Math.min(dc, COLUMNS - dc);
          distance = dr * dr / 55 + dc * dc / 13;
        }
        if (distance < 9) {
          const weight = Math.exp(-distance) * 180;
          fx += (this.anchors[a]! + pullX - x) * weight;
          fy += (this.anchors[a + 1]! + pullY - y) * weight;
          fz += (this.anchors[a + 2]! + pullZ - z) * weight;
        }
      } else if (pointer.active) {
        const dx = x - pointer.x, dy = y - pointer.y, dz = z - pointer.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 3) {
          const influence = Math.exp(-d2 * 2.2) * (pointer.down ? -25 : 7);
          fx += dx * influence; fy += dy * influence; fz += dz * influence;
        }
      }
      for (let k = 0; k < pulses.length; k++) {
        const pulse = pulses[k]!;
        const dx = x - pulse.x, dy = y - pulse.y, dz = z - pulse.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + .001;
        const shell = distance - pulseRadius[k]!;
        if (shell > -.85 && shell < .85) {
          const influence = Math.exp(-shell * shell * 20) * pulseAmplitude[k]! / distance;
          fx += dx * influence; fy += dy * influence; fz += dz * influence;
        }
      }
      velocity[a] = (velocity[a]! + fx * dt) * damping;
      velocity[a + 1] = (velocity[a + 1]! + fy * dt) * damping;
      velocity[a + 2] = (velocity[a + 2]! + fz * dt) * damping;
      p[a] += velocity[a]! * dt;
      p[a + 1] += velocity[a + 1]! * dt;
      p[a + 2] += velocity[a + 2]! * dt;
    }
    const stiffness = .22 + tension * .38;
    for (let iteration = 0; iteration < 2; iteration++) {
      for (let edge = 0; edge < this.lengths.length; edge++) {
        const a = this.edges[edge * 2]! * 3, b = this.edges[edge * 2 + 1]! * 3;
        const dx = p[b]! - p[a]!, dy = p[b + 1]! - p[a + 1]!, dz = p[b + 2]! - p[a + 2]!;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-8;
        const correction = (length - this.lengths[edge]!) / length * stiffness * .5;
        p[a] += dx * correction; p[a + 1] += dy * correction; p[a + 2] += dz * correction;
        p[b] -= dx * correction; p[b + 1] -= dy * correction; p[b + 2] -= dz * correction;
      }
    }
    for (let i = 0; i < p.length; i++) {
      if (!Number.isFinite(p[i]!) || Math.abs(p[i]!) > 10) { p[i] = this.anchors[i]!; velocity[i] = 0; }
      else velocity[i] = (p[i]! - this.previous[i]!) * HZ;
    }
    if (this.pulses.length) {
      for (const pulse of this.pulses) pulse.age += dt;
      this.pulses = this.pulses.filter(pulse => pulse.age < 2);
    }
  }
}
