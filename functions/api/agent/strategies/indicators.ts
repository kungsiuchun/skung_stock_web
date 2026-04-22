/**
 * Financial Technical Indicators Helper
 */

export interface MACDResult {
  dif: number;
  dea: number;
  bar: number;
}

export interface BollingerResult {
  upper: number;
  mid: number;
  lower: number;
}

export class TechnicalIndicators {
  static SMA(data: number[], period: number): number {
    if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
    const slice = data.slice(data.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  static EMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  static MACD(data: number[], fast = 12, slow = 26, signal = 9): MACDResult {
    const emaFastArr: number[] = [];
    const emaSlowArr: number[] = [];
    const difArr: number[] = [];

    // Calculate DIF
    for (let i = 0; i < data.length; i++) {
      const subset = data.slice(0, i + 1);
      const f = this.EMA(subset, fast);
      const s = this.EMA(subset, slow);
      emaFastArr.push(f);
      emaSlowArr.push(s);
      difArr.push(f - s);
    }

    // Calculate DEA (Signal line)
    const deaArr: number[] = [];
    for (let i = 0; i < difArr.length; i++) {
      deaArr.push(this.EMA(difArr.slice(0, i + 1), signal));
    }

    const lastDif = difArr[difArr.length - 1];
    const lastDea = deaArr[deaArr.length - 1];

    return {
      dif: lastDif,
      dea: lastDea,
      bar: (lastDif - lastDea) * 2
    };
  }

  static RSI(data: number[], period = 14): number {
    if (data.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = data.length - period; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  static BollingerBands(data: number[], period = 20, stdDev = 2): BollingerResult {
    const slice = data.slice(Math.max(0, data.length - period));
    const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
    
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / slice.length;
    const sd = Math.sqrt(variance);

    return {
      upper: mid + stdDev * sd,
      mid: mid,
      lower: mid - stdDev * sd
    };
  }

  static Fibonacci(high: number, low: number): Record<string, number> {
    const range = high - low;
    return {
      '0': low,
      '23.6': high - range * 0.236,
      '38.2': high - range * 0.382,
      '50': high - range * 0.5,
      '61.8': high - range * 0.618,
      '78.6': high - range * 0.786,
      '100': high,
      '161.8': high + range * 1.618
    };
  }
}
