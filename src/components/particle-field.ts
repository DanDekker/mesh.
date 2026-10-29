import { FieldRenderer } from '../graphics/renderer.ts';
import type { SurfaceGrab } from '../graphics/grab.ts';
import { wheelDelta } from '../shared/wheel.ts';
import { COUNT, FRAME_HEADER, FORMS, DEFAULT_SETTINGS, IDLE_POINTER, writeShape, normalizeSettings, type FieldSettings, type Form, type Pointer } from '../shared/field.ts';

export class ParticleField extends HTMLElement {
  private renderer?: FieldRenderer;
  private canvas?: HTMLCanvasElement;
  private worker?: Worker;
  private workerTarget?: Float32Array;
  private socket?: WebSocket;
  private privateActive = false;
  private resizeObserver?: ResizeObserver;
  private lifetime?: AbortController;
  private settings = { ...DEFAULT_SETTINGS };
  private target: Float32Array = new Float32Array(COUNT * 3);
  private displayed: Float32Array = new Float32Array(COUNT * 3);
  private targetTime = 0;
  private displayedTime = 0;
  private raf = 0;
  private previous = 0;
  private dirtyUntil = 0;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private pointer: Pointer = { ...IDLE_POINTER };
  private feedback?: SVGSVGElement;
  private reticleEl?: SVGCircleElement;
  private contactEl?: SVGCircleElement;
  private tetherEl?: SVGLineElement;
  private screen = { x: 0, y: 0 };
  private press = { x: 0, y: 0 };
  private grab?: SurfaceGrab;
  private capturedPointer?: number;
  private travel = 0;
  private pressed = false;
  private lastWorld = { x: 0, y: 0, z: 0, time: 0 };
  private pointerVelocity = { x: 0, y: 0, z: 0 };
  private pressTime = 0;
  private cursorInside = false;
  private reticle = { x: 0, y: 0, vx: 0, vy: 0, seeded: false };
  private lastInteract = 0;
  private lastIdlePulse = 0;
  private lastTap = { time: 0, x: 0, y: 0 };
  private frameEma = 1 / 60;
  private quality = 1;
  private qualityFrames = 0;

