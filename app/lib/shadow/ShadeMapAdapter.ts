import type { IShadowLayer } from './IShadowLayer';

export class ShadeMapAdapter implements IShadowLayer {
  private _lastDate: Date = new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private instance: any) {}

  setDate(date: Date) {
    this._lastDate = date;
    this.instance.setDate(date);
  }

  resize() {
    this.instance.setDate(this._lastDate);
  }

  remove() {
    this.instance.remove?.();
  }

  setSunExposure(enabled: boolean, opts?: { startDate: Date; endDate: Date; iterations: number }) {
    if (enabled) {
      this.instance.setSunExposure?.(true, opts);
    } else {
      this.instance.setSunExposure?.(false);
    }
  }

  on(event: string, callback: () => void) {
    this.instance.on?.(event, callback);
  }
}
