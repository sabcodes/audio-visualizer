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
