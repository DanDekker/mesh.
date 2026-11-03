import { expect, test } from 'bun:test';
import { FramePool } from '../src/physics/frame-pool.ts';

const transfer = (positions: Float32Array) => structuredClone(positions, { transfer: [positions.buffer] });

test('a stalled consumer cannot grow the frame queue', () => {
  const pool = new FramePool(24);
  expect(pool.take()).toHaveLength(24);
  expect(pool.take()).toHaveLength(24);
  for (let frame = 0; frame < 1000; frame++) expect(pool.take()).toBeUndefined();
});

test('transferred frames can be reused without detaching the displayed frame', () => {
  const pool = new FramePool(24);
  let displayed = transfer(pool.take()!);
  displayed.fill(7);
  for (let frame = 0; frame < 100; frame++) {
    const next = pool.take()!;
    next.fill(frame);
    const received = transfer(next);
    expect(next.byteLength).toBe(0);
    expect(displayed[0]).toBe(frame ? frame - 1 : 7);
    const recycled = transfer(displayed);
    pool.recycle(recycled.buffer);
    displayed = received;
    expect(displayed[0]).toBe(frame);
  }
});

test('invalid returned buffers do not reopen an exhausted pool', () => {
  const pool = new FramePool(24);
  pool.take(); pool.take();
  pool.recycle(new ArrayBuffer(0));
  pool.recycle(new ArrayBuffer(4));
  expect(pool.take()).toBeUndefined();
});

test('a paused form change is delivered after a stalled consumer returns a buffer', async () => {
  const worker = new Worker(new URL('../src/physics/worker.ts', import.meta.url).href);
  const received: { positions: Float32Array; form: string }[] = [];
  let ready!: () => void;
  const initial = new Promise<void>(resolve => { ready = resolve; });
  worker.addEventListener('message', ({ data }) => {
    received.push(data);
    if (received.length === 2) ready();
  });
  try {
    await initial;
    await Bun.sleep(100);
    expect(received).toHaveLength(2);
    const updated = new Promise<{ positions: Float32Array; form: string }>(resolve => {
      worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
    });
    worker.postMessage({ type: 'settings', settings: { form: 'cube', paused: true } });
    const buffer = received[0]!.positions.buffer;
    worker.postMessage({ type: 'recycle', buffer }, [buffer]);
    const frame = await updated;
    expect(frame.form).toBe('cube');
    expect(frame.positions.every(Number.isFinite)).toBe(true);
    expect(received[1]!.positions.byteLength).toBeGreaterThan(0);
    await Bun.sleep(100);
    expect(received).toHaveLength(3);
  } finally { worker.terminate(); }
}, 5000);
