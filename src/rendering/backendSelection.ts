export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';
export type BackendName = 'webgpu' | 'webgl2';

export interface BackendInitResult<T extends { dispose(): void | Promise<void> }> {
  renderer: T;
  backend: BackendName;
  failures: string[];
}

/** Initialize first, report the actual backend, and dispose failures before retrying. */
export async function initializeBackend<T extends { dispose(): void | Promise<void> }>(
  preference: BackendPreference,
  create: (forceWebGL: boolean) => T,
  initialize: (candidate: T) => Promise<BackendName>,
): Promise<BackendInitResult<T>> {
  const failures: string[] = [];
  const attempts = preference === 'auto' ? [false, true] : [preference === 'webgl2'];
  for (const forceWebGL of attempts) {
    let candidate: T | undefined;
    const label = forceWebGL ? 'WebGL2' : 'WebGPU';
    try {
      candidate = create(forceWebGL);
      const backend = await initialize(candidate);
      if ((forceWebGL && backend !== 'webgl2') || (preference === 'webgpu' && backend !== 'webgpu')) {
        throw new Error(`Requested ${label} but initialized ${backend}`);
      }
      return { renderer: candidate, backend, failures };
    } catch (error) {
      failures.push(`${label} initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      try { await candidate?.dispose(); }
      catch (error) { failures.push(`Disposal failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  throw new Error(`Backend initialization failed: ${failures.join('; ')}`);
}
