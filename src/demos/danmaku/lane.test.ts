import { describe, expect, test } from 'bun:test';
import { LaneManager, type ScrollSpec } from './lane';

// A danmaku ~100px wide crossing a 1000px stage at 0.2 px/ms (5s crossing).
const scroll = (now: number, over: Partial<ScrollSpec> = {}): ScrollSpec => ({
  now,
  width: 100,
  speed: 0.2,
  stageWidth: 1000,
  ...over,
});

describe('LaneManager — scrolling allocation', () => {
  test('first danmaku takes the top lane (0)', () => {
    const lm = new LaneManager(5);
    expect(lm.allocateScroll(scroll(0))).toBe(0);
  });

  test('a second danmaku at the same instant cannot reuse the busy lane', () => {
    const lm = new LaneManager(5);
    expect(lm.allocateScroll(scroll(0))).toBe(0);
    expect(lm.allocateScroll(scroll(0))).toBe(1);
  });

  test('a lane frees once the previous tail has cleared the spawn edge', () => {
    const lm = new LaneManager(1);
    expect(lm.allocateScroll(scroll(0))).toBe(0);
    // tail clears the right edge at width/speed = 100/0.2 = 500ms; before that → no lane
    expect(lm.allocateScroll(scroll(499))).toBe(-1);
    expect(lm.allocateScroll(scroll(500))).toBe(0);
  });

  test('returns -1 when every lane is occupied', () => {
    const lm = new LaneManager(2);
    expect(lm.allocateScroll(scroll(0))).toBe(0);
    expect(lm.allocateScroll(scroll(0))).toBe(1);
    expect(lm.allocateScroll(scroll(0))).toBe(-1);
  });

  test('a faster follower is blocked longer than the spawn-gap (no overtaking)', () => {
    const lm = new LaneManager(1);
    // slow leader: width 200, speed 0.1 → freeAt = 2000ms, exitAt = (1000+200)/0.1 = 12000ms
    expect(lm.allocateScroll(scroll(0, { width: 200, speed: 0.1 }))).toBe(0);
    // a fast follower (speed 0.5) at t=2000 has cleared the spawn gap, but would
    // overtake: it needs now >= exitAt - stageWidth/speed = 12000 - 2000 = 10000.
    expect(lm.allocateScroll(scroll(2000, { speed: 0.5 }))).toBe(-1);
    expect(lm.allocateScroll(scroll(10000, { speed: 0.5 }))).toBe(0);
  });
});

describe('LaneManager — fixed (top/bottom) allocation', () => {
  test('top fixed danmaku fill from the top lane downward', () => {
    const lm = new LaneManager(4);
    expect(lm.allocateFixed(0, 4000, 'top')).toBe(0);
    expect(lm.allocateFixed(0, 4000, 'top')).toBe(1);
  });

  test('bottom fixed danmaku fill from the bottom lane upward', () => {
    const lm = new LaneManager(4);
    expect(lm.allocateFixed(0, 4000, 'bottom')).toBe(3);
    expect(lm.allocateFixed(0, 4000, 'bottom')).toBe(2);
  });

  test('a fixed lane is reusable once its hold time expires', () => {
    const lm = new LaneManager(1);
    expect(lm.allocateFixed(0, 4000, 'top')).toBe(0);
    expect(lm.allocateFixed(3999, 4000, 'top')).toBe(-1);
    expect(lm.allocateFixed(4000, 4000, 'top')).toBe(0);
  });
});

describe('LaneManager — lifecycle', () => {
  test('setLaneCount shrinks the usable lanes', () => {
    const lm = new LaneManager(3);
    lm.setLaneCount(1);
    expect(lm.laneCount).toBe(1);
    expect(lm.allocateScroll(scroll(0))).toBe(0);
    expect(lm.allocateScroll(scroll(0))).toBe(-1);
  });

  test('reset frees every lane', () => {
    const lm = new LaneManager(1);
    lm.allocateScroll(scroll(0));
    lm.reset();
    expect(lm.allocateScroll(scroll(0))).toBe(0);
  });
});
