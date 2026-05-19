// ============================================================
// Technical Indicators — pure functions
// ============================================================

/**
 * Simple Moving Average
 * Returns array of same length as closes, with null for pre-period positions
 */
export function calcMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period <= 0) return []
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period) return result

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += closes[i]
  }
  result[period - 1] = sum / period

  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period]
    result[i] = sum / period
  }

  return result
}

/**
 * Exponential Moving Average
 * Uses SMA for the first EMA seed value, then recursive EMA formula
 */
export function calcEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period <= 0) return []
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period) return result

  const k = 2 / (period + 1)

  // Seed: SMA of first `period` closes
  let seedSum = 0
  for (let i = 0; i < period; i++) {
    seedSum += closes[i]
  }
  let ema = seedSum / period
  result[period - 1] = ema

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    result[i] = ema
  }

  return result
}

/**
 * MACD: DIF = EMA12 - EMA26, DEA = EMA9 of DIF, histogram = 2*(DIF - DEA)
 */
export function calcMACD(closes: number[]): {
  dif: (number | null)[]
  dea: (number | null)[]
  histogram: (number | null)[]
} {
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)

  const dif: (number | null)[] = new Array(closes.length).fill(null)
  // First valid DIF appears at index 25 (when EMA26 is seeded)
  const difValues: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      dif[i] = ema12[i]! - ema26[i]!
      difValues.push(dif[i]!)
    }
  }

  // DEA = EMA9 of DIF values
  const deaFull = calcEMA(difValues, 9)
  const dea: (number | null)[] = new Array(closes.length).fill(null)
  let deaIdx = 0
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] !== null) {
      dea[i] = deaFull[deaIdx]
      deaIdx++
    }
  }

  const histogram: (number | null)[] = new Array(closes.length).fill(null)
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] !== null && dea[i] !== null) {
      histogram[i] = (dif[i]! - dea[i]!) * 2
    }
  }

  return { dif, dea, histogram }
}

/**
 * Bollinger Bands: middle = MA(period), upper/lower = middle ± multiplier * std
 */
export function calcBOLL(
  closes: number[],
  period: number,
  multiplier: number
): {
  upper: (number | null)[]
  middle: (number | null)[]
  lower: (number | null)[]
} {
  const upper: (number | null)[] = new Array(closes.length).fill(null)
  const middle: (number | null)[] = new Array(closes.length).fill(null)
  const lower: (number | null)[] = new Array(closes.length).fill(null)

  if (closes.length < period) return { upper, middle, lower }

  // Compute rolling std
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)

    middle[i] = mean
    upper[i] = mean + multiplier * std
    lower[i] = mean - multiplier * std
  }

  return { upper, middle, lower }
}

/**
 * KDJ indicator
 * RSV = (close - lowest_low) / (highest_high - lowest_low) * 100
 */
export function calcKDJ(
  highs: number[],
  lows: number[],
  closes: number[]
): {
  k: (number | null)[]
  d: (number | null)[]
  j: (number | null)[]
} {
  const n = closes.length
  const period = 9
  const k: (number | null)[] = new Array(n).fill(null)
  const d: (number | null)[] = new Array(n).fill(null)
  const j: (number | null)[] = new Array(n).fill(null)

  if (n < period) return { k, d, j }

  let prevK = 50
  let prevD = 50

  for (let i = period - 1; i < n; i++) {
    const sliceHigh = highs.slice(i - period + 1, i + 1)
    const sliceLow = lows.slice(i - period + 1, i + 1)
    const highest = Math.max(...sliceHigh)
    const lowest = Math.min(...sliceLow)
    const rsv = highest === lowest ? 50 : ((closes[i] - lowest) / (highest - lowest)) * 100

    prevK = (2 / 3) * prevK + (1 / 3) * rsv
    prevD = (2 / 3) * prevD + (1 / 3) * prevK
    const curJ = 3 * prevK - 2 * prevD

    k[i] = Math.round(prevK * 100) / 100
    d[i] = Math.round(prevD * 100) / 100
    j[i] = Math.round(curJ * 100) / 100
  }

  return { k, d, j }
}

/**
 * RSI (Relative Strength Index)
 * Uses Wilder's smoothing method
 */
export function calcRSI(closes: number[], period: number): (number | null)[] {
  const n = closes.length
  const result: (number | null)[] = new Array(n).fill(null)
  if (n < period + 1) return result

  // First gains/losses average (simple average of first `period` changes)
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= period
  avgLoss /= period

  if (avgLoss === 0) {
    result[period] = 100
  } else {
    const rs = avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  // Wilder's smoothing for subsequent values
  for (let i = period + 1; i < n; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) {
      result[i] = 100
    } else {
      const rs = avgGain / avgLoss
      result[i] = 100 - 100 / (1 + rs)
    }
  }

  return result
}
