import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer, loadPrivateFactory } from '../src/server.ts';
import { COUNT, FRAME_HEADER, FORMS, writeShape } from '../src/shared/field.ts';

const instance = createServer({ port: 0, hostname: '127.0.0.1', privateFactory: null });
const base = instance.server.url;
afterAll(() => instance.stop());

test('only the allowlisted browser assets are served', async () => {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('<particle-field');
  expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
  for (const path of ['.env', '.git/config', 'src/server.ts', 'private/adapter.ts', '.private/engine.wasm', 'otto.dylib', 'main.js.map', '%2e%2e/.env']) {
    const response = await fetch(new URL(path, base));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  }
});

test('HEAD preserves asset sizes without sending their contents', async () => {
  for (const path of ['', 'main.js', 'worker.js', 'style.css', 'icon.svg', 'social.png']) {
    const url = new URL(path, base);
    const get = await fetch(url);
    const size = (await get.arrayBuffer()).byteLength;
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('content-length')).toBe(String(size));
    expect(await head.text()).toBe('');
  }
});

test('the API reveals no private implementation and rejects writes', async () => {
  const response = await fetch(new URL('api/field', base));
  expect(await response.json()).toEqual({ private: false });
  const post = await fetch(base, { method: 'POST', body: '{}' });
  expect(post.status).toBe(405);
  expect(post.headers.get('allow')).toBe('GET, HEAD');
});

test('private streaming is absent without an adapter', async () => {
  expect((await fetch(new URL('field', base))).status).toBe(404);
});

test('plain HTTP requests do not allocate a private provider', async () => {
  let allocated = 0;
  const privateInstance = createServer({ port: 0, hostname: '127.0.0.1', privateFactory: topology => {
    allocated++;
    return { advance() { return { positions: topology.positions, time: 0 }; }, dispose() {} };
  } });
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(new URL('field', privateInstance.server.url), {
        method, headers: { Origin: privateInstance.server.url.origin },
      });
      expect(response.status).toBe(426);
      expect(allocated).toBe(0);
    }
  } finally { privateInstance.stop(); }
});

test('private adapters cannot be loaded from inside the public repository', async () => {
  const saved = process.env.MESH_PRIVATE_ADAPTER;
  const directory = mkdtempSync(resolve(import.meta.dir, '../..private-test-'));
  const path = join(directory, 'adapter.ts');
  writeFileSync(path, 'export const createField = () => { throw new Error("must not load"); };');
  try {
    process.env.MESH_PRIVATE_ADAPTER = path;
    await expect(loadPrivateFactory()).rejects.toThrow('outside the public repository');
  } finally {
    if (saved === undefined) delete process.env.MESH_PRIVATE_ADAPTER; else process.env.MESH_PRIVATE_ADAPTER = saved;
    unlinkSync(path); rmdirSync(directory);
  }
});

test('a private provider streams coordinates and releases its session', async () => {
  let disposed = 0, allocated = 0;
  const privateInstance = createServer({ port: 0, hostname: '127.0.0.1', privateFactory: topology => {
    allocated++;
    return { advance(input) { writeShape(topology.positions, input.settings.form); return { positions: topology.positions, time: .5 }; }, dispose() { disposed++; } };
  } });
  const url = new URL('field', privateInstance.server.url);
  try {
    expect((await fetch(url, { headers: { Origin: 'https://elsewhere.invalid' } })).status).toBe(403);
    expect(allocated).toBe(0);
    // Bun's native client accepts handshake headers; the DOM constructor type does not.
    const Client = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
    const socket = new Client(url.href.replace('http:', 'ws:'), { headers: { Origin: privateInstance.server.url.origin } });
    socket.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('No coordinate frame')); }, 2000);
      let switched = false;
      socket.onmessage = event => {
        try {
          const frame = new Float32Array(event.data as ArrayBuffer);
          expect(frame.length).toBe(COUNT * 3 + FRAME_HEADER); expect(frame[0]).toBe(.5); expect(frame[1]).toBe(COUNT);
          expect(frame.every(Number.isFinite)).toBe(true);
          const form = FORMS[frame[2]!];
          if (!switched) {
            expect(form).toBe('silk'); switched = true;
            socket.send(JSON.stringify({ type: 'settings', settings: { form: 'cube', paused: true } }));
            return;
          }
          if (form === 'silk') return;
          expect(form).toBe('cube'); expect(frame[FRAME_HEADER]).toBeCloseTo(1.04, 5);
          socket.close(); clearTimeout(timer); resolve();
        } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
      };
      socket.onerror = error => { clearTimeout(timer); reject(error); };
    });
    await Bun.sleep(20);
    expect(allocated).toBe(1); expect(disposed).toBe(1);
  } finally { privateInstance.stop(); }
});
