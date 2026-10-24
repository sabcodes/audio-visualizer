import { describe, expect, it, vi } from 'vitest';
import { FrameLoop } from '../../src/rendering/FrameLoop';

function fixture() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => { pending.set(id, callback); return id++; });
  const cancel = vi.fn((handle: number) => { pending.delete(handle); });
  const loop = new FrameLoop({ request, cancel });
  const run = () => {
    const next = pending.entries().next().value;
    if (!next) throw new Error('No pending frame');
    pending.delete(next[0]); next[1](100);
  };
  return { loop, pending, run, request, cancel };
}
describe('one controlled animation loop', () => {
  it('schedules one frame and handles ID zero on stop', () => {
    const f = fixture(); f.loop.start(vi.fn()); f.loop.stop(); f.loop.stop();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(0);
    expect(f.pending.size).toBe(0);
  });
  it('repeated starts cancel the prior submission', () => {
    const f = fixture(); const first = vi.fn(); const second = vi.fn();
    f.loop.start(first); f.loop.start(second); f.run();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    expect(f.pending.size).toBe(1);
  });
  it('stop inside callback never reschedules', () => {
    const f = fixture(); f.loop.start(() => f.loop.stop()); f.run();
    expect(f.pending.size).toBe(0);
  });
  it('restart inside callback keeps only the new loop', () => {
    const f = fixture(); const next = vi.fn(); f.loop.start(() => f.loop.start(next)); f.run();
    expect(f.pending.size).toBe(1); f.run(); expect(next).toHaveBeenCalledOnce();
  });
  it('ignores stale callbacks even after a new loop starts', () => {
    const f = fixture(); const old = vi.fn(); const next = vi.fn();
    f.loop.start(old); const stale = [...f.pending.values()][0]; f.loop.start(next); stale(0);
    expect(old).not.toHaveBeenCalled(); expect(f.pending.size).toBe(1);
  });
  it('a replaced callback throwing cannot stop its replacement', () => {
    const f = fixture(); const next = vi.fn();
    f.loop.start(() => { f.loop.start(next); throw new Error('old frame failed'); });
    expect(() => f.run()).toThrow('old frame failed');
    expect(f.pending.size).toBe(1); f.run(); expect(next).toHaveBeenCalledOnce();
  });
  it('propagates exceptions without rescheduling and allows recovery', () => {
    const f = fixture(); f.loop.start(() => { throw new Error('frame failed'); });
    expect(() => f.run()).toThrow('frame failed'); expect(f.pending.size).toBe(0);
    const next = vi.fn(); f.loop.start(next); f.run(); expect(next).toHaveBeenCalledOnce();
  });
});
