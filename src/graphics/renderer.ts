import { COUNT, COLUMNS, createEdges, gridIndex, isSurface, pointIndices, textureCoordinates, type Form, type Palette, type Pointer } from '../shared/field.ts';
import { SURFACE, SURFACE_SLOTS } from '../shared/surface.ts';
import { project, inverseRotate } from './camera.ts';
import { FieldCamera } from './field-camera.ts';
import { SurfaceGrab } from './grab.ts';

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in float aStress;
uniform vec3 uRotation;
uniform vec3 uColor;
uniform float uScale;
uniform float uAspect;
uniform float uDpr;
uniform float uTime;
uniform float uDust;
uniform vec2 uCenter;
uniform vec3 uPointer;
uniform float uContact;
uniform float uEnergy;
uniform float uSurface;
out vec3 vColor;
out float vAlpha;
vec3 rotate(vec3 p) {
  float a=uRotation.x,b=uRotation.y,c=uRotation.z;
  p=vec3(p.x,cos(a)*p.y-sin(a)*p.z,sin(a)*p.y+cos(a)*p.z);
  p=vec3(cos(b)*p.x+sin(b)*p.z,p.y,-sin(b)*p.x+cos(b)*p.z);
  return vec3(cos(c)*p.x-sin(c)*p.y,sin(c)*p.x+cos(c)*p.y,p.z);
}
void main() {
  vec3 point=aPosition;
  if(uDust>.5) { point.x+=sin(uTime*.03+aUV.x*10.)*.1;point.y+=cos(uTime*.04+aUV.y*9.)*.08; }
  vec3 p=rotate(point),n=normalize(rotate(aNormal)+vec3(0.,0.,.00001));
  float perspective=5.5/(5.5+p.z);
  gl_Position=vec4(p.x*uScale*perspective/uAspect+uCenter.x,p.y*uScale*perspective+uCenter.y,.5+p.z*.065,1.);
  float depth=clamp(1.-(p.z+2.4)/5.,.12,1.);
  float facing=pow(abs(dot(n,normalize(vec3(-.25,.6,1.)))),4.);
  float rim=pow(1.-abs(n.z),3.);
  float edge=pow(abs(aUV.y*2.-1.),8.)*(1.-uSurface);
  float phase=mix(aUV.x*6.28318*3.+cos(aUV.y*6.28318)*.65,dot(aPosition,vec3(3.,2.,1.5)),uSurface);
  float thread=.5+.5*sin(phase);
  float contact=exp(-dot(aPosition-uPointer,aPosition-uPointer)*8.)*uContact;
  float charge=clamp(aStress*.8+contact*.6,0.,1.);
  float light=.3+depth*.6+facing*.7+rim*.5+edge*.2;
  vec3 warm=mix(uColor*.68,uColor,thread*.4+.6);
  vec3 highlight=mix(uColor,vec3(.81,1.,.88),.75);
  vColor=mix(warm,highlight,clamp(pow(facing,2.)*.4+edge*.1+charge*.7,0.,1.))*(light+charge*.8+uEnergy*.3);
  vAlpha=(.3+depth*.7)*(1.-uDust*.91);
  gl_PointSize=(1.25+depth*.7+facing*.5+edge*.35+charge*1.4)*uDpr*perspective;
  if(uDust>.5) { vColor=uColor*.45;vAlpha*=(.3+.7*aUV.y)*(.82+.18*sin(uTime*(.5+aUV.x*.8)+aUV.y*43.));gl_PointSize=(.6+aUV.x*.7)*uDpr; }
}`;
const POINT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 color;
void main() {
  float d=length(gl_PointCoord-vec2(.5));
  float halo=exp(-d*d*13.);
  float core=1.-smoothstep(.08,.25,d);
  if(d>.5) discard;
  color=vec4(vColor*(.8+core*.7),vAlpha*halo);
}`;
const LINE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 color;
void main() { color=vec4(vColor,vAlpha*.29); }`;
const QUAD_VERTEX = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  vUV=p;
  gl_Position=vec4(p*2.-1.,0.,1.);
}`;
const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uDirection;
in vec2 vUV;
out vec4 color;
void main() {
  vec3 sum=texture(uImage,vUV).rgb*.227027;
  sum+=texture(uImage,vUV+uDirection*1.384615).rgb*.316216;
  sum+=texture(uImage,vUV-uDirection*1.384615).rgb*.316216;
  sum+=texture(uImage,vUV+uDirection*3.230769).rgb*.070270;
  sum+=texture(uImage,vUV-uDirection*3.230769).rgb*.070270;
  color=vec4(sum,1.);
}`;
const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uAspect;
uniform vec3 uColor;
uniform float uTime;
uniform float uGlow;
uniform vec3 uCursor;
in vec2 vUV;
out vec4 color;
float grain(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main() {
  vec2 q=(vUV-vec2(.5,.54))*vec2(uAspect,1.);
  float halo=exp(-dot(q,q)*3.6);
  vec2 cq=(vUV-uCursor.xy)*vec2(uAspect,1.);
  float candle=exp(-dot(cq,cq)*9.)*uCursor.z;
  vec3 background=vec3(.027,.031,.030)+uColor*(halo*(.007+.0015*sin(uTime*.4+1.7))+candle*.011);
  vec2 dir=vUV-.5;
  float fringe=.0013*length(dir);
  vec3 scene=vec3(texture(uScene,vUV+dir*fringe).r,texture(uScene,vUV).g,texture(uScene,vUV-dir*fringe).b);
  vec3 bloom=texture(uBloom,vUV).rgb;
  vec3 lit=scene+bloom*(.65+uGlow*.35);
  lit=lit/(vec3(1.)+lit*.38);
  vec3 result=background+lit;
  float vignette=1.-smoothstep(.35,1.25,length((vUV-.5)*vec2(1.,.85)))*(.38+.025*sin(uTime*.55));
  result*=vignette;
  float step24=floor(uTime*24.)*17.31;
  result+=(grain(gl_FragCoord.xy+vec2(step24,-step24))-.5)/390.;
  color=vec4(result,1.);
}`;

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
const COLORS: Record<Palette, [number, number, number]> = { alpine: [.24, .83, .52] };

