import { describe, expect, it, vi } from 'vitest';
import { initializeBackend } from '../../src/rendering/backendSelection';

describe('backend initialization', () => {
  it('reports the actual initialized backend rather than navigator capabilities', async () => {
    const candidate = { dispose: vi.fn() };
    const result = await initializeBackend('auto', () => candidate, async () => 'webgl2');
    expect(result.backend).toBe('webgl2');
    expect(candidate.dispose).not.toHaveBeenCalled();
  });

  it('awaits failed native disposal before constructing the fallback', async () => {
    const events: string[] = [];
    const result = await initializeBackend('auto', (forced) => {
      events.push(`create-${forced}`);
      return { forced, async dispose() { await Promise.resolve(); events.push('disposed'); } };
    }, async ({ forced }) => {
      if (!forced) throw new Error('adapter denied');
      return 'webgl2';
    });
    expect(events).toEqual(['create-false', 'disposed', 'create-true']);
    expect(result.backend).toBe('webgl2');
    expect(result.failures.join()).toContain('adapter denied');
  });

  it('forced GL constructs only one GL candidate and disposes it on failure', async () => {
    const dispose = vi.fn();
    const create = vi.fn(() => ({ dispose }));
    await expect(initializeBackend('webgl2', create, async () => { throw new Error('unavailable'); })).rejects.toThrow('unavailable');
    expect(create).toHaveBeenCalledExactlyOnceWith(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('strict native preference rejects implicit renderer fallback', async () => {
    const dispose = vi.fn();
    const create = vi.fn(() => ({ dispose }));
    await expect(initializeBackend('webgpu', create, async () => 'webgl2')).rejects.toThrow('initialized webgl2');
    expect(create).toHaveBeenCalledExactlyOnceWith(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('forced fallback also validates the actual backend and disposes once', async () => {
    const disposals = [vi.fn(), vi.fn()];
    let index = 0;
    const create = () => ({ id: index, dispose: disposals[index++] });
    await expect(initializeBackend('auto', create, async ({ id }) => {
      if (id === 0) throw new Error('native unavailable');
      return 'webgpu';
    })).rejects.toThrow('initialized webgpu');
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it('constructor failure never re-disposes an earlier candidate', async () => {
    const dispose = vi.fn();
    let count = 0;
    await expect(initializeBackend('auto', () => {
      if (count++) throw new Error('constructor failed');
      return { dispose };
    }, async () => { throw new Error('init failed'); })).rejects.toThrow(/init failed.*constructor failed/);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('retains async disposal errors and still attempts the fallback', async () => {
    const create = (forced: boolean) => ({ forced, async dispose() { throw new Error('cleanup error'); } });
    const result = await initializeBackend('auto', create, async ({ forced }) => {
      if (!forced) throw new Error('init error');
      return 'webgl2';
    });
    expect(result.failures.join('; ')).toMatch(/init error.*cleanup error/);
  });
});
