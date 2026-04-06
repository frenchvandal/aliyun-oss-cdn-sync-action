import { delay } from "jsr/async";

export class ApiRateLimiter {
  private gate: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;
  private nextStartTime = 0;

  constructor(limitPerSecond: number) {
    if (!Number.isFinite(limitPerSecond) || limitPerSecond <= 0) {
      throw new Error(
        `limitPerSecond must be a positive finite number, got ${limitPerSecond}`,
      );
    }

    this.intervalMs = Math.max(1, Math.ceil(1000 / limitPerSecond));
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    // Reserve a start slot in a short critical section so calls can overlap in
    // flight while still respecting the configured request-start interval.
    const reservation = this.gate.then(async () => {
      const now = Date.now();
      const scheduledStartTime = Math.max(this.nextStartTime, now);
      this.nextStartTime = scheduledStartTime + this.intervalMs;

      const waitMs = scheduledStartTime - now;
      if (waitMs > 0) {
        await delay(waitMs);
      }
    });

    this.gate = reservation.then(
      () => undefined,
      () => undefined,
    );

    return reservation.then(() => fn());
  }
}
