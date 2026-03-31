import { Logger } from "../logger";

export class Heartbeat {
  private lastTick: Date | null = null;
  private log: Logger;
  private intervalMs: number;

  constructor(tickIntervalMs: number, log: Logger) {
    this.intervalMs = tickIntervalMs;
    this.log = log.child("heartbeat");
  }

  tick() {
    this.lastTick = new Date();
  }

  isStale(): boolean {
    if (!this.lastTick) return false; // Never ticked yet, not stale
    const elapsed = Date.now() - this.lastTick.getTime();
    return elapsed > this.intervalMs * 2;
  }

  getLastTick(): Date | null {
    return this.lastTick;
  }
}
