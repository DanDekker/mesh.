export type Vec3 = { x: number; y: number; z: number };
export type View = { rotation: number[]; scale: number; aspect: number; center: number[] };

export function rotate(point: Vec3, angles: number[]): Vec3 {
  let { x, y, z } = point;
  const [pitch, yaw, roll] = angles;
  [y, z] = [Math.cos(pitch!) * y - Math.sin(pitch!) * z, Math.sin(pitch!) * y + Math.cos(pitch!) * z];
  [x, z] = [Math.cos(yaw!) * x + Math.sin(yaw!) * z, -Math.sin(yaw!) * x + Math.cos(yaw!) * z];
  [x, y] = [Math.cos(roll!) * x - Math.sin(roll!) * y, Math.sin(roll!) * x + Math.cos(roll!) * y];
  return { x, y, z };
}

export function inverseRotate(point: Vec3, angles: number[]): Vec3 {
  let { x, y, z } = point;
  const [pitch, yaw, roll] = angles;
  [x, y] = [Math.cos(-roll!) * x - Math.sin(-roll!) * y, Math.sin(-roll!) * x + Math.cos(-roll!) * y];
  [x, z] = [Math.cos(-yaw!) * x + Math.sin(-yaw!) * z, -Math.sin(-yaw!) * x + Math.cos(-yaw!) * z];
  [y, z] = [Math.cos(-pitch!) * y - Math.sin(-pitch!) * z, Math.sin(-pitch!) * y + Math.cos(-pitch!) * z];
  return { x, y, z };
}

export function project(point: Vec3, view: View): Vec3 {
  const p = rotate(point, view.rotation), perspective = 5.5 / (5.5 + p.z);
  return { x: p.x * view.scale * perspective / view.aspect + view.center[0]!, y: p.y * view.scale * perspective + view.center[1]!, z: p.z };
}

export function unproject(x: number, y: number, depth: number, view: View): Vec3 {
  const perspective = 5.5 / (5.5 + depth);
  return inverseRotate({ x: (x - view.center[0]!) * view.aspect / (view.scale * perspective), y: (y - view.center[1]!) / (view.scale * perspective), z: depth }, view.rotation);
}

export function fit(points: Float32Array, rotation: number[], aspect: number, stride = 1) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const cx = Math.cos(rotation[0]!), sx = Math.sin(rotation[0]!), cy = Math.cos(rotation[1]!), sy = Math.sin(rotation[1]!), cz = Math.cos(rotation[2]!), sz = Math.sin(rotation[2]!);
  for (let i = 0; i < points.length; i += 3 * stride) {
    const px = points[i]!, py = points[i + 1]!, pz = points[i + 2]!;
    const ry = cx * py - sx * pz, rz = sx * py + cx * pz;
    const rx = cy * px + sy * rz, depth = -sy * px + cy * rz;
    const perspective = 5.5 / (5.5 + depth), x = (cz * rx - sz * ry) * perspective, y = (sz * rx + cz * ry) * perspective;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (stride > 1) { const px = (x1 - x0) * .03, py = (y1 - y0) * .03; x0 -= px; x1 += px; y0 -= py; y1 += py; }
  const scale = Math.min(aspect * 1.7 / (x1 - x0), 1.42 / (y1 - y0));
  return { scale, center: [-(x1 + x0) * .5 * scale / aspect, -(y1 + y0) * .5 * scale + .035] };
}
