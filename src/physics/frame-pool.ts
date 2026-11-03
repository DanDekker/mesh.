// One frame can be displayed while the other is in transit. If the main thread
// falls behind, keep the latest simulation state instead of queueing allocations.
export class FramePool {
  private allocated = 0;
  private spare: Float32Array[] = [];

  constructor(private length: number) {}

  take(): Float32Array | undefined {
    const positions = this.spare.pop();
    if (positions) return positions;
    if (this.allocated >= 2) return;
    this.allocated++;
    return new Float32Array(this.length);
  }

  recycle(buffer: ArrayBuffer) {
    if (buffer.byteLength !== this.length * 4 || this.spare.length >= this.allocated) return;
    this.spare.push(new Float32Array(buffer));
  }
}
