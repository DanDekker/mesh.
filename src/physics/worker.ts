/// <reference lib="webworker" />
import { Simulation } from './simulation.ts';
import { COUNT, HZ, type FieldSettings, type Pointer } from '../shared/field.ts';

const simulation = new Simulation();
let previous = performance.now(), remainder = 0, lastSent = 0, visible = true, spare: Float32Array | undefined;
const worker = self as unknown as DedicatedWorkerGlobalScope;
function send() {
  const positions = spare ?? new Float32Array(COUNT * 3);
  spare = undefined;
  positions.set(simulation.positions);
  worker.postMessage({ type: 'frame', positions, time: simulation.time, form: simulation.settings.form }, [positions.buffer]);
}
worker.onmessage = ({ data }: MessageEvent) => {
  if (data.type === 'settings') { simulation.configure(data.settings as Partial<FieldSettings>); send(); }
  if (data.type === 'pointer') simulation.pointer = data.pointer as Pointer;
  if (data.type === 'pulse') simulation.pulse(data.x, data.y, data.z, data.force);
  if (data.type === 'fling') simulation.fling(data.index, data.vx, data.vy, data.vz);
  if (data.type === 'wheel' && !simulation.settings.paused) simulation.swirl(data.kick);
  if (data.type === 'reset') { simulation.reset(); send(); }
  if (data.type === 'visibility') { visible = data.visible; previous = performance.now(); remainder = 0; }
  if (data.type === 'recycle' && data.buffer instanceof ArrayBuffer && data.buffer.byteLength === COUNT * 12) spare = new Float32Array(data.buffer);
};
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - previous) / 1000, .08);
  previous = now;
  if (!visible || simulation.settings.paused) { remainder = 0; return; }
  remainder += elapsed;
  let steps = 0;
  while (remainder >= 1 / HZ && steps < 7) { simulation.step(); remainder -= 1 / HZ; steps++; }
  if (steps && now - lastSent >= 1000 / 60) { send(); lastSent = now; }
}, 1000 / HZ);
send();
