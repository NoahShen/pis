import type { Clock } from "../../src/time/clock.js";

export class FakeClock implements Clock {
  private currentTime: number;

  constructor(initialTime: Date) {
    this.currentTime = initialTime.getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advance(milliseconds: number): void {
    this.currentTime += milliseconds;
  }
}