export class FieldRenderer {
  private gl: WebGL2RenderingContext;
  private points: WebGLProgram;
  private lines: WebGLProgram;
  private blur: WebGLProgram;
  private composite: WebGLProgram;
  private meshVAO: WebGLVertexArrayObject;
  private dustVAO: WebGLVertexArrayObject;
  private positionBuffer: WebGLBuffer;
  private normalBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private stressBuffer: WebGLBuffer;
  private edgeCount: number;
  private edgeBuffer: WebGLBuffer;
  private pointBuffer: WebGLBuffer;
  private pointList = pointIndices('silk');
  private form: Form = 'silk';
  private normals = new Float32Array(COUNT * 3);
  private stresses = new Float32Array(COUNT);
  private strain = new Float32Array(COUNT);
  private neighborOffsets = new Int32Array(0);
  private slotIndex = new Uint16Array(0);
  private slotCount = 0;
  private prevPositions = new Float32Array(COUNT * 3);
  private prevValid = false;
  private camera = new FieldCamera();
  private get reference() { return this.camera.reference; }
  private currentPositions?: Float32Array;
  private scene?: Target;
  private bloomA?: Target;
  private bloomB?: Target;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private aspect = 1;
  private wheelEnergy = 0;
  private contact: Pointer = { x: 0, y: 0, z: 0, active: false, down: false };
  private contactStrength = 0;
  private cursorTarget = { x: .5, y: .5, inside: false };
  private cursor = { x: .5, y: .5, strength: 0 };
  private color = [...COLORS.alpine];
  private goalColor = [...COLORS.alpine];
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private buffers: WebGLBuffer[] = [];
  private programs: WebGLProgram[] = [];
  private dustCount = 550;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.points = this.program(VERTEX, POINT_FRAGMENT);
    this.lines = this.program(VERTEX, LINE_FRAGMENT);
    this.blur = this.program(QUAD_VERTEX, BLUR_FRAGMENT);
    this.composite = this.program(QUAD_VERTEX, COMPOSITE_FRAGMENT);
    this.meshVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.meshVAO);
    this.positionBuffer = this.attribute(0, new Float32Array(COUNT * 3), 3, gl.DYNAMIC_DRAW);
    this.normalBuffer = this.attribute(1, this.normals, 3, gl.DYNAMIC_DRAW);
    this.stressBuffer = this.attribute(3, this.stresses, 1, gl.DYNAMIC_DRAW);
    this.uvBuffer = this.attribute(2, textureCoordinates('silk'), 2, gl.STATIC_DRAW);
    const edges = createEdges();
    const index = gl.createBuffer()!; this.buffers.push(index); this.edgeBuffer = index;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);
    this.edgeCount = edges.length;
    this.pointBuffer = gl.createBuffer()!; this.buffers.push(this.pointBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pointBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.pointList, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeBuffer);
    this.dustVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.dustVAO);
    const dust = new Float32Array(this.dustCount * 3), dustUV = new Float32Array(this.dustCount * 2), dustNormals = new Float32Array(this.dustCount * 3);
    let seed = 821;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < this.dustCount; i++) {
      dust[i * 3] = (random() - .5) * 14;
      dust[i * 3 + 1] = (random() - .5) * 9;
      dust[i * 3 + 2] = random() * 4;
      dustUV[i * 2] = random(); dustUV[i * 2 + 1] = random(); dustNormals[i * 3 + 2] = 1;
    }
    this.attribute(0, dust, 3, gl.STATIC_DRAW); this.attribute(1, dustNormals, 3, gl.STATIC_DRAW); this.attribute(2, dustUV, 2, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    this.buildNeighbors('silk');
  }

  private buildNeighbors(form: Form) {
    const surface = isSurface(form), count = surface ? SURFACE_SLOTS : COUNT;
    this.slotCount = count;
    this.neighborOffsets = new Int32Array(count * 4);
    this.slotIndex = new Uint16Array(count);
    for (let slot = 0; slot < count; slot++) {
      const row = Math.floor(slot / COLUMNS), column = slot % COLUMNS, at = slot * 4;
      this.slotIndex[slot] = surface ? SURFACE.canonical[slot]! : slot;
      this.neighborOffsets[at] = (surface ? SURFACE.neighbors[at]! : gridIndex(form, row - 1, column)) * 3;
      this.neighborOffsets[at + 1] = (surface ? SURFACE.neighbors[at + 1]! : gridIndex(form, row + 1, column)) * 3;
      this.neighborOffsets[at + 2] = (surface ? SURFACE.neighbors[at + 2]! : gridIndex(form, row, column - 1)) * 3;
      this.neighborOffsets[at + 3] = (surface ? SURFACE.neighbors[at + 3]! : gridIndex(form, row, column + 1)) * 3;
    }
  }

  private program(vertexSource: string, fragmentSource: string) {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Shader failed: ${log}`); }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program failed: ${gl.getProgramInfoLog(program)}`);
    this.programs.push(program);
    return program;
  }

  private attribute(location: number, values: Float32Array, size: number, usage: number) {
    const gl = this.gl, buffer = gl.createBuffer()!; this.buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values, usage); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  private uniform(program: WebGLProgram, name: string) {
    let cache = this.uniforms.get(program);
    if (!cache) { cache = new Map(); this.uniforms.set(program, cache); }
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(program, name));
    return cache.get(name)!;
  }

  private target(width: number, height: number): Target {
    const gl = this.gl, texture = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Render target unavailable');
    return { texture, framebuffer, width, height };
  }

  private deleteTarget(target?: Target) { if (target) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer); } }

  resize(width: number, height: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.aspect = this.width / this.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.width * this.dpr), h = Math.round(this.height * this.dpr);
    if (this.canvas.width === w && this.canvas.height === h && this.scene) return;
    this.canvas.width = w; this.canvas.height = h;
    this.camera.resize(this.aspect);
    this.deleteTarget(this.scene); this.deleteTarget(this.bloomA); this.deleteTarget(this.bloomB);
    this.scene = this.target(w, h);
    this.bloomA = this.target(Math.max(1, Math.floor(w / 3)), Math.max(1, Math.floor(h / 3)));
    this.bloomB = this.target(this.bloomA.width, this.bloomA.height);
  }

  palette(palette: Palette) { this.goalColor = [...COLORS[palette]]; }

  touch(pointer: Pointer, cursorX = .5, cursorY = .5, inside = false) { this.contact = { ...pointer }; this.cursorTarget = { x: cursorX, y: cursorY, inside }; }

  wheel(delta: number) { this.wheelEnergy = Math.min(1, this.wheelEnergy + Math.abs(delta) * 2.8); }

  axis() { return inverseRotate({ x: 0, y: 0, z: 1 }, this.view.rotation); }

  private get view() { return this.camera.view; }

  topology(form: Form) {
    if (this.form === form) return;
    this.form = form;
    const gl = this.gl, edges = createEdges(form);
    gl.bindVertexArray(this.meshVAO); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW); this.edgeCount = edges.length; gl.bindVertexArray(null);
    this.pointList = pointIndices(form);
    gl.bindVertexArray(this.meshVAO); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.pointList, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeBuffer); gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, textureCoordinates(form), gl.STATIC_DRAW);
    this.stresses.fill(0);
    this.buildNeighbors(form);
    this.prevValid = false;
  }

  private geometry(positions: Float32Array, delta: number) {
    const gl = this.gl, offsets = this.neighborOffsets, reference = this.reference, normals = this.normals;
    normals.fill(0); this.strain.fill(0);
    for (let slot = 0; slot < this.slotCount; slot++) {
      const index = this.slotIndex[slot]!, a = index * 3, at = slot * 4;
      const x0 = offsets[at]!, x1 = offsets[at + 1]!, y0 = offsets[at + 2]!, y1 = offsets[at + 3]!;
      const ax = positions[x1]! - positions[x0]!, ay = positions[x1 + 1]! - positions[x0 + 1]!, az = positions[x1 + 2]! - positions[x0 + 2]!;
      const bx = positions[y1]! - positions[y0]!, by = positions[y1 + 1]! - positions[y0 + 1]!, bz = positions[y1 + 2]! - positions[y0 + 2]!;
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const inverse = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      normals[a] += nx * inverse; normals[a + 1] += ny * inverse; normals[a + 2] += nz * inverse;
      const rx = reference[x1]! - reference[x0]!, ry = reference[x1 + 1]! - reference[x0 + 1]!, rz = reference[x1 + 2]! - reference[x0 + 2]!;
      const referenceLength = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-5;
      const stretch = Math.min(1, Math.abs(Math.sqrt(ax * ax + ay * ay + az * az) / referenceLength - 1) * 1.4);
      if (stretch > this.strain[index]!) this.strain[index] = stretch;
    }
    const glowScale = this.prevValid ? .22 / Math.max(delta, 1 / 240) : 0, previous = this.prevPositions;
    for (const index of this.pointList) {
      const at = index * 3, nx = normals[at]!, ny = normals[at + 1]!, nz = normals[at + 2]!;
      const inverse = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      normals[at] = nx * inverse; normals[at + 1] = ny * inverse; normals[at + 2] = nz * inverse;
      let target = this.strain[index]!;
      if (glowScale) {
        const dx = positions[at]! - previous[at]!, dy = positions[at + 1]! - previous[at + 1]!, dz = positions[at + 2]! - previous[at + 2]!;
        const glow = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) * glowScale) * .55;
        if (glow > target) target = glow;
      }
      this.stresses[index] += (target - this.stresses[index]!) * .17;
    }
    previous.set(positions); this.prevValid = true;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.normals);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stressBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.stresses);
  }

  private meshUniforms(program: WebGLProgram, time: number, dust: number) {
    const gl = this.gl; gl.useProgram(program);
    const { rotation, scale, center } = this.view;
    gl.uniform3f(this.uniform(program, 'uRotation'), rotation[0]!, rotation[1]!, rotation[2]!);
    gl.uniform3f(this.uniform(program, 'uColor'), this.color[0]!, this.color[1]!, this.color[2]!);
    gl.uniform1f(this.uniform(program, 'uScale'), scale); gl.uniform1f(this.uniform(program, 'uAspect'), this.aspect);
    gl.uniform2f(this.uniform(program, 'uCenter'), center[0]!, center[1]!);
    gl.uniform3f(this.uniform(program, 'uPointer'), this.contact.x, this.contact.y, this.contact.z);
    gl.uniform1f(this.uniform(program, 'uContact'), this.contactStrength); gl.uniform1f(this.uniform(program, 'uEnergy'), this.wheelEnergy);
    gl.uniform1f(this.uniform(program, 'uSurface'), dust ? 0 : isSurface(this.form) ? 1 : 0);
    gl.uniform1f(this.uniform(program, 'uDpr'), this.dpr); gl.uniform1f(this.uniform(program, 'uTime'), time); gl.uniform1f(this.uniform(program, 'uDust'), dust);
  }

  private blurPass(source: WebGLTexture, target: Target, x: number, y: number) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(this.blur); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(this.uniform(this.blur, 'uImage'), 0); gl.uniform2f(this.uniform(this.blur, 'uDirection'), x, y); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(positions: Float32Array, time: number, delta: number) {
    if (!this.scene || !this.bloomA || !this.bloomB) return;
    const gl = this.gl;
    for (let i = 0; i < 3; i++) this.color[i] += (this.goalColor[i]! - this.color[i]!) * Math.min(1, delta * 3);
    this.camera.update(this.form, time, delta, this.contact.down);
    this.wheelEnergy *= Math.exp(-delta * 5.5);
    this.contactStrength += ((this.contact.active ? (this.contact.down ? 1 : .35) : 0) - this.contactStrength) * (1 - Math.exp(-delta * 14));
    const cursorLag = 1 - Math.exp(-delta * 16);
    this.cursor.x += (this.cursorTarget.x - this.cursor.x) * cursorLag;
    this.cursor.y += (this.cursorTarget.y - this.cursor.y) * cursorLag;
    this.cursor.strength += ((this.cursorTarget.inside ? 1 : 0) - this.cursor.strength) * (1 - Math.exp(-delta * 6));
    this.currentPositions = positions;
    this.geometry(positions, delta);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer); gl.viewport(0, 0, this.scene.width, this.scene.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.dustVAO); this.meshUniforms(this.points, time, 1); gl.drawArrays(gl.POINTS, 0, this.dustCount);
    gl.bindVertexArray(this.meshVAO); this.meshUniforms(this.lines, time, 0); gl.drawElements(gl.LINES, this.edgeCount, gl.UNSIGNED_SHORT, 0);
    this.meshUniforms(this.points, time, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pointBuffer); gl.drawElements(gl.POINTS, this.pointList.length, gl.UNSIGNED_SHORT, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeBuffer);
    gl.bindVertexArray(null); gl.disable(gl.BLEND);
    this.blurPass(this.scene.texture, this.bloomA, 1.6 / this.bloomA.width, 0);
    this.blurPass(this.bloomA.texture, this.bloomB, 0, 1.6 / this.bloomB.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.texture); gl.uniform1i(this.uniform(this.composite, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bloomB.texture); gl.uniform1i(this.uniform(this.composite, 'uBloom'), 1);
    gl.uniform1f(this.uniform(this.composite, 'uAspect'), this.aspect); gl.uniform3f(this.uniform(this.composite, 'uColor'), this.color[0]!, this.color[1]!, this.color[2]!);
    gl.uniform1f(this.uniform(this.composite, 'uTime'), time);
    gl.uniform1f(this.uniform(this.composite, 'uGlow'), Math.min(1, this.wheelEnergy * .8 + this.contactStrength * .45));
    gl.uniform3f(this.uniform(this.composite, 'uCursor'), this.cursor.x, this.cursor.y, this.cursor.strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  point(index: number) {
    const positions = this.currentPositions ?? this.reference, at = index * 3;
    const position = { x: positions[at]!, y: positions[at + 1]!, z: positions[at + 2]! };
    const p = project(position, this.view);
    return { ...position, screenX: (p.x + 1) * this.width * .5, screenY: (1 - p.y) * this.height * .5, depth: p.z, index };
  }

  pick(clientX: number, clientY: number) {
    if (!this.currentPositions) return null;
    const bounds = this.canvas.getBoundingClientRect(), x = clientX - bounds.left, y = clientY - bounds.top;
    let best = 42 * 42, selected = -1;
    const { rotation, scale, center } = this.view;
    const [pitch, yaw, roll] = rotation;
    const cx = Math.cos(pitch!), sx = Math.sin(pitch!), cy = Math.cos(yaw!), sy = Math.sin(yaw!), cz = Math.cos(roll!), sz = Math.sin(roll!);
    const positions = this.currentPositions;
    for (const index of this.pointList) {
      const at = index * 3, px = positions[at]!, py = positions[at + 1]!, pz = positions[at + 2]!;
      const ry = cx * py - sx * pz, rz = sx * py + cx * pz, rx = cy * px + sy * rz, depth = -sy * px + cy * rz;
      const perspective = 5.5 / (5.5 + depth);
      const dx = ((cz * rx - sz * ry) * scale * perspective / this.aspect + center[0]! + 1) * this.width * .5 - x;
      const dy = (1 - ((sz * rx + cz * ry) * scale * perspective + center[1]!)) * this.height * .5 - y;
      const score = dx * dx + dy * dy + (depth + 3) * 16;
      if (score < best) { best = score; selected = index; }
    }
    return selected >= 0 ? this.point(selected) : null;
  }

  grab(clientX: number, clientY: number) {
    const hit = this.pick(clientX, clientY);
    if (!hit) return null;
    const bounds = this.canvas.getBoundingClientRect();
    return new SurfaceGrab(hit, hit.index, clientX, clientY, this.view, { left: bounds.left, top: bounds.top, width: this.width, height: this.height });
  }

  dispose() {
    const gl = this.gl;
    this.deleteTarget(this.scene); this.deleteTarget(this.bloomA); this.deleteTarget(this.bloomB);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const program of this.programs) gl.deleteProgram(program);
    gl.deleteVertexArray(this.meshVAO); gl.deleteVertexArray(this.dustVAO);
  }
}
