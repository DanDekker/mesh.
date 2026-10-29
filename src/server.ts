import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COUNT, ROWS, COLUMNS, HZ, FRAME_HEADER, FORMS, DEFAULT_SETTINGS, IDLE_POINTER, createEdges, writeShape, normalizeSettings, type FieldSettings, type Pointer, type WheelKick } from './shared/field.ts';
import type { PrivateFactory, PrivateField, FieldPulse, FieldFling } from './server/provider.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSETS = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/style.css', 'style.css'], ['/icon.svg', 'icon.svg'], ['/main.js', 'main.js'], ['/worker.js', 'worker.js']]);
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-cache',
};

export async function loadPrivateFactory(): Promise<PrivateFactory | null> {
  const input = process.env.MESH_PRIVATE_ADAPTER;
  if (!input) return null;
  if (!isAbsolute(input)) throw new Error('The private adapter must use an absolute external path.');
  const path = realpathSync(input), fromRoot = relative(realpathSync(ROOT), path);
  if (!fromRoot.startsWith(`..${sep}`)) throw new Error('The private adapter must stay outside the public repository.');
  const module = await import(pathToFileURL(path).href);
  if (typeof module.createField !== 'function') throw new Error('The private adapter must export createField.');
  return module.createField as PrivateFactory;
}

type Session = { field: PrivateField; settings: FieldSettings; pointer: Pointer; pulses: FieldPulse[]; kicks: WheelKick[]; flings: FieldFling[]; reset: boolean; visible: boolean; dirty: boolean; previous: number; lastSent: number; frame: Float32Array };

