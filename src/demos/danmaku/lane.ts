/**
 * Lane (track) allocation for danmaku — the classic "don't let comments overlap"
 * problem. The stage is divided into horizontal lanes one line tall. Scrolling
 * comments enter from the right; a lane may only be reused once the previous
 * comment has both (A) cleared the right spawn edge and (B) won't be overtaken
 * by a faster follower before it exits the left edge. Top/bottom comments hold a
 * lane for a fixed duration.
 *
 * All times are in milliseconds, positions in pixels, speed in px/ms.
 */
export interface ScrollSpec {
  now: number;
  width: number;
  speed: number;
  stageWidth: number;
}

interface Lane {
  scrollFreeAt: number; // earliest time the spawn gap is clear (condition A)
  scrollExitAt: number; // time the last comment's tail clears the left edge
  fixedUntil: number; // time a top/bottom comment stops occupying the lane
}

const emptyLane = (): Lane => ({
  scrollFreeAt: -Infinity,
  scrollExitAt: -Infinity,
  fixedUntil: -Infinity,
});

export class LaneManager {
  private lanes: Lane[] = [];

  constructor(count: number) {
    this.setLaneCount(count);
  }

  get laneCount(): number {
    return this.lanes.length;
  }

  setLaneCount(n: number): void {
    if (n < this.lanes.length) this.lanes.length = n;
    else while (this.lanes.length < n) this.lanes.push(emptyLane());
  }

  reset(): void {
    for (const l of this.lanes) Object.assign(l, emptyLane());
  }

  /** Allocate a lane for a scrolling comment, or -1 if none is free right now. */
  allocateScroll(spec: ScrollSpec): number {
    const { now, width, speed, stageWidth } = spec;
    for (let i = 0; i < this.lanes.length; i++) {
      const l = this.lanes[i];
      const noOvertake = now >= l.scrollExitAt - stageWidth / speed;
      if (now >= l.scrollFreeAt && noOvertake) {
        l.scrollFreeAt = now + width / speed;
        l.scrollExitAt = now + (stageWidth + width) / speed;
        return i;
      }
    }
    return -1;
  }

  /** Allocate a lane for a fixed (top/bottom) comment held for `durationMs`. */
  allocateFixed(now: number, durationMs: number, from: 'top' | 'bottom'): number {
    const n = this.lanes.length;
    for (let k = 0; k < n; k++) {
      const i = from === 'top' ? k : n - 1 - k;
      const l = this.lanes[i];
      if (now >= l.fixedUntil) {
        l.fixedUntil = now + durationMs;
        return i;
      }
    }
    return -1;
  }
}
