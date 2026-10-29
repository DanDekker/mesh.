import { COUNT, writeShape, type Form } from '../shared/field.ts';
import { fit, type View } from './camera.ts';

export class FieldCamera {
  readonly reference = new Float32Array(COUNT * 3);
  readonly view: View = { rotation: [.86, .12, -.31], scale: .65, aspect: 1, center: [0, .035] };
  private fitted = false;
  private time = 0;
  private previous = 0;

  resize(aspect: number) { this.view.aspect = aspect; this.fitted = false; }

  update(form: Form, time: number, delta: number, held: boolean) {
    writeShape(this.reference, form, time);
    if (time < this.previous - .2) this.time = 0;
    if (!held) this.time += Math.max(0, Math.min(.1, time - this.previous));
    this.previous = time;
    if (held && this.fitted) return;
    this.view.rotation = [.86 + Math.sin(this.time * .055) * .17, .12 + this.time * .045, -.31 + Math.sin(this.time * .04) * .13];
    // A local pull must not pan or resize the rest of the sculpture.
    const framing = fit(this.reference, this.view.rotation, this.view.aspect, 3);
    const blend = this.fitted ? 1 - Math.exp(-delta * 2.5) : 1;
    this.view.scale += (framing.scale - this.view.scale) * blend;
    for (let i = 0; i < 2; i++) this.view.center[i] += (framing.center[i]! - this.view.center[i]!) * blend;
    this.fitted = true;
  }
}
