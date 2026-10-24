import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from '../../src/rendering/AdaptiveResolution';

/** Feeds intervals starting at `start` ms; returns every non-null scale change and the end time. */
function feed(controller: AdaptiveResolution, intervals: number[], start: number) {
  let now = start; const changes: number[] = [];
  for (const interval of intervals) {
    now += interval;
    const next = controller.sample(interval, now);
    if (next !== null) changes.push(next);
  }
  return { changes, now };
}
const repeat = (value: number, count: number) => Array<number>(count).fill(value);

describe('AdaptiveResolution', () => {
  it('ignores a single 400 ms compile spike', () => {
    const controller = new AdaptiveResolution();
    expect(feed(controller, [...repeat(10, 119), 400], 0).changes).toEqual([]);
    expect(controller.scale).toBe(1);
  });
  it('steps down exactly one level on a sustained slow window', () => {
    const controller = new AdaptiveResolution();
    const first = feed(controller, repeat(22, 120), 0);
    expect(first.changes).toEqual([0.875]);
    expect(feed(controller, repeat(22, 60), first.now).changes).toEqual([]); // cooldown
  });
  it('requires three good windows to step up', () => {
    const controller = new AdaptiveResolution();
    const down = feed(controller, repeat(22, 120), 0);
    const afterCooldown = down.now + 2000;
    const two = feed(controller, repeat(8, 240), afterCooldown);
    expect(two.changes).toEqual([]);
    expect(controller.scale).toBe(0.875);
    expect(feed(controller, repeat(8, 120), two.now).changes).toEqual([1]);
  });
  it('never goes below 0.5', () => {
    const controller = new AdaptiveResolution();
    let now = 0;
    for (let i = 0; i < 8; i++) now = feed(controller, repeat(30, 120), now).now + 2000;
    expect(controller.scale).toBe(0.5);
  });
  it('lock pins the scale and ignores samples; lock(null) resumes Auto', () => {
    const controller = new AdaptiveResolution();
    controller.lock(0.75);
    const locked = feed(controller, repeat(30, 360), 0);
    expect(locked.changes).toEqual([]);
    expect(controller.scale).toBe(0.75);
    controller.lock(null);
    expect(feed(controller, repeat(30, 120), locked.now).changes).toEqual([0.875]);
  });
  it("reset discards the previous mode's window and starts warmup", () => {
    const controller = new AdaptiveResolution();
    const slow = feed(controller, repeat(30, 100), 0);
    controller.reset(slow.now);
    expect(feed(controller, repeat(30, 120), slow.now).changes).toEqual([]); // inside 5 s warmup
    expect(feed(controller, repeat(10, 120), slow.now + 5000).changes).toEqual([]);
    expect(controller.scale).toBe(1);
  });
  it('ignores a hidden-tab gap', () => {
    expect(new AdaptiveResolution().sample(3000, 3000)).toBeNull();
  });
  it('honours a 120 Hz budget', () => {
    const controller = new AdaptiveResolution({ budgetMs: 1000 / 120 });
    expect(feed(controller, repeat(9.5, 120), 0).changes).toEqual([0.875]);
  });
});

describe('AdaptiveResolution on vsync-capped displays', () => {
  it('probes back up from a transient downscale when steady at the 60 Hz cap', () => {
    const controller = new AdaptiveResolution();
    const down = feed(controller, repeat(22, 120), 0);
    expect(controller.scale).toBe(0.875);
    expect(feed(controller, repeat(16.7, 360), down.now + 2000).changes).toEqual([1]);
  });
  it('reverts a probe that makes frames slow again and backs off', () => {
    const controller = new AdaptiveResolution();
    const down = feed(controller, repeat(22, 120), 0);
    const probe = feed(controller, repeat(16.7, 360), down.now + 2000);
    expect(probe.changes).toEqual([1]);
    const regress = feed(controller, repeat(22, 120), probe.now + 2000);
    expect(regress.changes).toEqual([0.875]);
    // Backed off: three more good windows are not enough for another probe straight away.
    expect(feed(controller, repeat(16.7, 360), regress.now + 2000).changes).toEqual([]);
  });
  it('does not downscale a steady 50 Hz display when measured frame cost is low', () => {
    const controller = new AdaptiveResolution();
    let now = 0; const changes: number[] = [];
    for (let i = 0; i < 600; i++) { now += 20; const next = controller.sample(20, now, 3); if (next !== null) changes.push(next); }
    expect(changes).toEqual([]);
  });
  it('still downscales slow frames when measured frame cost is high', () => {
    const controller = new AdaptiveResolution();
    let now = 0; const changes: number[] = [];
    for (let i = 0; i < 120; i++) { now += 22; const next = controller.sample(22, now, 19); if (next !== null) changes.push(next); }
    expect(changes).toEqual([0.875]);
  });
});