export function createServer(options: { port?: number; hostname?: string; privateFactory?: PrivateFactory | null } = {}) {
  const factory = options.privateFactory ?? null;
  const clients = new Set<Bun.ServerWebSocket<Session>>();
  const server = Bun.serve<Session>({
    port: options.port ?? Number(process.env.PORT || 3000), hostname: options.hostname ?? process.env.HOST ?? '127.0.0.1',
    async fetch(request, server) {
      const url = new URL(request.url);
      const respond = (text: string, status: number) => new Response(text, { status, headers: HEADERS });
      if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 405);
      if (url.pathname === '/api/field') return Response.json({ private: Boolean(factory) }, { headers: HEADERS });
      if (url.pathname === '/field') {
        if (!factory) return respond('Not found', 404);
        if (request.headers.get('origin') !== url.origin) return respond('Forbidden', 403);
        if (clients.size >= 4) return respond('Field busy', 503);
        let field: PrivateField | undefined;
        try {
          const positions = new Float32Array(COUNT * 3); writeShape(positions, 'silk');
          field = factory({ count: COUNT, rows: ROWS, columns: COLUMNS, hz: HZ, positions, edges: createEdges() });
          if (server.upgrade(request, { data: { field, settings: { ...DEFAULT_SETTINGS }, pointer: { ...IDLE_POINTER }, pulses: [], kicks: [], flings: [], reset: false, visible: true, dirty: true, previous: performance.now(), lastSent: 0, frame: new Float32Array(COUNT * 3 + FRAME_HEADER) } })) return;
          field.dispose();
        } catch (error) { field?.dispose(); console.error('Private field could not start:', error); return respond('Field unavailable', 503); }
        return respond('Upgrade required', 426);
      }
      const name = ASSETS.get(url.pathname);
      if (!name) return respond('Not found', 404);
      const file = Bun.file(resolve(ROOT, 'dist', name));
      if (!(await file.exists())) return respond('Run bun run build first', 503);
      return new Response(request.method === 'HEAD' ? null : file, { headers: { ...HEADERS, 'Content-Type': file.type } });
    },
    websocket: {
      maxPayloadLength: 1024,
      backpressureLimit: 1_048_576,
      closeOnBackpressureLimit: true,
      idleTimeout: 120,
      open(socket) { clients.add(socket); },
      message(socket, message) {
        if (typeof message !== 'string') return;
        try {
          const data = JSON.parse(message), session = socket.data;
          if (data.type === 'settings' && data.settings && typeof data.settings === 'object') {
            const next = normalizeSettings(data.settings, session.settings);
            if (next.form !== session.settings.form) { session.pointer = { ...IDLE_POINTER }; session.pulses.length = 0; session.kicks.length = 0; session.flings.length = 0; }
            session.settings = next; session.dirty = true;
          }
          if (data.type === 'pointer' && data.pointer) {
            const p = data.pointer;
            if ([p.x, p.y, p.z].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 30)) {
              const velocity = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
              session.pointer = { x: p.x, y: p.y, z: p.z, down: p.down === true, active: p.active === true, index: Number.isInteger(p.index) && p.index >= 0 && p.index < COUNT ? p.index : -1, vx: velocity(p.vx), vy: velocity(p.vy), vz: velocity(p.vz) };
            }
          }
          if (data.type === 'pulse' && session.pulses.length < 6 && [data.x, data.y, data.z].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 30)) session.pulses.push({ x: data.x, y: data.y, z: data.z, force: typeof data.force === 'number' && Number.isFinite(data.force) ? Math.max(0, Math.min(2, data.force)) : 1 });
          if (data.type === 'fling' && session.flings.length < 4 && Number.isInteger(data.index) && data.index >= 0 && data.index < COUNT && [data.vx, data.vy, data.vz].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 30)) session.flings.push({ index: data.index, vx: data.vx, vy: data.vy, vz: data.vz });
          if (data.type === 'wheel' && data.kick && session.kicks.length < 8) {
            const kick = data.kick;
            if ([kick.delta, kick.x, kick.y, kick.z].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1)) session.kicks.push({ delta: kick.delta, x: kick.x, y: kick.y, z: kick.z });
          }
          if (data.type === 'reset') { session.reset = true; session.dirty = true; }
          if (data.type === 'visibility') { session.visible = data.visible === true; session.previous = performance.now(); session.dirty = true; }
        } catch { /* Invalid messages do not change the field. */ }
      },
      close(socket) { clients.delete(socket); socket.data.field.dispose(); },
    },
    error() { return new Response('Field unavailable', { status: 500, headers: HEADERS }); },
  });
  const timer = setInterval(() => {
    const now = performance.now();
    for (const socket of clients) {
      const session = socket.data, elapsed = Math.max(0, Math.min(80, now - session.previous)); session.previous = now;
      if (!session.visible || (session.settings.paused && !session.dirty)) continue;
      try {
        const frame = session.field.advance({ elapsedNanoseconds: Math.round(elapsed * 1e6), settings: session.settings, pointer: session.pointer, pulses: session.pulses, kicks: session.kicks, flings: session.flings, reset: session.reset });
        session.pulses.length = 0; session.kicks.length = 0; session.flings.length = 0; session.reset = false;
        if (frame.positions.length !== COUNT * 3 || !Number.isFinite(frame.time) || !frame.positions.every(value => Number.isFinite(value) && Math.abs(value) < 10)) throw new Error('Invalid field frame');
        if (now - session.lastSent < 1000 / 60 || socket.getBufferedAmount() > session.frame.byteLength * 3) continue;
        session.frame[0] = frame.time; session.frame[1] = COUNT; session.frame[2] = FORMS.indexOf(session.settings.form); session.frame.set(frame.positions, FRAME_HEADER);
        socket.sendBinary(session.frame); session.lastSent = now; session.dirty = false;
      } catch (error) { console.error('Private field stopped:', error); socket.close(1011, 'Field unavailable'); }
    }
  }, 1000 / HZ);
  timer.unref();
  const stop = server.stop.bind(server);
  return { server, stop() { clearInterval(timer); for (const socket of clients) socket.close(); return stop(true); } };
}

if (import.meta.main) {
  const privateFactory = await loadPrivateFactory();
  const instance = createServer({ privateFactory });
  console.log(`Mesh · ${instance.server.url}`);
  console.log(privateFactory ? 'Private rendering connected.' : 'Standalone rendering.');
  const shutdown = () => { instance.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
