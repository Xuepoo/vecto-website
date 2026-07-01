import { Entity, type IRenderer } from '@vectojs/core';

/**
 * An invisible scene node that measures the scene's real frame rate. Add it to a
 * Scene and read {@link fps}; for an honest performance report, wire
 * {@link startSampling}/{@link stopSampling} into report.ts's `frameSampler` so
 * the report uses the scene's own per-frame dt (not its own rAF). Reusable across
 * demos that don't already track their own frame timing.
 */
export class FrameMeter extends Entity {
  fps = 60;
  private samples: number[] | null = null;

  constructor() {
    super();
    this.interactive = false;
  }

  isPointInside(): boolean {
    return false;
  }
  getBounds(): null {
    return null;
  }
  render(_r: IRenderer): void {}

  update(dt: number): void {
    if (dt > 0) this.fps += (1000 / dt - this.fps) * 0.1;
    if (this.samples && dt > 0) this.samples.push(dt);
  }

  startSampling(): void {
    this.samples = [];
  }
  stopSampling(): number[] {
    const s = this.samples ?? [];
    this.samples = null;
    return s;
  }
}
