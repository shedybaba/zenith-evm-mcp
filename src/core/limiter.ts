export interface RateLimiterOptions {
  /** Maximum calls started within one window. */
  maxPerWindow: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum calls running at the same time. */
  maxConcurrent: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window rate limiter with a concurrency cap.
 * Calls wait (in FIFO order) instead of failing when a limit is reached.
 */
export class RateLimiter {
  private readonly started: number[] = [];
  private active = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: RateLimiterOptions) {
    if (opts.maxPerWindow < 1 || opts.maxConcurrent < 1 || opts.windowMs < 1) {
      throw new Error("RateLimiter limits must be positive");
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active -= 1;
    }
  }

  private acquire(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.started.length > 0 && now - this.started[0]! >= this.opts.windowMs) {
        this.started.shift();
      }
      if (this.active < this.opts.maxConcurrent && this.started.length < this.opts.maxPerWindow) {
        this.started.push(now);
        this.active += 1;
        return;
      }
      const windowWait =
        this.started.length >= this.opts.maxPerWindow
          ? this.opts.windowMs - (now - this.started[0]!) + 1
          : 5;
      await sleep(Math.max(5, Math.min(windowWait, 1000)));
    }
  }
}
