/**
 * Manages a single controlled animation frame loop with robust start/stop/shutdown.
 * Prevents duplicate frame submissions, stale callbacks, and rogue rescheduling.
 */
export class FrameLoop {
  private requestId: number | null = null;
  private generation = 0;
  private currentCallback: ((timestamp: number) => void) | null = null;
  private stopped = false;

  private scheduler: {
    request: (callback: FrameRequestCallback) => number;
    cancel: (id: number) => void;
  };

  constructor(scheduler?: {
    request: (callback: FrameRequestCallback) => number;
    cancel: (id: number) => void;
  }) {
    this.scheduler = scheduler || {
      request: (cb: FrameRequestCallback) => window.requestAnimationFrame(cb),
      cancel: (id: number) => window.cancelAnimationFrame(id),
    };
  }

  /**
   * Start the frame loop. Stops any previous loop and schedules a new one.
   * The callback will be invoked on each frame with the timestamp.
   *
   * Exceptions in the callback propagate and prevent rescheduling.
   * If stopped or restarted from inside the callback, no reschedule occurs.
   */
  start(callback: (timestamp: number) => void): void {
    this.stop();
    this.stopped = false;
    this.currentCallback = callback;
    const gen = ++this.generation;
    this.schedule(gen);
  }

  /**
   * Stop the frame loop. Idempotent and handles even requestId === 0.
   * Can be called from inside the callback without issues.
   */
  stop(): void {
    ++this.generation;
    this.currentCallback = null;
    this.stopped = true;
    if (this.requestId !== null) {
      this.scheduler.cancel(this.requestId);
      this.requestId = null;
    }
  }

  /**
   * Internal method to schedule the next frame.
   * Guards against stale generations and respects stopped state.
   */
  private schedule(gen: number): void {
    if (gen !== this.generation || this.stopped) {
      return;
    }

    this.requestId = this.scheduler.request((timestamp: number) => {
      // Guard: stale generation or stopped
      if (gen !== this.generation || this.stopped) {
        return;
      }

      this.requestId = null;
      const callback = this.currentCallback;
      if (!callback) {
        return;
      }

      try {
        callback(timestamp);
      } catch (error) {
        // Exception propagates, prevents reschedule
        if (gen === this.generation) this.stop();
        throw error;
      }

      // Only reschedule if not stopped and generation still matches
      if (gen === this.generation && !this.stopped) {
        this.schedule(gen);
      }
    });
  }
}