  connectedCallback() {
    this.lastInteract = performance.now();
    this.lifetime = new AbortController();
    const { signal } = this.lifetime;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{display:block;overflow:hidden;touch-action:none}
      canvas{display:block;width:100%;height:100%;outline:0}
      .feedback{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;color:#8ce5bb;opacity:0;transition:opacity .25s}
      .reticle{fill:none;stroke:currentColor;stroke-width:.75;opacity:.6;transition:r .18s}
      .contact{fill:#d2f7df;opacity:.85}
      .tether{stroke:currentColor;stroke-width:.65;opacity:0}
    </style><canvas aria-hidden="true"></canvas><svg class="feedback" aria-hidden="true"><line class="tether"/><circle class="reticle" r="6"/><circle class="contact" r="1.8"/></svg>`;
    this.canvas = root.querySelector('canvas')!;
    this.feedback = root.querySelector('.feedback')!;
    this.reticleEl = root.querySelector('.reticle')!; this.contactEl = root.querySelector('.contact')!; this.tetherEl = root.querySelector('.tether')!;
    writeShape(this.target, this.settings.form); this.displayed.set(this.target);
    try { this.renderer = new FieldRenderer(this.canvas); }
    catch (error) { this.failure(error); return; }
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.clearContact(); cancelAnimationFrame(this.raf); this.raf = 0; }, { signal });
    this.canvas.addEventListener('webglcontextrestored', () => {
      try { this.renderer?.dispose(); this.renderer = new FieldRenderer(this.canvas!); this.resize(); this.renderer.palette(this.settings.palette); this.renderer.topology(this.settings.form); this.requestFrame(); }
      catch (error) { this.failure(error); }
    }, { signal });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this);
    this.addEventListener('pointermove', event => {
      if (!this.renderer || !event.isPrimary) return;
      this.cursorInside = true;
      const bounds = this.getBoundingClientRect(); this.screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      if (this.pressed) this.travel = Math.max(this.travel, Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y));
      if (this.grab) {
        this.pointer = this.grab.move(event.clientX, event.clientY);
      } else {
        const hit = this.renderer.pick(event.clientX, event.clientY);
        this.pointer = hit ? { x: hit.x, y: hit.y, z: hit.z, active: true, down: false, index: hit.index } : { ...IDLE_POINTER };
      }
      this.trackVelocity(event.timeStamp);
      this.updateContact();
    }, { signal });
    this.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.renderer || !event.isPrimary) return;
      this.cursorInside = true;
      const grab = this.renderer.grab(event.clientX, event.clientY);
      if (!grab) { this.clearContact(); return; }
      this.grab = grab; this.capturedPointer = event.pointerId;
      this.setPointerCapture(event.pointerId);
      const bounds = this.getBoundingClientRect(); this.screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      this.travel = 0; this.pressed = true; this.pressTime = event.timeStamp; this.press = { x: event.clientX, y: event.clientY };
      this.pointerVelocity = { x: 0, y: 0, z: 0 }; this.lastWorld.time = 0;
      this.pointer = grab.move(event.clientX, event.clientY);
      this.trackVelocity(event.timeStamp);
      this.updateContact();
    }, { signal });
    const release = (event: PointerEvent) => {
      if (!event.isPrimary || event.pointerId !== this.capturedPointer) return;
      if (event.type === 'pointerup' && this.pressed && !this.settings.paused) {
        if (this.travel < 5) {
          const again = event.timeStamp - this.lastTap.time < 350 && Math.hypot(this.press.x - this.lastTap.x, this.press.y - this.lastTap.y) < 44;
          this.lastTap = { time: event.timeStamp, x: this.press.x, y: this.press.y };
          this.send({ type: 'pulse', x: this.pointer.x, y: this.pointer.y, z: this.pointer.z, force: Math.min(2, (1 + this.chargeAt(event.timeStamp)) * (again ? 1.5 : 1)) });
          if (again) this.renderer?.wheel(.2);
          if (event.pointerType === 'touch') navigator.vibrate?.(again ? 10 : 6);
        }
        else if (this.pointer.index !== undefined) {
          const stale = Math.exp(-Math.max(0, event.timeStamp - this.lastWorld.time) / 120), v = this.pointerVelocity;
          this.send({ type: 'fling', index: this.pointer.index, vx: v.x * stale, vy: v.y * stale, vz: v.z * stale });
          if (event.pointerType === 'touch') navigator.vibrate?.(8);
        }
      }
      this.clearContact();
    };
    this.addEventListener('pointerup', release, { signal }); this.addEventListener('pointercancel', release, { signal });
    this.addEventListener('lostpointercapture', event => { if (event.pointerId === this.capturedPointer) this.clearContact(); }, { signal });
    this.addEventListener('pointerleave', () => { this.cursorInside = false; if (!this.pointer.down) { this.pointer.active = false; this.updateContact(); } else this.updateContact(); }, { signal });
    this.addEventListener('wheel', event => {
      event.preventDefault();
      if (!this.renderer || this.settings.paused || this.pointer.down) return;
      const delta = wheelDelta(event.deltaY, event.deltaMode, this.clientHeight);
      const axis = this.renderer.axis();
      this.lastInteract = performance.now();
      this.send({ type: 'wheel', kick: { delta, ...axis } }); this.renderer.wheel(delta); this.requestFrame();
    }, { signal, passive: false });
    window.addEventListener('blur', () => this.clearContact(), { signal });
    document.addEventListener('visibilitychange', () => {
      this.send({ type: 'visibility', visible: !document.hidden });
      if (document.hidden) { this.clearContact(); cancelAnimationFrame(this.raf); this.raf = 0; }
      else { this.previous = 0; this.requestFrame(); }
    }, { signal });
    this.startWorker(); this.connectPrivate(signal); this.resize();
  }

  disconnectedCallback() {
    this.lifetime?.abort(); this.resizeObserver?.disconnect(); this.worker?.terminate(); this.socket?.close();
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    cancelAnimationFrame(this.raf); this.raf = 0; this.renderer?.dispose();
  }

  configure(input: Partial<FieldSettings>) {
    const previousForm = this.settings.form;
    this.settings = normalizeSettings(input, this.settings);
    if (previousForm !== this.settings.form) {
      this.clearContact();
      writeShape(this.target, this.settings.form, this.displayedTime); this.displayed.set(this.target);
    }
    this.renderer?.palette(this.settings.palette);
    this.renderer?.topology(this.settings.form);
    this.send({ type: 'settings', settings: this.settings }); this.requestFrame();
  }

  reset() { this.clearContact(); this.send({ type: 'reset' }); this.requestFrame(); }

  private trackVelocity(time: number) {
    const p = this.pointer, last = this.lastWorld;
    if (!p.active) { last.time = 0; this.pointerVelocity = { x: 0, y: 0, z: 0 }; return; }
    if (last.time) {
      const dt = Math.max(1 / 240, Math.min(.1, (time - last.time) / 1000)), v = this.pointerVelocity;
      v.x += ((p.x - last.x) / dt - v.x) * .45; v.y += ((p.y - last.y) / dt - v.y) * .45; v.z += ((p.z - last.z) / dt - v.z) * .45;
      p.vx = v.x; p.vy = v.y; p.vz = v.z;
    }
    this.lastWorld = { x: p.x, y: p.y, z: p.z, time };
  }

  private clearContact() {
    const captured = this.capturedPointer;
    this.capturedPointer = undefined; this.grab = undefined; this.pressed = false;
    this.lastWorld.time = 0; this.pointerVelocity = { x: 0, y: 0, z: 0 };
    this.pointer = { ...IDLE_POINTER }; this.updateContact();
    if (captured !== undefined && this.hasPointerCapture(captured)) this.releasePointerCapture(captured);
  }

  private updateContact() {
    if (this.pointer.active) this.lastInteract = performance.now();
    this.renderer?.touch(this.pointer, this.clientWidth ? this.screen.x / this.clientWidth : .5, this.clientHeight ? 1 - this.screen.y / this.clientHeight : .5, this.cursorInside);
    this.style.cursor = this.pointer.down ? 'grabbing' : this.pointer.active ? 'grab' : '';
    this.send({ type: 'pointer', pointer: this.pointer }); this.requestFrame();
  }

  private chargeAt(time: number) {
    return this.pressed && this.travel < 5 ? 1 - Math.exp(-Math.max(0, time - this.pressTime) / 900) : 0;
  }

  private drawContact(delta: number) {
    if (!this.feedback || !this.renderer) return;
    this.feedback.style.opacity = this.pointer.active ? '1' : '0';
    const ring = this.reticle, dt = Math.min(delta, .05);
    if (!ring.seeded) { ring.x = this.screen.x; ring.y = this.screen.y; ring.seeded = true; }
    ring.vx += ((this.screen.x - ring.x) * 420 - ring.vx * 32) * dt; ring.x += ring.vx * dt;
    ring.vy += ((this.screen.y - ring.y) * 420 - ring.vy * 32) * dt; ring.y += ring.vy * dt;
    const charge = this.chargeAt(performance.now());
    const reticle = this.reticleEl!, contact = this.contactEl!, tether = this.tetherEl!;
    reticle.setAttribute('cx', String(ring.x)); reticle.setAttribute('cy', String(ring.y));
    reticle.setAttribute('r', this.pointer.down ? String(12 - charge * 4.5) : '6');
    reticle.style.opacity = String(.6 + charge * .35);
    const index = this.pointer.index ?? -1;
    const point = index >= 0 ? this.renderer.point(index) : null;
    contact.setAttribute('cx', String(point?.screenX ?? this.screen.x)); contact.setAttribute('cy', String(point?.screenY ?? this.screen.y));
    contact.setAttribute('r', String(1.8 + charge * 1.7));
    tether.setAttribute('x1', String(ring.x)); tether.setAttribute('y1', String(ring.y));
    tether.setAttribute('x2', String(point?.screenX ?? this.screen.x)); tether.setAttribute('y2', String(point?.screenY ?? this.screen.y));
    tether.style.opacity = this.pointer.down && point ? String(Math.min(.5, Math.hypot(point.screenX - this.screen.x, point.screenY - this.screen.y) / 100)) : '0';
  }

  private failure(error: unknown) {
    console.error('Mesh renderer:', error);
    this.dispatchEvent(new CustomEvent('mesh-error', { detail: 'This view needs WebGL 2. Please enable hardware acceleration.', bubbles: true }));
  }

  private startWorker() {
    if (this.worker || !this.isConnected) return;
    this.worker = new Worker(new URL('worker.js', document.baseURI), { type: 'module', name: 'mesh-field' });
    this.worker.addEventListener('message', ({ data }) => {
      if (this.privateActive || data.type !== 'frame') return;
      if (data.positions instanceof Float32Array && data.positions.length === COUNT * 3) {
        if (data.form !== this.settings.form) { this.worker?.postMessage({ type: 'recycle', buffer: data.positions.buffer }, [data.positions.buffer as ArrayBuffer]); return; }
        const spare = this.workerTarget;
        this.workerTarget = data.positions;
        this.frame(data.positions, data.time, data.form);
        if (spare && spare !== data.positions && this.worker) this.worker.postMessage({ type: 'recycle', buffer: spare.buffer }, [spare.buffer as ArrayBuffer]);
      }
    });
    this.worker.addEventListener('error', error => this.failure(error));
    this.worker.postMessage({ type: 'settings', settings: this.settings });
    this.worker.postMessage({ type: 'visibility', visible: !document.hidden });
  }

  private async connectPrivate(signal: AbortSignal) {
    try {
      const response = await fetch(new URL('api/field', document.baseURI), { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
      if (!response.ok || !(await response.json()).private || signal.aborted) return;
      const socketUrl = new URL('field', document.baseURI);
      socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(socketUrl);
      socket.binaryType = 'arraybuffer'; this.socket = socket;
      this.connectionTimer = setTimeout(() => { if (!this.privateActive) socket.close(); }, 4000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'settings', settings: this.settings }));
        socket.send(JSON.stringify({ type: 'visibility', visible: !document.hidden }));
      });
      socket.addEventListener('message', ({ data }) => {
        if (!(data instanceof ArrayBuffer) || data.byteLength !== (COUNT * 3 + FRAME_HEADER) * 4) return;
        const frame = new Float32Array(data);
        if (frame[1] !== COUNT || !Number.isFinite(frame[0])) return;
        const form = FORMS[frame[2]!];
        if (!form || form !== this.settings.form) return;
        if (!this.privateActive) {
          this.privateActive = true; this.worker?.terminate(); this.worker = undefined;
          if (this.connectionTimer) clearTimeout(this.connectionTimer);
        }
        this.frame(frame.subarray(FRAME_HEADER), frame[0]!, form);
      });
      socket.addEventListener('close', () => { this.privateActive = false; this.socket = undefined; this.startWorker(); });
      socket.addEventListener('error', () => socket.close());
    } catch { /* The standalone renderer is already running. */ }
  }

  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    if (!this.privateActive) this.worker?.postMessage(message);
  }

  private frame(positions: Float32Array, time: number, form: Form) {
    if (form !== this.settings.form) return;
    this.target = positions; this.targetTime = time; this.requestFrame();
  }

  private resize() { if (this.renderer) { if (this.grab) this.clearContact(); this.renderer.resize(this.clientWidth, this.clientHeight); this.feedback?.setAttribute('viewBox', `0 0 ${this.clientWidth} ${this.clientHeight}`); this.requestFrame(); } }

  private requestFrame() {
    this.dirtyUntil = performance.now() + 1000;
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(time => this.render(time));
  }

  private render(now: number) {
    this.raf = 0;
    if (!this.renderer || document.hidden) return;
    const delta = this.previous ? Math.min(.05, (now - this.previous) / 1000) : 1 / 60;
    this.previous = now;
    this.frameEma += (delta - this.frameEma) * .04;
    if (++this.qualityFrames > 90 && this.frameEma > .023 && this.quality > .62) {
      this.quality = Math.max(.62, this.quality * .78); this.renderer.setQuality(this.quality); this.qualityFrames = 0;
    } else if (this.qualityFrames > 600 && this.frameEma < .0125 && this.quality < 1) {
      this.quality = Math.min(1, this.quality * 1.2); this.renderer.setQuality(this.quality); this.qualityFrames = 0;
    }
    const blend = 1 - Math.exp(-delta * 40);
    for (let i = 0; i < this.displayed.length; i++) this.displayed[i] += (this.target[i]! - this.displayed[i]!) * blend;
    this.displayedTime += (this.targetTime - this.displayedTime) * blend;
    if (!this.settings.paused && now - this.lastInteract > 7000 && now - this.lastIdlePulse > 9000) {
      this.lastIdlePulse = now;
      const index = (Math.floor(now / 9000) * 7919) % COUNT, at = index * 3;
      this.send({ type: 'pulse', x: this.displayed[at]!, y: this.displayed[at + 1]!, z: this.displayed[at + 2]!, force: .35 });
    }
    this.renderer.render(this.displayed, this.displayedTime, delta);
    this.drawContact(delta);
    if (!this.settings.paused || now < this.dirtyUntil) this.raf = requestAnimationFrame(time => this.render(time));
  }
}
