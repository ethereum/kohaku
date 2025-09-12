import { delay } from '../utils/promises';

export class ProgressService {
  private startValue: number;

  private endValue: number;

  private totalMsec: number;

  private delayMsec: number;

  private stopped = false;

  constructor(startValue: number, endValue: number, totalMsec: number, delayMsec: number) {
    this.startValue = startValue;
    this.endValue = endValue;
    this.totalMsec = totalMsec;
    this.delayMsec = delayMsec;
  }

  /**
   * Calls progressCallback once every delayMsec msec.
   * Progresses linearly between startValue and endValue, until stop() is called.
   */
  async progressSteadily(progressCallback: (progress: number) => void, iteration = 0) {
    if (this.stopped) {
      return;
    }
    const numTotalIterations = this.totalMsec / this.delayMsec;
    const currentValue =
      this.startValue + (iteration / numTotalIterations) * (this.endValue - this.startValue);
    if (currentValue > this.endValue) {
      return;
    }
    progressCallback(currentValue);
    await delay(this.delayMsec);
    await this.progressSteadily(progressCallback, iteration + 1);
  }

  stop() {
    this.stopped = true;
  }
}
