import { Entity, type Scene } from '@vectojs/core';
import { Danmaku } from './danmaku';
import { LaneManager } from './lane';
import { Pool } from './pool';
import { rollComment, type CommentDraw } from './corpus';

export type Measure = (text: string, font: string) => number;

const FIXED_HOLD_MS = 4200;
// Fast enough that a 5000 target fills in a few seconds rather than ~10.
const MAX_SPAWN_PER_FRAME = 24;

/**
 * Drives the danmaku stream: an invisible controller entity that, each frame,
 * moves scrolling comments, retires off-screen / expired ones (recycled through
 * a {@link Pool}), and tops the stage up toward a target on-screen count using a
 * {@link LaneManager} for clean placement (falling back to overlap when the
 * target exceeds lane capacity — that's the "thousands of comments" stress mode).
 */
export class DanmakuEngine extends Entity {
  readonly active: Danmaku[] = [];
  stageWidth = 1280;
  stageHeight = 480;
  lineHeight = 32;

  paused = false;
  hidden = false;
  /** stress: `target` is the simultaneous on-screen count; realistic: comments/min. */
  mode: 'stress' | 'realistic' = 'stress';
  target = 200; // on-screen count (stress) or comments-per-minute (realistic)
  speedScale = 1; // user speed multiplier
  playbackRate = 1; // follows the video so danmaku move in the video's time
  danmakuOpacity = 1;
  area: 'full' | 'top' = 'full';
  private spawnAcc = 0; // fractional spawn budget for realistic mode

  private pool = new Pool<Danmaku>(
    () => new Danmaku(),
    (d) => {
      d.hovered = false;
      d.liked = false;
      d.likes = 0;
    },
  );
  private lanes = new LaneManager(15);
  private now = 0;
  private rrLane = 0; // round-robin cursor for the overlap fallback
  fps = 60; // smoothed render rate, surfaced to the HUD
  private samples: number[] | null = null; // per-frame dt capture for the report

  /** Begin capturing the scene's real per-frame dt (for an honest perf report). */
  startSampling(): void {
    this.samples = [];
  }

  /** Stop capturing and return the collected per-frame dt values (ms). */
  stopSampling(): number[] {
    const s = this.samples ?? [];
    this.samples = null;
    return s;
  }

  constructor(
    private host: Scene,
    private measure: Measure,
  ) {
    super();
    this.interactive = false;
  }

  isPointInside(): boolean {
    return false;
  }
  getBounds(): null {
    return null;
  }
  render(): void {}

  get created(): number {
    return this.pool.created;
  }

  resize(w: number, h: number): void {
    this.stageWidth = w;
    this.stageHeight = h;
    const usable = this.area === 'top' ? h / 4 : h;
    this.lanes.setLaneCount(Math.max(1, Math.floor(usable / this.lineHeight)));
  }

  setArea(area: 'full' | 'top'): void {
    this.area = area;
    this.resize(this.stageWidth, this.stageHeight);
  }

  private laneY(lane: number): number {
    return (lane + 0.5) * this.lineHeight + 8;
  }

  /** Spawn a specific comment. Returns the entity, or null if nothing was placed. */
  spawn(draw: CommentDraw): Danmaku | null {
    const d = this.pool.acquire();
    d.text = draw.text;
    d.color = draw.color;
    d.fontSize = draw.fontSize;
    d.type = draw.type;
    d.bornAt = this.now;
    d.opacity = this.hidden ? 0 : this.danmakuOpacity;
    d.measuredWidth = this.measure(draw.text, d.font);

    const lane = this.placeLane(d);
    if (lane < 0) {
      this.pool.release(d);
      return null;
    }
    d.y = this.laneY(lane);
    if (d.type === 'scroll') {
      d.speed = (0.06 + (d.fontSize > 26 ? 0.02 : 0.05) + Math.random() * 0.03) * this.speedScale;
      d.x = this.stageWidth;
    } else {
      d.x = (this.stageWidth - d.measuredWidth) / 2;
      d.expireAt = this.now + FIXED_HOLD_MS;
    }
    this.host.add(d);
    this.active.push(d);
    return d;
  }

  /** Find a lane: prefer collision-free placement, fall back to overlap if dense. */
  private placeLane(d: Danmaku): number {
    if (d.type === 'scroll') {
      const lane = this.lanes.allocateScroll({
        now: this.now,
        width: d.measuredWidth,
        speed: d.speed || 0.12,
        stageWidth: this.stageWidth,
      });
      if (lane >= 0) return lane;
    } else {
      const lane = this.lanes.allocateFixed(this.now, FIXED_HOLD_MS, d.type as 'top' | 'bottom');
      if (lane >= 0) return lane;
    }
    // Overlap fallback: only when we still want more comments on screen.
    if (this.active.length < this.target) {
      this.rrLane = (this.rrLane + 1) % Math.max(1, this.lanes.laneCount);
      return this.rrLane;
    }
    return -1;
  }

  private retire(d: Danmaku): void {
    this.host.remove(d);
    this.pool.release(d);
  }

  update(dt: number, time: number): void {
    this.now = time;
    if (dt > 0) this.fps += (1000 / dt - this.fps) * 0.1;
    if (this.samples && dt > 0) this.samples.push(dt);
    if (this.paused) return;

    // Comments live in the video's time, so a 2x video moves them 2x as fast.
    const move = dt * this.playbackRate;

    // Move + cull in a single compacting pass.
    let w = 0;
    for (let i = 0; i < this.active.length; i++) {
      const d = this.active[i];
      d.opacity = this.hidden ? 0 : this.danmakuOpacity;
      if (d.type === 'scroll') {
        if (!d.hovered) d.x -= d.speed * move;
        if (d.x + d.measuredWidth < -4) {
          this.retire(d);
          continue;
        }
      } else if (!d.hovered && time >= d.expireAt) {
        this.retire(d);
        continue;
      }
      this.active[w++] = d;
    }
    this.active.length = w;

    if (this.hidden) return; // invisible comments need not spawn

    if (this.mode === 'realistic') {
      // A timeline-tied stream: spawn at `target` comments/min, scaled by the
      // video's playback rate. The on-screen count is whatever results.
      this.spawnAcc += (move * this.target) / 60000;
      let n = Math.min(Math.floor(this.spawnAcc), MAX_SPAWN_PER_FRAME);
      this.spawnAcc -= Math.floor(this.spawnAcc);
      while (n-- > 0) this.spawn(rollComment());
    } else {
      // Stress: keep ~`target` comments on screen, rate-limited so it fills in.
      let budget = MAX_SPAWN_PER_FRAME;
      while (this.active.length < this.target && budget-- > 0) {
        if (!this.spawn(rollComment())) break;
      }
    }
  }

  /** Topmost comment under a stage-space point, or null. */
  hitTest(x: number, y: number): Danmaku | null {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].isPointInside(x, y)) return this.active[i];
    }
    return null;
  }

  clear(): void {
    for (const d of this.active) this.retire(d);
    this.active.length = 0;
    this.lanes.reset();
  }
}
